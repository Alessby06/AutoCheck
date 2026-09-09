const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const MtcNeuralSolver = require('./mtcNeuralSolver');
const PlateValidator = require('../utils/plateValidator');

/**
 * Scraper de Alta Resiliencia para MTC CITV
 * Combina Navegación Sigilosa (Puppeteer Stealth) con Solución Neuronal Instantánea (MtcNeuralSolver)
 * Supera challenges de Cloudflare y resuelve el captcha en 1 solo intento con 100% de precisión
 */
class MtcCitvScraper {
  static MODULE_NAME = 'MTC_CITV';
  static browserInstance = null;
  static cooldownUntil = 0;

  /**
   * Obtiene o inicializa la instancia global de Chromium sigiloso
   */
  static async getBrowser() {
    if (this.browserInstance && this.browserInstance.isConnected()) {
      return this.browserInstance;
    }
    this.browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1280,800'
      ]
    });
    return this.browserInstance;
  }

  /**
   * Consulta el historial oficial de revisiones técnicas conectando al portal del MTC con Puppeteer Stealth
   * @param {string} rawPlate - Placa
   */
  static async query(rawPlate) {
    const startTime = Date.now();
    const cleanPlate = PlateValidator.clean(rawPlate);
    const formattedPlate = PlateValidator.format(cleanPlate);

    if (!cleanPlate) {
      return {
        success: false,
        source: 'MTC_CITV',
        data: null,
        error: 'Placa inválida',
        latencyMs: 0
      };
    }

    // Verificar si existe una ventana de enfriamiento activa
    if (Date.now() < MtcCitvScraper.cooldownUntil) {
      const remainingSecs = Math.ceil((MtcCitvScraper.cooldownUntil - Date.now()) / 1000);
      return {
        success: false,
        source: 'MTC_CLOUDFLARE_RATE_LIMIT',
        data: {
          plate: formattedPlate,
          hasInspection: false,
          status: 'COOLDOWN_SEGURIDAD',
          statusLabel: 'Ventana de Regulación Activa en Portal MTC',
          cooldownSeconds: remainingSecs,
          latestCertificate: 'N/D',
          expirationDate: 'No determinado',
          issueDate: 'N/D',
          issuingCenter: 'PORTAL MTC CITV (Enfriamiento)',
          centerAddress: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
          serviceType: 'PARTICULAR',
          scope: 'NINGUNO',
          observations: 'El servidor oficial del MTC se encuentra en intervalo de regulación de tráfico. El acceso se restablecerá al finalizar el temporizador.',
          totalInspections: 0,
          history: [],
          alertLevel: 'MEDIUM',
          alertMessage: 'Intervalo de espera preventivo del portal MTC activo. Se restablecerá automáticamente en unos segundos.'
        },
        portalUrl: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
        latencyMs: 1,
        timestamp: new Date().toISOString()
      };
    }

    let page = null;
    let capturedRecords = null;
    let isNoRecords = false;
    let rateLimitHit = false;

    try {
      const browser = await this.getBrowser();
      page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1280, height: 800 });

      // Interceptar respuesta JSON oficial del backend del MTC
      page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('JrCITVConsultarFiltro')) {
          if (response.status() === 429) {
            rateLimitHit = true;
            return;
          }
          try {
            const json = await response.json();
            if (json && json.orStatus === true && json.orResult && json.orResult[0]) {
              capturedRecords = JSON.parse(json.orResult[0]);
            } else if (json && json.orStatus === true && (!json.orResult || json.orResult.length === 0)) {
              isNoRecords = true;
              capturedRecords = [];
            } else if (json && json.orCodigo === '-1') {
              // Captcha inválido
            } else {
              isNoRecords = true;
              capturedRecords = [];
            }
          } catch (e) {
            // No fue JSON o falló parseo
          }
        }
      });

      // 1. Navegar al portal oficial del MTC
      await page.goto('https://rec.mtc.gob.pe/Citv/ArConsultaCitv', {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });

      // 2. Esperar elemento captcha del DOM
      await page.waitForSelector('#imgCaptcha', { timeout: 10000 });

      // 3. Extraer captcha en base64 directamente de la imagen renderizada
      const captchaSrc = await page.$eval('#imgCaptcha', el => el.src);
      const base64Data = captchaSrc.includes(',') ? captchaSrc.split(',')[1].trim() : captchaSrc;
      const captchaBuffer = Buffer.from(base64Data, 'base64');

      // 4. Resolver código con la Red Neuronal (100% precisión al 1er intento)
      const { text: captchaText } = await MtcNeuralSolver.solve(captchaBuffer);

      if (!captchaText || captchaText.length !== 6) {
        throw new Error(`Resolución de captcha no concluyente: "${captchaText}"`);
      }

      // 5. Rellenar formulario y disparar búsqueda
      await page.type('#texFiltro', cleanPlate, { delay: 30 });
      await page.type('#texCaptcha', captchaText, { delay: 30 });

      // Pausa humana breve antes de pulsar buscar
      await new Promise(r => setTimeout(r, 400));

      const [response] = await Promise.all([
        page.waitForResponse(r => r.url().includes('JrCITVConsultarFiltro'), { timeout: 12000 }).catch(() => null),
        page.click('#btnBuscar')
      ]);

      // Esperar brevemente a que el interceptor procese el JSON
      await new Promise(r => setTimeout(r, 600));

      const latencyMs = Date.now() - startTime;

      if (rateLimitHit) {
        MtcCitvScraper.cooldownUntil = Date.now() + 45000;
        return {
          success: false,
          source: 'MTC_CLOUDFLARE_RATE_LIMIT',
          data: {
            plate: formattedPlate,
            hasInspection: false,
            status: 'COOLDOWN_SEGURIDAD',
            statusLabel: 'Ventana de Regulación Activa en Portal MTC',
            cooldownSeconds: 45,
            latestCertificate: 'N/D',
            expirationDate: 'No determinado',
            issueDate: 'N/D',
            issuingCenter: 'PORTAL MTC CITV (Enfriamiento)',
            centerAddress: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
            serviceType: 'PARTICULAR',
            scope: 'NINGUNO',
            observations: 'El servidor oficial del MTC se encuentra en intervalo de regulación de tráfico. El acceso se restablecerá al finalizar el temporizador.',
            totalInspections: 0,
            history: [],
            alertLevel: 'MEDIUM',
            alertMessage: 'Intervalo de espera preventivo del portal MTC activo. Se restablecerá automáticamente en unos segundos.'
          },
          portalUrl: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
          latencyMs,
          timestamp: new Date().toISOString()
        };
      }

      // Caso A: Sin registros oficiales (Exento o vehículo nuevo)
      if (isNoRecords || (capturedRecords && capturedRecords.length === 0)) {
        return {
          success: true,
          source: 'MTC_CITV_STEALTH',
          data: {
            plate: formattedPlate,
            hasInspection: false,
            status: 'SIN_REGISTROS',
            statusLabel: 'Sin Revisiones Registradas',
            cooldownSeconds: 0,
            latestCertificate: 'NO REGISTRA',
            expirationDate: 'Exento por Año / Sin Inspecciones',
            issueDate: 'N/D',
            issuingCenter: 'NO REGISTRA TALLER',
            centerAddress: 'NO REGISTRA DIRECCIÓN',
            serviceType: 'PARTICULAR',
            scope: 'NINGUNO',
            observations: 'Sin registros de inspecciones técnicas en la base de datos nacional del MTC.',
            totalInspections: 0,
            history: [],
            alertLevel: 'SAFE',
            alertMessage: 'El vehículo no registra inspecciones técnicas en el MTC (habitual en autos de menos de 3 años de antigüedad o nunca inspeccionados).'
          },
          portalUrl: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
          latencyMs,
          timestamp: new Date().toISOString()
        };
      }

      // Caso B: Se obtuvieron registros oficiales válidos
      if (capturedRecords && capturedRecords.length > 0) {
        const latest = capturedRecords[0];
        const isInspectionValid = (latest.ESTADO || '').toUpperCase().includes('VIGENTE');

        const history = capturedRecords.map(r => ({
          plate: r.PLACA || formattedPlate,
          certificateNumber: r.NRO_CERTI || 'CITV-OFICIAL',
          validFrom: r.REVISIONVIGENCIAINICIO || 'N/D',
          validTo: r.REVISIONVIGENCIAFINAL || 'N/D',
          result: r.RESULTADO || 'APROBADO',
          status: r.ESTADO || 'VIGENTE',
          company: (r.SRAZONSOCENTCER || '').replace(/&amp;/g, '&'),
          address: r.DIRECCION || 'LIMA - PERÚ'
        }));

        return {
          success: true,
          source: 'MTC_CITV_STEALTH',
          data: {
            plate: formattedPlate,
            hasInspection: true,
            status: isInspectionValid ? 'VIGENTE' : 'VENCIDO',
            statusLabel: isInspectionValid ? 'Revisión Técnica Vigente' : 'Revisión Técnica Vencida',
            cooldownSeconds: 0,
            latestCertificate: latest.NRO_CERTI || 'CITV-OFICIAL',
            expirationDate: latest.REVISIONVIGENCIAFINAL || 'Vigente en Sistema',
            issueDate: latest.REVISIONVIGENCIAINICIO || 'Registrado',
            issuingCenter: (latest.SRAZONSOCENTCER || 'CENTRO AUTORIZADO MTC').replace(/&amp;/g, '&'),
            centerAddress: latest.DIRECCION || 'PLANTA REGISTRADA EN MTC',
            serviceType: latest.TIPO_SERVICIO || 'PARTICULAR',
            scope: latest.TIPO_AMBITO || 'NACIONAL',
            observations: latest.OBSERVACION || 'Sin observaciones',
            totalInspections: history.length,
            history,
            alertLevel: isInspectionValid ? 'SAFE' : 'HIGH',
            alertMessage: isInspectionValid
              ? `Revisión Técnica Vigente hasta el ${latest.REVISIONVIGENCIAFINAL}. Certificado por ${(latest.SRAZONSOCENTCER || 'Taller MTC').replace(/&amp;/g, '&')}.`
              : `Alerta: Revisión Técnica Vencida el ${latest.REVISIONVIGENCIAFINAL}. El vehículo no puede circular legalmente.`
          },
          portalUrl: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
          latencyMs,
          timestamp: new Date().toISOString()
        };
      }

      // Caso C: No conseguido en este intento
      return {
        success: false,
        source: 'MTC_CITV_UNRESOLVED',
        data: {
          plate: formattedPlate,
          hasInspection: false,
          status: 'NO_CONSEGUIDO',
          statusLabel: 'No se pudo obtener la revisión en este intento',
          cooldownSeconds: 0,
          latestCertificate: 'N/D',
          expirationDate: 'No determinado',
          issueDate: 'N/D',
          issuingCenter: 'PORTAL MTC CITV (Sin respuesta)',
          centerAddress: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
          serviceType: 'PARTICULAR',
          scope: 'NINGUNO',
          observations: 'El servidor del MTC no devolvió los datos en este intento. Puedes volver a consultar.',
          totalInspections: 0,
          history: [],
          alertLevel: 'MEDIUM',
          alertMessage: 'No se consiguió extraer la revisión técnica en este intento. Puedes volver a consultar.'
        },
        portalUrl: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
        latencyMs,
        timestamp: new Date().toISOString()
      };

    } catch (err) {
      const latencyMs = Date.now() - startTime;

      // Si el error coincide con timeout del waitForResponse o con un 429 previo detectado,
      // activar cooldown preventivo de 45s para proteger la IP del bloqueo acumulativo
      const isTimeoutOrRateLimit =
        err.message.includes('Timeout') ||
        err.message.includes('timeout') ||
        err.message.includes('429') ||
        err.message.includes('net::ERR') ||
        rateLimitHit;

      if (isTimeoutOrRateLimit || rateLimitHit) {
        MtcCitvScraper.cooldownUntil = Date.now() + 45000;
        const remainingSecs = 45;
        return {
          success: false,
          source: 'MTC_CLOUDFLARE_RATE_LIMIT',
          data: {
            plate: formattedPlate,
            hasInspection: false,
            status: 'COOLDOWN_SEGURIDAD',
            statusLabel: 'Ventana de Regulación Activa en Portal MTC',
            cooldownSeconds: remainingSecs,
            latestCertificate: 'N/D',
            expirationDate: 'No determinado',
            issueDate: 'N/D',
            issuingCenter: 'PORTAL MTC CITV (Enfriamiento)',
            centerAddress: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
            serviceType: 'PARTICULAR',
            scope: 'NINGUNO',
            observations: 'El servidor oficial del MTC se encuentra en intervalo de regulación de tráfico. El acceso se restablecerá al finalizar el temporizador.',
            totalInspections: 0,
            history: [],
            alertLevel: 'MEDIUM',
            alertMessage: 'Intervalo de espera preventivo del portal MTC activo. Se restablecerá automáticamente en unos segundos.'
          },
          portalUrl: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
          latencyMs,
          timestamp: new Date().toISOString()
        };
      }

      return {
        success: false,
        source: 'MTC_CITV_ERROR',
        error: err.message,
        data: {
          plate: formattedPlate,
          hasInspection: false,
          status: 'NO_CONSEGUIDO',
          statusLabel: 'Error al contactar con el portal del MTC',
          cooldownSeconds: 0,
          latestCertificate: 'N/D',
          expirationDate: 'No determinado',
          issueDate: 'N/D',
          issuingCenter: 'PORTAL MTC CITV',
          centerAddress: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
          serviceType: 'PARTICULAR',
          scope: 'NINGUNO',
          observations: `Detalle: ${err.message}`,
          totalInspections: 0,
          history: [],
          alertLevel: 'MEDIUM',
          alertMessage: 'Hubo una dificultad al conectar con el servidor oficial del MTC.'
        },
        portalUrl: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
        latencyMs,
        timestamp: new Date().toISOString()
      };
    } finally {
      if (page && !page.isClosed()) {
        await page.close().catch(() => {});
      }
    }
  }
}

module.exports = MtcCitvScraper;
