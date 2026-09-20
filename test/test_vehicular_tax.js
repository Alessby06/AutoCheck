const BrowserHelper = require('../src/utils/browserHelper');
const CaptchaSolver = require('../src/utils/captchaSolver');

async function testBusquedaPlacaVehicular(plate) {
  console.log(`\n======================================================`);
  console.log(`🧪 Probando Impuesto Vehicular en VirtualSAT para: ${plate}`);
  console.log(`======================================================`);
  let page = null;
  try {
    const browser = await BrowserHelper.getBrowser();
    page = await browser.newPage();
    await page.goto('https://www.sat.gob.pe/VirtualSAT/principal.aspx', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const url = page.url();
    const mysession = new URL(url).searchParams.get('mysession');
    const tributarioUrl = `https://www.sat.gob.pe/VirtualSAT/modulos/BusquedaTributario.aspx?mysession=${encodeURIComponent(mysession)}&tri=V`;
    await page.goto(tributarioUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000));
    
    // Seleccionar busqueda por placa
    await page.select('#tipoBusqueda', 'divBuscaPlaca');
    await new Promise(r => setTimeout(r, 500));
    
    // Llenar placa
    await page.type('#ctl00_cplPrincipal_txtPlaca', plate.replace('-', ''), { delay: 30 });
    
    // Capturar y resolver captcha de imagen
    const captchaEl = await page.$('img[alt="Visual verification"]');
    if (!captchaEl) {
      throw new Error('No se encontró imagen captcha en BusquedaTributario');
    }
    
    const captchaBuffer = await captchaEl.screenshot();
    const code = CaptchaSolver.solve(captchaBuffer);
    console.log(`Captcha resuelto: "${code}"`);
    
    await page.type('#ctl00_cplPrincipal_txtCaptcha', code, { delay: 30 });
    await page.click('#ctl00_cplPrincipal_CaptchaContinue');
    
    await new Promise(r => setTimeout(r, 3500));
    
    const resultInfo = await page.evaluate(() => {
      const url = window.location.href;
      const bodyText = document.body.innerText;
      const tables = Array.from(document.querySelectorAll('table')).map(t => ({
        id: t.id,
        rows: Array.from(t.querySelectorAll('tr')).map(tr => 
          Array.from(tr.querySelectorAll('th, td')).map(td => td.innerText.trim())
        )
      }));
      return { url, bodySnippet: bodyText.substring(0, 600), tables };
    });
    
    console.log('Resultado de consulta Impuesto Vehicular:', JSON.stringify(resultInfo, null, 2));
  } catch(e) {
    console.error('Error en testBusquedaPlacaVehicular:', e.message);
  } finally {
    if (page) await BrowserHelper.closePage(page);
    await BrowserHelper.cleanupAll();
    process.exit(0);
  }
}

testBusquedaPlacaVehicular('BDW670');
