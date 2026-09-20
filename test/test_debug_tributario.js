const BrowserHelper = require('../src/utils/browserHelper');
const CaptchaSolver = require('../src/utils/captchaSolver');
const fs = require('fs');

async function debugTributario() {
  let page = null;
  try {
    const browser = await BrowserHelper.getBrowser();
    page = await browser.newPage();
    await page.goto('https://www.sat.gob.pe/VirtualSAT/principal.aspx', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const url = page.url();
    const mysession = new URL(url).searchParams.get('mysession');
    const tributarioUrl = `https://www.sat.gob.pe/VirtualSAT/modulos/BusquedaTributario.aspx?mysession=${encodeURIComponent(mysession)}&tri=V`;
    await page.goto(tributarioUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Extraer todo el HTML y scripts de la pagina
    const html = await page.content();
    fs.writeFileSync('test/tributario_dump.html', html);
    console.log('HTML guardado en test/tributario_dump.html. Longitud:', html.length);
    
    // Inspeccionar la logica del select #tipoBusqueda
    const jsLogic = await page.evaluate(() => {
      const sel = document.getElementById('tipoBusqueda');
      return {
        onchange: sel ? sel.getAttribute('onchange') : null,
        outerHTML: sel ? sel.outerHTML : null,
        placaInput: document.getElementById('ctl00_cplPrincipal_txtPlaca')?.outerHTML,
        hidTipConsulta: document.getElementById('ctl00_cplPrincipal_hidTipConsulta')?.outerHTML,
        hidPlaca: document.getElementById('ctl00_cplPrincipal_hidPlaca')?.outerHTML,
        allInputs: Array.from(document.querySelectorAll('input, select')).map(i => ({ id: i.id, name: i.name, value: i.value, style: i.getAttribute('style') }))
      };
    });
    
    console.log('Lógica de BusquedaTributario:', JSON.stringify(jsLogic, null, 2));
  } catch(e) {
    console.error('Error en debugTributario:', e);
  } finally {
    if (page) await BrowserHelper.closePage(page);
    await BrowserHelper.cleanupAll();
    process.exit(0);
  }
}

debugTributario();
