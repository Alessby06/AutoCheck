@echo off
title AutoCheck Peru - Servidor de Reporte Vehicular
echo ========================================================
echo   Iniciando AutoCheck Peru (Reporte Vehicular por Placa)
echo ========================================================
echo.
echo Abriendo la aplicacion en tu navegador...
start http://localhost:3000
echo.
echo Servidor en ejecucion. Para cerrarlo, presiona Ctrl + C o cierra esta ventana.
echo ========================================================
node server.js
pause
