const MtcCitvScraper = require('../src/scrapers/mtcCitvScraper');
const SatLimaScraper = require('../src/scrapers/satLimaScraper');
const InfogasScraper = require('../src/scrapers/infogasScraper');
const SutranScraper = require('../src/scrapers/sutranScraper');
const CallaoScraper = require('../src/scrapers/callaoScraper');
const AtuScraper = require('../src/scrapers/atuScraper');
const SunarpScraper = require('../src/scrapers/sunarpScraper');
const ApesegScraper = require('../src/scrapers/apesegScraper');
const BrowserHelper = require('../src/utils/browserHelper');

const PLATE = 'W2E444';

async function testScraper(name, fn, timeoutMs = 30000) {
  console.log(`\n==============================================`);
  console.log(`🔍 [PROBANDO] ${name}...`);
  console.log(`==============================================`);
  const start = Date.now();
  try {
    const timer = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout de ${timeoutMs}ms excedido`)), timeoutMs)
    );
    const result = await Promise.race([fn(), timer]);
    const duration = Date.now() - start;
    console.log(`⏱️ Duración: ${duration}ms`);
    console.log(`Resultado:`, JSON.stringify(result, null, 2));
    return { name, success: result?.success !== false, duration, result };
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`❌ [ERROR en ${name}] (${duration}ms):`, err.message || err);
    return { name, success: false, duration, error: err.message };
  } finally {
    try {
      await BrowserHelper.cleanupAll();
    } catch(e) {}
  }
}

async function run() {
  console.log(`🚀 Iniciando auditoría individual de scrapers para la placa: ${PLATE}`);
  const results = [];

  // 1. Scrapers HTTP / Axios rápidos primero
  results.push(await testScraper('1. SUTRAN (Infracciones carreteras)', () => SutranScraper.query(PLATE), 15000));
  results.push(await testScraper('2. CALLAO (Fotopapeletas)', () => CallaoScraper.query(PLATE), 15000));
  results.push(await testScraper('3. ATU (Fiscalización Transporte)', () => AtuScraper.query(PLATE), 35000));
  results.push(await testScraper('4. INFOGAS (GNV / GNC)', () => InfogasScraper.query(PLATE), 15000));
  results.push(await testScraper('5. SAT LIMA (Papeletas, Impuestos y Capturas)', () => SatLimaScraper.query(PLATE), 35000));
  results.push(await testScraper('6. MTC CITV (Revisión Técnica)', () => MtcCitvScraper.query(PLATE), 30000));

  // 2. Scrapers con Puppeteer / Navegador
  results.push(await testScraper('9. APESEG (SOAT en vivo)', () => ApesegScraper.query(PLATE), 45000));
  results.push(await testScraper('10. SUNARP (Datos Vehiculares)', () => SunarpScraper.query(PLATE), 45000));

  console.log(`\n==============================================`);
  console.log(`📊 RESUMEN FINAL DE SCRAPERS (Placa ${PLATE})`);
  console.log(`==============================================`);
  for (const r of results) {
    const status = r.success ? '✅ OK' : '❌ ERROR';
    console.log(`${r.name.padEnd(40)} | ${status} | ${r.duration}ms ${r.error ? `(${r.error})` : ''}`);
  }
  process.exit(0);
}

run();
