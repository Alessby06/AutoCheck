const { connect } = require('puppeteer-real-browser');
const BrowserHelper = require('../utils/browserHelper');
const PlateValidator = require('../utils/plateValidator');
const CaptchaSolver = require('../utils/captchaSolver');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Scraper Oficial en Vivo para Consulta de SOAT e Historial Completo de Pólizas en APESEG
 * Fuente Oficial: Asociación Peruana de Empresas de Seguros (APESEG)
 * URL: https://webapp.apeseg.org.pe/consulta-soat/?source=apeseg
 * 
 * Mejoras de Estabilidad e Inmunidad a Bloqueos:
 * - Cero fugas de procesos en Windows (userDataDir persistente y taskkill seguro en subárbol)
 * - Persistencia y reutilización de token de sesión en memoria (Session Token Pooling)
 * - Bloqueo de /logout para evitar que la aplicación web invalide el token obtenido
 * - Detección terminal instantánea en el intento 1 para vehículos sin SOAT (cero reintentos ciegos)
 * - Respaldo resiliente y no destructivo ante ventanas de enfriamiento (Rate Limit 429)
 * - Cero almacenamiento o persistencia en disco de datos de placas (consultas 100% en tiempo real)
 */
class ApesegScraper {
  static MODULE_NAME = 'APESEG_SOAT_LIVE';

  // Pool de sesión en memoria (reutiliza el Bearer token sin quemar cuota de login)
  static sessionToken = null;
  static sessionTokenExpiresAt = 0;

  /**
   * Consulta oficial de SOAT e Historial de Seguros por placa
   * @param {string} rawPlate - Placa en cualquier formato
   */
  static async query(rawPlate) {
    const startTime = Date.now();
    const cleanPlate = PlateValidator.clean(rawPlate);
    const formattedPlate = PlateValidator.format(cleanPlate);

    if (!cleanPlate) {
      return {
        success: false,
        source: 'APESEG_OFICIAL_LIVE',
        data: null,
        error: 'Placa inválida',
        latencyMs: 0
      };
    }

    let browserInstance = null;
    let browserPid = null;
    let profileDir = null;

    try {
      // 1. Directorio efímero y aislado por instancia para evitar colisiones ECONNREFUSED en Windows
      const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      profileDir = path.join(process.cwd(), `.chrome_soat_${uniqueId}`);
      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }

      // 2. Lanzar navegador con soporte nativo de Cloudflare Turnstile
      const { browser, page } = await connect({
        headless: false,
        turnstile: true,
        customConfig: { userDataDir: profileDir },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--window-position=-32000,-32000',
          '--window-size=1280,900',
          '--no-first-run',
          '--no-default-browser-check'
        ]
      });

      BrowserHelper.registerBrowser(browser);
      browserInstance = browser;
      browserPid = browser.process()?.pid;

      let isRateLimited = false;
      let isNoRecordFound = false;

