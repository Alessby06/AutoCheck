const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const { existsSync } = require('fs');
const path = require('path');
const os = require('os');

const execAsync = util.promisify(exec);

/**
 * Solver Neuronal de Alta Precisión para Captchas Alfanuméricos (SAT / MTC / Portales del Estado)
 * Utiliza ddddocr con motor ONNX runtime. Refactorizado a 100% Asíncrono.
 */
class CaptchaSolver {
  /**
   * Resuelve una imagen de captcha en buffer sin bloquear el Event Loop
   * @param {Buffer} imageBuffer 
   * @returns {Promise<string|null>} Texto en mayúsculas del captcha
   */
  static async solve(imageBuffer) {
    if (!imageBuffer || imageBuffer.length === 0) return null;
    
    const tempFile = path.join(os.tmpdir(), `sat_cap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`);
    
    try {
      // Escritura asíncrona para no bloquear el hilo
      await fs.writeFile(tempFile, imageBuffer);
      
      const pythonScript = `import sys, io, ddddocr; sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='ignore'); ocr = ddddocr.DdddOcr(show_ad=False); print(ocr.classification(open(r'${tempFile}', 'rb').read()).upper())`;
      
      // Ejecución asíncrona del subproceso de Python
      const { stdout } = await execAsync(`python -c "${pythonScript}"`, {
        encoding: 'utf-8',
        timeout: 8000,
        windowsHide: true
      });
      
      const cleaned = stdout.replace(/[^A-Z0-9]/gi, '').toUpperCase().trim();
      return cleaned || null;
      
    } catch (err) {
      console.warn('[CaptchaSolver] Error resolviendo captcha:', err.message);
      return null;
    } finally {
      try {
        if (existsSync(tempFile)) {
          await fs.unlink(tempFile);
        }
      } catch (e) {
        // Ignorar errores de limpieza térmica
      }
    }
  }
}

module.exports = CaptchaSolver;