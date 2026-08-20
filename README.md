# Cars API — Distribuidor de Anúncios
API + painel web que sincroniza o estoque de veículos de um site **WordPress** (via REST API ou scraping da página de estoque) e distribui os anúncios para múltiplos portais automotivos — **Webmotors**, **CarrosP** e **NaPista**.

O projeto tem duas frentes: uma **API em Express** que busca, normaliza e publica os carros, e um **painel HTML/JS simples** (`public/index.html`, de nome fictício "Muvve Cars") onde o usuário seleciona quais carros e para quais portais sincronizar.

## Índice

- [Como funciona](#como-funciona)
- [Funcionalidades](#funcionalidades)
- [Stack](#stack)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Endpoints da API](#endpoints-da-api)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Rodando localmente](#rodando-localmente)
- [Deploy (Vercel)](#deploy-vercel)
- [Status dos portais / limitações conhecidas](#status-dos-portais--limitações-conhecidas)

## Como funciona

```
WordPress (REST API / scraping) → normalização dos dados → painel de seleção → POST /sync → portais (Webmotors, CarrosP, NaPista)
```

1. **Busca do estoque** (`src/services/wordpress.js`): a API tenta, em ordem de preferência:
   1. **REST API do WordPress** — descobre automaticamente o *custom post type* de carros (`carros`, `carro`, `veiculos`, `veiculo`, `cars`, `inventory`, ou o valor de `WORDPRESS_POST_TYPE`), com autenticação opcional via *Application Password*.
   2. **Scraping da página de estoque** (`WORDPRESS_STOCK_URL`), usando `axios` + `cheerio`: navega pelas páginas de listagem, segue paginação e extrai os dados de cada página de detalhe do veículo.
   3. **Posts genéricos do WordPress** filtrados por categoria (configurada ou descoberta automaticamente por palavras-chave como "carro", "estoque", "seminovos").
2. **Extração/normalização de campos**: quando o veículo tem campos ACF (Advanced Custom Fields), eles são usados diretamente (`marca`, `modelo`, `ano`, `preço`, `km`, `cor`, `combustível`, `câmbio` — com aliases em PT/EN). Quando não há ACF, um extrator por regex tenta inferir esses dados a partir do título/texto do anúncio (ex.: `R$ 45.000`, `2019`, `35.000 km`, palavras como "automático"/"flex").
3. **Persistência local** (`data/db.json` via `src/services/db.js`): guarda, por `carId`, em quais portais aquele carro já foi publicado — usado para exibir os badges de status no painel.
4. **Sincronização** (`src/services/sync.js`): recebe a lista de carros selecionados e os portais-alvo, e para cada combinação chama o conector correspondente, registrando sucesso/erro.
5. **Conectores de portal** (`src/services/portals/*.js`): cada um mapeia o objeto `car` para o payload esperado pelo portal e faz um `POST` autenticado com Bearer token. Se a URL/chave da API não estiver configurada, o conector retorna `status: "skipped"` em vez de falhar.

## Funcionalidades

- Painel web único (`/`) para visualizar o estoque, selecionar carros e portais de destino, e disparar a sincronização.
- Proxy de imagens (`/proxy-image`) para contornar hotlink protection/CORS de imagens hospedadas no WordPress.
- Descoberta automática do *custom post type*/categoria de carros no WordPress, com fallback em cascata (REST API → scraping → posts por categoria).
- Extração heurística de atributos do veículo quando o WordPress não expõe campos estruturados (ACF).
- Registro de quais carros já foram publicados em quais portais, com badges no painel.
- Endpoint de diagnóstico (`/wp/types`) para ajudar a identificar o *post type* correto de um WordPress específico.

## Stack

- **Node.js** (ESM, `"type": "module"`) + **Express 5**
- **axios** — requisições HTTP (WordPress REST API, portais, scraping)
- **cheerio** — parsing de HTML para o fallback de scraping
- **cors**, **dotenv**
- **nodemon** (dev)
- Front-end: HTML/CSS/JS puro, sem framework, servido como estático pelo próprio Express
- Deploy: **Vercel** (função serverless)

## Estrutura de pastas

```
├── api/
│   └── index.js            # entrypoint serverless da Vercel (reexporta o app Express)
├── public/
│   ├── index.html           # painel "Distribuidor de Anúncios"
│   └── imgs/                 # logo e favicon
├── src/
│   ├── server.js             # app Express: rotas, estáticos, health check
│   └── services/
│       ├── wordpress.js      # busca/normalização dos carros (REST API + scraping)
│       ├── sync.js           # orquestra a sincronização carro × portal
│       ├── db.js             # persistência simples em data/db.json
│       └── portals/
│           ├── webmotors.js
│           ├── carrosp.js
│           └── napista.js
├── data/
│   └── db.json               # estado de sincronização (carId → portais publicados)
├── vercel.json                # rewrites de todas as rotas para api/index.js
└── package.json
```

## Endpoints da API

| Método | Rota           | Descrição                                                                 |
|--------|----------------|-----------------------------------------------------------------------------|
| GET    | `/`            | Serve o painel web (`public/index.html`)                                    |
| GET    | `/health`      | Health check (`{ status: "ok" }`)                                           |
| GET    | `/cars`        | Lista os carros do WordPress, já com o status de sincronização por portal   |
| POST   | `/sync`        | Dispara a sincronização. Body: `{ targets: string[], selectedCarIds?: string[] }` |
| GET    | `/proxy-image` | Faz proxy de uma imagem externa. Query: `?url=<url-da-imagem>`              |
| GET    | `/wp/types`    | Diagnóstico: lista os *post types* expostos na REST API do WordPress e sugere qual usar |

## Variáveis de ambiente

Crie um arquivo `.env` na raiz (**nunca commitado** — veja [Segurança](#segurança)) com base neste modelo:

```bash
PORT=3001

# WordPress (obrigatório)
WORDPRESS_URL=https://seusite.com.br
WORDPRESS_USERNAME=usuario
WORDPRESS_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx   # Application Password do WordPress

# WordPress (opcionais — usados nos fallbacks)
WORDPRESS_POST_TYPE=carros              # custom post type, se souber
WORDPRESS_STOCK_URL=https://seusite.com.br/estoque/   # fallback de scraping
WORDPRESS_CATEGORY_SLUG=                # fallback por categoria de posts

# Portais de destino (opcionais — sem eles, o portal é "pulado" na sincronização)
WEBMOTORS_API_URL=
WEBMOTORS_API_KEY=
CARROSP_API_URL=
CARROSP_API_KEY=
NAPISTA_API_URL=
NAPISTA_API_KEY=
```

> Somente `WORDPRESS_URL` é estritamente obrigatório para a API subir e listar carros. Os demais campos de portal são opcionais — se ausentes, a sincronização para aquele portal retorna `status: "skipped"`.

## Rodando localmente

```bash
npm install
```

```bash
npm run dev
```

Isso sobe a API com `nodemon` em `http://localhost:3001` (ou na porta definida em `PORT`). Para rodar sem hot-reload:

```bash
npm start
```

Abra `http://localhost:3001` para ver o painel.

## Deploy (Vercel)

O projeto já está preparado para deploy serverless na Vercel:

- `api/index.js` reexporta o app Express como handler serverless.
- `vercel.json` reescreve todas as rotas para essa função.
- As variáveis de ambiente (`WORDPRESS_URL`, `WORDPRESS_APP_PASSWORD`, chaves dos portais etc.) devem ser configuradas no painel da Vercel (**Project Settings → Environment Variables**), não em um `.env` commitado.

⚠️ **Atenção**: `data/db.json` é usado como "banco de dados" local via sistema de arquivos. Em ambiente serverless (Vercel), o sistema de arquivos é **efêmero e somente leitura entre invocações** — ou seja, o histórico de "carro X já foi sincronizado com portal Y" **não persiste de forma confiável em produção**. Para persistir esse estado em produção, será necessário trocar `src/services/db.js` por um banco externo (ex.: Vercel KV, Postgres, Redis, etc.).

## Status dos portais / limitações conhecidas

- Os três conectores (`webmotors.js`, `carrosp.js`, `napista.js`) já têm o mapeamento de payload implementado, mas dependem de `API_URL`/`API_KEY` de cada portal — **atualmente nenhuma dessas integrações está configurada**, então na prática toda sincronização retorna `status: "skipped"` até que as credenciais reais de cada portal sejam obtidas e configuradas.
- A extração de dados por regex (`extractCarFieldsFromText`) é uma heurística best-effort para quando o WordPress não expõe campos ACF estruturados — pode falhar ou extrair valores incorretos em anúncios com texto fora do padrão esperado.
- O scraping de fallback (`fetchCarsFromStockPage`) depende da estrutura HTML do site de estoque e pode quebrar se o tema/layout do site mudar.
- Não há autenticação no painel web nem nos endpoints da API — qualquer pessoa com acesso à URL pode disparar `/sync`.
