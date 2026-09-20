const BrowserHelper = require('../src/utils/browserHelper');
const SatImpuestoVehicularScraper = require('../src/scrapers/satImpuestoVehicularScraper');

async function testSatDiagnostics(plate) {
  console.log(`\n======================================================`);
  console.log(`🔍 DIAGNÓSTICO PROFUNDO SAT LIMA PARA: ${plate}`);
  console.log(`======================================================`);
  
  const result = await SatImpuestoVehicularScraper.query(plate, false); // false = sin caché
  console.log('RESULTADO RESUMIDO:');
  console.log({
    success: result.success,
    hasTax: result.data?.hasTax,
    totalTax: result.data?.totalTax,
    totalTaxDebtPEN: result.data?.totalTaxDebtPEN,
    records: result.data?.taxRecords,
    contribuyente: result.data?.contribuyente,
    alertMessage: result.data?.alertMessage
  });
}

async function run() {
  await testSatDiagnostics('ABK-316');
  await BrowserHelper.cleanupAll();
  process.exit(0);
}

run();
