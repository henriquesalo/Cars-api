import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { fetchWordPressCars } from './services/wordpress.js';
import { fetchWordPressTypes } from './services/wordpress.js';
import { syncCars } from './services/sync.js';
import { getAllSyncedData } from './services/db.js';

// Corrigir __dirname em ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const app = express();
app.use(cors());
app.use(express.json());

// Servir estáticos
app.use(express.static(path.join(__dirname, '../public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Rotas básicas
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/proxy-image', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).end();
  }
  try {
    const response = await axios.get(url, { responseType: 'stream', timeout: 15000 });
    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }
    response.data.pipe(res);
  } catch (err) {
    res.status(502).end();
  }
});

app.get('/cars', async (req, res) => {
  try {
    const cars = await fetchWordPressCars();
    const syncedData = await getAllSyncedData();
    
    const carsWithPlatforms = cars.map(car => ({
      ...car,
      platforms: syncedData[car.id] || []
    }));

    res.json({ total: carsWithPlatforms.length, cars: carsWithPlatforms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint de sincronização
app.post('/sync', async (req, res) => {
  try {
    const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];
    const selectedCarIds = Array.isArray(req.body?.selectedCarIds) ? req.body.selectedCarIds : null;
    const summary = await syncCars(targets, selectedCarIds);
    res.json({ message: 'Sincronização concluída', ...summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint de diagnóstico: lista post types expostos na REST e sugere o slug de carros
app.get('/wp/types', async (req, res) => {
  try {
    const info = await fetchWordPressTypes();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API-Carros rodando na porta ${PORT}`);
});
