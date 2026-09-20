const BrowserHelper = require('../src/utils/browserHelper');
const CaptchaSolver = require('../src/utils/captchaSolver');

async function testClickContribuyente(plate) {
  let page = null;
  try {
    const browser = await BrowserHelper.getBrowser();
    page = await browser.newPage();
    await page.goto('https://www.sat.gob.pe/VirtualSAT/principal.aspx', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const url = page.url();
    const mysession = new URL(url).searchParams.get('mysession');
    
    const tributarioUrl = `https://www.sat.gob.pe/VirtualSAT/modulos/BusquedaTributario.aspx?mysession=${encodeURIComponent(mysession)}&tri=V`;
    await page.goto(tributarioUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 600));

    await page.evaluate((placaVal) => {
      const sel = document.getElementById('tipoBusqueda');
      if (sel) {
        sel.value = 'divBuscaPlaca';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const hidTipo = document.getElementById('ctl00_cplPrincipal_hidTipConsulta');
      if (hidTipo) hidTipo.value = 'divBuscaPlaca';
      const txtPlaca = document.getElementById('ctl00_cplPrincipal_txtPlaca');
      if (txtPlaca) txtPlaca.value = placaVal;
    }, plate.replace('-', ''));

    const captchaEl = await page.$('img[alt="Visual verification"]');
    if (captchaEl) {
      const captchaBuffer = await captchaEl.screenshot();
      const code = CaptchaSolver.solve(captchaBuffer);
      await page.type('#ctl00_cplPrincipal_txtCaptcha', code, { delay: 20 });
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {}),
        page.click('#ctl00_cplPrincipal_CaptchaContinue')
      ]);
      await new Promise(r => setTimeout(r, 1200));

      // Ver qué links o botones hay en la tabla de contribuyentes
      const adminLinks = await page.evaluate(() => {
        const grid = document.querySelector('table');
        if (!grid) return [];
        return Array.from(grid.querySelectorAll('a, input[type="radio"], input[type="submit"]')).map(el => ({
          tag: el.tagName,
          id: el.id,
          href: el.href || null,
          text: el.innerText.trim(),
          onclick: el.getAttribute('onclick')
        }));
      });

      console.log('Links encontrados en tabla de administrado:', JSON.stringify(adminLinks, null, 2));

      // Si hay un link, hacer click
      const firstLink = await page.$('table a');
      if (firstLink) {
        console.log('Haciendo click en el contribuyente encontrado...');
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {}),
          firstLink.click()
        ]);
        await new Promise(r => setTimeout(r, 1500));

        const estadoCuenta = await page.evaluate(() => {
          const body = document.body.innerText;
          const tables = Array.from(document.querySelectorAll('table')).map(t => ({
            id: t.id,
            headers: Array.from(t.querySelectorAll('th')).map(th => th.innerText.trim()),
            rows: Array.from(t.querySelectorAll('tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim())).filter(r => r.length > 0)
          }));
          return { snippet: body.substring(0, 800), tables };
        });

        console.log('Estado de Cuenta Detallado de Impuesto Vehicular:', JSON.stringify(estadoCuenta, null, 2));
      }
    }
  } catch(e) {
    console.error(e);
  } finally {
    if (page) await BrowserHelper.closePage(page);
    await BrowserHelper.cleanupAll();
    process.exit(0);
  }
}

testClickContribuyente('B3P-128');
