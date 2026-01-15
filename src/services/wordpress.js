import axios from 'axios';
import * as cheerio from 'cheerio';

const DEFAULT_POST_TYPES = ['carros', 'carro', 'veiculos', 'veiculo', 'cars', 'inventory'];

function buildAuthHeader(username, appPassword) {
  if (!username || !appPassword) return {};
  const token = Buffer.from(`${username}:${appPassword}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').trim();
}

function normalizeBase(url) {
  return url ? url.replace(/\/$/, '') : url;
}

function getOrigin(input) {
  if (!input) return null;
  try {
    const u = new URL(input);
    return `${u.protocol}//${u.host}`;
  } catch {
    const m = String(input).match(/^https?:\/\/[^/]+/i);
    return m ? m[0] : normalizeBase(input);
  }
}

export async function fetchWordPressCars() {
  const baseUrl = process.env.WORDPRESS_URL;
  const username = process.env.WORDPRESS_USERNAME;
  const appPassword = process.env.WORDPRESS_APP_PASSWORD;
  const preferredPostType = process.env.WORDPRESS_POST_TYPE;
  const stockUrl = process.env.WORDPRESS_STOCK_URL;

  if (!baseUrl) throw new Error('WORDPRESS_URL não configurada');
  const headers = buildAuthHeader(username, appPassword);
  const origin = getOrigin(baseUrl);
  const postType = await discoverPostType(origin, preferredPostType, headers);
  if (postType) {
    const url = `${origin}/wp-json/wp/v2/${postType}?status=publish&per_page=100&_embed=1`;
    try {
      const { data } = await axios.get(url, { headers, timeout: 20000 });
      return (data || []).map(mapPostToCar);
    } catch (err) {
      const status = err?.response?.status;
      const payload = err?.response?.data;
      const hint = status === 401 || status === 403 ? 'Verifique WORDPRESS_USERNAME/WORDPRESS_APP_PASSWORD ou restrições da REST API.' : '';
      throw new Error(`Falha ao consultar WordPress (${status ?? 'sem status'}): ${formatErr(payload || err)} ${hint}`.trim());
    }
  }

  // Fallback 1: se houver página de estoque configurada, raspa e retorna
  if (stockUrl) {
    try {
      const cars = await fetchCarsFromStockPage(stockUrl);
      if (cars.length) return cars;
    } catch (e) {
      // Continua para fallback de posts se raspagem falhar
    }
  }

  // Fallback 2: usar posts com filtro por categoria configurável
  const categorySlug = process.env.WORDPRESS_CATEGORY_SLUG;
  let categoryId = null;
  if (categorySlug) {
    categoryId = await resolveCategoryId(origin, categorySlug, headers);
  } else {
    // Tenta descobrir automaticamente uma categoria relacionada a carros
    categoryId = await discoverCarCategory(origin, headers);
  }
  const postsUrl = `${origin}/wp-json/wp/v2/posts?status=publish&per_page=100&_embed=1${categoryId ? `&categories=${categoryId}` : ''}`;
  try {
    const { data } = await axios.get(postsUrl, { headers, timeout: 20000 });
    return (data || []).map(mapPostToCar);
  } catch (err) {
    const status = err?.response?.status;
    const payload = err?.response?.data;
    const hint = status === 401 || status === 403 ? 'Verifique credenciais ou restrições da REST API.' : '';
    throw new Error(`Falha ao consultar posts (${status ?? 'sem status'}): ${formatErr(payload || err)} ${hint}`.trim());
  }
}

async function discoverPostType(baseUrl, preferred, headers) {
  // Tenta o preferido primeiro, depois os padrões
  const candidates = preferred ? [preferred, ...DEFAULT_POST_TYPES.filter(p => p !== preferred)] : DEFAULT_POST_TYPES;
  for (const t of candidates) {
    const url = `${baseUrl}/wp-json/wp/v2/${t}?per_page=1`;
    try {
      const resp = await axios.get(url, {
        headers,
        timeout: 12000,
        validateStatus: s => s < 500, // não estourar exceção em 404
      });
      if (resp.status === 200 && Array.isArray(resp.data)) return t;
      if (resp.status === 401 || resp.status === 403) {
        // Bloqueado: provavelmente precisa de auth ou REST restrita
        throw new Error('Acesso negado ao REST (401/403).');
      }
    } catch (e) {
      // Silencia e tenta o próximo, exceto se bloqueio explícito
      if (e?.message?.includes('Acesso negado')) throw e;
    }
  }
  return null;
}

