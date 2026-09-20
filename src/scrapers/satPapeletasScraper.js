const BrowserHelper = require('../utils/browserHelper');
const PlateValidator = require('../utils/plateValidator');
const memoryCache = require('../cache/memoryCache');
const CaptchaSolver = require('../utils/captchaSolver');

/**
 * Scraper Oficial en Vivo para Consulta de Papeletas de Tránsito en SAT Lima (VirtualSAT)
 * - Tolerancia a fallos de renderizado de Captcha en origen (ASP.NET UpdatePanels)
 * - Selectores universales (Wildcards)
 */
class SatPapeletasScraper {
  static MODULE_NAME = 'SAT_PAPELETAS';
  static TTL_SECONDS = 3600;

  static async query(rawPlate, useCache = true, masterSession = null) {
    const startTime = Date.now();
    const cleanPlate = PlateValidator.clean(rawPlate);
    const formattedPlate = PlateValidator.format(cleanPlate);

    if (!cleanPlate) {
      return { success: false, source: 'SAT_PAPELETAS_LIVE', data: null, error: 'Placa inválida', latencyMs: 0 };
    }

    if (useCache) {
      const cached = memoryCache.get(this.MODULE_NAME, cleanPlate);
      if (cached) return { ...cached, fromCache: true, latencyMs: Date.now() - startTime };
    }

    let page = null;
    let lastErrorScreenshot = null;

    try {
      page = await BrowserHelper.createPage();
      await page.setViewport({ width: 1280, height: 800 });

      // Auto-cerrar alertas silenciosas de ASP.NET
      page.on('dialog', async dialog => {
        console.log(`[SAT Papeletas] Alerta nativa cerrada: ${dialog.message()}`);
        await dialog.accept();
      });

      // SIN INTERCEPTOR: Permitir toda la red para que el servidor antiguo cargue a su ritmo
      await page.setRequestInterception(false);

      let mysession = masterSession;

      // Fallback si no hay Token Maestro
      if (!mysession) {
        console.log(`[SAT Papeletas] Obteniendo sesión individual para placa ${formattedPlate}...`);
        const entryUrls = ['https://www.sat.gob.pe/VirtualSAT/bienvenida.aspx', 'https://www.sat.gob.pe/VirtualSAT/principal.aspx'];
        for (const entryUrl of entryUrls) {
          try {
            await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
            const currentUrl = page.url();
            if (currentUrl.includes('mysession=')) {
              mysession = new URL(currentUrl).searchParams.get('mysession');
              if (mysession && mysession.length > 5) break;
            }
            for (const frame of page.frames()) {
              if (frame.url().includes('mysession=')) {
                mysession = new URL(frame.url()).searchParams.get('mysession');
                if (mysession && mysession.length > 5) break;
              }
            }
            if (mysession && mysession.length > 5) break;
          } catch (navErr) { }
        }
      }

      if (!mysession) throw new Error('No se pudo obtener sesión activa en VirtualSAT.');

      const papeletasUrl = `https://www.sat.gob.pe/VirtualSAT/modulos/papeletas.aspx?mysession=${encodeURIComponent(mysession)}`;
      await page.goto(papeletasUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      let querySuccess = false;

      for (let attempt = 1; attempt <= 4; attempt++) {

        // 1. SELECCIONAR BÚSQUEDA POR PLACA NATIVAMENTE
        await page.evaluate(() => {
          const selects = Array.from(document.querySelectorAll('select'));
          for (const sel of selects) {
            for (const opt of sel.options) {
              if (opt.text.toLowerCase().includes('placa')) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return;
              }
            }
          }
        });

        // 2. ESPERA LARGA AL AJAX DEL SAT PARA QUE DIBUJE LOS ELEMENTOS
        await new Promise(r => setTimeout(r, 2500));

        // 3. LLENAR LA PLACA (CON SELECTORES UNIVERSALES)
        await page.evaluate((placa) => {
          const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
          let inpPlaca = document.querySelector('input[name*="txtPlaca"], input[id*="txtPlaca"]');
          if (!inpPlaca && inputs.length > 0) inpPlaca = inputs[0]; // Fallback brutal al primer input

          if (inpPlaca) {
            inpPlaca.value = placa;
            inpPlaca.dispatchEvent(new Event('input', { bubbles: true }));
            inpPlaca.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, cleanPlate);

        // 4. VERIFICAR CAPTCHA (OPCIONAL)
        let captchaEl = await page.$('img[alt="Visual verification"], img[id*="imgCaptcha"], img[src*="captcha"]');

        if (captchaEl) {
          const box = await captchaEl.boundingBox();
          if (box && box.width > 0 && box.height > 0) {
            const captchaBuffer = await captchaEl.screenshot();
            const code = await CaptchaSolver.solve(captchaBuffer);

            if (code && code.length >= 3) {
              await page.evaluate((captchaCode) => {
                const inpCap = document.querySelector('input[name*="txtCaptcha"], input[id*="txtCaptcha"]');
                if (inpCap) {
                  inpCap.value = captchaCode;
                  inpCap.dispatchEvent(new Event('input', { bubbles: true }));
                }
              }, code);
            }
          }
        } else {
          console.log(`[SAT Papeletas] Intento ${attempt}: El SAT no renderizó el Captcha. Forzando botón Buscar...`);
        }

        // 5. CLIC EN BUSCAR A LA FUERZA
        await page.evaluate(() => {
          const btn = document.querySelector('input[type="submit"][value*="Buscar"], button[id*="btnBuscar"], input[id*="CaptchaContinue"]');
          if (btn) btn.click();
        });

        // 6. ESPERAR RESPUESTA Y VERIFICAR EL DOM
        try {
          await page.waitForFunction(() => {
            const table = document.querySelector('table[id*="grdEstadoCuenta"], table[id*="grdPapeletas"]');
            const errMsg = document.querySelector('span[id*="lblMensajeCapcha"], span[id*="lblMensaje"]');
            const bodyTxt = document.body ? document.body.innerText : '';

            const isClean = bodyTxt.includes('No se encontraron papeletas') || bodyTxt.includes('No registra papeletas');
            const isErr = errMsg && (errMsg.innerText.includes('incorrecta') || errMsg.innerText.includes('coincide'));

            return !!table || isClean || isErr;
          }, { timeout: 12000 });
        } catch (waitErr) {
          console.debug(`[SAT Debug] Timeout esperando tabla. Guardando foto de error...`);
          lastErrorScreenshot = await page.screenshot({ encoding: 'base64', quality: 50 }).catch(() => null);

          // Si el SAT bloqueó el postback, refrescamos e intentamos de nuevo
          await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => { });
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        // 7. VERIFICAR RESULTADOS
        const checkResult = await page.evaluate(() => {
          const table = document.querySelector('table[id*="grdEstadoCuenta"], table[id*="grdPapeletas"]');
          const errMsg = document.querySelector('span[id*="lblMensajeCapcha"], span[id*="lblMensaje"]');
          const bodyTxt = document.body ? document.body.innerText : '';

          const isClean = bodyTxt.includes('No se encontraron papeletas') || bodyTxt.includes('No registra papeletas');
          const isErr = errMsg && (errMsg.innerText.includes('incorrecta') || errMsg.innerText.includes('coincide') || bodyTxt.includes('Código incorrecto'));

          return { isCaptchaError: isErr, hasTable: !!table, isClean: isClean };
        });

        if (checkResult.isCaptchaError) {
          console.log(`[SAT Papeletas] Captcha incorrecto (Intento ${attempt})...`);
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }

        if (checkResult.hasTable || checkResult.isClean) {
          querySuccess = true;
          break;
        }
      }

      // EXTRACCIÓN DE DATOS
      const records = await page.evaluate((placaFormatted) => {
        const table = document.querySelector('table[id*="grdEstadoCuenta"], table[id*="grdPapeletas"], table[id*="grdDetallePapeleta"]');
        if (!table) return [];

        const parseMoney = (val) => {
          if (!val) return 0;
          const clean = val.replace(/[^0-9.-]/g, '');
          const num = parseFloat(clean);
          return isNaN(num) ? 0 : num;
        };

        const trs = Array.from(table.querySelectorAll('tr')).slice(1);
        return trs.map(tr => {
          const cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim().replace(/\s+/g, ' '));
          if (cells.length < 6) return null;

          const isCellZeroPlate = cells[0] && cells[0].replace(/[^A-Za-z0-9]/g, '').length >= 5 && !cells[0].includes(' ');
          const offset = (cells.length >= 14 && !isCellZeroPlate) ? 1 : 0;

          return {
            placa: (cells[0 + offset] || placaFormatted).trim(),
            reglamento: (cells[1 + offset] || 'SET').trim(),
            falta: (cells[2 + offset] || '').trim(),
            infractionCode: (cells[2 + offset] || '').trim(),
            documento: (cells[3 + offset] || '').replace(/ver copia.*/i, '').trim(),
            documentNumber: (cells[3 + offset] || '').replace(/ver copia.*/i, '').trim(),
            fechas: (cells[4 + offset] || '').trim(),
            date: (cells[4 + offset] || '').trim(),
            importe: parseMoney(cells[5 + offset]),
            originalAmountPEN: parseMoney(cells[5 + offset]),
            gastosCostas: parseMoney(cells[6 + offset]),
            descuento: parseMoney(cells[7 + offset]),
            discountPEN: parseMoney(cells[7 + offset]),
            deuda: parseMoney(cells[8 + offset]),
            debtPEN: parseMoney(cells[8 + offset]),
            estado: (cells[9 + offset] || 'Pendiente').trim(),
            status: (cells[9 + offset] || 'Pendiente').trim(),
            licencia: (cells[10 + offset] || '').trim(),
            tipoDocIden: (cells[11 + offset] || '').trim(),
            numDocIden: (cells[12 + offset] || '').trim(),
            compromisoPago: (cells[13 + offset] || '').trim()
          };
        }).filter(Boolean);
      }, formattedPlate);

      let evidenceScreenshot = null;
      try {
        const tableElement = await page.$('table[id*="grdEstadoCuenta"], table[id*="grdPapeletas"]');
        if (tableElement) {
          const rawShot = await tableElement.screenshot({ encoding: 'base64', type: 'jpeg', quality: 65 });
          evidenceScreenshot = `data:image/jpeg;base64,${rawShot}`;
        } else {
          const rawShot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 40, clip: { x: 0, y: 150, width: 1280, height: 600 } });
          evidenceScreenshot = `data:image/jpeg;base64,${rawShot}`;
        }
      } catch (e) { }

      if (!querySuccess && records.length === 0) {
        throw new Error('El SAT no respondió con resultados. Revisa la imagen adjunta para diagnosticar el estado del portal.');
      }

      const totalFines = records.length;
      const totalDebtPEN = Math.round(records.reduce((sum, r) => sum + (r.debtPEN || 0), 0) * 100) / 100;
      const hasCriticalFine = records.some(r => (r.infractionCode || '').toUpperCase().startsWith('M'));

      const result = {
        success: true,
        source: 'SAT_PAPELETAS_LIVE',
        data: {
          plate: formattedPlate,
          hasFines: totalFines > 0,
          totalFines,
          totalDebtPEN,
          records,
          alertLevel: totalFines === 0 ? 'SAFE' : (hasCriticalFine || totalDebtPEN > 500 ? 'HIGH' : 'MEDIUM'),
          alertMessage: totalFines === 0
            ? 'Excelente: Sin papeletas pendientes registradas en el SAT de Lima.'
            : `Registra ${totalFines} papeleta(s) por un total de S/ ${totalDebtPEN.toFixed(2)} en VirtualSAT.`,
          evidenceScreenshot
        },
        portalUrl: 'https://www.sat.gob.pe/virtualsat/',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };

      memoryCache.set(this.MODULE_NAME, cleanPlate, result, this.TTL_SECONDS);
      return result;

    } catch (err) {
      console.warn(`[SAT Papeletas Error] ${err.message}`);

      let finalShot = lastErrorScreenshot;
      try {
        if (page && !finalShot) finalShot = await page.screenshot({ encoding: 'base64', quality: 40 });
      } catch (e) { }

      return {
        success: false,
        source: 'SAT_PAPELETAS_LIVE',
        data: {
          plate: formattedPlate,
          hasFines: false,
          totalFines: 0,
          totalDebtPEN: 0,
          records: [],
          alertLevel: 'SAFE',
          alertMessage: 'Consulta fallida o sistema SAT inestable.',
          evidenceScreenshot: finalShot ? `data:image/jpeg;base64,${finalShot}` : null
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

module.exports = SatPapeletasScraper;