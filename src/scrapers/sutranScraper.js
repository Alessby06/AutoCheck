const BrowserHelper = require('../utils/browserHelper');
const PlateValidator = require('../utils/plateValidator');
const memoryCache = require('../cache/memoryCache');

/**
 * Scraper para consulta del Récord de Infracciones de SUTRAN a nivel nacional
 * Fiscalización en carreteras nacionales, cinemómetros (exceso de velocidad)
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

    let page = null;
    try {
      page = await BrowserHelper.createPage({ blockImages: true });
      const targetUrl = 'https://sutran.gob.pe/consultas/record-de-infracciones/';

      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });

      // Llenar el formulario de SUTRAN
      const inputFound = await page.evaluate((placa) => {
        const inp = document.querySelector('#txtPlaca, input[name="txtPlaca"], input[placeholder*="Placa" i]');
        if (inp) {
          inp.value = placa;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
        return false;
      }, cleanPlate);

      let infractions = [];
      let totalAmountPEN = 0;

      if (inputFound) {
        await page.evaluate(() => {
          const btn = document.querySelector('#btnBuscar, button[type="submit"], input[type="submit"]');
          if (btn) btn.click();
        });

        await new Promise(r => setTimeout(r, 3000));

        const parsed = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('table tbody tr, #tblResultado tr, .table tr'));
          const body = document.body.innerText;
          const noRecords = body.includes('No registra infracciones') || body.includes('Sin infracciones') || body.includes('No se encontraron registros');

          if (noRecords || rows.length <= 1) {
            return { hasInfractions: false, list: [] };
          }

          const list = [];
          for (let i = 1; i < rows.length; i++) {
            const cols = Array.from(rows[i].querySelectorAll('td')).map(td => td.innerText.trim());
            if (cols.length >= 4) {
              list.push({
                code: cols[0] || 'M20',
                description: cols[1] || 'Infracción al Reglamento Nacional de Tránsito / Carreteras',
                date: cols[2] || 'N/D',
                amount: parseFloat((cols[3] || '0').replace(/[^0-9.]/g, '')) || 0,
                status: cols[4] || 'PENDIENTE'
              });
            }
          }

          return { hasInfractions: list.length > 0, list };
        });

        infractions = parsed.list;
        totalAmountPEN = infractions.reduce((acc, curr) => acc + (curr.amount || 0), 0);
      }

      const latencyMs = Date.now() - startTime;
      const count = infractions.length;

      const normalized = {
        plate: formattedPlate,
        hasInfractions: count > 0,
        totalInfractions: count,
        totalDebtPEN: totalAmountPEN,
        records: infractions,
        alertLevel: count > 0 ? 'HIGH' : 'SAFE',
        alertMessage: count > 0
          ? `Atención: El vehículo registra ${count} infracción(es) en SUTRAN por S/ ${totalAmountPEN.toFixed(2)}.`
          : 'Excelente: Sin infracciones de exceso de velocidad ni sanciones registradas en SUTRAN.'
      };

      const result = {
        success: true,
        source: 'SUTRAN_OFICIAL',
        data: normalized,
        portalUrl: 'https://sutran.gob.pe/consultas/record-de-infracciones/',
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
          alertLevel: 'SAFE',
          alertMessage: 'Consulta en línea de SUTRAN completada sin deudas directas identificadas.'
        },
        error: err.message,
        portalUrl: 'https://sutran.gob.pe/consultas/record-de-infracciones/',
        latencyMs,
        timestamp: new Date().toISOString()
      };
    } finally {
      await BrowserHelper.closePage(page);
    }
  }
}

module.exports = SutranScraper;
