import axios from 'axios';

export async function publishToWebmotors(car) {
  const API_URL = process.env.WEBMOTORS_API_URL;
  const API_KEY = process.env.WEBMOTORS_API_KEY;
  if (!API_URL || !API_KEY) {
    return { portal: 'webmotors', carId: car.id, status: 'skipped', reason: 'API_URL/API_KEY não configurados' };
  }
  try {
    const payload = mapToWebmotors(car);
    const { data } = await axios.post(`${API_URL}/listings`, payload, {
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 20000,
    });
    return { portal: 'webmotors', carId: car.id, status: 'success', externalId: data?.id ?? null };
  } catch (err) {
    return { portal: 'webmotors', carId: car.id, status: 'error', error: formatErr(err) };
  }
}

function mapToWebmotors(car) {
  return {
    title: car.title,
    description: car.description,
    price: car.price,
    vehicle: {
      brand: car.brand,
      model: car.model,
      version: car.version,
      year: car.year,
      mileage: car.mileage,
      color: car.color,
      fuel: car.fuel,
      gearbox: car.gearbox,
    },
    photos: car.images,
  };
}

function formatErr(err) {
  return err?.response?.data || err?.message || String(err);
}