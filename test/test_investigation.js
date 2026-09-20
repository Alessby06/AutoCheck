const BrowserHelper = require('../src/utils/browserHelper');

async function testVirtualSatTributario() {
  console.log('--- Probando VirtualSAT BusquedaTributario.aspx?tri=V ---');
  let page = null;
  try {
    const browser = await BrowserHelper.getBrowser();
    page = await browser.newPage();
    await page.goto('https://www.sat.gob.pe/VirtualSAT/principal.aspx', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const url = page.url();
    const mysession = new URL(url).searchParams.get('mysession');
    console.log('Session obtenida:', mysession);
    
    if (!mysession) {
      throw new Error('No session');
    }
    
    const tributarioUrl = `https://www.sat.gob.pe/VirtualSAT/modulos/BusquedaTributario.aspx?mysession=${encodeURIComponent(mysession)}&tri=V`;
    console.log('Navegando a:', tributarioUrl);
    await page.goto(tributarioUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    
    const pageInfo = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, select, button')).map(el => ({
        id: el.id,
        name: el.name,
        type: el.type,
        value: el.value,
        tag: el.tagName
      }));
      const frames = Array.from(document.querySelectorAll('iframe')).map(f => f.src);
      const title = document.title;
      const textSample = document.body.innerText.substring(0, 500);
      return { title, inputs, frames, textSample };
    });
    
    console.log('Info de BusquedaTributario:', JSON.stringify(pageInfo, null, 2));
  } catch (err) {
    console.error('Error en testVirtualSatTributario:', err.message);
  } finally {
    if (page) await BrowserHelper.closePage(page);
  }
}

async function testMtc() {
  console.log('\n--- Probando MTC CITV con domcontentloaded ---');
  let page = null;
  try {
    const browser = await BrowserHelper.getBrowser();
    page = await browser.newPage();
    const start = Date.now();
    await page.goto('https://rec.mtc.gob.pe/Citv/ArConsultaCitv', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#imgCaptcha', { timeout: 15000 });
    console.log(`MTC cargó en ${Date.now() - start}ms!`);
  } catch (e) {
    console.error('Error MTC:', e.message);
  } finally {
    if (page) await BrowserHelper.closePage(page);
  }
}

async function testSutran() {
  console.log('\n--- Probando SUTRAN con domcontentloaded ---');
  let page = null;
  try {
    const browser = await BrowserHelper.getBrowser();
    page = await browser.newPage();
    const start = Date.now();
    await page.goto('https://webexterno.sutran.gob.pe/WebExterno/Pages/frmRecordInfracciones.aspx', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#txtPlaca', { timeout: 15000 });
    console.log(`SUTRAN cargó en ${Date.now() - start}ms!`);
  } catch (e) {
    console.error('Error SUTRAN:', e.message);
  } finally {
    if (page) await BrowserHelper.closePage(page);
  }
}

async function run() {
  await testVirtualSatTributario();
  await testMtc();
  await testSutran();
  await BrowserHelper.cleanupAll();
  process.exit(0);
}

run();
