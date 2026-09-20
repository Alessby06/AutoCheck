const BrowserHelper = require('../src/utils/browserHelper');

async function testSelectOptions() {
  let page = null;
  try {
    const browser = await BrowserHelper.getBrowser();
    page = await browser.newPage();
    await page.goto('https://www.sat.gob.pe/VirtualSAT/principal.aspx', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const url = page.url();
    const mysession = new URL(url).searchParams.get('mysession');
    const tributarioUrl = `https://www.sat.gob.pe/VirtualSAT/modulos/BusquedaTributario.aspx?mysession=${encodeURIComponent(mysession)}&tri=V`;
    await page.goto(tributarioUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const options = await page.evaluate(() => {
      const sel = document.getElementById('tipoBusqueda');
      if (!sel) return [];
      return Array.from(sel.options).map(o => ({ value: o.value, text: o.text }));
    });
    console.log('Opciones de tipoBusqueda en BusquedaTributario:', JSON.stringify(options, null, 2));
  } catch(e) {
    console.error('Error:', e);
  } finally {
    if (page) await BrowserHelper.closePage(page);
    await BrowserHelper.cleanupAll();
    process.exit(0);
  }
}

testSelectOptions();
