const BrowserHelper = require('../utils/browserHelper');
const PlateValidator = require('../utils/plateValidator');
const memoryCache = require('../cache/memoryCache');

/**
 * Scraper de Alta Fidelidad para Consulta en Vivo de Fiscalización e Infracciones en ATU
 * (Autoridad de Transporte Urbano para Lima y Callao - Pasarela Oficial SISPAGO)
 * 
 * Cobertura Integral:
 * - Ciclo de vida robusto en SPA con Materialize CSS y WebComponents
 * - Cierre preventivo de popups y avisos institucionales
 * - Selección dual (DOM nativo + Dropdown virtual Materialize)
 * - Extracción estructurada: N° Acta, Falta, Fecha, Montos, Descuentos, Estado y Enlace Oficial
 * - Detección y suma automática a deuda consolidada
 */
class AtuScraper {
  static MODULE_NAME = 'ATU_FINES';
  static TTL_SECONDS = 3600; // 1 hora de caché

  /**
   * Consulta las actas de fiscalización e infracciones registradas en la ATU
   * @param {string} rawPlate - Placa vehicular
   * @param {boolean} useCache - Uso de caché en memoria
   */
  static async query(rawPlate, useCache = true) {
    const startTime = Date.now();
    const cleanPlate = PlateValidator.clean(rawPlate);
    const formattedPlate = PlateValidator.format(cleanPlate);

    if (!cleanPlate) {
      return {
        success: false,
        source: 'ATU_OFICIAL',
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
      page = await BrowserHelper.createPage();
      await page.setViewport({ width: 1280, height: 850 });

      // 1. Navegar a la raíz de la pasarela oficial
      try {
        await page.goto('https://pasarela.atu.gob.pe/#', {
          waitUntil: 'domcontentloaded',
          timeout: 40000
        });
      } catch (e) {
        await page.goto('https://pasarela.atu.gob.pe/#', {
          waitUntil: 'load',
          timeout: 35000
        });
      }
      await new Promise(r => setTimeout(r, 2000));

      // 2. Cerrar popup de bienvenida / comunicados si existe y remover overlays
      try {
        await page.evaluate(() => {
          const btn = document.querySelector('#btnCerrarHomePopup') || 
                      document.querySelector('.home-popup-close') ||
                      document.querySelector('.modal .close');
          if (btn) btn.click();
          document.querySelectorAll('.home-popup, .modal-overlay').forEach(el => el.remove());
        });
      } catch (e) {}
      await new Promise(r => setTimeout(r, 1000));

      // 3. Clic en el enlace del menú lateral para "Consulta y Pago de Infracciones"
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a'));
          const target = links.find(el => {
            const txt = (el.innerText || el.textContent || '').trim();
            return txt.includes('Consulta y Pago de Infracciones') && !txt.includes('PRS') && !txt.includes('Pronto');
          });
          if (target) target.click();
        });
        
        await new Promise(r => setTimeout(r, 2000));
        const hasForm = await page.evaluate(() => !!(document.querySelector('#formBusqueda') || document.querySelector('#TipoBusquedaselectElemento') || document.querySelector('page-buscar-deuda-component')));
        if (hasForm) break;
      }

      // 4. Esperar a que el selector y formulario estén listos
      await page.waitForFunction(() => {
        return !!(document.querySelector('#TipoBusquedaselectElemento') || 
                  document.querySelector('#formBusqueda') ||
                  document.querySelector('ul.dropdown-content li span') ||
                  document.querySelector('select'));
      }, { timeout: 15000 });
      await new Promise(r => setTimeout(r, 800));