function mapPostToCar(post) {
  const acf = post.acf || {};
  const embedded = post._embedded || {};

  const images = [];
  const featured = embedded['wp:featuredmedia']?.[0]?.source_url;
  if (featured) images.push(featured);
  if (Array.isArray(acf.photos)) {
    acf.photos.forEach(p => {
      if (typeof p === 'string') images.push(p);
      else if (p?.url) images.push(p.url);
    });
  }

  return {
    id: post.id,
    title: post.title?.rendered || post.slug,
    description: stripHtml(post.content?.rendered || ''),
    ...mergeExtractedFields({
      brand: acf.brand || acf.marca || null,
      model: acf.model || acf.modelo || null,
      version: acf.version || acf.versao || null,
      year: acf.year || acf.ano || null,
      price: acf.price || acf.preco || null,
      mileage: acf.mileage || acf.km || null,
      color: acf.color || acf.cor || null,
      fuel: acf.fuel || acf.combustivel || null,
      gearbox: acf.gearbox || acf.cambio || null,
    }, post),
    images: sanitizeImageList(images.length ? images : extractImagesFromContent(post.content?.rendered || '')),
  };
}

function formatErr(err) {
  if (typeof err === 'string') return err;
  if (err?.message) return err.message;
  try {
    return JSON.stringify(err).slice(0, 500);
  } catch {
    return String(err);
  }
}

async function resolveCategoryId(baseUrl, slug, headers) {
  try {
    const { data } = await axios.get(`${baseUrl}/wp-json/wp/v2/categories?slug=${encodeURIComponent(slug)}`, {
      headers,
      timeout: 12000,
    });
    const cat = Array.isArray(data) ? data[0] : null;
    return cat?.id || null;
  } catch {
    return null;
  }
}

