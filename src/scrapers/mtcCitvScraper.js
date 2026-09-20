const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const PlateValidator = require('../utils/plateValidator');
const MtcNeuralSolver = require('./mtcNeuralSolver');

/**
 * Resuelve el captcha alfanumérico del MTC utilizando ddddocr en Python como fallback
 * @param {Buffer} captchaBuffer
 * @returns {string|null}
 */
function solveCaptchaDdddocr(captchaBuffer) {
  const tmpDir = path.join(__dirname, '..', '..', 'temp_audio');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const timestamp = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const tmpImg = path.join(tmpDir, `mtc_cap_${timestamp}.png`);

  try {
    fs.writeFileSync(tmpImg, captchaBuffer);
    const cmd = `python -c "import ddddocr; ocr = ddddocr.DdddOcr(show_ad=False); print('RESULT:' + ocr.classification(open(r'${tmpImg}', 'rb').read()))"`;
    const out = execSync(cmd, { timeout: 10000 }).toString();
    const match = out.match(/RESULT:(\w+)/);
    return match ? match[1].trim() : null;
  } catch (e) {
    console.warn('[MtcCitvScraper] Fallo en solver ddddocr:', e.message);
    return null;
  } finally {
    try { if (fs.existsSync(tmpImg)) fs.unlinkSync(tmpImg); } catch (e) {}
  }
}

/**
 * Solucionador híbrido de alta precisión:
 * 1. MtcNeuralSolver en memoria (~46ms)
 * 2. Si confianza < 0.95 o longitud !== 6, fallback secundario a ddddocr
 * @param {Buffer} buffer
 * @returns {Promise<string|null>}
 */
async function resolveCaptchaHybrid(buffer) {
  try {
    const neural = await MtcNeuralSolver.solve(buffer);
    if (neural && neural.text && neural.text.length === 6 && neural.confidence >= 0.95) {
      return neural.text;
    }

    // Si la confianza es menor a 0.95 o la longitud no es 6, invocar fallback ddddocr
    const dddd = solveCaptchaDdddocr(buffer);
    if (dddd && dddd.length === 6) {
      return dddd;
    }

    // Si ddddocr falló pero el neural devolvió 6 dígitos con confianza menor, intentar con neural
    if (neural && neural.text && neural.text.length === 6) {
      return neural.text;
    }

    return dddd || null;
  } catch (err) {
    console.warn('[MtcCitvScraper] Error en resolución neuronal, intentando ddddocr:', err.message);
    return solveCaptchaDdddocr(buffer);
  }
}

/**
 * Ejecuta una petición HTTP GET nativa con timeout y control de headers
 * @param {string} url
 * @param {Object} options
 * @returns {Promise<{ statusCode: number, headers: Object, body: string }>}
 */
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout || 10000;
    const req = https.get(url, {
      headers: options.headers || {},
      timeout
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`HTTP request timeout (${timeout}ms) hacia ${url}`));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Genera la respuesta estandarizada en caso de Rate Limit / Cooldown de Cloudflare
 */
function createCooldownResponse(formattedPlate, cooldownSeconds, latencyMs) {
  return {
    success: false,
    source: 'MTC_CLOUDFLARE_RATE_LIMIT',
    error: `Ventana de enfriamiento preventiva activa en portal MTC (${cooldownSeconds}s)`,
    data: {
      plate: formattedPlate,
      hasInspection: false,
      status: 'COOLDOWN_SEGURIDAD',
      statusLabel: 'Ventana de Regulación Activa en Portal MTC',
      cooldownSeconds,
      latestCertificate: 'N/D',
      expirationDate: 'No determinado',
      issueDate: 'N/D',
      issuingCenter: 'PORTAL MTC CITV (Enfriamiento)',
      centerAddress: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
      serviceType: 'PARTICULAR',
      scope: 'NINGUNO',
      observations: 'El servidor oficial del MTC se encuentra en intervalo de regulación de tráfico (Cloudflare HTTP 429).',
      totalInspections: 0,
      history: [],
      records: [],
      alertLevel: 'MEDIUM',
      alertMessage: `Intervalo de espera preventivo del portal MTC activo (${cooldownSeconds}s restante).`
    },
    portalUrl: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
    latencyMs,
    timestamp: new Date().toISOString()
  };
}

