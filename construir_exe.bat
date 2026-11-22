@echo off
rem Arma la versión descargable: la carpeta dist\LeanOS con LeanOS.exe adentro.
rem Hay que volver a correrlo cada vez que cambies el código para que el .exe se actualice.
rem
rem IMPORTANTE: PyInstaller borra toda la carpeta dist\LeanOS antes de armarla de nuevo.
rem Por eso este archivo pone a salvo tu carpeta "datos" y tu configuracion.json, y al final
rem los devuelve a su lugar. (Si tus datos están en otra carpeta, como OneDrive, no se tocan.)
cd /d "%~dp0"

tasklist /fi "imagename eq LeanOS.exe" 2>nul | find /i "LeanOS.exe" >nul
if not errorlevel 1 (
    echo LeanOS.exe esta abierto. Cerralo ^(cerra la ventana negra^) y volve a correr esto.
    pause
    exit /b 1
)

rem Si quedó una carpeta de un intento anterior, puede tener tus datos: no la pisamos.
if exist "_guardado_temporal" (
    echo Quedo la carpeta _guardado_temporal de un intento anterior. Puede tener tus datos.
    echo Revisala, movela a otro lado y volve a correr esto.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    python -m venv .venv
)
".venv\Scripts\python.exe" -m pip install -r requirements-construir.txt

rem 1) Poner a salvo lo que el usuario tiene en dist\LeanOS
mkdir "_guardado_temporal"
if exist "dist\LeanOS\datos" move "dist\LeanOS\datos" "_guardado_temporal\datos" >nul
if exist "dist\LeanOS\configuracion.json" copy /y "dist\LeanOS\configuracion.json" "_guardado_temporal\configuracion.json" >nul

rem 2) Construir
".venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean --name LeanOS ^
    --add-data "web\templates;web\templates" ^
    --add-data "web\static;web\static" ^
    servidor.py
set RESULTADO=%errorlevel%

rem 3) Devolver lo guardado (si no había configuración propia, se usa la del proyecto)
xcopy /e /i /y ejemplos dist\LeanOS\ejemplos >nul
if exist "_guardado_temporal\configuracion.json" (
    copy /y "_guardado_temporal\configuracion.json" "dist\LeanOS\configuracion.json" >nul
) else if exist "configuracion.json" (
    copy /y configuracion.json dist\LeanOS\configuracion.json >nul
) else (
    copy /y configuracion.ejemplo.json dist\LeanOS\configuracion.json >nul
)
if exist "_guardado_temporal\datos" move "_guardado_temporal\datos" "dist\LeanOS\datos" >nul

rem 4) Solo si todo volvió a su lugar, borramos la carpeta temporal (que ya quedó vacía de datos)
if not exist "_guardado_temporal\datos" rmdir /s /q "_guardado_temporal"

echo.
if not "%RESULTADO%"=="0" (
    echo FALLO el armado del .exe. Tus datos y tu configuracion siguen en dist\LeanOS.
    pause
    exit /b 1
)
echo Listo. Abri dist\LeanOS\LeanOS.exe
pause