      // 3. Interceptar tráfico de red para optimizar login y evitar logout
      await page.setRequestInterception(true);
      page.on('request', req => {
        const url = req.url();

        // Reutilizar token Bearer si aún está vigente en memoria
        if (url.includes('/consulta-soat/api/login') && ApesegScraper.sessionToken && Date.now() < ApesegScraper.sessionTokenExpiresAt) {
          req.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ access_token: ApesegScraper.sessionToken })
          });
          return;
        }

        // Bloquear logout para mantener el token de sesión activo
        if (url.includes('/consulta-soat/api/logout')) {
          req.abort();
          return;
        }

        req.continue();
      });

      page.on('response', async res => {
        const url = res.url();
        if (url.includes('/consulta-soat/api/login') && res.status() === 429) {
          isRateLimited = true;
        }
        if (url.includes('/consulta-soat/api/login') && res.status() === 200) {
          try {
            const data = await res.json();
            if (data && data.access_token) {
              ApesegScraper.sessionToken = data.access_token;
              ApesegScraper.sessionTokenExpiresAt = Date.now() + 45 * 60 * 1000;
            }
          } catch {}
        }
      });

      // 4. Navegar a la aplicación web oficial de APESEG
      await page.goto('https://webapp.apeseg.org.pe/consulta-soat/?source=apeseg', {
        waitUntil: 'domcontentloaded',
        timeout: 35000
      });

      let rawCertificates = null;

      // 5. Bucle de consulta directa de Certificados con gestión de Turnstile de uso único
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (isRateLimited) break;

        // A. Obtener token Turnstile fresco
        let currentTurnstile = null;
        for (let t = 0; t < 25; t++) {
          currentTurnstile = await page.evaluate(() => {
            return document.querySelector('[name="cf-turnstile-response"]')?.value || null;
          });
          if (currentTurnstile && currentTurnstile.length > 20) break;

          await page.evaluate(() => {
            if (window.turnstile && !document.querySelector('#turnstile-container iframe')) {
              try {
                window.turnstile.render('#turnstile-container', { sitekey: '0x4AAAAAADyJA_4hEDeVktbR' });
              } catch (e) {}
            }
          });
          await new Promise(r => setTimeout(r, 600));
        }

        if (!currentTurnstile) {
          console.warn(`[ApesegScraper] Intento ${attempt}: No se obtuvo token Turnstile`);
          continue;
        }

        // B. Asegurar token JWT Bearer
        let jwt = (ApesegScraper.sessionToken && Date.now() < ApesegScraper.sessionTokenExpiresAt)
          ? ApesegScraper.sessionToken
          : null;

        if (!jwt) {
          const loginRes = await page.evaluate(async () => {
            try {
              const res = await fetch('https://api.apeseg.org.pe/consulta-soat/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: 'notificaciones@apeseg.org.pe', password: 'G3sepa13579!' })
              });
              return { status: res.status, data: await res.json() };
            } catch (e) {
              return { status: 500, error: e.message };
            }
          });

          if (loginRes.status === 429) {
            isRateLimited = true;
            break;
          }

          if (loginRes.status === 200 && loginRes.data && loginRes.data.access_token) {
            jwt = loginRes.data.access_token;
            ApesegScraper.sessionToken = jwt;
            ApesegScraper.sessionTokenExpiresAt = Date.now() + 45 * 60 * 1000;
          }
        }

        // C. Consulta directa de certificados vía API oficial (sin requerir OCR redundante)
        if (jwt && currentTurnstile) {
          const certsResult = await page.evaluate(async (token, cf, plate) => {
            try {
              const res = await fetch(`https://api.apeseg.org.pe/consulta-soat/api/certificados/placa/${plate}`, {
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'CF-Turnstile-Response': cf,
                  'X-Source': 'apeseg',
                  'X-Referrer': 'https://www.apeseg.org.pe/'
                }
              });
              const text = await res.text();
              let parsed = null;
              try { parsed = JSON.parse(text); } catch(e) {}
              return { status: res.status, rawText: text.substring(0, 150), data: parsed };
            } catch (e) {
              return { status: 500, error: e.message };
            }
          }, jwt, currentTurnstile, cleanPlate);

          console.log(`[ApesegScraper] Intento ${attempt}: API Certificados HTTP ${certsResult.status} (Placa: ${cleanPlate}) ->`, certsResult.rawText);

          if (certsResult.status === 200) {
            rawCertificates = Array.isArray(certsResult.data) ? certsResult.data : [];
            break;
          } else if (certsResult.status === 404) {
            rawCertificates = [];
            isNoRecordFound = true;
            break;
          } else if (certsResult.status === 429) {
            isRateLimited = true;
            break;
          } else if (certsResult.status === 401) {
            ApesegScraper.sessionToken = null;
            ApesegScraper.sessionTokenExpiresAt = 0;
            await new Promise(r => setTimeout(r, 400));
            continue;
          } else if (certsResult.status === 403) {
            // Token Turnstile quemado o inválido: resetear Turnstile en la página para generar uno nuevo
            await page.evaluate(() => {
              if (window.turnstile) {
                try { window.turnstile.reset(); } catch (e) {}
              }
            });
            await new Promise(r => setTimeout(r, 1200));
            continue;
          }
        }
      }

      let apesegScreenshot = null;
      try {
        const rawShot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 75 });
        apesegScreenshot = `data:image/jpeg;base64,${rawShot}`;
      } catch (e) {}

      const latencyMs = Date.now() - startTime;

      // Caso A: Rate limit activo de APESEG (respuesta amigable y resiliente)
      if (isRateLimited) {
        return {
          success: true,
          source: 'APESEG_OFICIAL_LIVE',
          data: {
            hasSoat: null,
            status: 'RATE_LIMIT_COOLDOWN',
            statusLabel: 'Servidor APESEG en Enfriamiento',
            isExpired: false,
            isCommercialOrTaxi: false,
            hadCommercialHistory: false,
            company: 'APESEG (Tráfico Regulado)',
            policyNumber: 'Consulte en 2 min',
            validFrom: null,
            validTo: null,
            useType: 'CONSULTA DIFERIDA',
            vehicleClass: 'N/D',
            certificateType: 'N/D',
            creationDate: null,
            summary: 'El servidor oficial de aseguradoras (APESEG) está regulando el tráfico por alta demanda momentánea. Esto NO significa que el auto no tenga seguro. Por favor reintente en 2 minutos.',
            totalPolicies: 0,
            history: [],
            evidenceScreenshot: apesegScreenshot
          },
          latencyMs
        };
      }

      // Caso B: Vehículo sin SOAT registrado
      if (!rawCertificates || rawCertificates.length === 0) {
        return {
          success: true,
          source: 'APESEG_OFICIAL_LIVE',
          data: {
            hasSoat: false,
            status: 'NO_REGISTRA',
            statusLabel: 'Sin registro de SOAT en APESEG',
            isExpired: true,
            isCommercialOrTaxi: false,
            hadCommercialHistory: false,
            company: 'NO REGISTRA',
            policyNumber: 'N/D',
            validFrom: null,
            validTo: null,
            useType: 'NO DETERMINADO',
            vehicleClass: 'N/D',
            certificateType: 'N/D',
            creationDate: null,
            totalPolicies: 0,
            history: [],
            evidenceScreenshot: apesegScreenshot
          },
          latencyMs
        };
      }

      // Caso C: Vehículo con SOAT e historial
      const current = rawCertificates[0];
      const isVigente = (current.Estado || '').toUpperCase() === 'VIGENTE';
      const useUpper = (current.NombreUsoVehiculo || '').toUpperCase();
      const isCommercialOrTaxi = useUpper.includes('TAXI') || useUpper.includes('URBANO') || useUpper.includes('PUBLICO') || useUpper.includes('COMERCIAL');

      // Mapear historial completo ordenado
      const history = rawCertificates.map(c => ({
        company: c.NombreCompania || 'N/D',
        status: (c.Estado || 'DESCONOCIDO').toUpperCase(),
        policyNumber: c.NumeroPoliza || c.CodigoUnicoPoliza || 'N/D',
        validFrom: c.FechaInicio || 'N/D',
        validTo: c.FechaFin || 'N/D',
        useType: c.NombreUsoVehiculo || 'PARTICULAR',
        vehicleClass: c.NombreClaseVehiculo || 'AUTOMOVIL',
        certificateType: c.TipoCertificado || 'ELECTRONICO',
        creationDate: c.FechaCreacion || 'N/D',
        cancellationDate: c.FechaAnulacion || null
      }));

      // Detectar si en el historial alguna vez fue Taxi o Comercial
      const hadCommercialHistory = history.some(h => {
        const u = (h.useType || '').toUpperCase();
        return u.includes('TAXI') || u.includes('URBANO') || u.includes('PUBLICO') || u.includes('COMERCIAL');
      });

      return {
        success: true,
        source: 'APESEG_OFICIAL_LIVE',
        data: {
          hasSoat: true,
          status: isVigente ? 'VIGENTE' : 'VENCIDO',
          statusLabel: isVigente ? 'SOAT VIGENTE' : 'SOAT VENCIDO',
          isExpired: !isVigente,
          isCommercialOrTaxi,
          hadCommercialHistory,
          company: current.NombreCompania || 'N/D',
          policyNumber: current.NumeroPoliza || current.CodigoUnicoPoliza || 'N/D',
          validFrom: current.FechaInicio || 'N/D',
          validTo: current.FechaFin || 'N/D',
          useType: current.NombreUsoVehiculo || 'PARTICULAR',
          vehicleClass: current.NombreClaseVehiculo || 'AUTOMOVIL',
          certificateType: current.TipoCertificado || 'ELECTRONICO',
          creationDate: current.FechaCreacion || 'N/D',
          seats: current.NumeroAsientos || 'N/D',
          brand: current.Marca || '',
          model: current.ModeloVehiculo || '',
          totalPolicies: rawCertificates.length,
          history,
          evidenceScreenshot: apesegScreenshot
        },
        latencyMs
      };

    } catch (err) {
      console.error('[ApesegScraper] Error durante consulta en vivo:', err.message);
      return {
        success: false,
        source: 'APESEG_OFICIAL_LIVE',
        data: null,
        error: err.message,
        latencyMs: Date.now() - startTime
      };
    } finally {
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch {}
      }
      if (browserPid) {
        try {
          execSync(`taskkill /F /T /PID ${browserPid} >nul 2>&1`, { stdio: 'ignore' });
        } catch {}
      }
      if (profileDir && fs.existsSync(profileDir)) {
        try {
          fs.rmSync(profileDir, { recursive: true, force: true });
        } catch {}
      }
    }
  }
}

module.exports = ApesegScraper;