async function discoverCarCategory(baseUrl, headers) {
  const KEYWORDS = ['carro', 'carros', 'veiculo', 'veículos', 'estoque', 'seminovos', 'automoveis', 'automóveis'];
  try {
    const { data } = await axios.get(`${baseUrl}/wp-json/wp/v2/categories?per_page=100`, {
      headers,
      timeout: 12000,
    });
    const list = Array.isArray(data) ? data : [];
    const scored = list.map(c => {
      const text = `${c.slug} ${c.name}`.toLowerCase();
      const score = KEYWORDS.reduce((acc, k) => (text.includes(k) ? acc + 1 : acc), 0);
      return { id: c.id, slug: c.slug, name: c.name, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.score ? scored[0].id : null;
  } catch {
    return null;
  }
}

function extractImagesFromContent(html) {
  const urls = [];
  const regex = /<img[^>]+src=["']([^"'>]+)["'][^>]*>/gi;
  let m;
  while ((m = regex.exec(html)) && urls.length < 10) {
    urls.push(m[1]);
  }
  return urls;
}

function sanitizeImageList(list) {
  return (list || []).map(u => String(u).trim().replace(/`/g, '')).filter(Boolean);
}

function mergeExtractedFields(current, post) {
  const text = `${post.title?.rendered || ''} \n ${stripHtml(post.content?.rendered || '')}`;
  const extracted = extractCarFieldsFromText(text);
  return {
    brand: current.brand ?? extracted.brand ?? null,
    model: current.model ?? extracted.model ?? null,
    version: current.version ?? extracted.version ?? null,
    year: current.year ?? extracted.year ?? null,
    price: current.price ?? extracted.price ?? null,
    mileage: current.mileage ?? extracted.mileage ?? null,
    color: current.color ?? extracted.color ?? null,
    fuel: current.fuel ?? extracted.fuel ?? null,
    gearbox: current.gearbox ?? extracted.gearbox ?? null,
  };
}

function extractCarFieldsFromText(text) {
  const t = (text || '').toLowerCase();
  const getPrice = () => {
    const m = t.match(/r\$\s*([\d\.\,]+)/i) || t.match(/preço[:\s]*([\d\.\,]+)/i);
    if (!m) return null;
    const n = m[1].replace(/\./g, '').replace(/,/g, '.');
    const val = parseFloat(n);
    return Number.isFinite(val) ? Math.round(val) : null;
  };
  const getYear = () => {
    const m = t.match(/(19\d{2}|20\d{2})/);
    return m ? parseInt(m[1], 10) : null;
  };
  const getKm = () => {
    const m = t.match(/(\d+[\.\d]*)\s*km/) || t.match(/km[:\s]*([\d\.\,]+)/);
    if (!m) return null;
    const n = m[1].replace(/\./g, '').replace(/,/g, '');
    const val = parseInt(n, 10);
    return Number.isFinite(val) ? val : null;
  };
  const getFuel = () => {
    if (t.includes('flex')) return 'Flex';
    if (t.includes('gasolina')) return 'Gasolina';
    if (t.includes('diesel')) return 'Diesel';
    if (t.includes('etanol') || t.includes('álcool')) return 'Etanol';
    return null;
  };
  const getGearbox = () => {
    if (t.includes('automático') || t.includes('automatico')) return 'Automático';
    if (t.includes('manual')) return 'Manual';
    if (t.includes('cvt')) return 'CVT';
    return null;
  };
  const COLORS = ['preto','branco','prata','cinza','vermelho','azul','verde','marrom','bege'];
  const getColor = () => COLORS.find(c => t.includes(c))?.replace(/^./, s => s.toUpperCase()) || null;
  const BRANDS = ['fiat','chevrolet','gm','volkswagen','vw','ford','toyota','honda','hyundai','renault','peugeot','citroën','citroen','bmw','mercedes','audi','nissan','jeep','kia','land rover','volvo'];
  const getBrandModel = () => {
    const title = (postTitle(text) || '').toLowerCase();
    for (const b of BRANDS) {
      const i = title.indexOf(b);
      if (i >= 0) {
        const rest = title.slice(i + b.length).trim();
        const tokens = rest.split(/\s+/).filter(Boolean);
        const model = tokens.slice(0, 3).join(' ').trim();
        return { brand: capitalize(b), model: model || null };
      }
    }
    return { brand: null, model: null };
  };
  const bm = getBrandModel();
  return {
    brand: bm.brand,
    model: bm.model,
    version: null,
    year: getYear(),
    price: getPrice(),
    mileage: getKm(),
    color: getColor(),
    fuel: getFuel(),
    gearbox: getGearbox(),
  };
}

function postTitle(text) {
  return (text || '').split('\n')[0];
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

async function fetchCarsFromStockPage(stockUrl) {
  const { data: html } = await axios.get(stockUrl, { timeout: 20000 });
  const $ = cheerio.load(html);
  const items = [];

  // Estratégia de coleta de links de veículos e paginação
  const origin = getOrigin(stockUrl);
  const detailLinks = await collectDetailLinksFromStock(stockUrl);
  for (const link of detailLinks) {
    try {
      const { data: detailHtml } = await axios.get(link, { timeout: 20000 });
      const d$ = cheerio.load(detailHtml);

      const title = d$('h1, h2, .title, .titulo').first().text().trim()
        || d$('meta[property="og:title"]').attr('content')?.trim()
        || d$('title').text().trim();

      const imgs = [];
      d$('img').each((j, img) => { const src = d$(img).attr('src'); if (src) imgs.push(src); });
      const pageText = d$('body').text().trim();
      const extracted = extractCarFieldsFromText(`${title}\n${pageText}`);

      const hasSignals = extracted.price || extracted.mileage || extracted.year || imgs.length > 0;
      if (!title || !hasSignals) continue;

      items.push({
        id: link,
        title,
        description: '',
        ...extracted,
        images: sanitizeImageList(imgs),
      });
    } catch (e) {
      // Ignora erros individuais de páginas detalhe
    }
  }
  if (items.length) return dedupeCars(items);

  const candidates = $('article, .car, .vehicle, .estoque, .estoque-item, .listing, .card, .product, li');
  candidates.each((i, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    const title = $el.find('h1,h2,h3,.title,.titulo').first().text().trim() || $el.find('a').first().text().trim();
    const link = $el.find('a[href]').first().attr('href') || null;
    const imgs = [];
    $el.find('img').each((j, img) => { const src = $(img).attr('src'); if (src) imgs.push(src); });

    const extracted = extractCarFieldsFromText(text || title);
    const hasSignals = extracted.price || extracted.mileage || extracted.year;
    if (!title || (!hasSignals && imgs.length === 0)) return;

    items.push({
      id: link || `${i}`,
      title,
      description: '',
      ...extracted,
      images: sanitizeImageList(imgs),
    });
  });

  // Se não encontrou com os candidatos, tenta uma heurística por seções
  if (items.length === 0) {
    $('section, div').each((i, sec) => {
      const $sec = $(sec);
      if (!/estoque|carros|veiculos|seminovos/i.test($sec.attr('class') || '') && !/estoque|carros|veiculos|seminovos/i.test(($sec.attr('id') || ''))) return;
      const secText = $sec.text().trim();
      const extracted = extractCarFieldsFromText(secText);
      if (!(extracted.price || extracted.mileage || extracted.year)) return;
      const title = $sec.find('h1,h2,h3,.title,.titulo').first().text().trim() || null;
      const imgs = [];
      $sec.find('img').each((j, img) => { const src = $(img).attr('src'); if (src) imgs.push(src); });
      items.push({ id: `sec-${i}`, title: title || 'Carro', description: '', ...extracted, images: sanitizeImageList(imgs) });
    });
  }

  return dedupeCars(items);
}

function dedupeCars(items) {
  // Deduplica por título+ano+preço
  const seen = new Set();
  const unique = [];
  for (const it of items) {
    const key = `${(it.title || '').toLowerCase()}-${it.year || ''}-${it.price || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(it);
  }
  return unique;
}

function toAbsolute(href, origin) {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('/')) return origin + href;
  return origin + '/' + href;
}

async function collectDetailLinksFromStock(stockUrl) {
  const origin = getOrigin(stockUrl);
  const queue = [stockUrl];
  const visited = new Set();
  const found = new Set();
  const MAX_PAGES = 10;

  while (queue.length && visited.size < MAX_PAGES) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const { data: html } = await axios.get(url, { timeout: 20000 });
      const $ = cheerio.load(html);
      $('a[href*="/carro/"]').each((i, a) => {
        const href = $(a).attr('href');
        const abs = toAbsolute(href, origin);
        if (abs && /\/carro\//.test(abs)) found.add(abs);
      });

      // Coleta links de paginação comuns
      const paginationSelectors = [
        'a[rel="next"]',
        '.pagination a',
        'a.next',
        'a[href*="/page/"]',
        'a[href*="?pagina="]',
      ];
      for (const sel of paginationSelectors) {
        $(sel).each((i, a) => {
          const href = $(a).attr('href');
          const abs = toAbsolute(href, origin);
          if (abs && !visited.has(abs) && !queue.includes(abs)) queue.push(abs);
        });
      }

      // Também tenta pelo texto
      $('a').each((i, a) => {
        const txt = ($(a).text() || '').toLowerCase();
        if (txt.includes('próxima') || txt.includes('mais') || txt.includes('next')) {
          const href = $(a).attr('href');
          const abs = toAbsolute(href, origin);
          if (abs && !visited.has(abs) && !queue.includes(abs)) queue.push(abs);
        }
      });
    } catch (e) {
      // ignora página com erro e segue
    }
  }

  return Array.from(found);
}

export async function fetchWordPressTypes() {
  const origin = getOrigin(process.env.WORDPRESS_URL);
  const username = process.env.WORDPRESS_USERNAME;
  const appPassword = process.env.WORDPRESS_APP_PASSWORD;
  const preferredPostType = process.env.WORDPRESS_POST_TYPE;
  if (!origin) throw new Error('WORDPRESS_URL não configurada');
  const headers = buildAuthHeader(username, appPassword);

  // Lista tipos expostos na REST
  let typesData = {};
  try {
    const { data } = await axios.get(`${origin}/wp-json/wp/v2/types`, {
      headers,
      timeout: 15000,
    });
    typesData = data || {};
  } catch (err) {
    const status = err?.response?.status;
    const payload = err?.response?.data;
    const hint = status === 401 || status === 403 ? 'Verifique credenciais ou restrições da REST API.' : '';
    throw new Error(`Falha ao listar types (${status ?? 'sem status'}): ${formatErr(payload || err)} ${hint}`.trim());
  }

  const types = Object.keys(typesData).map(k => ({ slug: k, label: typesData[k]?.name || k }));
  const present = new Set(types.map(t => t.slug));
  const guessFromTypes = (() => {
    const candidates = preferredPostType ? [preferredPostType, ...DEFAULT_POST_TYPES.filter(c => c !== preferredPostType)] : DEFAULT_POST_TYPES;
    for (const c of candidates) if (present.has(c)) return c;
    return null;
  })();

  // Verifica endpoints candidatos (responses e status)
  const candidateStatus = {};
  const toCheck = preferredPostType ? [preferredPostType, ...DEFAULT_POST_TYPES.filter(c => c !== preferredPostType)] : DEFAULT_POST_TYPES;
  for (const c of toCheck) {
    try {
      const resp = await axios.get(`${origin}/wp-json/wp/v2/${c}?per_page=1`, {
        headers,
        timeout: 10000,
        validateStatus: s => s < 500,
      });
      candidateStatus[c] = { status: resp.status, ok: resp.status === 200, count: Array.isArray(resp.data) ? resp.data.length : undefined };
    } catch (err) {
      candidateStatus[c] = { status: null, ok: false, error: formatErr(err) };
    }
  }

  return { types, guess: guessFromTypes, candidates: candidateStatus };
}