const BrowserHelper = require('../utils/browserHelper');
const PlateValidator = require('../utils/plateValidator');
const CaptchaSolver = require('../utils/captchaSolver');
const memoryCache = require('../cache/memoryCache');

/**
 * Scraper Oficial en Vivo para Consulta del Impuesto al Patrimonio Vehicular en SAT Lima (VirtualSAT)
 * - Portal Oficial: https://www.sat.gob.pe/virtualsat/
 * - Consulta directa a: /VirtualSAT/modulos/BusquedaTributario.aspx?tri=V
 * - Soporte para multi-administrados y desglose de cuotas e insolutos
 * - Solución definitiva al error de contexto CDP en reintentos de captcha
 * - Captura en memoria la evidencia oficial (Zero Disk Residue)
 */
class SatImpuestoVehicularScraper {
  static MODULE_NAME = 'SAT_IMPUESTO_VEHICULAR';
  static TTL_SECONDS = 3600; // 1 hora de caché

  static async query(rawPlate, useCache = true, masterSession = null) {
    const startTime = Date.now();
    const cleanPlate = PlateValidator.clean(rawPlate);
    const formattedPlate = PlateValidator.format(cleanPlate);

    if (!cleanPlate) {
      return {
        success: false,
        source: 'SAT_IMPUESTO_VEHICULAR_LIVE',
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
    let taxRecords = [];
    let contribuyenteNombre = '';
    let contribuyenteCodigo = '';
    let allContribuyentes = [];

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

      console.log(`[SAT Impuesto Vehicular] Obteniendo sesión en VirtualSAT para placa ${formattedPlate}...`);
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

      const tributarioUrl = `https://www.sat.gob.pe/VirtualSAT/modulos/BusquedaTributario.aspx?mysession=${encodeURIComponent(mysession)}&tri=V`;
      console.log(`[SAT Impuesto Vehicular] Consultando módulo tributario en VirtualSAT...`);
      await page.goto(tributarioUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 800));

      // Seleccionar Búsqueda por Placa y sincronizar hidTipConsulta y divs según la arquitectura del SAT
      await page.evaluate((placa) => {
        const sel = document.querySelector('#tipoBusqueda');
        if (sel) {
          sel.value = 'divBuscaPlaca';
          if (window.jQuery) {
            window.jQuery(sel).trigger('change');
          } else {
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        const hid = document.querySelector('#ctl00_cplPrincipal_hidTipConsulta');
        if (hid) {
          hid.value = 'divBuscaPlaca';
        }
        const divPlaca = document.querySelector('#ctl00_cplPrincipal_divBuscaPlaca') || document.querySelector('#divBuscaPlaca');
        if (divPlaca) divPlaca.style.display = 'block';

        const divCod = document.querySelector('#busqCodAdministrado');
        if (divCod) divCod.style.display = 'none';

        const divCaptcha = document.querySelector('#divCaptcha');
        if (divCaptcha) divCaptcha.style.display = 'block';

        const inp = document.querySelector('#ctl00_cplPrincipal_txtPlaca');
        if (inp) {
          inp.focus();
          inp.value = placa;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          inp.dispatchEvent(new Event('blur', { bubbles: true }));
        }
      }, cleanPlate);
      await new Promise(r => setTimeout(r, 600));

      // Resolver captcha de imagen
      for (let capAttempt = 1; capAttempt <= 4; capAttempt++) {
        // En cada intento (incluso tras postback de error), re-sincronizar tipo de búsqueda a Placa
        await page.evaluate((placa) => {
          const sel = document.querySelector('#tipoBusqueda');
          if (sel) {
            sel.value = 'divBuscaPlaca';
            if (window.jQuery) {
              window.jQuery(sel).trigger('change');
            } else {
              sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          const hid = document.querySelector('#ctl00_cplPrincipal_hidTipConsulta');
          if (hid) hid.value = 'divBuscaPlaca';

          const divPlaca = document.querySelector('#ctl00_cplPrincipal_divBuscaPlaca') || document.querySelector('#divBuscaPlaca');
          if (divPlaca) divPlaca.style.display = 'block';

          const divCod = document.querySelector('#busqCodAdministrado');
          if (divCod) divCod.style.display = 'none';

          const divCaptcha = document.querySelector('#divCaptcha');
          if (divCaptcha) divCaptcha.style.display = 'block';

          const inp = document.querySelector('#ctl00_cplPrincipal_txtPlaca');
          if (inp) {
            inp.value = placa;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, cleanPlate);

        await new Promise(r => setTimeout(r, 400));

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

        if (code && code.length >= 3) {
          await page.evaluate((captchaCode, placa) => {
            // Re-confirmar placa antes del submit
            const inpPlaca = document.querySelector('#ctl00_cplPrincipal_txtPlaca');
            if (inpPlaca) {
              inpPlaca.value = placa;
              inpPlaca.dispatchEvent(new Event('input', { bubbles: true }));
              inpPlaca.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const inp = document.querySelector('#ctl00_cplPrincipal_txtCaptcha');
            if (inp) {
              inp.value = captchaCode;
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const btn = document.querySelector('#ctl00_cplPrincipal_CaptchaContinue');
            if (btn) btn.click();
          }, code, cleanPlate);

          await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => { });
          await new Promise(r => setTimeout(r, 1500));

          // Verificar si se produjo error de captcha o validación en pantalla
          const hasErrorOnPage = await page.evaluate(() => {
            const text = document.body.innerText;
            return text.includes('Código incorrecto') || text.includes('Códigodigo incorrecto') || text.includes('El código ingresado no coincide');
          });

          if (hasErrorOnPage) {
            console.log('[SAT Impuesto Vehicular] Captcha o validación fallida, reintentando intento ' + (capAttempt + 1));
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }

          // Verificar si listó administrados/contribuyentes
          const adminRows = await page.evaluate(() => {
            const table = document.querySelector('#ctl00_cplPrincipal_grdAdministrados');
            if (!table) return [];
            const trs = Array.from(table.querySelectorAll('tr')).slice(1);
            return trs.map((r, i) => {
              const tds = Array.from(r.querySelectorAll('td'));
              const a = r.querySelector('a');
              return {
                index: i,
                codigo: tds[0]?.innerText?.trim() || '',
                nombre: tds[1]?.innerText?.trim() || '',
                linkSelector: a ? `#${a.id}` : null
              };
            }).filter(a => a.linkSelector);
          });

          if (adminRows.length > 0) {
            for (let i = 0; i < adminRows.length; i++) {
              const admin = adminRows[i];

              if (i > 0) {
                await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => { });
                await new Promise(r => setTimeout(r, 1200));
              }

              const clicked = await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (el) {
                  if (el.href && el.href.includes('__doPostBack')) {
                    const match = el.href.match(/__doPostBack\('([^']*)','([^']*)'\)/);
                    if (match && typeof window.__doPostBack === 'function') {
                      window.__doPostBack(match[1], match[2]);
                      return true;
                    }
                  }
                  el.click();
                  return true;
                }
                return false;
              }, admin.linkSelector);

              if (!clicked) continue;
              await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => { });
              await new Promise(r => setTimeout(r, 1200));

              const adminTaxRows = await page.evaluate((adminCod, adminNom, placaFormatted) => {
                const table = document.querySelector('#ctl00_cplPrincipal_grdEstadoCuenta');
                if (!table) return [];

                const trs = Array.from(table.querySelectorAll('tr')).slice(1);
                const rawItems = trs.map(tr => {
                  const cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim().replace(/\s+/g, ' '));
                  if (cells.length < 5) return null;

                  const ano = (cells[0] || '').trim();
                  const cuota = (cells[1] || '').trim();
                  const documento = (cells[2] || '').trim();
                  const totalDeuda = parseFloat(cells[3]?.replace(/,/g, '')) || 0;
                  const dscto = parseFloat(cells[4]?.replace(/,/g, '')) || 0;
                  const deudaWeb = parseFloat(cells[8]?.replace(/,/g, '')) || totalDeuda;
                  const vencimiento = (cells[9] || 'N/D').trim();
                  const estado = (cells[10] || 'Pendiente').trim();
                  const tipoDoc = (cells[12] || cells[11] || 'Valor Tributario').trim();
                  const referencia = (cells[16] || cells[cells.length - 1] || 'Impuesto Vehicular').trim();

                  const isMulta = referencia.toUpperCase().includes('MULTA') || tipoDoc.toUpperCase().includes('RM');
                  const concepto = isMulta ? 'Multa Tributaria' : 'Impuesto Vehicular';

                  return {
                    placa: placaFormatted,
                    plate: placaFormatted,
                    contribuyente: `${adminCod} - ${adminNom}`,
                    concepto,
                    concept: concepto,
                    ano,
                    year: ano,
                    cuota: cuota === '0' ? 'Cuota Única' : cuota,
                    rawCuota: cuota,
                    documento,
                    documentNumber: documento,
                    insoluto: totalDeuda,
                    originalAmountPEN: totalDeuda,
                    descuento: dscto,
                    discountPEN: dscto,
                    totalDeuda: deudaWeb,
                    debtPEN: deudaWeb,
                    deuda: deudaWeb,
                    monto: deudaWeb,
                    fechavencimiento: vencimiento,
                    dueDate: vencimiento,
                    estado,
                    status: estado,
                    tipoDoc,
                    referencia
                  };
                }).filter(Boolean);

                const hasIndividualCuotasForYear = {};
                rawItems.forEach(item => {
                  if (item.rawCuota && item.rawCuota !== '0') {
                    hasIndividualCuotasForYear[item.year] = true;
                  }
                });

                return rawItems.filter(item => {
                  if (item.rawCuota === '0' && hasIndividualCuotasForYear[item.year]) {
                    return false;
                  }
                  return true;
                });
              }, admin.codigo, admin.nombre, formattedPlate);

              if (adminTaxRows.length > 0) {
                allContribuyentes.push(`${admin.codigo} - ${admin.nombre}`);
                taxRecords.push(...adminTaxRows);
                if (!contribuyenteNombre) {
                  contribuyenteCodigo = admin.codigo;
                  contribuyenteNombre = admin.nombre;
                }
              }
            }
            break;
          } else {
            // Verificar si directamente mostró la tabla de estado de cuenta
            const directTable = await page.$('#ctl00_cplPrincipal_grdEstadoCuenta');
            if (directTable) {
              const directTaxRows = await page.evaluate((placaFormatted) => {
                const table = document.querySelector('#ctl00_cplPrincipal_grdEstadoCuenta');
                if (!table) return [];
                const trs = Array.from(table.querySelectorAll('tr')).slice(1);
                return trs.map(tr => {
                  const cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim().replace(/\s+/g, ' '));
                  if (cells.length < 5) return null;
                  const ano = (cells[0] || '').trim();
                  const cuota = (cells[1] || '').trim();
                  const documento = (cells[2] || '').trim();
                  const totalDeuda = parseFloat(cells[3]?.replace(/,/g, '')) || 0;
                  const dscto = parseFloat(cells[4]?.replace(/,/g, '')) || 0;
                  const deudaWeb = parseFloat(cells[8]?.replace(/,/g, '')) || totalDeuda;
                  const vencimiento = (cells[9] || 'N/D').trim();
                  const estado = (cells[10] || 'Pendiente').trim();
                  const tipoDoc = (cells[12] || cells[11] || 'Valor Tributario').trim();
                  const referencia = (cells[16] || cells[cells.length - 1] || 'Impuesto Vehicular').trim();
                  const isMulta = referencia.toUpperCase().includes('MULTA') || tipoDoc.toUpperCase().includes('RM');
                  const concepto = isMulta ? 'Multa Tributaria' : 'Impuesto Vehicular';
                  return {
                    placa: placaFormatted,
                    plate: placaFormatted,
                    concepto,
                    concept: concepto,
                    ano,
                    year: ano,
                    cuota,
                    documento,
                    documentNumber: documento,
                    insoluto: totalDeuda,
                    originalAmountPEN: totalDeuda,
                    descuento: dscto,
                    discountPEN: dscto,
                    totalDeuda: deudaWeb,
                    debtPEN: deudaWeb,
                    deuda: deudaWeb,
                    monto: deudaWeb,
                    fechavencimiento: vencimiento,
                    dueDate: vencimiento,
                    estado,
                    status: estado,
                    tipoDoc,
                    referencia
                  };
                }).filter(Boolean);
              }, formattedPlate);

              taxRecords.push(...directTaxRows);
              break;
            }

            const pageText = await page.evaluate(() => document.body.innerText);
            if (pageText.includes('No se encontraron registros') || pageText.includes('Sin registros')) {
              break;
            }
          }
        }
      }

      // Captura en memoria de la pantalla oficial
      let evidenceScreenshot = null;
      try {
        const rawShot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 75 });
        evidenceScreenshot = `data:image/jpeg;base64,${rawShot}`;
      } catch (e) { }

      const totalTax = taxRecords.length;
      const totalTaxDebtPEN = Math.round(taxRecords.reduce((sum, r) => sum + (r.totalDeuda || r.debtPEN || 0), 0) * 100) / 100;

      const result = {
        success: true,
        source: 'SAT_IMPUESTO_VEHICULAR_LIVE',
        data: {
          plate: formattedPlate,
          hasTax: totalTax > 0,
          totalTax,
          totalTaxDebtPEN,
          taxRecords,
          records: taxRecords,
          contribuyente: allContribuyentes.length > 0 ? allContribuyentes.join('; ') : (contribuyenteNombre ? `${contribuyenteCodigo} - ${contribuyenteNombre}` : null),
          alertLevel: totalTax === 0 ? 'SAFE' : 'MEDIUM',
          alertMessage: totalTax === 0
            ? 'Excelente: Sin deudas de impuesto vehicular registradas en el SAT de Lima.'
            : `Registra ${totalTax} cuota(s) tributarias pendientes por S/ ${totalTaxDebtPEN.toFixed(2)} en VirtualSAT.`,
          evidenceScreenshot
        },
        portalUrl: 'https://www.sat.gob.pe/virtualsat/',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };

      memoryCache.set(this.MODULE_NAME, cleanPlate, result, this.TTL_SECONDS);
      return result;

    } catch (err) {
      console.warn(`[SAT Impuesto Vehicular Error] ${err.message}`);
      return {
        success: false,
        source: 'SAT_IMPUESTO_VEHICULAR_LIVE',
        data: {
          plate: formattedPlate,
          hasTax: false,
          totalTax: 0,
          totalTaxDebtPEN: 0,
          taxRecords: [],
          records: [],
          alertLevel: 'SAFE',
          alertMessage: 'Consulta en VirtualSAT finalizada.'
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

module.exports = SatImpuestoVehicularScraper;
