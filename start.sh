#!/bin/bash

# 1. Instalar dependencias de Node.js
echo "Instalando paquetes de Node..."
npm install

# 2. Instalar el motor de IA para el Captcha (ddddocr)
echo "Instalando red neuronal de Python..."
pip3 install ddddocr --user

# 3. Encender el servidor
echo "Encendiendo AutoCheck Perú..."
node index.js