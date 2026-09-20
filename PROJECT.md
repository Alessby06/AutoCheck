# Project: Sistema de Reporte de Autos — Diagnóstico, Optimización y Estabilización

## Architecture
- Motor de consulta y agregación vehicular para Perú (Node.js).
- Orquestación en `VehicleService.queryComplete` despacha concurrentemente 8 módulos scraper que consolidan 10 entidades auditadas vía `AuditReporter`:
  1. `mtcCitv`: Inspección Técnica Vehicular (`src/scrapers/mtcCitvScraper.js`) [EN ALCANCE]
  2. `sunarp`: Consulta Vehicular Registral (`src/scrapers/sunarpScraper.js`) [EN ALCANCE]
  3. `callao`: Fotopapeletas Callao (`src/scrapers/callaoScraper.js`) [EN ALCANCE]
  4. `satPapeletas`: Papeletas SAT Lima (`src/scrapers/satLimaScraper.js`) [INTACTO - SOLO LECTURA]
  5. `satImpuestoVehicular`: Impuesto Vehicular SAT (`src/scrapers/satLimaScraper.js`) [INTACTO - SOLO LECTURA]
  6. `satCaptura`: Órdenes de Captura SAT (`src/scrapers/satLimaScraper.js`) [INTACTO - SOLO LECTURA]
  7. `sutran`: Fiscalización en Vías Nacionales (`src/scrapers/sutranScraper.js`) [INTACTO - SOLO LECTURA]
  8. `apeseg`: Historial de SOAT (`src/scrapers/apesegScraper.js`) [INTACTO - SOLO LECTURA]
  9. `infogas`: Certificación GNV/GLP (`src/scrapers/infogasScraper.js`) [INTACTO - SOLO LECTURA]
  10. `atu`: Transporte Urbano Lima y Callao (`src/scrapers/atuScraper.js`) [INTACTO - SOLO LECTURA]

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | MTC CITV Fast-Path HTTP & Solver Neuronal | Reemplazar navegación pesada por HTTP directo (`/Citv/refrescarCaptcha` y `/Citv/JrCITVConsultarFiltro`), inferencia neuronal con `MtcNeuralSolver.js` (46ms), elusión de Rate Limit 1015 con `/Citv/`, latencia < 15s (meta ~1-2s). | M1 | Survey Explorer 1 / ORIGINAL_REQUEST |
| 2 | SUNARP Estabilización & Aislamiento | Perfil efímero aislado `.chrome_sunarp_${Date.now()}` sin colisiones de lock en Windows, sondeo reactivo de `capturedPayload` (cada 100ms) eliminando `setTimeout(5500)` ciego, sondeo ágil de Turnstile, latencia < 20s (meta ~12s). | M2 | Survey Explorer 2 / ORIGINAL_REQUEST |
| 3 | Callao Optimización `domcontentloaded` | Cambiar `networkidle2` a `domcontentloaded`, extraer captcha inline Base64 de inmediato, bloqueo selectivo de recursos pesados externos (GTM, estilos, fuentes), latencia < 15s (meta ~4s). | M3 | Survey Explorer 3 / ORIGINAL_REQUEST |
| 4 | Auditoría Integral 10 Entidades & No Regresión | Ejecución de auditoría completa en vivo (`VehicleService.queryComplete` y `test/test_audit_new_plate.js`) con las 10 entidades respondiendo SUCCESS, cero colisiones de proceso ni timeouts, y cero regresión sobre SAT, APESEG, SUTRAN, INFOGAS, ATU. | M4 | Survey Explorer 3 / ORIGINAL_REQUEST |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 0 | Survey & Architecture | Investigación técnica de los 3 scrapers y la arquitectura de pruebas | none | DONE |
| 1 | Optimización MTC CITV | `src/scrapers/mtcCitvScraper.js` | M0 | DONE |
| 2 | Estabilización SUNARP | `src/scrapers/sunarpScraper.js` | M1 | DONE |
| 3 | Optimización Callao | `src/scrapers/callaoScraper.js` | M2 | IN_PROGRESS |
| 4 | Auditoría E2E 10 Entidades | Pruebas integrales de todas las 10 entidades y verificación de latencias | M1, M2, M3 | PLANNED |

## Interface Contracts
- **Scraper Output Contract**:
  Todos los scrapers exportan `query(plate, options)` retornando:
  ```json
  {
    "success": true,
    "source": "NOMBRE_OFICIAL",
    "data": { ... },
    "error": null,
    "latencyMs": 1234
  }
  ```
  En caso de fallback o error:
  `{ "success": false, "source": "FALLBACK_NAME", "data": null, "error": "descripción", "latencyMs": 1234 }`

## Code Layout & Write Ownership
- `src/scrapers/mtcCitvScraper.js`: Propiedad exclusiva de Milestone 1.
- `src/scrapers/sunarpScraper.js`: Propiedad exclusiva de Milestone 2.
- `src/scrapers/callaoScraper.js`: Propiedad exclusiva de Milestone 3.
- `src/scrapers/satLimaScraper.js`: PROHIBIDO MODIFICAR (Solo Lectura).
- `src/scrapers/apesegScraper.js`: PROHIBIDO MODIFICAR (Solo Lectura).
- `src/scrapers/sutranScraper.js`: PROHIBIDO MODIFICAR (Solo Lectura).
- `src/scrapers/infogasScraper.js`: PROHIBIDO MODIFICAR (Solo Lectura).
- `src/scrapers/atuScraper.js`: PROHIBIDO MODIFICAR (Solo Lectura).
- `src/utils/browserHelper.js`: Solo Lectura (preservar estabilidad global).
- `src/services/vehicleService.js`: Solo Lectura (consumidor de scrapers).