/**
 * Scraper de Alto Rendimiento y Resiliencia para MTC CITV (Inspección Técnica Vehicular)
 * Opera mediante Fast-Path 100% HTTP nativo (sin Chromium), inferencia neuronal en memoria (46ms),
 * fallback automático a ddddocr, bypass de Cloudflare 1015 mediante ruta normalizada /Citv/,
 * e inspección activa de encabezados Cloudflare Edge (retry-after).
 */
class MtcCitvScraper {
  static MODULE_NAME = 'MTC_CITV';
  static cooldownUntil = 0;

  /**
   * Consulta el historial oficial de revisiones técnicas del MTC
   * @param {string} rawPlate - Placa a consultar
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

    // Verificar si existe una ventana de enfriamiento activa (Cloudflare Sentinel)
    if (Date.now() < MtcCitvScraper.cooldownUntil) {
      const remainingSecs = Math.ceil((MtcCitvScraper.cooldownUntil - Date.now()) / 1000);
      return createCooldownResponse(formattedPlate, remainingSecs, 1);
    }

    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Referer': 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
      'X-Requested-With': 'XMLHttpRequest'
    };

    let queryResult = null;
    const MAX_ATTEMPTS = 4;

    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // 1. Obtener sesión fresca y captcha Base64
        const rCaptcha = await httpRequest('https://rec.mtc.gob.pe/Citv/refrescarCaptcha', {
          headers: defaultHeaders,
          timeout: 8000
        });

        // Detección de Rate Limit (HTTP 429) según Cloudflare Sentinel
        if (rCaptcha.statusCode === 429) {
          const retryAfter = parseInt(rCaptcha.headers['retry-after'] || '60', 10);
          MtcCitvScraper.cooldownUntil = Date.now() + (retryAfter * 1000);
          return createCooldownResponse(formattedPlate, retryAfter, Date.now() - startTime);
        }

        if (!rCaptcha.body) {
          continue;
        }

        let jsonCap = null;
        try {
          jsonCap = JSON.parse(rCaptcha.body);
        } catch (e) {
          continue;
        }

        if (!jsonCap || !jsonCap.orResult) {
          continue;
        }

        // Extraer cookie de sesión ASP.NET_SessionId
        const cookies = (rCaptcha.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        const captchaBuffer = Buffer.from(jsonCap.orResult, 'base64');

        // 2. Resolver Captcha en memoria con solver híbrido (Neural + ddddocr)
        const captchaText = await resolveCaptchaHybrid(captchaBuffer);
        if (!captchaText || captchaText.length !== 6) {
          continue;
        }

        // 3. Consultar endpoint oficial con bypass de Cloudflare 1015 (ruta /Citv/)
        const queryUrl = `https://rec.mtc.gob.pe/Citv/JrCITVConsultarFiltro?pArrParametros=1|${encodeURIComponent(cleanPlate)}||${encodeURIComponent(captchaText)}`;
        const rQuery = await httpRequest(queryUrl, {
          headers: {
            ...defaultHeaders,
            'Cookie': cookies
          },
          timeout: 8000
        });

        if (rQuery.statusCode === 429) {
          const retryAfter = parseInt(rQuery.headers['retry-after'] || '60', 10);
          MtcCitvScraper.cooldownUntil = Date.now() + (retryAfter * 1000);
          return createCooldownResponse(formattedPlate, retryAfter, Date.now() - startTime);
        }

        let parsedQuery = null;
        try {
          parsedQuery = JSON.parse(rQuery.body);
        } catch (e) {
          // Si hubo error de parseo (ej. respuesta no JSON inesperada), reintentar
          continue;
        }

        if (parsedQuery && parsedQuery.orStatus === true) {
          queryResult = parsedQuery;
          break;
        } else if (parsedQuery && parsedQuery.orCodigo === '-1') {
          // Captcha o sesión rechazada por MTC (-1) -> reintentar con captcha fresco
          continue;
        }
      }

      const latencyMs = Date.now() - startTime;

      // Si no se obtuvo respuesta exitosa tras los reintentos
      if (!queryResult || queryResult.orStatus !== true) {
        return {
          success: false,
          source: 'MTC_CITV_UNRESOLVED',
          error: 'El servidor del MTC no devolvió los datos tras los reintentos.',
          data: {
            plate: formattedPlate,
            hasInspection: false,
            status: 'NO_CONSEGUIDO',
            statusLabel: 'No se pudo obtener la revisión en este intento',
            cooldownSeconds: 0,
            latestCertificate: 'N/D',
            expirationDate: 'No determinado',
            issueDate: 'N/D',
            issuingCenter: 'PORTAL MTC CITV',
            centerAddress: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
            serviceType: 'PARTICULAR',
            scope: 'NINGUNO',
            observations: 'El servidor del MTC no devolvió los datos tras los reintentos. Puedes reintentar la auditoría.',
            totalInspections: 0,
            history: [],
            records: [],
            alertLevel: 'MEDIUM',
            alertMessage: 'No se consiguió extraer la revisión técnica en este intento.'
          },
          portalUrl: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
          latencyMs,
          timestamp: new Date().toISOString()
        };
      }

      // Procesar registros devueltos por el servidor
      let rawRecords = [];
      if (queryResult.orResult && queryResult.orResult[0]) {
        try {
          rawRecords = JSON.parse(queryResult.orResult[0]);
        } catch (e) {
          rawRecords = [];
        }
      }

      // Caso A: Sin registros oficiales (Exento o vehículo nuevo)
      if (!rawRecords || rawRecords.length === 0) {
        return {
          success: true,
          source: 'MTC_CITV',
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
            records: [],
            alertLevel: 'SAFE',
            alertMessage: 'El vehículo no registra inspecciones técnicas en el MTC (habitual en autos de menos de 3 años de antigüedad o nunca inspeccionados).'
          },
          error: null,
          portalUrl: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
          latencyMs,
          timestamp: new Date().toISOString()
        };
      }

      // Caso B: Se obtuvieron registros oficiales válidos
      const history = rawRecords.map(r => ({
        plate: r.PLACA || formattedPlate,
        certificateNumber: r.NRO_CERTI || 'CITV-OFICIAL',
        validFrom: r.REVISIONVIGENCIAINICIO || 'N/D',
        validTo: r.REVISIONVIGENCIAFINAL || 'N/D',
        result: r.RESULTADO || 'APROBADO',
        status: (r.ESTADO || 'VIGENTE').trim().toUpperCase(),
        company: (r.SRAZONSOCENTCER || '').replace(/&amp;/g, '&'),
        address: r.DIRECCION || 'LIMA - PERÚ',
        serviceType: r.TIPO_SERVICIO || 'PARTICULAR',
        scope: r.TIPO_AMBITO || 'NACIONAL',
        observations: r.OBSERVACION || 'Sin observaciones'
      }));

      const latest = history[0];
      const isInspectionValid = (latest.status || '').includes('VIGENTE');

      return {
        success: true,
        source: 'MTC_CITV',
        data: {
          plate: formattedPlate,
          hasInspection: true,
          status: isInspectionValid ? 'VIGENTE' : 'VENCIDO',
          statusLabel: isInspectionValid ? 'Revisión Técnica Vigente' : 'Revisión Técnica Vencida',
          cooldownSeconds: 0,
          latestCertificate: latest.certificateNumber,
          expirationDate: latest.validTo,
          issueDate: latest.validFrom,
          issuingCenter: latest.company || 'CENTRO AUTORIZADO MTC',
          centerAddress: latest.address,
          serviceType: latest.serviceType,
          scope: latest.scope,
          observations: latest.observations,
          totalInspections: history.length,
          history,
          records: history,
          alertLevel: isInspectionValid ? 'SAFE' : 'HIGH',
          alertMessage: isInspectionValid
            ? `Revisión Técnica Vigente hasta el ${latest.validTo}. Certificado por ${latest.company}.`
            : `Alerta: Revisión Técnica Vencida el ${latest.validTo}. El vehículo no puede circular legalmente.`
        },
        error: null,
        portalUrl: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
        latencyMs,
        timestamp: new Date().toISOString()
      };

    } catch (err) {
      const latencyMs = Date.now() - startTime;
      console.error('[MtcCitvScraper Error]', err);

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
          records: [],
          alertLevel: 'MEDIUM',
          alertMessage: 'Hubo una dificultad al conectar con el servidor oficial del MTC.'
        },
        portalUrl: 'https://rec.mtc.gob.pe/Citv/ArConsultaCitv',
        latencyMs,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = MtcCitvScraper;
