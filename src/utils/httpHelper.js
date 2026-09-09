const axios = require('axios');

/**
 * Cliente HTTP optimizado para peticiones directas y rápidas a portales públicos
 */
class HttpHelper {
  /**
   * Crea una instancia de Axios con cabeceras de navegación y timeouts seguros
   */
  static createClient(customHeaders = {}, timeoutMs = 10000) {
    return axios.create({
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'es-PE,es;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        ...customHeaders
      }
    });
  }

  /**
   * Ejecuta una petición GET con reintentos
   */
  static async get(url, config = {}, maxRetries = 2) {
    let lastError;
    const client = this.createClient(config.headers, config.timeout || 10000);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await client.get(url, config);
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 800 * attempt));
        }
      }
    }
    throw lastError;
  }

  /**
   * Ejecuta una petición POST con reintentos
   */
  static async post(url, data, config = {}, maxRetries = 2) {
    let lastError;
    const client = this.createClient(config.headers, config.timeout || 10000);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await client.post(url, data, config);
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 800 * attempt));
        }
      }
    }
    throw lastError;
  }
}

module.exports = HttpHelper;
