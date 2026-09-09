/**
 * Utilidad de validación y normalización de placas de rodaje de Perú
 */
class PlateValidator {
  /**
   * Limpia y normaliza el string de placa
   * @param {string} rawPlate - Placa en cualquier formato (ej. "abc-123", "a1b 234", "b3t489")
   * @returns {string} Placa en mayúsculas sin guiones ni espacios (ej. "B3T489")
   */
  static clean(rawPlate) {
    if (!rawPlate || typeof rawPlate !== 'string') return '';
    return rawPlate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /**
   * Valida si una placa cumple con los formatos legales peruanos
   * @param {string} rawPlate - Placa limpia
   * @returns {{isValid: boolean, type: string, formatted: string, clean: string, message: string}}
   */
  static validate(rawPlate) {
    const clean = this.clean(rawPlate);

    if (!clean) {
      return { isValid: false, type: 'UNKNOWN', formatted: '', clean: '', message: 'Debe ingresar una placa vehicular.' };
    }

    // 1. Placas de Motos y Mototaxis (Menores: ej. 1234-5A o 1234-AB o 5678-C1)
    if (/^[0-9]{4}[A-Z0-9]{2}$/.test(clean)) {
      const formatted = `${clean.slice(0, 4)}-${clean.slice(4)}`;
      return {
        isValid: true,
        type: 'MOTORCYCLE',
        formatted,
        clean,
        message: 'Placa de vehículo menor válida'
      };
    }

    // 2. Placa Nacional Única de Rodaje Estándar (Autos, camionetas, buses, camiones: 6 caracteres, ej. ABC-123 o A1B-234)
    if (/^[A-Z0-9]{3}[0-9]{3}$/.test(clean) || /^[A-Z0-9]{6}$/.test(clean)) {
      // Si los primeros caracteres no son 4 números seguidos, es un auto estándar
      const formatted = `${clean.slice(0, 3)}-${clean.slice(3)}`;
      return {
        isValid: true,
        type: 'STANDARD',
        formatted,
        clean,
        message: 'Placa estándar peruana válida'
      };
    }

    // 3. Placas antiguas o especiales (Formato pre-2010: ej. A-1234, AB-1234, ABC-12)
    if (clean.length >= 5 && clean.length <= 7) {
      const formatted = clean.length === 6 ? `${clean.slice(0, 3)}-${clean.slice(3)}` : clean;
      return {
        isValid: true,
        type: 'LEGACY',
        formatted,
        clean,
        message: 'Placa con formato especial o antiguo'
      };
    }

    return {
      isValid: false,
      type: 'INVALID',
      formatted: clean,
      clean,
      message: 'Formato de placa inválido. Una placa peruana estándar tiene 6 caracteres (ej. B3T-489 o C0A-653).'
    };
  }

  /**
   * Formatea una placa con su guión oficial
   * @param {string} rawPlate 
   * @returns {string} ej: "B3T-489"
   */
  static format(rawPlate) {
    const result = this.validate(rawPlate);
    return result.formatted || this.clean(rawPlate);
  }
}

module.exports = PlateValidator;
