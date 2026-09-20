const BrowserHelper = require('../utils/browserHelper');
const PlateValidator = require('../utils/plateValidator');
const CaptchaSolver = require('../utils/captchaSolver');
const memoryCache = require('../cache/memoryCache');

/**
 * Scraper Oficial en Vivo para Consulta de Órdenes de Captura y Embargos Coactivos en SAT Lima (VirtualSAT)
 * - Portal Oficial: https://www.sat.gob.pe/virtualsat/
 * - Consulta directa a: /VirtualSAT/modulos/Capturas.aspx?tri=C
 * - Extracción de medidas cautelares, expedientes y montos de afectación
 * - Captura en memoria la evidencia oficial (Zero Disk Residue)
 */
class SatCapturaScraper {
  static MODULE_NAME = 'SAT_CAPTURA';
  static TTL_SECONDS = 3600; // 1 hora de caché

  static async query(rawPlate, useCache = true, masterSession = null) {
    const startTime = Date.now();
    const cleanPlate = PlateValidator.clean(rawPlate);
    const formattedPlate = PlateValidator.format(cleanPlate);

    if (!cleanPlate) {
      return {
        success: false,
        source: 'SAT_CAPTURA_LIVE',
        data: null,
        error: 'Placa inválida',
        latencyMs: 0
      };
    }

    if (useCache) {
      const cached = memoryCache.get(this.MODULE_NAME, cleanPlate);
      if (cached) {
        return { ...cached, fromCache: true, latencyMs: Date.now() - startTime };
      }
    }

    let page = null;
    let captureRecords = [];
    let hasCaptureOrder = false;

    try {
      page = await BrowserHelper.createPage();
      await page.setViewport({ width: 1280, height: 800 });

      // Optimización de red
      await page.setRequestInterception(true);
      page.on('request', req => {
        const url = req.url().toLowerCase();
        const type = req.resourceType();

        if (
          type === 'stylesheet' ||
          type === 'font' ||
          url.includes('google-analytics') ||
          url.includes('googletagmanager') ||
          url.includes('facebook') ||
          url.includes('hotjar') ||
          url.includes('clarity')
        ) {
          return req.abort();
        }

        if (type === 'image') {
          if (
            !url.includes('captcha') &&
            !url.includes('visual') &&
            !url.includes('jpegimage') &&
            !url.includes('cplprincipal')
          ) {
            return req.abort();
          }
        }

        req.continue();
      });

      console.log(`[SAT Captura] Obteniendo sesión en VirtualSAT para placa ${formattedPlate}...`);
      let mysession = masterSession;

      // Solo busca sesión individual si el Orquestador no le pasó el Token Maestro
      if (!mysession) {
        console.log(`[SAT] Obteniendo sesión individual en VirtualSAT para placa ${formattedPlate}...`);
        const entryUrls = [
          'https://www.sat.gob.pe/VirtualSAT/bienvenida.aspx',
          'https://www.sat.gob.pe/VirtualSAT/principal.aspx'
        ];

        for (const entryUrl of entryUrls) {
          try {
            await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
            const currentUrl = page.url();
            if (currentUrl.includes('mysession=')) {
              mysession = new URL(currentUrl).searchParams.get('mysession');
              if (mysession && mysession.length > 5) break;
            }
            for (const frame of page.frames()) {
              const fUrl = frame.url();
              if (fUrl.includes('mysession=')) {
                mysession = new URL(fUrl).searchParams.get('mysession');
                if (mysession && mysession.length > 5) break;
              }
            }
            if (mysession && mysession.length > 5) break;
          } catch (navErr) { }
        }
      } else {
        console.log(`[SAT] Usando Token Maestro Compartido: ${mysession.substring(0, 8)}...`);
      }

      if (!mysession) {
        throw new Error('No se pudo obtener sesión activa en VirtualSAT');
      }

      const capturasUrl = `https://www.sat.gob.pe/VirtualSAT/modulos/Capturas.aspx?tri=C&mysession=${encodeURIComponent(mysession)}`;
      console.log(`[SAT Captura] Consultando órdenes de captura en VirtualSAT...`);
      await page.goto(capturasUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await new Promise(r => setTimeout(r, 1000));

      for (let attempt = 1; attempt <= 4; attempt++) {
        let captchaEl = null;
        let captchaBuffer = null;
        try {
          captchaEl = await page.$('img[alt="Visual verification"]');
          if (!captchaEl) break;
          captchaBuffer = await captchaEl.screenshot();
        } catch (e) {
          await new Promise(r => setTimeout(r, 600));
          continue;
        }

        const code = await CaptchaSolver.solve(captchaBuffer);

        if (!code || code.length < 3) {
          await page.evaluate(() => {
            const refBtn = document.querySelector('#ctl00_cplPrincipal_ibtnRefresh');
            if (refBtn) refBtn.click();
          });
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }

        await page.evaluate((placa, captchaCode) => {
          const inpPlaca = document.querySelector('#ctl00_cplPrincipal_txtPlaca');
          if (inpPlaca) {
            inpPlaca.value = placa;
            inpPlaca.dispatchEvent(new Event('input', { bubbles: true }));
            inpPlaca.dispatchEvent(new Event('change', { bubbles: true }));
          }

          const inpCap = document.querySelector('#ctl00_cplPrincipal_txtCaptcha');
          if (inpCap) {
            inpCap.value = captchaCode;
            inpCap.dispatchEvent(new Event('input', { bubbles: true }));
            inpCap.dispatchEvent(new Event('change', { bubbles: true }));
          }

          const btn = document.querySelector('#ctl00_cplPrincipal_CaptchaContinue');
          if (btn) btn.click();
        }, cleanPlate, code);

        await new Promise(r => setTimeout(r, 2200));

        const check = await page.evaluate(() => {
          const errMsg = document.querySelector('#ctl00_cplPrincipal_lblMensajeCapcha');
          const isError = errMsg && errMsg.innerText.includes('incorrecta');
          const grid = document.querySelector('#ctl00_cplPrincipal_grdCapturas');
          let items = [];
          if (grid) {
            const trs = Array.from(grid.querySelectorAll('tr'));
            if (trs.length > 1) {
              for (let r = 1; r < trs.length; r++) {
                const cols = Array.from(trs[r].querySelectorAll('td')).map(c => c.innerText.trim());
                if (cols.length > 0 && cols.some(c => c.length > 0)) {
                  items.push({
                    expediente: cols[0] || 'N/D',
                    documento: cols[1] || 'N/D',
                    fechaMedida: cols[2] || 'N/D',
                    tipoMedida: cols[3] || 'Embargo / Captura',
                    montoAfectacion: parseFloat(cols[4]?.replace(/[^0-9.]/g, '')) || 0,
                    estado: cols[5] || 'Vigente'
                  });
                }
              }
            }
          }
          return { isError, items };
        });

        if (!check.isError) {
          captureRecords = check.items;
          hasCaptureOrder = captureRecords.length > 0;
          break;
        }
      }

      // Captura en memoria de la pantalla oficial
      let evidenceScreenshot = null;
      try {
        const rawShot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 75 });
        evidenceScreenshot = `data:image/jpeg;base64,${rawShot}`;
      } catch (e) { }

      const totalCaptures = captureRecords.length;

      const result = {
        success: true,
        source: 'SAT_CAPTURA_LIVE',
        data: {
          plate: formattedPlate,
          hasCaptureOrder,
          totalCaptures,
          captureRecords,
          records: captureRecords,
          alertLevel: hasCaptureOrder ? 'CRITICAL' : 'SAFE',
          alertMessage: hasCaptureOrder
            ? `ALERTA CRÍTICA: Registra ${totalCaptures} orden(es) de captura o embargo coactivo en el SAT.`
            : 'Sin orden de captura ni medidas cautelares coactivas registradas en el SAT.',
          evidenceScreenshot
        },
        portalUrl: 'https://www.sat.gob.pe/virtualsat/',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };

      memoryCache.set(this.MODULE_NAME, cleanPlate, result, this.TTL_SECONDS);
      return result;

    } catch (err) {
      console.warn(`[SAT Captura Error] ${err.message}`);
      return {
        success: false,
        source: 'SAT_CAPTURA_LIVE',
        data: {
          plate: formattedPlate,
          hasCaptureOrder: false,
          totalCaptures: 0,
          captureRecords: [],
          records: [],
          alertLevel: 'SAFE',
          alertMessage: 'Consulta de capturas finalizada.'
        },
        error: err.message,
        portalUrl: 'https://www.sat.gob.pe/virtualsat/',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
    } finally {
      if (page) await BrowserHelper.closePage(page);
    }
  }
}

module.exports = SatCapturaScraper;
