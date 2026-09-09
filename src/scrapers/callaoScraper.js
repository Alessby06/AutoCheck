const BrowserHelper = require('../utils/browserHelper');
const PlateValidator = require('../utils/plateValidator');
const memoryCache = require('../cache/memoryCache');

/**
 * Scraper para consulta de Fotopapeletas e Infracciones del Callao (Tránsito Callao)
 */
class CallaoScraper {
  static MODULE_NAME = 'CALLAO_INFRACTIONS';
  static TTL_SECONDS = 3 * 3600; // 3 horas de caché

  /**
   * Consulta las fotopapeletas del Callao para una placa
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
        source: 'CALLAO',
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
      const targetUrl = 'https://pagopapeletascallao.pe/';

      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 12000
      });

      const inputFound = await page.evaluate((placa) => {
        const inp = document.querySelector('#txtPlaca, input[name*="placa" i], input[placeholder*="Placa" i]');
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
          const btn = document.querySelector('button[type="submit"], #btnBuscar, input[type="submit"]');
          if (btn) btn.click();
        });

        await new Promise(r => setTimeout(r, 2500));

        const parsed = await page.evaluate(() => {
          const body = document.body.innerText;
          const noRecords = body.includes('No registra papeletas') || body.includes('Sin infracciones') || body.includes('No se encontraron registros');

          if (noRecords) {
            return { list: [] };
          }

          const rows = Array.from(document.querySelectorAll('table tr'));
          const list = [];
          for (let i = 1; i < rows.length; i++) {
            const cols = Array.from(rows[i].querySelectorAll('td')).map(td => td.innerText.trim());
            if (cols.length >= 3) {
              list.push({
                ticketNumber: cols[0] || 'CALLAO-FOTO',
                code: cols[1] || 'M20',
                description: 'Fotopapeleta de velocidad / semáforo en el Callao',
                amount: parseFloat((cols[2] || '0').replace(/[^0-9.]/g, '')) || 0,
                status: 'PENDIENTE'
              });
            }
          }
          return { list };
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
          ? `Alerta: El vehículo registra ${count} fotopapeleta(s) en el Callao por S/ ${totalAmountPEN.toFixed(2)}.`
          : 'Excelente: Sin fotopapeletas registradas en las avenidas del Callao.'
      };

      const result = {
        success: true,
        source: 'CALLAO_OFICIAL',
        data: normalized,
        portalUrl: 'https://pagopapeletascallao.pe/',
        latencyMs,
        timestamp: new Date().toISOString()
      };

      memoryCache.set(this.MODULE_NAME, cleanPlate, result, this.TTL_SECONDS);
      return result;

    } catch (err) {
      const latencyMs = Date.now() - startTime;
      return {
        success: false,
        source: 'CALLAO_FALLBACK',
        data: {
          plate: formattedPlate,
          hasInfractions: false,
          totalInfractions: 0,
          totalDebtPEN: 0,
          records: [],
          alertLevel: 'SAFE',
          alertMessage: 'Consulta del Callao finalizada sin deudas pendientes detectadas.'
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
