const PlateValidator = require('../utils/plateValidator');
const MtcCitvScraper = require('../scrapers/mtcCitvScraper');
const SatLimaScraper = require('../scrapers/satLimaScraper');
const SunarpScraper = require('../scrapers/sunarpScraper');
const ApesegScraper = require('../scrapers/apesegScraper');
const InfogasScraper = require('../scrapers/infogasScraper');
const SutranScraper = require('../scrapers/sutranScraper');
const CallaoScraper = require('../scrapers/callaoScraper');
const AtuScraper = require('../scrapers/atuScraper');
const SatCapturaScraper = require('../scrapers/satCapturaScraper');

/**
 * Servicio Central de Auditoría Vehicular 100% Online en Tiempo Real
 */
class VehicleService {
  /**
   * Consulta completa del vehículo integrando todas las fuentes oficiales en vivo
   * @param {string} rawPlate - Placa
   * @param {number|null} advertisedKm - Kilometraje anunciado (opcional)
   */
  static async queryComplete(rawPlate, advertisedKm = null) {
    const validation = PlateValidator.validate(rawPlate);

    if (!validation.isValid) {
      throw new Error(validation.message);
    }

    const cleanPlate = validation.clean;
    const formattedPlate = validation.formatted;
    const startTime = Date.now();

    console.log(`🌐 [VehicleService] Ejecutando Auditoría 100% EN VIVO para ${formattedPlate}...`);

    // 2. Ejecutar todas las fuentes oficiales en paralelo
    const [
      mtcRes,
      satRes,
      sunarpRes,
      apesegRes,
      infogasRes,
      sutranRes,
      callaoRes,
      atuRes,
      satCapturaRes
    ] = await Promise.allSettled([
      MtcCitvScraper.query(cleanPlate),
      SatLimaScraper.query(cleanPlate),
      SunarpScraper.query(cleanPlate),
      ApesegScraper.query(cleanPlate),
      InfogasScraper.query(cleanPlate),
      SutranScraper.query(cleanPlate),
      CallaoScraper.query(cleanPlate),
      AtuScraper.query(cleanPlate),
      SatCapturaScraper.query(cleanPlate)
    ]);

    const mtc = mtcRes.status === 'fulfilled' ? mtcRes.value : { success: false, error: mtcRes.reason?.message };
    const sat = satRes.status === 'fulfilled' ? satRes.value : { success: false, error: satRes.reason?.message };
    const sunarp = sunarpRes.status === 'fulfilled' ? sunarpRes.value : { success: false, error: sunarpRes.reason?.message };
    const apeseg = apesegRes.status === 'fulfilled' ? apesegRes.value : { success: false, error: apesegRes.reason?.message };
    const infogas = infogasRes.status === 'fulfilled' ? infogasRes.value : { success: false, error: infogasRes.reason?.message };
    const sutran = sutranRes.status === 'fulfilled' ? sutranRes.value : { success: false, error: sutranRes.reason?.message };
    const callao = callaoRes.status === 'fulfilled' ? callaoRes.value : { success: false, error: callaoRes.reason?.message };
    const atu = atuRes.status === 'fulfilled' ? atuRes.value : { success: false, error: atuRes.reason?.message };
    const satCaptura = satCapturaRes.status === 'fulfilled' ? satCapturaRes.value : { success: false, error: satCapturaRes.reason?.message };

    // Integrar verificación real en vivo de Orden de Captura SAT
    if (sat.data) {
      sat.data.hasCaptureOrder = Boolean(satCaptura.data?.hasCaptureOrder);
      sat.data.totalCaptures = satCaptura.data?.totalCaptures || 0;
      sat.data.captureRecords = satCaptura.data?.records || [];
      sat.data.captureVerifiedLive = satCaptura.success === true;
      sat.data.captureSource = satCaptura.source || 'SAT_LIMA_CAPTURAS_LIVE';
    }

    // Evaluar Semáforo Global y Alertas
    const alerts = [];
    let overallRisk = 'LOW';

    // Captura SAT (Coactivo y Embargos)
    if (sat.data?.hasCaptureOrder || satCaptura.data?.hasCaptureOrder) {
      alerts.push({
        level: 'CRITICAL',
        title: 'ORDEN DE CAPTURA ACTIVA',
        message: (satCaptura.data?.totalCaptures && satCaptura.data.totalCaptures > 0)
          ? `El vehículo registra ${satCaptura.data.totalCaptures} orden(es) de captura o embargo coactivo en el SAT de Lima.`
          : 'El vehículo registra orden de captura o embargo coactivo en el SAT de Lima.'
      });
      overallRisk = 'CRITICAL';
    }

    // Multas SAT
    if (sat.data?.hasFines && sat.data.totalFines > 0) {
      alerts.push({
        level: 'HIGH',
        title: `Papeletas Pendientes en Lima (S/ ${sat.data.totalDebtPEN.toFixed(2)})`,
        message: `Registra ${sat.data.totalFines} papeleta(s) pendientes de pago en el SAT de Lima.`
      });
      if (overallRisk === 'LOW') overallRisk = 'MEDIUM';
    }

    // SUTRAN
    if (sutran.data?.hasInfractions && sutran.data.totalInfractions > 0) {
      alerts.push({
        level: 'MEDIUM',
        title: `Infracciones en Carreteras (S/ ${sutran.data.totalDebtPEN.toFixed(2)})`,
        message: `Registra ${sutran.data.totalInfractions} infracción(es) en vías nacionales ante SUTRAN.`
      });
      if (overallRisk === 'LOW') overallRisk = 'MEDIUM';
    }

    // Callao
    if (callao.data?.hasInfractions && callao.data.totalInfractions > 0) {
      alerts.push({
        level: 'MEDIUM',
        title: `Fotopapeletas Callao (S/ ${callao.data.totalDebtPEN.toFixed(2)})`,
        message: `Registra ${callao.data.totalInfractions} fotopapeleta(s) en avenidas del Callao.`
      });
      if (overallRisk === 'LOW') overallRisk = 'MEDIUM';
    }

    // SOAT
    if (apeseg.data?.status === 'RATE_LIMIT_COOLDOWN') {
      alerts.push({
        level: 'LOW',
        title: 'SOAT: Servidor en Enfriamiento',
        message: 'APESEG está regulando consultas por alta demanda momentánea. Por favor vuelva a auditar en 2 minutos para confirmar SOAT.'
      });
    } else if (apeseg.data?.isExpired) {
      alerts.push({
        level: 'HIGH',
        title: 'SOAT Vencido',
        message: 'El vehículo no cuenta con SOAT vigente ante las aseguradoras.'
      });
      if (overallRisk !== 'CRITICAL') overallRisk = 'HIGH';
    } else if (apeseg.data?.isCommercialOrTaxi) {
      alerts.push({
        level: 'HIGH',
        title: 'Uso Comercial / Taxi Registrado',
        message: `Atención: Registrado ante el seguro bajo la modalidad "${apeseg.data.useType}".`
      });
      if (overallRisk === 'LOW') overallRisk = 'MEDIUM';
    } else if (apeseg.data?.hadCommercialHistory) {
      alerts.push({
        level: 'MEDIUM',
        title: 'Historial de Uso Comercial o Taxi Detectado',
        message: 'Atención al comprador: Aunque su última póliza figura como Particular, el vehículo registra historial previo bajo servicio comercial o taxi ante aseguradoras.'
      });
      if (overallRisk === 'LOW') overallRisk = 'MEDIUM';
    }

    // GNV (INFOGAS & FISE)
    if (infogas.data?.hasGnv) {
      if (infogas.data.isChipBlocked) {
        alerts.push({
          level: 'HIGH',
          title: 'Chip GNV Bloqueado (Sin Carga)',
          message: 'El chip de gas está bloqueado en INFOGAS por falta de certificación anual o prueba de cilindro. No puede abastecer en grifos.'
        });
        if (overallRisk === 'LOW') overallRisk = 'MEDIUM';
      } else if (infogas.data.isCylinderExpired) {
        alerts.push({
          level: 'HIGH',
          title: 'Cilindro de Gas Vencido (Prueba Quinquenal)',
          message: `La certificación del cilindro/tanque de GNV venció el ${infogas.data.cylinderExpiry}. Riesgo de seguridad y bloqueo inminente.`
        });
        if (overallRisk === 'LOW') overallRisk = 'MEDIUM';
      } else if (infogas.data.isAnnualExpired) {
        alerts.push({
          level: 'MEDIUM',
          title: 'Revisión Anual GNV Vencida',
          message: `La certificación anual del sistema de gas venció el ${infogas.data.annualExpiry}.`
        });
        if (overallRisk === 'LOW') overallRisk = 'MEDIUM';
      }

      if (infogas.data.fise?.overdueDebtPEN > 0) {
        alerts.push({
          level: 'MEDIUM',
          title: `Deuda Vencida FISE (S/ ${infogas.data.fise.overdueDebtPEN.toFixed(2)})`,
          message: `El vehículo registra cuotas morosas en el programa Ahorro GNV del MINEM.`
        });
        if (overallRisk === 'LOW') overallRisk = 'MEDIUM';
      }
    }

    // Revisión Técnica MTC
    if (mtc.data?.status === 'VENCIDO') {
      alerts.push({
        level: 'HIGH',
        title: 'Revisión Técnica Vencida',
        message: `La inspección técnica venció el ${mtc.data.expirationDate}. No puede circular legalmente.`
      });
      if (overallRisk !== 'CRITICAL') overallRisk = 'HIGH';
    }

    const totalDebtConsolidatedPEN =
      (sat.data?.totalDebtPEN || 0) +
      (sutran.data?.totalDebtPEN || 0) +
      (callao.data?.totalDebtPEN || 0);

    const totalDurationMs = Date.now() - startTime;

    // Checklist de inspección física presencial para el comprador
    const physicalChecklist = [
      {
        id: 'chk-vin',
        title: 'Código VIN Troquelado en Chasis',
        guide: 'Verifica que el código troquelado en el cortafuego del motor y bajo el parabrisas coincidan con la tarjeta de propiedad. No debe haber signos de esmerilado ni soldaduras.',
        riskIfFailed: 'Grave: Posible vehículo clonado o chasis adulterado.'
      },
      {
        id: 'chk-engine',
        title: 'Número de Motor Original',
        guide: 'Localiza con una linterna el bloque de motor y confirma que el número coincida exactamente con la tarjeta SUNARP.',
        riskIfFailed: 'Grave: Si el motor fue cambiado y no regularizado notarialmente, no pasará revisión técnica.'
      },
      {
        id: 'chk-pillars',
        title: 'Soldaduras de Fábrica en Parantes A, B y C',
        guide: 'Baja las gomas protectoras de las puertas y examina los puntos de soldadura redondos y regulares de fábrica.',
        riskIfFailed: 'Alto: Masilla o soldadura artesanal delata un choque grave o volcadura.'
      },
      {
        id: 'chk-oil',
        title: 'Tapa de Aceite (Prueba de Emulsión)',
        guide: 'Abre la tapa de llenado de aceite con el motor frío. No debe haber pasta blanquecina ni aspecto de café con leche.',
        riskIfFailed: 'Crítico: Empaque de culata quemado o refrigerante mezclado con el aceite.'
      }
    ];

    const report = {
      plate: formattedPlate,
      plateType: validation.type,
      queryTimestamp: new Date().toISOString(),
      totalDurationMs,
      overallRisk,
      totalDebtConsolidatedPEN,
      alerts,
      physicalChecklist,
      modules: {
        mtcCitv: mtc,
        satLima: sat,
        satCaptura: satCaptura,
        sunarp: sunarp,
        apeseg: apeseg,
        infogas: infogas,
        sutran: sutran,
        callao: callao,
        atu: atu
      }
    };

    report.fechaConsulta = new Date().toISOString();
    report.isLive = true;
    report.fromCache = false;

    return report;
  }
}

module.exports = VehicleService;
