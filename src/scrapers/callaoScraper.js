const BrowserHelper = require('../utils/browserHelper');
const PlateValidator = require('../utils/plateValidator');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Intenta resolver el captcha numerico de 3 dígitos de Callao
 * Estrategia dual: OpenCV+HSV (alto acierto en dígitos azules) → ddddocr directo (fallback)
 * @param {Buffer} rawBuffer
 * @returns {string|null}
 */
function solveCallaoCaptcha(rawBuffer) {
  const tmpDir = path.join(__dirname, '..', '..', 'temp_audio');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const timestamp = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const tmpImg = path.join(tmpDir, `callao_cap_${timestamp}.png`);
  const solverScript = path.join(__dirname, '..', 'utils', 'callaoSolver.py');

  try {
    fs.writeFileSync(tmpImg, rawBuffer);

    // Solver primario: OpenCV+HSV (aísla los dígitos azules con alta precisión)
    try {
      const out = execSync(`python "${solverScript}" "${tmpImg}"`, { timeout: 10000 }).toString();
      const match = out.match(/RESULT:(\d+)/);
      const result = match ? match[1].trim() : null;
      if (result && result.length === 3) {
        return result;
      }
    } catch (primaryErr) {
      console.warn('[CallaoScraper] Solver primario OpenCV falló, usando fallback ddddocr:', primaryErr.message);
    }

    // Solver de respaldo: ddddocr directo sobre la imagen original
    const fallbackScript = `import sys, io, ddddocr; sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='ignore'); ocr = ddddocr.DdddOcr(show_ad=False); res = ocr.classification(open(r'${tmpImg.replace(/\\/g, '\\\\')}', 'rb').read()); digits = ''.join([c for c in res if c.isdigit()]); print('RESULT:' + digits)`;
    const fallbackOut = execSync(`python -c "${fallbackScript}"`, { timeout: 10000 }).toString();
    const fallbackMatch = fallbackOut.match(/RESULT:(\d+)/);
    const fallbackResult = fallbackMatch ? fallbackMatch[1].trim() : null;
    if (fallbackResult && fallbackResult.length === 3) {
      console.log('[CallaoScraper] Captcha resuelto por fallback ddddocr:', fallbackResult);
      return fallbackResult;
    }
    return fallbackResult || null;
  } catch (e) {
    console.warn('[CallaoScraper] Error en solver dual de captcha Callao:', e.message);
    return null;
  } finally {
    try { if (fs.existsSync(tmpImg)) fs.unlinkSync(tmpImg); } catch (e) {}
  }
}

/**
 * Scraper Oficial en Vivo para Fotopapeletas e Infracciones de la Municipalidad del Callao
 * Portal: https://pagopapeletascallao.pe/
 */
class CallaoScraper {
  static MODULE_NAME = 'CALLAO_INFRACTIONS';

  /**
   * Consulta en vivo las fotopapeletas del Callao para una placa
   * @param {string} rawPlate - Placa a consultar
   */
  static async query(rawPlate) {
    const startTime = Date.now();
    const cleanPlate = PlateValidator.clean(rawPlate);
    const formattedPlate = PlateValidator.format(cleanPlate);

    if (!cleanPlate) {
      return {
        success: false,
        source: 'CALLAO_FALLBACK',
        data: null,
        error: 'Placa inválida',
        latencyMs: 0
      };
    }

    let page = null;
    const MAX_ATTEMPTS = 5;
    let infractions = [];
    let formAccepted = false;

    try {
      page = await BrowserHelper.createPage({ blockImages: false });

      // Intercepción selectiva de peticiones para bloquear recursos pesados e innecesarios
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        try {
          const resourceType = req.resourceType();
          const url = req.url().toLowerCase();

          if (
            resourceType === 'stylesheet' ||
            resourceType === 'font' ||
            resourceType === 'media' ||
            url.includes('google-analytics.com') ||
            url.includes('googletagmanager.com') ||
            url.includes('bing.net') ||
            (resourceType === 'image' && !url.startsWith('data:'))
          ) {
            req.abort();
          } else {
            req.continue();
          }
        } catch (e) {
          // Ignorar si la solicitud ya fue resuelta o la página está cerrando
        }
      });

