# 🚗 AutoCheck Perú (Alpha)

Plataforma de auditoría e inteligencia vehicular por placa en Perú. Consolida en tiempo real antecedentes vehiculares, gravámenes, multas, inspección técnica (CITV), SOAT y récord de kilometraje mediante scrapers concurrentes y redes neuronales ligeras para resolución de captchas.

---

## ⚡ Características Principales

- **Auditoría Multi-Fuente en Tiempo Real:**
  - **SUNARP:** Gravámenes, propietarios, datos registrales y características técnicas del vehículo.
  - **MTC CITV:** Certificado de Inspección Técnica Vehicular con red neuronal local MLP para bypass de captchas (inferencia < 5ms).
  - **APESEG:** Estado y vigencia de pólizas de SOAT en todas las aseguradoras peruanas.
  - **SUTRAN & Callao:** Fotopapeletas e infracciones en carreteras nacionales y red vial urbana.
  - **SAT Lima:** Papeletas municipales y órdenes de captura vigentes.
  - **INFOGAS:** Certificaciones y chips de conversión GNV/GLP.
  - **ATU:** Récord de servicio en transporte público y taxis.
- **Detección de Manipulación de Kilometraje:** Análisis cronológico para alertar retrocesos de odómetro.
- **Caché Inteligente & Persistencia Segura:** Almacenamiento local en disco que respeta fechas de vigencia y evita consultas duplicadas innecesarias.
- **Interfaz Web Moderna:** Dashboard para consultas rápidas con visualización de nivel de riesgo consolidado.

---

## 🛠️ Requisitos Previos

- **Node.js**: v18 o superior instalado.
- **NPM**: v9 o superior.
- **Python** (Opcional, solo requerido si se utiliza el solver secundario ddddocr para captchas del SAT).

---

## 🚀 Instalación y Puesta en Marcha

1. **Clonar el repositorio:**
   `ash
   git clone https://github.com/TU_USUARIO/autocheck-peru.git
   cd autocheck-peru
   `

2. **Instalar dependencias:**
   `ash
   npm install
   `

3. **Iniciar la aplicación:**
   - **En Windows (un clic):** Doble clic sobre iniciar.bat.
   - **Desde terminal:**
     `ash
     npm start
     `

4. **Acceso Web:**
   Abre tu navegador en [http://localhost:3000](http://localhost:3000)

---

## 📡 API Endpoints

### 1. Auditoría Completa por Placa
- **Ruta:** GET /api/vehicle/report
- **Parámetros:**
  - plate o placa (requerido): Placa del vehículo (ej. B3T-489, C0A653).
  - km (opcional): Kilometraje anunciado en venta para validar posibles inconsistencias.
- **Ejemplo:**
  `http
  GET http://localhost:3000/api/vehicle/report?plate=B3T-489&km=45000
  `

### 2. Health Check
- **Ruta:** GET /api/health

---

## 🧪 Pruebas Automatizadas

Para validar los scrapers y módulos centrales:
`ash
node test/testBlock1.js
`

---

## 📂 Estructura del Proyecto

`
├── public/                 # Frontend Web (HTML, CSS, JS estático)
├── src/
│   ├── cache/              # Motor de caché en memoria RAM
│   ├── scrapers/           # Scrapers especializados y solvers neuronales
│   ├── services/           # Lógica de negocio y cálculo de riesgo vehicular
│   ├── storage/            # Persistencia en disco local
│   └── utils/              # Validadores de placas peruanas y helpers de red
├── test/                   # Suites de pruebas de integración
├── .gitignore              # Reglas de exclusión de Git
├── iniciar.bat             # Script de lanzamiento directo para Windows
├── package.json            # Manifiesto del proyecto y dependencias
├── server.js               # Servidor Express API
└── README.md
`

---

## 📄 Licencia

Este proyecto está bajo la Licencia MIT.
