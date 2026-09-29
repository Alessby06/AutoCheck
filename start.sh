#!/bin/bash
set -euo pipefail

# 1. Instalar dependencias de Node.js (solo si faltan)
if [ ! -d "node_modules" ]; then
  echo "Instalando paquetes de Node..."
  npm ci --omit=dev
else
  echo "node_modules ya existe, saltando npm install"
fi

# 2. Preparar entorno Python para ddddocr + OpenCV headless
#    Usamos un venv aislado para no contaminar el sistema y asegurar python3
if [ ! -d ".venv" ]; then
  echo "Creando entorno virtual Python..."
  python3 -m venv .venv
fi
source .venv/bin/activate
echo "Instalando ddddocr y opencv-python-headless..."
pip install --upgrade pip
pip install ddddocr opencv-python-headless

# 3. Encender el servidor
echo "Encendiendo AutoCheck Perú..."
exec node server.js