      // 1. Navegación inicial única al portal de Callao
      await page.goto('https://pagopapeletascallao.pe/', {
        waitUntil: 'domcontentloaded',
        timeout: 25000
      });

      let callaoScreenshot = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          console.log(`[CallaoScraper] Intento ${attempt}/${MAX_ATTEMPTS} para placa ${formattedPlate}...`);

          // Extraer imagen del captcha (inline Base64 en el DOM)
          let captchaSrc = await page.evaluate(() => {
            const img = document.querySelector('img[alt="captcha"], img[src*="data:image/png"], .captcha img');
            return img ? img.src : null;
          });

          if (!captchaSrc || !captchaSrc.includes(',')) {
            await new Promise(r => setTimeout(r, 600));
            continue;
          }

          const base64Data = captchaSrc.split(',')[1].trim();
          const captchaBuffer = Buffer.from(base64Data, 'base64');
          const code = solveCallaoCaptcha(captchaBuffer);
          console.log(`[CallaoScraper] Captcha resuelto (${attempt}): "${code}"`);

          if (!code || code.length !== 3) {
            console.warn(`[CallaoScraper] Captcha con longitud inválida ("${code}"), refrescando captcha...`);
            await page.evaluate(() => {
              const refreshBtn = document.querySelector('.captcha a, #refreshCaptcha, img[alt="captcha"]');
              if (refreshBtn) refreshBtn.click();
            });
            await new Promise(r => setTimeout(r, 800));
            continue;
          }

