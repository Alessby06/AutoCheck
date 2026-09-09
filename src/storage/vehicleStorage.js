const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'vehicles.json');

/**
 * Gestor de almacenamiento persistente estricto:
 * Solo guarda consultas exitosas y comprobadas.
 * Jamás almacena estados de error, fallbacks temporales ni consultas incompletas.
 */
class VehicleStorage {
  static ensureFile() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify({}, null, 2), 'utf8');
    }
  }

  static readAll() {
    this.ensureFile();
    try {
      const content = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(content || '{}');
    } catch (e) {
      console.error('[VehicleStorage] Error leyendo base de datos:', e.message);
      return {};
    }
  }

  static writeAll(data) {
    this.ensureFile();
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('[VehicleStorage] Error guardando base de datos:', e.message);
    }
  }

  /**
   * Vacía completamente la base de datos local
   */
  static clearAll() {
    this.writeAll({});
    console.log('🧹 [VehicleStorage] Base de datos local limpiada por completo.');
  }

  /**
   * Obtiene los datos de un vehículo si la caché es válida y no ha alcanzado 'proxima_auditoria'
   * @param {string} cleanPlate - Placa normalizada (ej: C0A653)
   * @returns {Object|null}
   */
  static getValid(cleanPlate) {
    const all = this.readAll();
    const entry = all[cleanPlate.toUpperCase()];
    if (!entry) return null;

    const now = new Date();
    const nextAudit = new Date(entry.proxima_auditoria);

    if (now < nextAudit) {
      return {
        ...entry,
        fromPersistentStorage: true
      };
    }

    return null;
  }

  /**
   * Guarda únicamente si la consulta de revisión técnica fue EXITOSA y legítima.
   * Si falló o fue un timeout/captcha no resuelto, NO SE GUARDA NADA en disco.
   * @param {string} cleanPlate - Placa
   * @param {Object} vehicleReport - Reporte completo
   */
  static save(cleanPlate, vehicleReport) {
    const mtc = vehicleReport.modules?.mtcCitv;
    
    // Regla de Oro: Solo guardar si el MTC respondió con éxito comprobado
    const isValidMtc = mtc && mtc.success === true && (
      mtc.source === 'MTC_CITV_REST_API' || 
      mtc.data?.status === 'VIGENTE' || 
      mtc.data?.status === 'VENCIDO' || 
      mtc.data?.status === 'SIN_REGISTROS'
    );

    if (!isValidMtc) {
      console.log(`⚠️ [VehicleStorage] Consulta incompleta o no verificada para ${cleanPlate}. NO se guardará en disco para permitir reintentos limpios.`);
      return {
        fecha_consulta: new Date().toISOString(),
        proxima_auditoria: null
      };
    }

    const all = this.readAll();
    const now = new Date();
    let nextAuditDate = new Date(now.getTime() + (24 * 3600 * 1000)); // 24h por defecto si venció

    const mtcData = mtc.data;
    if (mtcData && mtcData.status === 'VIGENTE' && mtcData.expirationDate) {
      const parts = mtcData.expirationDate.split(/[\/\-]/);
      if (parts.length === 3) {
        const exp = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T23:59:59.000Z`);
        if (!isNaN(exp.getTime()) && exp > now) {
          nextAuditDate = exp; // Válido hasta la fecha exacta de vencimiento
        }
      }
    }

    const payloadToSave = {
      placa: cleanPlate.toUpperCase(),
      fecha_consulta: now.toISOString(),
      proxima_auditoria: nextAuditDate.toISOString(),
      report: vehicleReport
    };

    all[cleanPlate.toUpperCase()] = payloadToSave;
    this.writeAll(all);
    console.log(`💾 [VehicleStorage] Guardado con éxito en disco para ${cleanPlate} (Válido hasta: ${nextAuditDate.toISOString()})`);
    return payloadToSave;
  }
}

module.exports = VehicleStorage;
