/**
 * Envoltorio de seguridad para garantizar que ninguna consulta exceda un tiempo límite estricto
 */
class TimeoutHelper {
  /**
   * Ejecuta una promesa con un timeout estricto
   * @param {Promise} promise - Promesa a ejecutar
   * @param {number} ms - Milisegundos máximos (ej: 6000)
   * @param {Object} fallbackValue - Valor a retornar en caso de timeout
   */
  static async withTimeout(promise, ms, fallbackValue) {
    let timeoutHandle;

    const timeoutPromise = new Promise((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve(fallbackValue);
      }, ms);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutHandle);
      return result;
    } catch (err) {
      clearTimeout(timeoutHandle);
      throw err;
    }
  }
}

module.exports = TimeoutHelper;
