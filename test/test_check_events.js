const BrowserHelper = require('../src/utils/browserHelper');

async function checkEvents() {
  let page = null;
  try {
    const browser = await BrowserHelper.getBrowser();
    page = await browser.newPage();
    await page.goto('https://www.sat.gob.pe/VirtualSAT/principal.aspx', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const url = page.url();
    const mysession = new URL(url).searchParams.get('mysession');
    const tributarioUrl = `https://www.sat.gob.pe/VirtualSAT/modulos/BusquedaTributario.aspx?mysession=${encodeURIComponent(mysession)}&tri=V`;
    await page.goto(tributarioUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const handler = await page.evaluate(() => {
      // Simular cambio de select y ver qué campos hidden se modifican
      const sel = document.getElementById('tipoBusqueda');
      sel.value = 'divBuscaPlaca';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      
      return {
        hidTipConsulta: document.getElementById('ctl00_cplPrincipal_hidTipConsulta')?.value,
        hidPlaca: document.getElementById('ctl00_cplPrincipal_hidPlaca')?.value,
        divPlacaVisible: document.getElementById('ctl00_cplPrincipal_divBuscaPlaca')?.style?.display,
        btnSubmitOnclick: document.getElementById('ctl00_cplPrincipal_CaptchaContinue')?.getAttribute('onclick')
      };
    });
    
    console.log('Estado tras cambiar select a divBuscaPlaca:', JSON.stringify(handler, null, 2));
  } catch(e) {
    console.error(e);
  } finally {
    if (page) await BrowserHelper.closePage(page);
    await BrowserHelper.cleanupAll();
    process.exit(0);
  }
}

checkEvents();
