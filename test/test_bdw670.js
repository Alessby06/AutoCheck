const VehicleService = require('../src/services/vehicleService');
const BrowserHelper = require('../src/utils/browserHelper');

async function test() {
  console.log('🧪 Iniciando prueba de VehicleService con placa BDW-670...');
  try {
    const report = await VehicleService.queryComplete('BDW-670');
    console.log('\n==============================================');
    console.log('📊 REPORTE CONSOLIDADO BDW-670:');
    console.log('==============================================');
    console.log('Placa:', report.plate);
    console.log('Riesgo Global:', report.overallRisk);
    console.log('Deuda Consolidada Total PEN: S/', report.totalDebtConsolidatedPEN);
    console.log('Alertas:', JSON.stringify(report.alerts, null, 2));
    console.log('\n--- MÓDULO SAT LIMA ---');
    console.log('SAT Success:', report.modules.satLima.success);
    console.log('SAT Source:', report.modules.satLima.source);
    console.log('SAT Has Fines:', report.modules.satLima.data?.hasFines);
    console.log('SAT Total Fines:', report.modules.satLima.data?.totalFines);
    console.log('SAT Total Debt PEN: S/', report.modules.satLima.data?.totalDebtPEN);
    console.log('SAT Records:', JSON.stringify(report.modules.satLima.data?.records, null, 2));
    console.log('\n--- MÓDULO SAT CAPTURAS ---');
    console.log('SAT Capturas Has Capture Order:', report.modules.satCaptura.data?.hasCaptureOrder);
    console.log('SAT Capturas Total:', report.modules.satCaptura.data?.totalCaptures);
  } catch (err) {
    console.error('❌ Error en test:', err);
  } finally {
    await BrowserHelper.cleanupAll();
    process.exit(0);
  }
}

test();
