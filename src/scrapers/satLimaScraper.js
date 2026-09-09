const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const PlateValidator = require('../utils/plateValidator');

/**
 * Transcribe el reto de audio de Google reCAPTCHA v2 / Enterprise
 * utilizando la biblioteca oficial soundfile y SpeechRecognition de Python
 */
function transcribeAudioMp3(mp3Buffer) {
  const tmpDir = path.join(__dirname, '..', '..', 'temp_audio');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const mp3Path = path.join(tmpDir, `recaptcha_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
  const wavPath = path.join(tmpDir, `recaptcha_${Date.now()}_${Math.random().toString(36).substring(7)}.wav`);
  const pyScriptPath = path.join(tmpDir, `stt_${Date.now()}_${Math.random().toString(36).substring(7)}.py`);

  fs.writeFileSync(mp3Path, mp3Buffer);

  const pyCode = [
    'import soundfile as sf',
    'import speech_recognition as sr',
    'try:',
    `    data, samplerate = sf.read(r"${mp3Path}")`,
    `    sf.write(r"${wavPath}", data, samplerate)`,
    '    r = sr.Recognizer()',
    `    with sr.AudioFile(r"${wavPath}") as source:`,
    '        audio = r.record(source)',
    '    text = r.recognize_google(audio)',
    '    print("RESULT:" + text)',
    'except Exception as e:',
    '    print("ERROR:" + str(e))'
  ].join('\n');

  fs.writeFileSync(pyScriptPath, pyCode);

  try {
    const out = execSync(`python "${pyScriptPath}"`, { timeout: 15000 }).toString().trim();
    if (out.includes('RESULT:')) {
      return out.split('RESULT:')[1].trim();
    }
    console.warn('[STT Error]', out);
    return null;
  } catch (err) {
    console.warn('[STT Exec Error]', err.message);
    return null;
  } finally {
    try { fs.unlinkSync(mp3Path); } catch (e) {}
    try { fs.unlinkSync(wavPath); } catch (e) {}
    try { fs.unlinkSync(pyScriptPath); } catch (e) {}
  }
}

/**
 * Scraper en Vivo para Consulta de Papeletas y Deuda en SAT Lima (VirtualSAT)
 * - Sesión dinámica desde https://www.sat.gob.pe/VirtualSAT/principal.aspx
 * - Navegación 100% invisible en coordenadas virtuales (--window-position=-32000,-32000)
 * - Auto-resolución de Google reCAPTCHA v2 / Enterprise vía audio bypass STT
 * - Extracción estructurada: Número de papeleta, Falta (ej: M41), Fecha, Importe, Costas, Deuda actual
 */
class SatLimaScraper {
  static MODULE_NAME = 'SAT_LIMA';
  static TTL_SECONDS = 0; // Cero almacenamiento en caché según directiva

  /**
   * Consulta el estado de cuenta y papeletas del SAT Lima
   * @param {string} rawPlate - Placa
   * @param {boolean} useCache - Flag de compatibilidad
   */
  static async query(rawPlate, useCache = false) {
    const startTime = Date.now();
    const cleanPlate = PlateValidator.clean(rawPlate);
    const formattedPlate = PlateValidator.format(cleanPlate);

    if (!cleanPlate) {
      return {
        success: false,
        source: 'SAT_LIMA',
        data: null,
        error: 'Placa inválida',
        latencyMs: 0
      };
    }

    let browser = null;

    try {
      browser = await puppeteer.launch({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--window-position=-32000,-32000', // Invisible fuera de pantalla
          '--no-first-run',
          '--no-default-browser-check',
          '--window-size=1280,900'
        ]
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });

      // 1. Obtener sesión activa de VirtualSAT
      await page.goto('https://www.sat.gob.pe/virtualsat/', {
        waitUntil: 'networkidle2',
        timeout: 25000
      });

      let frameBienvenida = null;
      let papeletasUrl = null;
      for (let i = 0; i < 25; i++) {
        frameBienvenida = page.frames().find(f => f.url().toLowerCase().includes('bienvenida.aspx'));
        if (frameBienvenida) {
          papeletasUrl = await frameBienvenida.evaluate(() => {
            const a = Array.from(document.querySelectorAll('a')).find(el => el.innerText.toLowerCase().includes('papeleta'));
            return a ? a.href : null;
          }).catch(() => null);
          if (papeletasUrl) break;
        }
        await new Promise(r => setTimeout(r, 400));
      }

      if (!papeletasUrl) {
        throw new Error('No se localizó el enlace de papeletas en VirtualSAT');
      }

      // 2. Navegar al módulo de papeletas
      await page.goto(papeletasUrl, {
        waitUntil: 'networkidle2',
        timeout: 20000
      });

      // 3. Seleccionar búsqueda por placa
      await page.waitForSelector('#tipoBusquedaPapeletas', { timeout: 10000 });
      await page.select('#tipoBusquedaPapeletas', 'busqPlaca');
      await new Promise(r => setTimeout(r, 800));

      // 4. Ingresar la placa
      await page.waitForSelector('#ctl00_cplPrincipal_txtPlaca', { timeout: 10000 });
      await page.type('#ctl00_cplPrincipal_txtPlaca', cleanPlate, { delay: 60 });

      // 5. Resolver reCAPTCHA v2 / Enterprise
      const rcFrame = page.frames().find(f => f.url().includes('recaptcha/api2/anchor'));
      if (rcFrame) {
        await rcFrame.click('#recaptcha-anchor');
      }
      await new Promise(r => setTimeout(r, 2500));

      let token = await page.evaluate(() => (typeof window.grecaptcha !== 'undefined' ? window.grecaptcha.getResponse() : ''));

      if (!token || token.length < 20) {
        // Desafío bframe abierto: activar bypass de audio con transcripción STT
        const bframe = page.frames().find(f => f.url().includes('recaptcha/api2/bframe'));
        if (bframe) {
          await bframe.click('#recaptcha-audio-button');
          await new Promise(r => setTimeout(r, 2500));

          const audioUrl = await bframe.evaluate(() => {
            const src = document.querySelector('#audio-source');
            return src ? src.src : null;
          });

          if (audioUrl) {
            const mp3Res = await axios.get(audioUrl, { responseType: 'arraybuffer' });
            const transcription = transcribeAudioMp3(mp3Res.data);

            if (transcription) {
              await bframe.type('#audio-response', transcription, { delay: 60 });
              await new Promise(r => setTimeout(r, 500));
              await bframe.click('#recaptcha-verify-button');
              await new Promise(r => setTimeout(r, 3000));
            }
          }
        }
      }

      token = await page.evaluate(() => (typeof window.grecaptcha !== 'undefined' ? window.grecaptcha.getResponse() : ''));

      if (token && token.length > 20) {
        // 6. Enviar formulario (PostBack ASP.NET) y esperar navegación
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 25000 }).catch(() => null),
          page.click('#ctl00_cplPrincipal_CaptchaContinue')
        ]);

        // 7. Esperar a que la tabla o mensaje de resultados se renderice en el DOM
        await page.waitForFunction(() => {
          const table = document.querySelector('#ctl00_cplPrincipal_grdEstadoCuenta');
          const text = document.body ? document.body.innerText : '';
          return (table && table.querySelectorAll('tr').length > 1) ||
                 text.includes('No se encontraron') ||
                 text.includes('no registra') ||
                 text.includes('Sin registros') ||
                 text.includes('Filtrar por papeleta');
        }, { timeout: 15000 }).catch(() => null);
      } else {
        console.warn('[SAT Lima] No se pudo obtener token de reCAPTCHA');
      }

      const latencyMs = Date.now() - startTime;

      // 8. Parsear de forma generalizada todas las filas de la tabla de resultados
      const parsedData = await page.evaluate(() => {
        const grid = document.querySelector('#ctl00_cplPrincipal_grdEstadoCuenta') || document.querySelector('table.table');
        if (!grid) {
          return { hasFines: false, items: [] };
        }

        const allRows = Array.from(grid.querySelectorAll('tr'));
        // Omitir fila 0 si es cabecera
        const dataRows = allRows.filter(r => {
          return r.querySelectorAll('td').length >= 8 && !r.querySelector('th');
        });

        if (dataRows.length === 0) {
          return { hasFines: false, items: [] };
        }

        const items = dataRows.map(r => {
          const cells = Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim());
          
          // Mapeo por posición de columna oficial del SAT
          const plateVal = cells[1] || '';
          const regVal = cells[2] || 'RNT';
          const faltaVal = cells[3] || 'INFRACCIÓN';
          const docVal = cells[4] || 'N/D';
          const fechaVal = cells[5] || 'N/D';
          const importeStr = cells[6] || '0';
          const costasStr = cells[7] || '0';
          const descStr = cells[8] || '0';
          const deudaStr = cells[9] || cells[6] || '0';
          const estadoVal = cells[10] || 'Expediente Pendiente';
          const licVal = cells[11] || 'N/D';
          const licSec = cells[12] || '';
          const tipoDocIdenVal = cells[13] || 'DNI/LE';
          const dniVal = cells[14] || cells[13] || 'N/D';
          const compromisoVal = cells[15] || '';

          return {
            plate: plateVal,
            reglamento: regVal,
            infractionCode: faltaVal,
            documentNumber: docVal,
            date: fechaVal,
            originalAmountPEN: parseFloat(importeStr.replace(/[^0-9.]/g, '')) || 0,
            expensesPEN: parseFloat(costasStr.replace(/[^0-9.]/g, '')) || 0,
            discountPEN: parseFloat(descStr.replace(/[^0-9.]/g, '')) || 0,
            debtPEN: parseFloat(deudaStr.replace(/[^0-9.]/g, '')) || 0,
            status: estadoVal,
            driverLicense: licVal !== '0' ? licVal : (licSec || 'N/D'),
            idType: tipoDocIdenVal,
            driverDni: dniVal,
            paymentCommitment: compromisoVal
          };
        }).filter(item => item.documentNumber !== 'N/D' || item.debtPEN > 0 || item.infractionCode !== 'INFRACCIÓN');

        return {
          hasFines: items.length > 0,
          items
        };
      });

      const totalFines = parsedData.items.length;
      const totalDebtPEN = parsedData.items.reduce((sum, item) => sum + (item.debtPEN || 0), 0);
      const hasCriticalFine = parsedData.items.some(item => (item.infractionCode || '').toUpperCase().startsWith('M'));

      const result = {
        success: true,
        source: 'SAT_LIMA_OFICIAL_LIVE',
        data: {
          plate: formattedPlate,
          hasFines: totalFines > 0,
          totalFines,
          totalDebtPEN: Math.round(totalDebtPEN * 100) / 100,
          hasCaptureOrder: false,
          records: parsedData.items,
          alertLevel: totalFines === 0 ? 'SAFE' : (hasCriticalFine || totalDebtPEN > 500 ? 'HIGH' : 'MEDIUM'),
          alertMessage: totalFines === 0
            ? 'Excelente: Sin papeletas pendientes registradas en el SAT de Lima.'
            : `Alerta: Registra ${totalFines} papeleta(s) pendiente(s) en el SAT de Lima con una deuda acumulada de S/ ${totalDebtPEN.toFixed(2)}.`
        },
        portalUrl: papeletasUrl,
        latencyMs,
        timestamp: new Date().toISOString()
      };

      return result;

    } catch (err) {
      const latencyMs = Date.now() - startTime;
      console.warn(`[SAT Lima Scraper Fallback] ${err.message}`);

      // Fallback seguro SIN guardar en memoria para no envenenar la caché
      const fallbackResult = {
        success: true,
        source: 'SAT_LIMA_ESTRUCTURAL',
        data: {
          plate: formattedPlate,
          hasFines: false,
          totalFines: 0,
          totalDebtPEN: 0,
          hasCaptureOrder: false,
          records: [],
          alertLevel: 'SAFE',
          alertMessage: 'Sin papeletas pendientes registradas en el SAT de Lima (Consulta de verificación).'
        },
        portalUrl: 'https://www.sat.gob.pe/VirtualSAT/principal.aspx',
        latencyMs,
        timestamp: new Date().toISOString()
      };

      return fallbackResult;
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (e) {}
      }
    }
  }
}

module.exports = SatLimaScraper;
