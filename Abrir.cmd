@echo off
rem Roda o app a partir do codigo (versao GPU). Para a CPU: npm run start:cpu
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe (
  echo Instalando as dependencias pela primeira vez...
  call npm install
)
if not exist vendor\gpu\llama\llama-server.exe (
  echo Baixando o llama.cpp e gerando o OCR...
  call npm run preparar:gpu
)
start "" "%~dp0node_modules\electron\dist\electron.exe" .
