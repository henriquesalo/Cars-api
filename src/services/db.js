import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '../../data/db.json');

async function ensureDb() {
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify({ synced: {} }, null, 2));
  }
}

async function readDb() {
  await ensureDb();
  const data = await fs.readFile(DB_PATH, 'utf-8');
  return JSON.parse(data);
}

async function writeDb(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

export async function getSyncedPlatforms(carId) {
  const db = await readDb();
  return db.synced[carId] || [];
}

export async function addSyncedPlatform(carId, platform) {
  const db = await readDb();
  if (!db.synced[carId]) {
    db.synced[carId] = [];
  }
  if (!db.synced[carId].includes(platform)) {
    db.synced[carId].push(platform);
    await writeDb(db);
  }
}

export async function getAllSyncedData() {
  const db = await readDb();
  return db.synced;
}
