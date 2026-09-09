const puppeteer = require('puppeteer');
const fs = require('fs');

/**
 * Gestor centralizado del navegador Chromium para scrapers
 */
class BrowserHelper {
  static browserInstance = null;

  /**
   * Busca los ejecutables estándar de Google Chrome o Microsoft Edge en Windows
   */
  static getSystemBrowserPath() {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
    ];

    for (const p of candidates) {
      if (p && fs.existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Obtiene o inicializa la instancia singleton del navegador
   */
  static async getBrowser() {
    if (this.browserInstance && this.browserInstance.connected) {
      return this.browserInstance;
    }

    const systemPath = this.getSystemBrowserPath();
    const launchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1280,800'
      ]
    };

    if (systemPath) {
      launchOptions.executablePath = systemPath;
    }

    try {
      this.browserInstance = await puppeteer.launch(launchOptions);
      return this.browserInstance;
    } catch (err) {
      console.warn(`[BrowserHelper] Falló lanzamiento con ruta del sistema, reintentando por defecto...`, err.message);
      delete launchOptions.executablePath;
      this.browserInstance = await puppeteer.launch(launchOptions);
      return this.browserInstance;
    }
  }

  /**
   * Crea una nueva página configurada con User-Agent realista y bloqueo de recursos pesados
   * @param {Object} options - Opciones adicionales
   */
  static async createPage(options = { blockImages: false }) {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    // User agent moderno y realista de escritorio
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    // Aceleración: Bloquear fuentes o imágenes innecesarias si se especifica
    if (options.blockImages) {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'media', 'font'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });
    }

    return page;
  }

  /**
   * Cierra de forma segura una página
   */
  static async closePage(page) {
    if (page) {
      try {
        await page.close();
      } catch (e) {
        // Ignorar error al cerrar página
      }
    }
  }

  /**
   * Cierra la instancia del navegador
   */
  static async closeBrowser() {
    if (this.browserInstance) {
      try {
        await this.browserInstance.close();
      } catch (e) {}
      this.browserInstance = null;
    }
  }
}

module.exports = BrowserHelper;
