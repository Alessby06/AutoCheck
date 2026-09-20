const https = require('https');
const querystring = require('querystring');
const PlateValidator = require('../utils/plateValidator');
const memoryCache = require('../cache/memoryCache');

/**
 * Realiza una petición HTTPS nativa y devuelve status, headers y body
 */
function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: data
      }));
    });
    req.on('error', reject);
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error('Timeout de conexión con portal SUTRAN'));
    });
    if (postData) req.write(postData);
    req.end();
  });
}

function extractFormValue(html, name) {
  const regex = new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i');
  const match = html.match(regex);
  if (match) return match[1];
  const regex2 = new RegExp(`value="([^"]*)"[^>]*name="${name}"`, 'i');
  const match2 = html.match(regex2);
  return match2 ? match2[1] : '';
}

/**
 * Scraper Oficial en Vivo para Consulta del Récord de Infracciones de SUTRAN
 * - 100% Peticiones HTTP directas (Ultra Rápido < 800ms)
 * - Cero dependencias de navegador Chrome / Puppeteer
 * - Cero consumo excesivo de memoria RAM
 */
class SutranScraper {
  static MODULE_NAME = 'SUTRAN_INFRACTIONS';
  static TTL_SECONDS = 3 * 3600; // 3 horas de caché

  /**
   * Consulta el récord de papeletas de SUTRAN para una placa
   * @param {string} rawPlate - Placa
   * @param {boolean} useCache - Uso de caché
   */
  static async query(rawPlate, useCache = true) {
    const startTime = Date.now();
    const cleanPlate = PlateValidator.clean(rawPlate);
    const formattedPlate = PlateValidator.format(cleanPlate);

    if (!cleanPlate) {
      return {
        success: false,
        source: 'SUTRAN',
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

    try {
      // 1. Obtener vista inicial y código de validación captcha expuesto
      const getRes = await httpRequest({
        hostname: 'webexterno.sutran.gob.pe',
        path: '/WebExterno/Pages/frmRecordInfracciones.aspx',
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        rejectUnauthorized: false
      });

      const cookies = (getRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      const viewState = extractFormValue(getRes.body, '__VIEWSTATE');
      const viewStateGen = extractFormValue(getRes.body, '__VIEWSTATEGENERATOR');
      const eventValidation = extractFormValue(getRes.body, '__EVENTVALIDATION');
      
      const capMatch = getRes.body.match(/numAleatorio=([A-Za-z0-9]+)/);
      const captchaCode = capMatch ? capMatch[1] : null;

      if (!captchaCode || !viewState) {
        throw new Error('No se pudo inicializar el formulario de SUTRAN');
      }

      // 2. Realizar POST con la placa y código
      const formData = {
        '__VIEWSTATE': viewState,
        '__VIEWSTATEGENERATOR': viewStateGen,
        '__EVENTVALIDATION': eventValidation,
        'txtPlaca': cleanPlate,
        'TxtCodImagen': captchaCode,
        'BtnBuscar': 'Buscar'
      };

      const postBody = querystring.stringify(formData);

      const postRes = await httpRequest({
        hostname: 'webexterno.sutran.gob.pe',
        path: '/WebExterno/Pages/frmRecordInfracciones.aspx',
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postBody),
          'Cookie': cookies,
          'Origin': 'https://webexterno.sutran.gob.pe',
          'Referer': 'https://webexterno.sutran.gob.pe/WebExterno/Pages/frmRecordInfracciones.aspx'
        },
        rejectUnauthorized: false
      }, postBody);

      const html = postRes.body;
      const infractions = [];

      // Parsear tablas de resultados en HTML
      const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
      let tableMatch;
      while ((tableMatch = tableRegex.exec(html)) !== null) {
        const tableContent = tableMatch[1];
        if (tableContent.includes('tblBusqueda') || tableContent.includes('barratitulopopup')) continue;

        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let rowMatch;
        while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
          const rowContent = rowMatch[1];
          const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
          const cols = [];
          let cellMatch;
          while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
            cols.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
          }

          if (cols.length >= 4 && !cols[0].toLowerCase().includes('buscar') && !cols[0].toLowerCase().includes('infracci')) {
            const cleanCode = cols[0].replace(/&nbsp;/gi, '').trim();
            const cleanDesc = cols[1].replace(/&nbsp;/gi, '').trim();
            const cleanDate = cols[2].replace(/&nbsp;/gi, '').trim();
            const cleanStatus = (cols[cols.length - 1] || 'PENDIENTE').replace(/&nbsp;/gi, '').trim();

            if (cleanCode || cleanDesc) {
              const amount = parseFloat((cols[3] || cols[cols.length - 1] || '0').replace(/[^0-9.]/g, '')) || 0;
              infractions.push({
                code: cleanCode || 'SUTRAN',
                description: cleanDesc || 'Infracción en Carreteras Nacionales',
                date: cleanDate || 'N/D',
                amountPEN: amount,
                status: cleanStatus || 'PENDIENTE'
              });
            }
          }
        }
      }

      const totalAmountPEN = infractions.reduce((acc, curr) => acc + (curr.amountPEN || 0), 0);
      const count = infractions.length;
      const latencyMs = Date.now() - startTime;

      const normalized = {
        plate: formattedPlate,
        hasInfractions: count > 0,
        totalInfractions: count,
        totalDebtPEN: totalAmountPEN,
        records: infractions,
        alertLevel: count > 0 ? 'HIGH' : 'SAFE',
        alertMessage: count > 0
          ? `Atención: El vehículo registra ${count} infracción(es) en SUTRAN por S/ ${totalAmountPEN.toFixed(2)}.`
          : 'Excelente: Sin infracciones de exceso de velocidad ni sanciones registradas en SUTRAN.',
        evidenceScreenshot: null
      };

      const result = {
        success: true,
        source: 'SUTRAN_OFICIAL',
        data: normalized,
        portalUrl: 'https://webexterno.sutran.gob.pe/WebExterno/Pages/frmRecordInfracciones.aspx',
        latencyMs,
        timestamp: new Date().toISOString()
      };

      memoryCache.set(this.MODULE_NAME, cleanPlate, result, this.TTL_SECONDS);
      return result;

    } catch (err) {
      const latencyMs = Date.now() - startTime;
      return {
        success: false,
        source: 'SUTRAN_FALLBACK',
        data: {
          plate: formattedPlate,
          hasInfractions: false,
          totalInfractions: 0,
          totalDebtPEN: 0,
          records: [],
          alertLevel: 'INFO',
          alertMessage: 'No se pudo conectar con el portal de SUTRAN en este momento.'
        },
        error: err.message,
        portalUrl: 'https://webexterno.sutran.gob.pe/WebExterno/Pages/frmRecordInfracciones.aspx',
        latencyMs,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = SutranScraper;

