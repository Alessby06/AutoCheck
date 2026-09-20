const PlateValidator = require('../utils/plateValidator');
const BrowserHelper = require('../utils/browserHelper');
const AuditReporter = require('../utils/auditReporter');
const MtcCitvScraper = require('../scrapers/mtcCitvScraper');
const SatPapeletasScraper = require('../scrapers/satPapeletasScraper');
const SatImpuestoVehicularScraper = require('../scrapers/satImpuestoVehicularScraper');
const SatCapturaScraper = require('../scrapers/satCapturaScraper');
const SunarpScraper = require('../scrapers/sunarpScraper');
const ApesegScraper = require('../scrapers/apesegScraper');
const InfogasScraper = require('../scrapers/infogasScraper');
const SutranScraper = require('../scrapers/sutranScraper');
const CallaoScraper = require('../scrapers/callaoScraper');
const AtuScraper = require('../scrapers/atuScraper');

/**
 * Servicio Central de Auditoría Vehicular 100% Online en Tiempo Real
 * Implementa Arquitectura de Sesión Compartida (Token Maestro) para SAT
 */
class VehicleService {
  /**
   * Consulta completa del vehículo integrando todas las fuentes oficiales en vivo
   * @param {string} rawPlate - Placa
   * @param {number|null} advertisedKm - Kilometraje anunciado (opcional)
   */
  static async queryComplete(rawPlate, advertisedKm = null) {
    // 0. Limpiar de forma preventiva cualquier ventana o proceso Chrome previo
    await BrowserHelper.cleanupAll();

    const validation = PlateValidator.validate(rawPlate);

    if (!validation.isValid) {
      throw new Error(validation.message);
    }

    const cleanPlate = validation.clean;
    const formattedPlate = validation.formatted;
    const startTime = Date.now();

    console.log(`🌐 [VehicleService] Ejecutando Auditoría 100% EN VIVO para ${formattedPlate}...`);

    try {
      // 1. Extraer un único Token Maestro del SAT para compartirlo
      console.log(`🔑 [VehicleService] Generando Token Maestro del SAT...`);
      let masterSatSession = null;
      let authPage = null;
      try {
        // Creamos una página rápida bloqueando imágenes para extraer la sesión en milisegundos
        authPage = await BrowserHelper.createPage({ blockImages: true });
        await authPage.goto('https://www.sat.gob.pe/VirtualSAT/bienvenida.aspx', { waitUntil: 'domcontentloaded', timeout: 15000 });

        const url = authPage.url();
        if (url.includes('mysession=')) {
          masterSatSession = new URL(url).searchParams.get('mysession');
        } else {
          for (const frame of authPage.frames()) {
            if (frame.url().includes('mysession=')) {
              masterSatSession = new URL(frame.url()).searchParams.get('mysession');
              break;
            }
          }
        }
      } catch (e) {
        console.warn('⚠️ [SAT] Fallo al generar Token Maestro, los scrapers usarán fallback individual:', e.message);
      } finally {
        if (authPage) await BrowserHelper.closePage(authPage);
      }

      // 2. Ejecutar todas las fuentes oficiales en paralelo
      // Inyectamos el Token Maestro a los 3 módulos del SAT para evitar baneos de IP
      const [
        mtcRes,
        satPapeletasRes,
        satImpuestoRes,
        satCapturaRes,
        sunarpRes,
        apesegRes,
        infogasRes,
        sutranRes,
        callaoRes,
        atuRes
      ] = await Promise.allSettled([
        MtcCitvScraper.query(cleanPlate),
        SatPapeletasScraper.query(cleanPlate, true, masterSatSession),
        SatImpuestoVehicularScraper.query(cleanPlate, true, masterSatSession),
        SatCapturaScraper.query(cleanPlate, true, masterSatSession),
        SunarpScraper.query(cleanPlate),
        ApesegScraper.query(cleanPlate),
        InfogasScraper.query(cleanPlate),
        SutranScraper.query(cleanPlate),
        CallaoScraper.query(cleanPlate),
        AtuScraper.query(cleanPlate)
      ]);

      const mtc = mtcRes.status === 'fulfilled' ? mtcRes.value : { success: false, error: mtcRes.reason?.message };
      const satPapeletas = satPapeletasRes.status === 'fulfilled' ? satPapeletasRes.value : { success: false, error: satPapeletasRes.reason?.message };
      const satImpuestoVehicular = satImpuestoRes.status === 'fulfilled' ? satImpuestoRes.value : { success: false, error: satImpuestoRes.reason?.message };
      const satCaptura = satCapturaRes.status === 'fulfilled' ? satCapturaRes.value : { success: false, error: satCapturaRes.reason?.message };
      const sunarp = sunarpRes.status === 'fulfilled' ? sunarpRes.value : { success: false, error: sunarpRes.reason?.message };
      const apeseg = apesegRes.status === 'fulfilled' ? apesegRes.value : { success: false, error: apesegRes.reason?.message };
      const infogas = infogasRes.status === 'fulfilled' ? infogasRes.value : { success: false, error: infogasRes.reason?.message };
      const sutran = sutranRes.status === 'fulfilled' ? sutranRes.value : { success: false, error: sutranRes.reason?.message };
      const callao = callaoRes.status === 'fulfilled' ? callaoRes.value : { success: false, error: callaoRes.reason?.message };
      const atu = atuRes.status === 'fulfilled' ? atuRes.value : { success: false, error: atuRes.reason?.message };

      // Evaluar Semáforo Global y Alertas de forma 100% independiente por entidad
      const alerts = [];
      let overallRisk = 'LOW';

      // 1. Órdenes de Captura SAT (Coactivo y Embargos)
      if (satCaptura.data?.hasCaptureOrder) {
        alerts.push({
          level: 'CRITICAL',
          title: 'ORDEN DE CAPTURA ACTIVA',
          message: (satCaptura.data?.totalCaptures && satCaptura.data.totalCaptures > 0)
            ? `El vehículo registra ${satCaptura.data.totalCaptures} orden(es) de captura o embargo coactivo en el SAT de Lima.`
            : 'El vehículo registra orden de captura o embargo coactivo en el SAT de Lima.'
        });
        overallRisk = 'CRITICAL';
      }

      // 2. Multas / Papeletas SAT
      if (satPapeletas.data?.hasFines && (satPapeletas.data.totalFines > 0 || (satPapeletas.data.records && satPapeletas.data.records.length > 0))) {
        alerts.push({
          level: 'HIGH',
          title: `Papeletas Pendientes en Lima (S/ ${(satPapeletas.data.totalDebtPEN || 0).toFixed(2)})`,
          message: `Registra ${satPapeletas.data.totalFines || satPapeletas.data.records.length} papeleta(s) pendientes de pago en el SAT de Lima.`
        });
        if (overallRisk === 'LOW') overallRisk = 'MEDIUM';
      }

      // 3. Impuesto Vehicular SAT
      if (satImpuestoVehicular.data?.hasTax && (satImpuestoVehicular.data.totalTax > 0 || (satImpuestoVehicular.data.taxRecords && satImpuestoVehicular.data.taxRecords.length > 0))) {
        alerts.push({
          level: 'MEDIUM',
          title: `Impuesto Vehicular en Lima (S/ ${(satImpuestoVehicular.data.totalTaxDebtPEN || 0).toFixed(2)})`,
          message: `Registra ${satImpuestoVehicular.data.totalTax || satImpuestoVehicular.data.taxRecords.length} deuda(s) de impuesto vehicular en el SAT de Lima.`
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

      // ATU
      if (atu.data?.hasInfractions && atu.data.totalInfractions > 0) {
        const isHigh = (atu.data.totalDebtPEN >= 500);
        alerts.push({
          level: isHigh ? 'HIGH' : 'MEDIUM',
          title: `Actas de Fiscalización ATU (S/ ${atu.data.totalDebtPEN.toFixed(2)})`,
          message: `Registra ${atu.data.totalInfractions} acta(s) de fiscalización o infracciones ante la ATU.`
        });
        if (isHigh && overallRisk !== 'CRITICAL') {
          overallRisk = 'HIGH';
        } else if (overallRisk === 'LOW') {
          overallRisk = 'MEDIUM';
        }
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
        (satPapeletas.data?.totalDebtPEN || 0) +
        (satImpuestoVehicular.data?.totalTaxDebtPEN || satImpuestoVehicular.data?.totalDebtPEN || 0) +
        (sutran.data?.totalDebtPEN || 0) +
        (callao.data?.totalDebtPEN || 0) +
        (atu.data?.totalDebtPEN || 0);

      const totalDurationMs = Date.now() - startTime;

      const report = {
        plate: formattedPlate,
        plateType: validation.type,
        queryTimestamp: new Date().toISOString(),
        totalDurationMs,
        overallRisk,
        totalDebtConsolidatedPEN,
        alerts,
        modules: {
          mtcCitv: mtc,
          satPapeletas: satPapeletas,
          satImpuestoVehicular: satImpuestoVehicular,
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

      // Generar auditoría detallada de los 10 scrapers oficiales
      report.scrapersAudit = AuditReporter.generateSummary(report.modules, formattedPlate);

      return report;
    } finally {
      // Garantizar la destrucción del 100% de los archivos temporales y cierre de navegadores
      await BrowserHelper.cleanupAll();
    }
  }
}

module.exports = VehicleService;