/**
 * Motor de Diagnóstico y Auditoría Exhaustiva de Scrapers Gubernamentales
 * Analiza las respuestas de cada entidad y clasifica con precisión:
 * - Si se obtuvieron datos
 * - Si el vehículo está limpio / sin registros / exento
 * - Si hubo error de red, captcha o caída de portal
 */
class AuditReporter {
  /**
   * Genera el listado completo y detallado del estado de todos los scrapers
   * @param {Object} modules - Objeto con los resultados de cada módulo
   * @param {string} plate - Placa consultada
   * @returns {Array<Object>} Listado de auditoría de los 10 scrapers
   */
  static generateSummary(modules, plate) {
    const list = [];

    // 1. MTC CITV (Revisiones Técnicas)
    const mtc = modules.mtcCitv;
    if (mtc && mtc.success) {
      const recordsCount = mtc.data?.history?.length || mtc.data?.records?.length || 0;
      const isVigente = mtc.data?.status === 'VIGENTE';
      const isVencido = mtc.data?.status === 'VENCIDO';
      list.push({
        id: 'mtcCitv',
        name: 'MTC CITV (Inspección Técnica Vehicular)',
        category: 'Técnico / Seguridad',
        status: 'SUCCESS',
        badge: isVigente ? 'VIGENTE' : (isVencido ? 'VENCIDO' : (recordsCount > 0 ? 'HISTORIAL' : 'SIN_REGISTROS')),
        badgeType: isVigente ? 'success' : (isVencido ? 'danger' : 'info'),
        message: recordsCount > 0
          ? `${recordsCount} certificado(s) histórico(s) encontrado(s). Estado actual: ${mtc.data?.status || 'N/D'} (Vigente hasta ${mtc.data?.expirationDate || 'N/D'}).`
          : 'El vehículo no registra inspecciones técnicas previas ante el MTC (Exento por año de fabricación nuevo o sin certificado).',
        latencyMs: mtc.latencyMs || 0,
        recordsCount
      });
    } else {
      list.push({
        id: 'mtcCitv',
        name: 'MTC CITV (Inspección Técnica Vehicular)',
        category: 'Técnico / Seguridad',
        status: 'ERROR',
        badge: 'TIMEOUT / ERROR',
        badgeType: 'error',
        message: mtc?.error ? `Incidencia: ${mtc.error}` : 'El portal de CITV del MTC no respondió dentro del límite de tiempo.',
        latencyMs: mtc?.latencyMs || 0,
        recordsCount: 0
      });
    }

    // 2. SUNARP (Propiedad y Datos Vehiculares)
    const sunarp = modules.sunarp;
    if (sunarp && sunarp.success) {
      const isNotRegistered = sunarp.data?.brand === 'NO REGISTRA EN SUNARP';
      list.push({
        id: 'sunarp',
        name: 'SUNARP (Registro de Propiedad Vehicular)',
        category: 'Legal / Propiedad',
        status: 'SUCCESS',
        badge: isNotRegistered ? 'NO_INSCRITO' : 'INSCRITO',
        badgeType: isNotRegistered ? 'warn' : 'success',
        message: isNotRegistered
          ? 'La placa no figura inscrita en la base de datos de consulta vehicular de SUNARP.'
          : `Datos extraídos con éxito: ${sunarp.data?.marca || ''} ${sunarp.data?.modelo || ''} | VIN: ${sunarp.data?.vin || 'N/D'} | Color: ${sunarp.data?.color || 'N/D'}.`,
        latencyMs: sunarp.latencyMs || 0,
        recordsCount: isNotRegistered ? 0 : 1
      });
    } else {
      list.push({
        id: 'sunarp',
        name: 'SUNARP (Registro de Propiedad Vehicular)',
        category: 'Legal / Propiedad',
        status: 'ERROR',
        badge: 'TIMEOUT / ERROR',
        badgeType: 'error',
        message: sunarp?.error ? `Incidencia: ${sunarp.error}` : 'Tiempo de espera agotado al conectar con el portal de SUNARP.',
        latencyMs: sunarp?.latencyMs || 0,
        recordsCount: 0
      });
    }

    // 3. SAT Lima (Papeletas de Tránsito)
    const satPapeletas = modules.satPapeletas;
    if (satPapeletas && satPapeletas.success) {
      const finesCount = satPapeletas.data?.totalFines || (satPapeletas.data?.records ? satPapeletas.data.records.length : 0);
      const debt = satPapeletas.data?.totalDebtPEN || 0;
      list.push({
        id: 'satPapeletas',
        name: 'SAT Lima Metropolitana (Papeletas de Tránsito)',
        category: 'Infracciones',
        status: 'SUCCESS',
        badge: finesCount > 0 ? 'CON_PAPELETAS' : 'SIN_DEUDA',
        badgeType: finesCount > 0 ? 'danger' : 'success',
        message: finesCount > 0
          ? `Registra ${finesCount} papeleta(s) pendientes de pago por un total de S/ ${debt.toFixed(2)} en VirtualSAT.`
          : 'Excelente: Sin papeletas pendientes registradas en el SAT de Lima Metropolitana.',
        latencyMs: satPapeletas.latencyMs || 0,
        recordsCount: finesCount
      });
    } else {
      list.push({
        id: 'satPapeletas',
        name: 'SAT Lima Metropolitana (Papeletas de Tránsito)',
        category: 'Infracciones',
        status: 'ERROR',
        badge: 'ERROR_CONEXION',
        badgeType: 'error',
        message: satPapeletas?.error ? `Incidencia: ${satPapeletas.error}` : 'VirtualSAT no devolvió respuesta para la consulta de papeletas.',
        latencyMs: satPapeletas?.latencyMs || 0,
        recordsCount: 0
      });
    }

    // 4. SAT Lima (Impuesto al Patrimonio Vehicular)
    const satImpuesto = modules.satImpuestoVehicular;
    if (satImpuesto && satImpuesto.success) {
      const taxCount = satImpuesto.data?.totalTax || (satImpuesto.data?.taxRecords ? satImpuesto.data.taxRecords.length : 0);
      const taxDebt = satImpuesto.data?.totalTaxDebtPEN || 0;
      const contribuyente = satImpuesto.data?.contribuyente;
      list.push({
        id: 'satImpuestoVehicular',
        name: 'SAT Lima (Impuesto al Patrimonio Vehicular)',
        category: 'Tributario',
        status: 'SUCCESS',
        badge: taxCount > 0 ? 'DEUDA_TRIBUTARIA' : 'AL_DIA_EXENTO',
        badgeType: taxCount > 0 ? 'danger' : 'success',
        message: taxCount > 0
          ? `Registra ${taxCount} cuota(s) tributarias pendientes por S/ ${taxDebt.toFixed(2)}.`
          : (contribuyente ? `Contribuyente (${contribuyente}) al día sin deudas exigibles (o exento por tener > 3 años).` : 'Sin deudas de impuesto vehicular registradas (Vehículo al día o exento por antigüedad).'),
        latencyMs: satImpuesto.latencyMs || 0,
        recordsCount: taxCount
      });
    } else {
      list.push({
        id: 'satImpuestoVehicular',
        name: 'SAT Lima (Impuesto al Patrimonio Vehicular)',
        category: 'Tributario',
        status: 'ERROR',
        badge: 'ERROR_CONEXION',
        badgeType: 'error',
        message: satImpuesto?.error ? `Incidencia: ${satImpuesto.error}` : 'No se pudo consultar el módulo tributario de VirtualSAT.',
        latencyMs: satImpuesto?.latencyMs || 0,
        recordsCount: 0
      });
    }

    // 5. SAT Lima (Órdenes de Captura Coactiva y Embargos)
    const satCaptura = modules.satCaptura;
    if (satCaptura && satCaptura.success) {
      const hasCap = Boolean(satCaptura.data?.hasCaptureOrder);
      const capCount = satCaptura.data?.totalCaptures || 0;
      list.push({
        id: 'satCaptura',
        name: 'SAT Lima (Ejecución Coactiva y Capturas)',
        category: 'Legal / Embargos',
        status: 'SUCCESS',
        badge: hasCap ? 'ORDEN_CAPTURA' : 'LIMPIO',
        badgeType: hasCap ? 'danger' : 'success',
        message: hasCap
          ? `ALERTA CRÍTICA: El vehículo registra ${capCount} orden(es) de captura o embargo coactivo en el SAT.`
          : 'Sin orden de captura ni medidas cautelares coactivas registradas en el SAT.',
        latencyMs: satCaptura.latencyMs || 0,
        recordsCount: capCount
      });
    } else {
      list.push({
        id: 'satCaptura',
        name: 'SAT Lima (Ejecución Coactiva y Capturas)',
        category: 'Legal / Embargos',
        status: 'ERROR',
        badge: 'TIMEOUT',
        badgeType: 'error',
        message: satCaptura?.error ? `Incidencia: ${satCaptura.error}` : 'Módulo de capturas no disponible.',
        latencyMs: satCaptura?.latencyMs || 0,
        recordsCount: 0
      });
    }

    // 6. Callao (Fotopapeletas Provincial)
    const callao = modules.callao;
    if (callao && callao.success) {
      const finesCount = callao.data?.totalInfractions || 0;
      const debt = callao.data?.totalDebtPEN || 0;
      list.push({
        id: 'callao',
        name: 'Municipalidad Provincial del Callao (Fotopapeletas)',
        category: 'Infracciones',
        status: 'SUCCESS',
        badge: finesCount > 0 ? 'CON_FOTOPAPELETAS' : 'SIN_DEUDA',
        badgeType: finesCount > 0 ? 'danger' : 'success',
        message: finesCount > 0
          ? `Registra ${finesCount} fotopapeleta(s) por S/ ${debt.toFixed(2)} en avenidas del Callao.`
          : 'Sin fotopapeletas registradas en la provincia del Callao.',
        latencyMs: callao.latencyMs || 0,
        recordsCount: finesCount
      });
    } else {
      list.push({
        id: 'callao',
        name: 'Municipalidad Provincial del Callao (Fotopapeletas)',
        category: 'Infracciones',
        status: 'ERROR',
        badge: 'ERROR_CONEXION',
        badgeType: 'error',
        message: callao?.error ? `Incidencia: ${callao.error}` : 'Servidor de Pago Papeletas Callao no respondió.',
        latencyMs: callao?.latencyMs || 0,
        recordsCount: 0
      });
    }

    // 7. SUTRAN (Fiscalización en Carreteras Nacionales)
    const sutran = modules.sutran;
    if (sutran && sutran.success) {
      const infractionsCount = sutran.data?.totalInfractions || 0;
      const debt = sutran.data?.totalDebtPEN || 0;
      list.push({
        id: 'sutran',
        name: 'SUTRAN (Infracciones en Vías Nacionales)',
        category: 'Infracciones',
        status: 'SUCCESS',
        badge: infractionsCount > 0 ? 'CON_INFRACCIONES' : 'SIN_DEUDA',
        badgeType: infractionsCount > 0 ? 'danger' : 'success',
        message: infractionsCount > 0
          ? `Registra ${infractionsCount} infracción(es) en carreteras nacionales por S/ ${debt.toFixed(2)}.`
          : 'No registra infracciones ni papeletas de velocidad ante SUTRAN.',
        latencyMs: sutran.latencyMs || 0,
        recordsCount: infractionsCount
      });
    } else {
      list.push({
        id: 'sutran',
        name: 'SUTRAN (Infracciones en Vías Nacionales)',
        category: 'Infracciones',
        status: 'ERROR',
        badge: 'ERROR_CONEXION',
        badgeType: 'error',
        message: sutran?.error ? `Incidencia: ${sutran.error}` : 'Portal de fiscalización de SUTRAN fuera de línea.',
        latencyMs: sutran?.latencyMs || 0,
        recordsCount: 0
      });
    }

    // 8. APESEG (SOAT e Historial de Pólizas en Aseguradoras)
    const apeseg = modules.apeseg;
    if (apeseg && apeseg.success) {
      const isCooldown = apeseg.data?.status === 'RATE_LIMIT_COOLDOWN';
      const hasActive = Boolean((apeseg.data?.hasSoat && apeseg.data?.status === 'VIGENTE') || apeseg.data?.hasActiveSoat);
      const isExpired = Boolean(apeseg.data?.isExpired || apeseg.data?.status === 'VENCIDO');
      const historyCount = apeseg.data?.history?.length || apeseg.data?.totalPolicies || apeseg.data?.policyHistory?.length || 0;
      const company = apeseg.data?.company || apeseg.data?.currentPolicy?.NombreCompania || 'Aseguradora';
      const validTo = apeseg.data?.validTo || apeseg.data?.currentPolicy?.FechaFin || 'N/D';

      let badge = 'SIN_SOAT';
      let badgeType = 'danger';
      let message = 'No figura registro de SOAT en la base de datos de aseguradoras.';

      if (isCooldown) {
        badge = 'ENFRIAMIENTO';
        badgeType = 'warn';
        message = 'APESEG regulando tráfico. Reintentar en 2 minutos para confirmar SOAT.';
      } else if (hasActive) {
        badge = 'SOAT_VIGENTE';
        badgeType = 'success';
        message = `SOAT Vigente con ${company} (Vence: ${validTo}). Historial: ${historyCount} póliza(s).`;
      } else if (isExpired || historyCount > 0) {
        badge = 'SOAT_VENCIDO';
        badgeType = 'danger';
        message = `SOAT vencido (Última aseguradora: ${company}). Registra ${historyCount} póliza(s) en historial.`;
      }

      list.push({
        id: 'apeseg',
        name: 'APESEG (SOAT e Historial de Aseguradoras)',
        category: 'Seguros',
        status: 'SUCCESS',
        badge,
        badgeType,
        message,
        latencyMs: apeseg.latencyMs || 0,
        recordsCount: historyCount
      });
    } else {
      list.push({
        id: 'apeseg',
        name: 'APESEG (SOAT e Historial de Aseguradoras)',
        category: 'Seguros',
        status: 'ERROR',
        badge: 'ERROR_API',
        badgeType: 'error',
        message: apeseg?.error ? `Incidencia: ${apeseg.error}` : 'API oficial de APESEG no devolvió respuesta.',
        latencyMs: apeseg?.latencyMs || 0,
        recordsCount: 0
      });
    }

    // 9. INFOGAS (Conversión GNV / GLP / FISE)
    const infogas = modules.infogas;
    if (infogas && infogas.success) {
      const hasGas = Boolean(infogas.data?.hasGasConversion || infogas.data?.hasGnv);
      const isChipBlocked = Boolean(infogas.data?.isChipBlocked);
      const hasDebt = Boolean(infogas.data?.fise?.hasOverdueDebt);
      const chipLabel = infogas.data?.chipStatus || (isChipBlocked ? 'BLOQUEADO' : 'HABILITADO');
      const fuelType = infogas.data?.fuelType || 'GNV';
      const annualExp = infogas.data?.annualExpiry;

      let msg = 'Vehículo original a gasolina/diésel sin conversión a GNV/GLP / Sin chip FISE.';
      if (hasGas) {
        msg = `Vehículo con sistema ${fuelType}. Chip: ${chipLabel}. Rev. Anual: ${annualExp || 'N/D'}. ${hasDebt ? `Registra deuda morosa de S/ ${infogas.data?.fise?.overdueDebtPEN || 0} en Ahorro GNV.` : 'Sin deuda morosa en programa FISE.'}`;
      }

      list.push({
        id: 'infogas',
        name: 'INFOGAS (Sistema de Control GNV / GLP y FISE)',
        category: 'Técnico / Combustible',
        status: 'SUCCESS',
        badge: hasGas ? (isChipBlocked ? 'CHIP_BLOQUEADO' : (hasDebt ? 'CON_DEUDA_FISE' : 'CHIP_ACTIVO')) : 'ORIGINAL_SIN_GAS',
        badgeType: hasGas ? (isChipBlocked || hasDebt ? 'danger' : 'success') : 'info',
        message: msg,
        latencyMs: infogas.latencyMs || 0,
        recordsCount: hasGas ? 1 : 0
      });
    } else {
      list.push({
        id: 'infogas',
        name: 'INFOGAS (Sistema de Control GNV / GLP y FISE)',
        category: 'Técnico / Combustible',
        status: 'ERROR',
        badge: 'ERROR_CONEXION',
        badgeType: 'error',
        message: infogas?.error ? `Incidencia: ${infogas.error}` : 'Portal de INFOGAS no disponible.',
        latencyMs: infogas?.latencyMs || 0,
        recordsCount: 0
      });
    }

    // 10. ATU (Fiscalización de Transporte Urbano)
    const atu = modules.atu;
    if (atu && atu.success) {
      const actasCount = atu.data?.records?.length || 0;
      const debt = atu.data?.totalDebtPEN || 0;
      list.push({
        id: 'atu',
        name: 'ATU (Fiscalización de Transporte Urbano Lima y Callao)',
        category: 'Fiscalización Urbana',
        status: 'SUCCESS',
        badge: actasCount > 0 ? 'CON_ACTAS_ATU' : 'SIN_ACTAS',
        badgeType: actasCount > 0 ? 'danger' : 'success',
        message: actasCount > 0
          ? `Registra ${actasCount} acta(s) de fiscalización de transporte por S/ ${debt.toFixed(2)} ante la ATU.`
          : 'Sin actas de fiscalización de transporte público registradas ante la ATU.',
        latencyMs: atu.latencyMs || 0,
        recordsCount: actasCount
      });
    } else {
      list.push({
        id: 'atu',
        name: 'ATU (Fiscalización de Transporte Urbano Lima y Callao)',
        category: 'Fiscalización Urbana',
        status: 'ERROR',
        badge: 'ERROR_CONEXION',
        badgeType: 'error',
        message: atu?.error ? `Incidencia: ${atu.error}` : 'Servidor de la ATU no devolvió respuesta.',
        latencyMs: atu?.latencyMs || 0,
        recordsCount: 0
      });
    }

    return list;
  }
}

module.exports = AuditReporter;
