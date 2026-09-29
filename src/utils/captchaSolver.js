const { spawn } = require('child_process');
const fs = require('fs').promises;
const { existsSync } = require('fs');
const path = require('path');
const os = require('os');

/**
 * Solver Neuronal Persistente para Captchas Alfanuméricos (SAT / MTC / Portales del Estado)
 * Utiliza ddddocr con motor ONNX runtime. Mantiene el proceso Python vivo para evitar
 * recargar el modelo (~64 MB) en cada invocación.
 */
class CaptchaSolver {
  static pythonProcess = null;
  static initialized = false;
  static initPromise = null;

  /**
   * Resuelve la cadena del intérprete Python disponible en el sistema
   * Prioridad: CAPTCHA_PYTHON env var → python3 → python
   */
  static resolvePython() {
    if (process.env.CAPTCHA_PYTHON) return process.env.CAPTCHA_PYTHON;
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  /**
   * Inicializa el proceso Python persistente (singleton lazy)
   */
  static async init() {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const python = this.resolvePython();
      const script = `
import sys, io, ddddocr, base64, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='ignore', write_through=True)
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='ignore', write_through=True)
ocr = ddddocr.DdddOcr(show_ad=False)
print('READY', flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        data = json.loads(line)
        img_b64 = data.get('image')
        if not img_b64:
            print(json.dumps({'error': 'no image'}), flush=True)
            continue
        img_bytes = base64.b64decode(img_b64)
        result = ocr.classification(img_bytes).upper()
        cleaned = ''.join(c for c in result if c.isalnum())
        print(json.dumps({'text': cleaned}), flush=True)
    except Exception as e:
        print(json.dumps({'error': str(e)}), flush=True)
`;

      this.pythonProcess = spawn(python, ['-c', script], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });

      let started = false;
      const startTimeout = setTimeout(() => {
        if (!started) {
          this.pythonProcess.kill();
          throw new Error('Timeout esperando READY del solver Python');
        }
      }, 15000);

      await new Promise((resolve, reject) => {
        this.pythonProcess.stdout.on('data', (data) => {
          const line = data.toString().trim();
          if (line === 'READY') {
            started = true;
            clearTimeout(startTimeout);
            resolve();
          }
        });
        this.pythonProcess.stderr.on('data', (data) => {
          const msg = data.toString().trim();
          if (msg && !msg.includes('ONNX')) console.warn('[ddddocr]', msg);
        });
        this.pythonProcess.on('error', reject);
        this.pythonProcess.on('exit', (code) => {
          if (!started) reject(new Error(`Solver Python salió con código ${code}`));
          this.initialized = false;
          this.pythonProcess = null;
        });
      });

      this.initialized = true;
    })();

    return this.initPromise;
  }

  /**
   * Resuelve una imagen de captcha en buffer usando el proceso persistente
   * @param {Buffer} imageBuffer
   * @returns {Promise<string|null>} Texto en mayúsculas del captcha
   */
  static async solve(imageBuffer) {
    if (!imageBuffer || imageBuffer.length === 0) return null;

    await this.init();

    const b64 = imageBuffer.toString('base64');
    const request = JSON.stringify({ image: b64 }) + '\n';

    return new Promise((resolve) => {
      if (!this.pythonProcess) return resolve(null);

      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          console.warn('[CaptchaSolver] Timeout, reiniciando proceso...');
          this.pythonProcess.kill();
          this.initialized = false;
          this.pythonProcess = null;
          this.initPromise = null;
          resolve(null);
        }
      }, 8000);

      const onData = (data) => {
        if (settled) return;
        const line = data.toString().trim();
        if (!line) return;
        try {
          const resp = JSON.parse(line);
          if (resp.text !== undefined) {
            settled = true;
            clearTimeout(timeout);
            this.pythonProcess.stdout.off('data', onData);
            resolve(resp.text || null);
          } else if (resp.error) {
            settled = true;
            clearTimeout(timeout);
            this.pythonProcess.stdout.off('data', onData);
            console.warn('[CaptchaSolver] Error del solver:', resp.error);
            resolve(null);
          }
        } catch {
          // No es JSON, ignorar
        }
      };

      this.pythonProcess.stdout.on('data', onData);

      try {
        this.pythonProcess.stdin.write(request);
      } catch (e) {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.pythonProcess.stdout.off('data', onData);
          this.initialized = false;
          this.pythonProcess = null;
          this.initPromise = null;
          resolve(null);
        }
      }
    });
  }

  /**
   * Cierra el proceso persistente (para limpieza al apagar)
   */
  static async close() {
    if (this.pythonProcess) {
      try {
        this.pythonProcess.kill();
      } catch {}
      this.pythonProcess = null;
      this.initialized = false;
      this.initPromise = null;
    }
  }
}

module.exports = CaptchaSolver;