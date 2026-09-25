const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Gestor centralizado del navegador Chromium para scrapers con soporte visual y ciclo de vida limpio
 */
class BrowserHelper {
  static browserInstance = null;
  static activeBrowsers = new Set();
  static activePids = new Set();

  /**
   * Busca los ejecutables estándar de Google Chrome o Microsoft Edge en Windows
   */
  static getSystemBrowserPath() {
    const candidates = [
      '/run/current-system/sw/bin/chromium', // <-- RUTA NUEVA PARA REPLIT
      '/usr/bin/chromium',
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
   * Registra una instancia externa de navegador (ej: puppeteer-real-browser de APESEG)
   */
  static registerBrowser(browser) {
    if (browser) {
      this.activeBrowsers.add(browser);
      try {
        const pid = browser.process()?.pid;
        if (pid) this.activePids.add(pid);
      } catch (e) { }
    }
  }

  static currentProfileDir = null;
  static browserLaunchPromise = null;

  /**
   * Obtiene o inicializa la instancia singleton del navegador en modo aislado y controlado
   */
  static async getBrowser() {
    if (this.browserInstance && this.browserInstance.connected) {
      return this.browserInstance;
    }

    if (this.browserLaunchPromise) {
      return this.browserLaunchPromise;
    }

    this.browserLaunchPromise = (async () => {
      // Crear directorio de perfil aislado y exclusivo para la sesión
      if (!this.currentProfileDir) {
        this.currentProfileDir = path.join(process.cwd(), `.chrome_session_${process.pid}_${Date.now()}`);
        if (!fs.existsSync(this.currentProfileDir)) {
          fs.mkdirSync(this.currentProfileDir, { recursive: true });
        }
      }

      const systemPath = this.getSystemBrowserPath();
      const launchOptions = {
        headless: 'new', // MODO 100% INVISIBLE SILENCIOSO
        userDataDir: this.currentProfileDir,
        defaultViewport: null,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--window-position=-32000,-32000',
          '--window-size=1280,800',
          '--no-first-run',
          '--no-default-browser-check',
          '--disk-cache-size=10485760',
          '--media-cache-size=10485760',
          '--disable-gpu-shader-disk-cache',
          '--disable-gpu-program-cache',
          '--disable-crash-reporter',
          '--no-crash-upload'
        ]
      };

      if (systemPath) {
        launchOptions.executablePath = systemPath;
      }

      try {
        const browser = await puppeteer.launch(launchOptions);
        this.browserInstance = browser;
        this.registerBrowser(browser);
        return browser;
      } catch (err) {
        console.warn(`[BrowserHelper] Falló lanzamiento con ruta del sistema, reintentando por defecto...`, err.message);
        delete launchOptions.executablePath;
        const browser = await puppeteer.launch(launchOptions);
        this.browserInstance = browser;
        this.registerBrowser(browser);
        return browser;
      }
    })();

    try {
      return await this.browserLaunchPromise;
    } finally {
      this.browserLaunchPromise = null;
    }
  }

  /**
   * Crea una nueva página configurada con User-Agent realista y visualmente accesible
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
      } catch (e) { }
    }
  }

  /**
   * Cierra la instancia singleton del navegador y purga su perfil efímero
   */
  static async closeBrowser() {
    if (this.browserInstance) {
      try {
        await this.browserInstance.close();
      } catch (e) { }
      this.browserInstance = null;
    }
    this.purgeCurrentProfile();
  }

  /**
   * Purga el directorio de perfil aislado de la sesión actual
   */
  static purgeCurrentProfile() {
    if (this.currentProfileDir && fs.existsSync(this.currentProfileDir)) {
      try {
        fs.rmSync(this.currentProfileDir, { recursive: true, force: true });
      } catch (e) { }
      this.currentProfileDir = null;
    }
  }

  /**
   * Limpieza preventiva y cierre de todos los navegadores, procesos y perfiles temporales
   */
  static async cleanupAll() {
    console.log('[BrowserHelper] Limpiando y cerrando navegadores anteriores...');
    for (const b of this.activeBrowsers) {
      try {
        if (b && b.connected) {
          const pages = await b.pages().catch(() => []);
          for (const p of pages) {
            await p.close().catch(() => { });
          }
          await b.close().catch(() => { });
        }
      } catch (e) { }
    }
    this.activeBrowsers.clear();
    this.browserInstance = null;

    // Matar procesos PIDs registrados si quedaron colgados
    for (const pid of this.activePids) {
      try {
        process.kill(pid);
      } catch (e) { }
    }
    this.activePids.clear();

    // Eliminar el perfil de sesión actual
    this.purgeCurrentProfile();

    // Eliminar cualquier perfil efímero .chrome_* en el directorio del proyecto
    try {
      const items = fs.readdirSync(process.cwd());
      for (const item of items) {
        if (item.startsWith('.chrome_')) {
          const fullPath = path.join(process.cwd(), item);
          try {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } catch (e) { }
        }
      }
    } catch (e) { }
  }
}

module.exports = BrowserHelper;
