const express = require('express');
const cors = require('cors');
const path = require('path');
const VehicleService = require('./src/services/vehicleService');
const PlateValidator = require('./src/utils/plateValidator');

// Silenciar advertencias benignas de EPERM al limpiar temporales de Chrome en Windows
process.on('uncaughtException', (err) => {
  if (err.code === 'EPERM' && err.path && err.path.includes('lighthouse')) {
    return; // Ignorar descriptor temporal bloqueado por el sistema operativo
  }
  console.error('[UncaughtException]', err);
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Servir la interfaz web estática
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint de verificación de estado
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'AutoCheck Perú - Motor de Auditoría Vehicular'
  });
});

// Endpoint principal: Reporte Integral por Placa
app.get('/api/vehicle/report', async (req, res) => {
  try {
    const rawPlate = req.query.plate || req.query.placa;

    if (!rawPlate) {
      return res.status(400).json({
        success: false,
        error: 'Debe proporcionar una placa (ej: /api/vehicle/report?plate=B3T-489).'
      });
    }

    const advertisedKm = req.query.km ? parseInt(req.query.km, 10) : null;
    const report = await VehicleService.queryComplete(rawPlate, advertisedKm);

    return res.json({
      success: true,
      data: report
    });

  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Error al procesar la auditoría vehicular.'
    });
  }
});

// Compatibilidad retroactiva con endpoint del bloque 1
app.get('/api/vehicle/block1', async (req, res) => {
  try {
    const rawPlate = req.query.plate || req.query.placa;
    if (!rawPlate) {
      return res.status(400).json({ success: false, error: 'Parámetro "plate" requerido.' });
    }
    const report = await VehicleService.queryComplete(rawPlate);
    return res.json({ success: true, data: report });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n====================================================`);
  console.log(`🚀 [AutoCheck Perú] Servidor Activo en:`);
  console.log(`👉 Web para tu Padre: http://localhost:${PORT}`);
  console.log(`👉 API Reporte:       http://localhost:${PORT}/api/vehicle/report?plate=B3T-489`);
  console.log(`====================================================\n`);
});
