const VehicleService = require('../src/services/vehicleService');
const BrowserHelper = require('../src/utils/browserHelper');

// Placa real peruana nueva para auditoría en vivo
const PLATE = 'CSF-293';

async function runAudit() {
  console.log(`========================================================`);
  console.log(`🚀 INICIANDO AUDITORÍA EN VIVO PARA PLACA NUEVA: ${PLATE}`);
  console.log(`========================================================\n`);

  const startTime = Date.now();

  try {
    const report = await VehicleService.queryComplete(PLATE);
    const totalDuration = Date.now() - startTime;

    console.log(`\n========================================================`);
    console.log(`📊 REPORTE FINAL CONSOLIDADO (${totalDuration}ms)`);
    console.log(`========================================================`);
    console.log(`Placa: ${report.plate}`);
    console.log(`Riesgo Global: ${report.overallRisk}`);
    console.log(`Deuda Consolidada: S/ ${report.totalDebtConsolidatedPEN}`);
    console.log(`Alertas Activas: ${report.alerts.length}`);
    report.alerts.forEach((a, idx) => {
      console.log(`  [${idx + 1}] [${a.level}] ${a.title} -> ${a.message}`);
    });

    console.log(`\n--------------------------------------------------------`);
    console.log(`📋 AUDITORÍA OFICIAL DE LOS 10 SCRAPERS (AuditReporter):`);
    console.log(`--------------------------------------------------------`);
    if (report.scrapersAudit) {
      console.table(report.scrapersAudit.map(s => ({
        Scraper: s.name.substring(0, 32),
        Estado: s.status,
        Badge: s.badge,
        Latencia: `${s.latencyMs}ms`,
        Detalle: s.message.substring(0, 45)
      })));
    }

    console.log(`\n--------------------------------------------------------`);
    console.log(`🔍 AUDITORÍA DETALLADA MÓDULO POR MÓDULO:`);
    console.log(`--------------------------------------------------------`);

    const modules = report.modules;

    for (const [modName, modResult] of Object.entries(modules)) {
      const isSuccess = modResult && modResult.success === true;
      const statusIcon = isSuccess ? '✅ ÉXITO' : '❌ ERROR / NO DATA';
      const source = modResult?.source || 'N/D';
      const latency = modResult?.latencyMs ? `${modResult.latencyMs}ms` : 'N/D';
      const error = modResult?.error || (modResult?.data ? 'Ninguno' : 'Sin datos');

      console.log(`\n🔹 [${modName.toUpperCase()}] | ${statusIcon} | Latencia: ${latency} | Fuente: ${source}`);
      if (!isSuccess || modResult?.error) {
        console.log(`   ⚠️ Detalle Error: ${error}`);
      }
      
      // Resumen del contenido extraído por cada módulo
      if (modResult?.data) {
        if (modName === 'mtcCitv') {
          console.log(`   Certificados CITV: ${modResult.data.records?.length || 0} encontrados`);
          console.log(`   Estado: ${modResult.data.status || 'N/D'} | Vigente hasta: ${modResult.data.expirationDate || 'N/D'}`);
        } else if (modName === 'satLima') {
          console.log(`   Papeletas SAT: ${modResult.data.totalFines || 0} | Deuda: S/ ${modResult.data.totalDebtPEN || 0}`);
          console.log(`   Detalle: ${JSON.stringify(modResult.data.records || [])}`);
        } else if (modName === 'satCaptura') {
          console.log(`   Orden de Captura: ${modResult.data.hasCaptureOrder ? 'SÍ' : 'NO'} | Total: ${modResult.data.totalCaptures || 0}`);
        } else if (modName === 'sunarp') {
          console.log(`   Marca/Modelo: ${modResult.data.marca || 'N/D'} ${modResult.data.modelo || ''} | Estado: ${modResult.data.estado || 'N/D'}`);
          console.log(`   VIN: ${modResult.data.vin || 'N/D'} | Motor: ${modResult.data.motor || 'N/D'} | Color: ${modResult.data.color || 'N/D'}`);
        } else if (modName === 'apeseg') {
          console.log(`   SOAT Vigente: ${modResult.data.hasActiveSoat ? 'SÍ' : 'NO'} | Aseguradora: ${modResult.data.currentPolicy?.NombreCompania || 'N/D'}`);
          console.log(`   Vigencia: ${modResult.data.currentPolicy?.FechaInicio || 'N/D'} al ${modResult.data.currentPolicy?.FechaFin || 'N/D'}`);
          console.log(`   Historial de Pólizas: ${modResult.data.policyHistory?.length || 0} registros`);
        } else if (modName === 'infogas') {
          console.log(`   Conversión a Gas: ${modResult.data.hasGasConversion ? 'SÍ' : 'NO'} | Estado Chip: ${modResult.data.status || 'N/D'}`);
        } else if (modName === 'sutran') {
          console.log(`   Infracciones Carretera: ${modResult.data.totalInfractions || 0} | Deuda: S/ ${modResult.data.totalDebtPEN || 0}`);
        } else if (modName === 'callao') {
          console.log(`   Fotopapeletas Callao: ${modResult.data.totalInfractions || 0} | Deuda: S/ ${modResult.data.totalDebtPEN || 0}`);
        } else if (modName === 'atu') {
          console.log(`   Fiscalización ATU: ${modResult.data.records?.length || 0} actas | Deuda: S/ ${modResult.data.totalDebtPEN || 0}`);
        }
      }
    }

  } catch (err) {
    console.error(`\n❌ Error crítico durante la auditoría general:`, err);
  } finally {
    await BrowserHelper.cleanupAll();
    process.exit(0);
  }
}

runAudit();