          // Inyección directa de valores en el DOM nativo
          await page.evaluate((placa, captchaCode) => {
            const sel = document.querySelector('#tipo_busqueda');
            if (sel) {
              sel.value = '1';
              sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const inpVal = document.querySelector('#valor_busqueda');
            if (inpVal) {
              inpVal.value = placa;
              inpVal.dispatchEvent(new Event('input', { bubbles: true }));
              inpVal.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const inpCap = document.querySelector('#captcha');
            if (inpCap) {
              inpCap.value = captchaCode;
              inpCap.dispatchEvent(new Event('input', { bubbles: true }));
              inpCap.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, cleanPlate, code);

          // Disparar búsqueda
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
            page.evaluate(() => {
              const btn = document.querySelector('#idBuscar');
              if (btn) btn.click();
            })
          ]);

          const currentUrl = page.url();
          if (currentUrl.includes('error=')) {
            console.warn(`[CallaoScraper] Código de seguridad rechazado en intento ${attempt}. Reintentando...`);
            await new Promise(r => setTimeout(r, 600));
            continue;
          }

          formAccepted = true;

          // 4. Extraer resultados tabulares
          const parsed = await page.evaluate(() => {
            const body = document.body.innerText;
            const noRecords = body.includes('No hay resultados para mostrar') ||
                              body.includes('No registra papeletas') ||
                              body.includes('Sin infracciones') ||
                              body.includes('No se encontraron registros');

            const dataTable = document.getElementById('dataTable') || document.querySelector('.dataTable, table');
            if (noRecords || !dataTable) {
              return { list: [] };
            }

            const list = [];
            const trs = Array.from(dataTable.querySelectorAll('tbody tr'));

            for (const tr of trs) {
              const cols = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim().replace(/\s+/g, ' '));
              
              // Omitir filas de cabecera, de totales o vacías
              if (cols.length === 0 || cols.some(c => c.includes('Criterio') || c.includes('Valor Insoluto') || c.includes('Amnistía') || c.includes('No se encontraron'))) {
                continue;
              }

              // Mapeo oficial de columnas de Callao:
              // [0]: checkbox, [1]: Placa, [2]: Código Falta, [3]: N° Papeleta, [4]: Fecha Infracción,
              // [5]: Importe (100% insoluto), [6]: Pago Voluntario DS 017-2026, [7]: N° Cuota, [8]: Detalle, [9]: Tipo
              if (cols.length >= 7) {
                const placa = cols[1] || '';
                const falta = cols[2] || 'INFRACCIÓN';
                const papeleta = cols[3] || 'N/D';
                const fecha = cols[4] || 'N/D';
                const importe100 = parseFloat((cols[5] || '0').replace(/[^0-9.]/g, '')) || 0;
                const pagoAmnistia = parseFloat((cols[6] || '0').replace(/[^0-9.]/g, '')) || 0;
                const cuota = cols[7] || '0';
                const tipo = cols[9] || 'Tránsito';

                list.push({
                  plate: placa,
                  infractionCode: falta,
                  documentNumber: papeleta,
                  date: fecha,
                  originalAmountPEN: importe100,
                  discountAmountPEN: pagoAmnistia,
                  savingsPEN: Math.max(0, importe100 - pagoAmnistia),
                  debtPEN: importe100,
                  quota: cuota,
                  type: tipo,
                  status: 'Pendiente'
                });
              }
            }

            return { list };
          });

          infractions = parsed.list;

          try {
            const rawShot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 75 });
            callaoScreenshot = `data:image/jpeg;base64,${rawShot}`;
          } catch (e) {}

          break; // Búsqueda completada exitosamente
        } catch (attemptErr) {
          console.warn(`[CallaoScraper] Error en intento ${attempt}:`, attemptErr.message);
          if (attempt === MAX_ATTEMPTS) {
            throw attemptErr;
          }
        }
      }

      if (!formAccepted) {
        throw new Error('No se pudo validar el captcha ni procesar la consulta tras varios intentos en el portal de Callao');
      }

      const latencyMs = Date.now() - startTime;
      const count = infractions.length;
      const totalOriginalDebt = infractions.reduce((acc, curr) => acc + (curr.originalAmountPEN || 0), 0);
      const totalDiscountDebt = infractions.reduce((acc, curr) => acc + (curr.discountAmountPEN || 0), 0);
      const totalSavings = Math.max(0, totalOriginalDebt - totalDiscountDebt);

      const hasVerySerious = infractions.some(r => (r.infractionCode || '').toUpperCase().startsWith('M'));
      const hasSerious = infractions.some(r => (r.infractionCode || '').toUpperCase().startsWith('G'));

      const normalized = {
        plate: formattedPlate,
        totalCount: count,
        infractions: infractions,
        debtAmount: totalOriginalDebt,
        alertLevel: count > 0 ? (hasVerySerious ? 'HIGH' : (hasSerious ? 'WARNING' : 'INFO')) : 'SAFE',
        alertMessage: count > 0
          ? `Alerta: El vehículo registra ${count} fotopapeleta(s) en la Municipalidad del Callao por S/ ${totalOriginalDebt.toFixed(2)} (Beneficio de Amnistía DS 017-2026: S/ ${totalDiscountDebt.toFixed(2)}).`
          : 'Excelente: Sin fotopapeletas registradas en las avenidas del Callao.',
        // Compatibilidad hacia atrás para VehicleService y AuditReporter
        hasInfractions: count > 0,
        totalInfractions: count,
        totalDebtPEN: totalOriginalDebt,
        totalDiscountPEN: totalDiscountDebt,
        totalSavingsPEN: totalSavings,
        records: infractions,
        evidenceScreenshot: callaoScreenshot
      };

      return {
        success: true,
        source: 'CALLAO_MUNICIPALIDAD',
        data: normalized,
        error: null,
        portalUrl: 'https://pagopapeletascallao.pe/',
        latencyMs,
        timestamp: new Date().toISOString()
      };

    } catch (err) {
      const latencyMs = Date.now() - startTime;
      console.error('[CallaoScraper Error]', err);

      return {
        success: false,
        source: 'CALLAO_FALLBACK',
        data: {
          plate: formattedPlate,
          totalCount: 0,
          infractions: [],
          debtAmount: 0,
          alertLevel: 'INFO',
          alertMessage: 'No se pudo conectar con el portal de Papeletas Callao en este momento. Verifique directamente en el portal oficial.',
          hasInfractions: false,
          totalInfractions: 0,
          totalDebtPEN: 0,
          totalDiscountPEN: 0,
          totalSavingsPEN: 0,
          records: []
        },
        error: err.message,
        portalUrl: 'https://pagopapeletascallao.pe/',
        latencyMs,
        timestamp: new Date().toISOString()
      };
    } finally {
      await BrowserHelper.closePage(page);
    }
  }
}

module.exports = CallaoScraper;
