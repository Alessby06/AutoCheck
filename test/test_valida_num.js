const BrowserHelper = require('../src/utils/browserHelper');

async function checkValidaSoloNumeros() {
  let page = null;
  try {
    const browser = await BrowserHelper.getBrowser();
    page = await browser.newPage();
    await page.goto('https://www.sat.gob.pe/VirtualSAT/principal.aspx', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const url = page.url();
    const mysession = new URL(url).searchParams.get('mysession');
    const tributarioUrl = `https://www.sat.gob.pe/VirtualSAT/modulos/BusquedaTributario.aspx?mysession=${encodeURIComponent(mysession)}&tri=V`;
    await page.goto(tributarioUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const funcCode = await page.evaluate(() => {
      return {
        validaSoloNumeros: typeof validaSoloNumeros !== 'undefined' ? validaSoloNumeros.toString() : 'undefined',
        codigoSAT: Array.from(document.querySelectorAll('script')).map(s => s.src || s.innerText.substring(0, 100))
      };
    });
    console.log('validaSoloNumeros function:', JSON.stringify(funcCode, null, 2));
  } catch(e) {
    console.error(e);
  } finally {
    if (page) await BrowserHelper.closePage(page);
    await BrowserHelper.cleanupAll();
    process.exit(0);
  }
}

checkValidaSoloNumeros();
