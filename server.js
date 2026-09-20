const express = require('express');
const cors = require('cors');
const path = require('path');
const VehicleService = require('./src/services/vehicleService');
const PlateValidator = require('./src/utils/plateValidator');

const fs = require('fs');

// Crear directorio de logs si no existe
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function logQuery(ip, plate, durationMs, success, errorMsg = '', report = null) {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const statusStr = success ? 'SUCCESS (200)' : `ERROR: ${errorMsg}`;
  let modulesSummary = '';
  if (report && report.modules) {
    modulesSummary = Object.entries(report.modules).map(([name, m]) => `${name}:${m.success ? 'OK' : 'ERR'}`).join(', ');
  }
  const logLine = `[${now}] IP: ${ip} | Placa: ${plate.padEnd(8)} | Duración: ${durationMs}ms | ${statusStr} ${modulesSummary ? `| Módulos: [${modulesSummary}]` : ''}\n`;
  try {
    fs.appendFileSync(path.join(logsDir, 'consultas.log'), logLine, 'utf8');
    if (report) {
      fs.writeFileSync(path.join(logsDir, 'latest_report.json'), JSON.stringify({ queryTime: now, plate, durationMs, report }, null, 2), 'utf8');
    }
  } catch (err) {
    console.warn('[Logger] Error escribiendo a consultas.log:', err.message);
  }
}

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

function printAuditConsoleTable(plate, scrapersAudit, durationMs) {
  console.log(`\n================================================================================`);
  console.log(`📊 [AUDITORÍA DE SCRAPERS] Placa: ${plate} | Tiempo Total: ${(durationMs / 1000).toFixed(2)}s`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(` # | Entidad / Scraper                          | Estado   | Latencia | Detalle`);
  console.log(`--------------------------------------------------------------------------------`);
  if (Array.isArray(scrapersAudit)) {
    scrapersAudit.forEach((item, idx) => {
      const num = (idx + 1).toString().padStart(2);
      const name = (item.name || item.id).padEnd(42).substring(0, 42);
      const status = (item.status || 'N/D').padEnd(8);
      const lat = `${item.latencyMs || 0}ms`.padStart(8);
      const msg = item.message ? item.message.substring(0, 60) : '';
      console.log(` ${num} | ${name} | ${status} | ${lat} | ${msg}`);
    });
  }
  console.log(`================================================================================\n`);
}

// Endpoint principal: Reporte Integral por Placa
app.get('/api/vehicle/report', async (req, res) => {
  const reqStart = Date.now();
  const rawPlate = req.query.plate || req.query.placa || '';
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  try {
    if (!rawPlate) {
      logQuery(clientIp, 'VACIA', Date.now() - reqStart, false, 'Placa no proporcionada');
      return res.status(400).json({
        success: false,
        error: 'Debe proporcionar una placa (ej: /api/vehicle/report?plate=B3T-489).'
      });
    }

    const advertisedKm = req.query.km ? parseInt(req.query.km, 10) : null;
    const report = await VehicleService.queryComplete(rawPlate, advertisedKm);
    const durationMs = Date.now() - reqStart;

    logQuery(clientIp, rawPlate, durationMs, true, '', report);
    printAuditConsoleTable(report.plate, report.scrapersAudit, durationMs);

    return res.json({
      success: true,
      data: report
    });

  } catch (err) {
    const durationMs = Date.now() - reqStart;
    logQuery(clientIp, rawPlate, durationMs, false, err.message);

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

// Limpieza ordenada al apagar el servidor
async function gracefulShutdown(signal) {
  console.log(`\n[Server] Señal ${signal} recibida. Cerrando navegadores y liberando recursos...`);
  try {
    await BrowserHelper.cleanupAll();
  } catch (e) {}
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

app.listen(PORT, () => {
  console.log(`\n====================================================`);
  console.log(`🚀 [AutoCheck Perú] Servidor Activo en:`);
  console.log(`👉 Web para tu Padre: http://localhost:${PORT}`);
  console.log(`👉 API Reporte:       http://localhost:${PORT}/api/vehicle/report?plate=B3T-489`);
  console.log(`====================================================\n`);
});
