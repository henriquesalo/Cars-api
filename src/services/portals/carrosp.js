import axios from 'axios';

export async function publishToCarrosP(car) {
  const API_URL = process.env.CARROSP_API_URL;
  const API_KEY = process.env.CARROSP_API_KEY;
  if (!API_URL || !API_KEY) {
    return { portal: 'carrosp', carId: car.id, status: 'skipped', reason: 'API_URL/API_KEY não configurados' };
  }
  try {
    const payload = mapToCarrosP(car);
    const { data } = await axios.post(`${API_URL}/anuncios`, payload, {
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 20000,
    });
    return { portal: 'carrosp', carId: car.id, status: 'success', externalId: data?.id ?? null };
  } catch (err) {
    return { portal: 'carrosp', carId: car.id, status: 'error', error: formatErr(err) };
  }
}

function mapToCarrosP(car) {
  return {
    titulo: car.title,
    descricao: car.description,
    preco: car.price,
    veiculo: {
      marca: car.brand,
      modelo: car.model,
      versao: car.version,
      ano: car.year,
      km: car.mileage,
      cor: car.color,
      combustivel: car.fuel,
      cambio: car.gearbox,
    },
    fotos: car.images,
  };
}

function formatErr(err) {
  return err?.response?.data || err?.message || String(err);
}