      // 5. Configurar búsqueda "Por Placa" (DOM nativo + Dropdown Materialize + WebComponent)
      await page.evaluate(() => {
        // A. Abrir dropdown de Materialize haciendo clic en el input trigger
        const trigger = document.querySelector('.select-wrapper input.select-dropdown') || document.querySelector('input.select-dropdown');
        if (trigger) trigger.click();

        // B. Clic en la opción Por Placa
        const dropdownOptions = Array.from(document.querySelectorAll('ul.dropdown-content li span, .select-wrapper li span'));
        const placaOpt = dropdownOptions.find(o => (o.innerText || '').toLowerCase().includes('placa'));
        if (placaOpt) {
          placaOpt.click();
          if (placaOpt.parentElement) placaOpt.parentElement.click();
        }

        // C. Select nativo
        const sel = document.querySelector('#TipoBusquedaselectElemento') || document.querySelector('select');
        if (sel && sel.options) {
          for (let i = 0; i < sel.options.length; i++) {
            if (sel.options[i].text.toLowerCase().includes('placa')) {
              sel.selectedIndex = i;
              sel.value = sel.options[i].value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              break;
            }
          }
        }

        // D. Invocar componente directamente si existe
        const comp = document.querySelector('page-buscar-deuda-component');
        if (comp && comp.__TipoBusqueda) {
          comp.__TipoBusqueda.value = { _id: "2", nombre: "Por Placa" };
          if (typeof comp.__TipoBusqueda.change === 'function') comp.__TipoBusqueda.change();
          comp.__TipoBusqueda.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await new Promise(r => setTimeout(r, 1200));

      // 6. Ingresar la placa vehicular de forma nativa mediante CDP
      const inputSelector = '#PlacaBusquedainputElemento, obj-input-component#PlacaBusqueda input, input[placeholder*="placa" i]';
      await page.waitForSelector(inputSelector, { visible: true, timeout: 10000 });
      await page.click(inputSelector, { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type(inputSelector, cleanPlate, { delay: 40 });
      await new Promise(r => setTimeout(r, 500));

      // Respaldo de sincronización en componentes Web
      await page.evaluate((placa) => {
        const inp = document.querySelector('#PlacaBusquedainputElemento');
        if (inp) {
          inp.value = placa;
          inp.classList.remove('invalid');
          inp.classList.add('valid');
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, cleanPlate);
      await new Promise(r => setTimeout(r, 400));

      // 7. Enviar formulario de búsqueda con clic nativo CDP y reCAPTCHA trigger
      const submitSelector = 'button[type="submit"], #formBusqueda button';
      const submitBtn = await page.$(submitSelector);
      if (submitBtn) {
        await submitBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }

      // 8. Esperar respuesta de la pasarela y renderizado de tabla
      await new Promise(resolve => setTimeout(resolve, 6500));

      // 9. Extraer y parsear todas las actas de la tabla DOM con paginación iterativa
      const allRecords = [];
      let pageNumber = 1;
      let hasMorePages = true;

      while (hasMorePages) {
        const pageData = await page.evaluate(() => {
          const bodyText = document.body ? document.body.innerText : '';
          const isClean = bodyText.includes('Sin Registros') || bodyText.includes('Total a Pagar: S/ 0.00');

          const cleanMonto = (str) => {
            if (!str) return 0;
            const n = parseFloat(str.replace(/[^0-9.]/g, ''));
            return isNaN(n) ? 0 : n;
          };

          const records = [];
          const tables = Array.from(document.querySelectorAll('table'));
          
          tables.forEach(table => {
            const rows = Array.from(table.querySelectorAll('tbody tr'));
            rows.forEach(tr => {
              const cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
              if (cells.length >= 8 && !cells[0].includes('Sin Registros') && !cells.join(' ').includes('Sin Registros')) {
                const actaNumber = cells[6] || cells[3] || cells[0] || 'N/D';
                const falta = cells[7] || cells[4] || 'INFRACCIÓN';
                const tipoActa = cells[4] || 'ACTA';
                const reglamento = cells[5] || 'ATU';
                const tipoInfractor = cells[8] || 'CONDUCTOR / PROPIETARIO';
                const fecha = cells[9] || 'N/D';
                const importe = cleanMonto(cells[11]);
                const gastos = cleanMonto(cells[12]);
                const totalDeuda = cleanMonto(cells[13]);
                const totalPagado = cleanMonto(cells[14]);
                const totalPagar = cleanMonto(cells[15]) || totalDeuda || importe;
                const estado = cells[16] || (totalPagar > 0 ? 'PENDIENTE' : 'CANCELADO');

                records.push({
                  actaNumber,
                  falta,
                  tipoActa,
                  reglamento,
                  tipoInfractor,
                  fecha,
                  originalAmountPEN: importe,
                  expensesPEN: gastos,
                  totalDebtPEN: totalDeuda,
                  paidPEN: totalPagado,
                  amountToPayPEN: totalPagar,
                  status: estado,
                  portalUrl: 'https://pasarela.atu.gob.pe/#'
                });
              }
            });
          });

          // Verificar control de paginación
          const paginationItems = Array.from(document.querySelectorAll('ul.pagination li, .pagination li'));
          const nextBtn = paginationItems.find(li => {
            const t = li.innerText || '';
            return t.includes('chevron_right') || t.includes('›') || t.includes('Sig');
          });
          const canGoNext = nextBtn ? !nextBtn.classList.contains('disabled') : false;

          return {
            records,
            isClean: isClean && records.length === 0,
            canGoNext
          };
        });

        if (pageData.records.length > 0) {
          allRecords.push(...pageData.records);
        }

        if (pageData.canGoNext && pageNumber < 25) {
          pageNumber++;
          await page.evaluate(() => {
            const paginationItems = Array.from(document.querySelectorAll('ul.pagination li, .pagination li'));
            const nextBtn = paginationItems.find(li => {
              const t = li.innerText || '';
              return t.includes('chevron_right') || t.includes('›') || t.includes('Sig');
            });
            if (nextBtn) {
              const a = nextBtn.querySelector('a') || nextBtn;
              a.click();
            }
          });
          await new Promise(r => setTimeout(r, 2000));
        } else {
          hasMorePages = false;
        }
      }

      let atuScreenshot = null;
      try {
        const rawShot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 75 });
        atuScreenshot = `data:image/jpeg;base64,${rawShot}`;
      } catch (e) {}

      const totalInfractions = allRecords.length;
      let totalDebtPEN = 0;
      allRecords.forEach(r => {
        totalDebtPEN += (r.amountToPayPEN || r.totalDebtPEN || r.originalAmountPEN || 0);
      });

      // Evaluar nivel de riesgo según decisiones acordadas
      let alertLevel = 'SAFE';
      let alertMessage = 'Excelente: Sin actas de fiscalización ni sanciones registradas en la ATU.';

      if (totalInfractions > 0) {
        if (totalDebtPEN >= 500) {
          alertLevel = 'HIGH';
          alertMessage = `Alerta: Registra ${totalInfractions} acta(s) de fiscalización en la ATU con deuda acumulada de S/ ${totalDebtPEN.toFixed(2)}.`;
        } else {
          alertLevel = 'MEDIUM';
          alertMessage = `Aviso: Registra ${totalInfractions} infracción(es) en la ATU con saldo pendiente de S/ ${totalDebtPEN.toFixed(2)}.`;
        }
      }

      const result = {
        success: true,
        source: 'ATU_OFICIAL',
        data: {
          plate: formattedPlate,
          hasInfractions: totalInfractions > 0,
          totalInfractions,
          totalDebtPEN,
          records: allRecords,
          isAuthorizedTaxi: false,
          statusLabel: totalInfractions > 0 
            ? `${totalInfractions} Acta(s) de Fiscalización (S/ ${totalDebtPEN.toFixed(2)})` 
            : 'En Regla ante ATU (Sin Multas)',
          alertLevel,
          alertMessage,
          evidenceScreenshot: atuScreenshot
        },
        portalUrl: 'https://pasarela.atu.gob.pe/#',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };

      memoryCache.set(this.MODULE_NAME, cleanPlate, result, this.TTL_SECONDS);
      return result;

    } catch (err) {
      console.error(`❌ [AtuScraper] Error consultando ${cleanPlate}:`, err.message);
      return {
        success: false,
        source: 'ATU_OFICIAL',
        data: {
          plate: formattedPlate,
          hasInfractions: false,
          totalInfractions: 0,
          totalDebtPEN: 0,
          records: [],
          statusLabel: 'Consulta ATU no disponible',
          alertLevel: 'INFO',
          alertMessage: 'No fue posible conectar con el servidor de la ATU en este momento.'
        },
        error: err.message,
        latencyMs: Date.now() - startTime
      };
    } finally {
      if (page) {
        await BrowserHelper.closePage(page);
      }
    }
  }
}

module.exports = AtuScraper;
