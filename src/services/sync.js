import { fetchWordPressCars } from './wordpress.js';
import { publishToWebmotors } from './portals/webmotors.js';
import { publishToCarrosP } from './portals/carrosp.js';
import { publishToNaPista } from './portals/napista.js';
import { addSyncedPlatform } from './db.js';

export async function syncCars(targets = [], selectedCarIds = null) {
  let cars = await fetchWordPressCars();
  
  if (selectedCarIds && Array.isArray(selectedCarIds) && selectedCarIds.length > 0) {
    cars = cars.filter(car => selectedCarIds.includes(String(car.id)));
  }

  const results = [];

  for (const car of cars) {
    for (const t of targets) {
      try {
        let r;
        if (t === 'webmotors') r = await publishToWebmotors(car);
        else if (t === 'carrosp') r = await publishToCarrosP(car);
        else if (t === 'napista') r = await publishToNaPista(car);
        else r = { portal: t, carId: car.id, status: 'error', error: 'Portal desconhecido' };
        
        if (r.status === 'success') {
          await addSyncedPlatform(car.id, t);
        }
        
        results.push(r);
      } catch (e) {
        results.push({ portal: t, carId: car.id, status: 'error', error: e.message });
      }
    }
  }

  return { totalCars: cars.length, targets, results };
}