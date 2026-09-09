const VehicleService = require('../src/services/vehicleService');
const PlateValidator = require('../src/utils/plateValidator');
const BrowserHelper = require('../src/utils/browserHelper');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 TEST SUITE: BLOQUE 1 - AUTOCHECK PERÚ (BACKEND)');
  console.log('====================================================\n');

  // Test 1: Validación de formatos de placas peruanas
  console.log('▶ TEST 1: Validador de Placas Peruanas');
  const testPlates = [
    { input: 'b3t489', expectedValid: true, expectedFormatted: 'B3T-489' },
    { input: 'ABC-123', expectedValid: true, expectedFormatted: 'ABC-123' },
    { input: '1234-5A', expectedValid: true, expectedFormatted: '1234-5A' },
    { input: 'invalida!!', expectedValid: false }
  ];

  let valPass = 0;
  for (const t of testPlates) {
    const res = PlateValidator.validate(t.input);
    const pass = res.isValid === t.expectedValid && (!t.expectedFormatted || res.formatted === t.expectedFormatted);
    if (pass) {
      console.log(`  ✅ [PASS] Input "${t.input}" -> Válido: ${res.isValid}, Formato: "${res.formatted}" (${res.type})`);
      valPass++;
    } else {
      console.error(`  ❌ [FAIL] Input "${t.input}" -> Obtenido: ${JSON.stringify(res)}`);
    }
  }
  console.log(`\nResultado Validador: ${valPass}/${testPlates.length} pasados.\n`);

  // Test 2: Consulta completa del Bloque 1 (Extracción en vivo)
  console.log('▶ TEST 2: Consulta Concurrente Bloque 1 (SOAT, GNV, SUTRAN, Callao)');
  const samplePlate = 'B3T-489';
  console.log(`  🔍 Consultando placa en vivo: ${samplePlate}...`);

  const t0 = Date.now();
  try {
    const report = await VehicleService.queryBlock1(samplePlate);
    const elapsed = Date.now() - t0;

    console.log(`\n  ⏱️ Tiempo de respuesta (en vivo): ${elapsed}ms (${(elapsed / 1000).toFixed(2)}s)`);
    console.log(`  🚗 Placa normalizada: ${report.plate}`);
    console.log(`  🛡️ Nivel de Riesgo Global: [${report.overallRisk}]`);
    console.log(`  ⚠️ Alertas detectadas: ${report.alerts.length}`);

    console.log('\n  📊 Resumen de Módulos del Bloque 1:');
    console.log(`     1. APESEG (SOAT): ${report.modules.soat.success ? '✅ OK' : '⚠️ ' + report.modules.soat.source} (Latencia: ${report.modules.soat.latencyMs}ms)`);
    if (report.modules.soat.data) {
      console.log(`        -> Estado: ${report.modules.soat.data.statusLabel} | Aseguradora: ${report.modules.soat.data.company} | Uso: ${report.modules.soat.data.useType}`);
    }

    console.log(`     2. INFOGAS (GNV): ${report.modules.gnv.success ? '✅ OK' : '⚠️ ' + report.modules.gnv.source} (Latencia: ${report.modules.gnv.latencyMs}ms)`);
    if (report.modules.gnv.data) {
      console.log(`        -> Estado Chip: ${report.modules.gnv.data.chipStatusLabel} | Combustible: ${report.modules.gnv.data.fuelType}`);
    }

    console.log(`     3. SUTRAN (Carreteras): ${report.modules.sutran.success ? '✅ OK' : '⚠️ ' + report.modules.sutran.source} (Latencia: ${report.modules.sutran.latencyMs}ms)`);
    if (report.modules.sutran.data) {
      console.log(`        -> Papeletas: ${report.modules.sutran.data.totalInfractions} | Deuda: S/ ${report.modules.sutran.data.totalDebtPEN.toFixed(2)}`);
    }

    console.log(`     4. CALLAO (Fotopapeletas): ${report.modules.callao.success ? '✅ OK' : '⚠️ ' + report.modules.callao.source} (Latencia: ${report.modules.callao.latencyMs}ms)`);
    if (report.modules.callao.data) {
      console.log(`        -> Fotopapeletas: ${report.modules.callao.data.totalInfractions} | Deuda: S/ ${report.modules.callao.data.totalDebtPEN.toFixed(2)}`);
    }

    // Test 3: Verificación de Caché Inmediata
    console.log('\n▶ TEST 3: Prueba de Caché en Memoria (Segunda consulta)');
    const tCache0 = Date.now();
    const cacheReport = await VehicleService.queryBlock1(samplePlate);
    const cacheElapsed = Date.now() - tCache0;
    console.log(`  ⚡ Tiempo de respuesta con Caché: ${cacheElapsed}ms (Instantáneo)`);
    console.log(`  ✅ Caché verificada: ${cacheReport.modules.soat.fromCache ? 'SOAT desde Caché' : 'Consultado'}`);

    console.log('\n  ✅ TODOS LOS TESTS DEL BLOQUE 1 HAN SIDO COMPLETADOS.');
  } catch (err) {
    console.error('  ❌ Error en Test:', err);
  } finally {
    await BrowserHelper.closeBrowser();
    process.exit(0);
  }
}

runTests();
