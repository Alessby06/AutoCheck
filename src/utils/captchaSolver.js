const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Solver Neuronal de Alta Precisión para Captchas Alfanuméricos (SAT / MTC / Portales del Estado)
 * Utiliza ddddocr con motor ONNX runtime.
 */
class CaptchaSolver {
  /**
   * Resuelve una imagen de captcha en buffer
   * @param {Buffer} imageBuffer 
   * @returns {string|null} Texto en mayúsculas del captcha
   */
  static solve(imageBuffer) {
    if (!imageBuffer || imageBuffer.length === 0) return null;
    
    const tempFile = path.join(os.tmpdir(), `sat_cap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`);
    try {
      fs.writeFileSync(tempFile, imageBuffer);
      const pythonScript = `import ddddocr; ocr = ddddocr.DdddOcr(show_ad=False); print(ocr.classification(open(r'${tempFile}', 'rb').read()).upper())`;
      const stdout = execSync(`python -c "${pythonScript}"`, {
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
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch (e) {}
    }
  }
}

module.exports = CaptchaSolver;
