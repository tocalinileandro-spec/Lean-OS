# Probar Lean OS en Windows

Todos los comandos son para el **Símbolo del sistema (`cmd`)**, parado en la carpeta del proyecto (por ejemplo `cd C:\Lean-OS`).

## 1. Instalar Node

1. Bajá Node 22 LTS (22.18 o más nuevo) desde https://nodejs.org e instalalo con las opciones por defecto.
2. Abrí una ventana nueva de `cmd` y comprobá:

```
node -v
npm -v
```

`node -v` tiene que mostrar `v22.18.0` o más.

## 2. Instalar y compilar

```
npm ci
npm run build
```

`npm run build` deja la app lista en la carpeta `dist\`.

## 3. Correr el servidor

Los valores de desarrollo no son secretos. Si no cargás `APP_PASSWORD_HASH` ni `SESSION_SECRET`, el servidor usa en desarrollo la contraseña `desarrollo` y avisa en pantalla.

```
set PORT=8080
set DATA_DIR=datos-servidor
npm run servidor
```

Dejá esa ventana abierta (se corta con `Ctrl+C`). Abrí http://localhost:8080 en Chrome o Edge, entrá con la contraseña `desarrollo` desde Ajustes > Cuenta y listo: la app guarda todo en el navegador y lo sincroniza con el servidor.

Comprobar que responde (en otra ventana de `cmd`):

```
curl http://localhost:8080/health
```

Tiene que escribir `ok`.

## 4. Instalar como aplicación (PWA)

Con el servidor andando y la página abierta en `http://localhost:8080`:

- **Chrome o Edge:** ícono de instalar en la barra de direcciones (o menú `⋮` > "Instalar Lean OS" / "Aplicaciones" > "Instalar este sitio como aplicación").
- **Celular (Android, Chrome):** abrí la dirección https de tu app desplegada y elegí "Instalar aplicación" / "Agregar a la pantalla principal". Por seguridad el navegador solo instala por https o desde `localhost`.

Una vez abierta una vez, la app abre también sin conexión.

## 5. Correr las pruebas

```
npm run verificar
```

Corre todas las pruebas, escribe `REPORTE.md` y termina con `verificar: APROBADO` si todo está verde. Otros comandos:

```
npm run tipos
npm test
```

## 6. Dónde quedan los datos

- **En el navegador:** la copia local de cada dispositivo (IndexedDB). Es la que usás todos los días.
- **En el servidor local:** la carpeta `datos-servidor\` (la base `lean-os.sqlite` y, dentro de `respaldos\`, un JSON por noche con los últimos 30). Esa carpeta no se sube al repositorio.
- **En Fly.io:** el volumen `lean_os_data`, montado en `/data` (ver SECRETOS.md).

## 7. Exportar un respaldo

En la app: **Ajustes > Respaldo > Exportar todo**. Descarga `lean-os-respaldo-AAAA-MM-DD.json`. Conviene guardarlo de vez en cuando en Google Drive. Para volver a cargarlo: **Importar un respaldo** en el mismo lugar.

Para restaurar un respaldo en un servidor nuevo y vacío:

```
npm run restaurar -- ruta\al\respaldo.json
```

## 8. App de Windows (.exe)

Es la misma app empaquetada en un solo archivo, `Lean-OS.exe` (no instala nada y abre sin conexión).

1. **Dónde bajarlo:** en GitHub, pestaña **Actions**, abrí la última corrida verde del CI y bajá el artefacto **Lean-OS-exe** (queda 30 días). Viene en un .zip: descomprimilo.
2. **Cómo abrirlo:** doble clic en `Lean-OS.exe`, o desde `cmd`: `Lean-OS.exe`. Tarda unos segundos la primera vez (se descomprime solo). Solo se abre una ventana a la vez.
3. **SmartScreen:** Windows puede mostrar "Windows protegió su PC" porque el .exe no está firmado (firmarlo cuesta dinero). Tocá **Más información** y luego **Ejecutar de todas formas**.
4. **Dónde quedan los datos:** en `%APPDATA%\Lean OS` (pegalo en el Explorador). Ahí está la copia local (IndexedDB). Borrar esa carpeta borra los datos locales de la app de Windows: exportá un respaldo antes (Ajustes > Respaldo).
5. **Sincronización:** la app de Windows sincroniza con `https://lean-os.fly.dev` por defecto. Para usar otro servidor, creá `%APPDATA%\Lean OS\config.json` con `{ "servidor": "https://mi-servidor.example.com" }` y reabrí la app. La variable `LEAN_OS_SERVIDOR` tiene prioridad sobre ese archivo. Sin conexión funciona igual y sincroniza cuando vuelva la red.
6. **Puerto:** usa el puerto local 47821 (fijo, porque de él depende dónde se guardan los datos). Si está ocupado, la app avisa y no abre; cerrá la otra copia o el programa que lo usa. `LEAN_OS_PUERTO` lo cambia, pero con otro puerto no ves los datos de antes.
7. **Modos de prueba (solo para el CI):** con la variable `LEAN_OS_PRUEBA` = `salud`, `s1-escribir` o `s1-leer` el .exe hace una comprobación y se cierra con código 0 (o 1 si falla); `LEAN_OS_DATOS` fija la carpeta de datos (usá una temporal, nunca la real). En uso normal esas variables no existen. Para correrlos todos: `node escritorio/probar-exe.ts` (en Windows, con el .exe ya armado).
8. **Armarlo a mano (Windows):** `npm ci`, `npm run build`, `node escritorio/compilar.ts`, luego en `escritorio\`: `npm ci` y `npm run empaquetar`. Sale `escritorio\salida\Lean-OS.exe`.

## 9. Entrada por audio (opcional)

Sin la clave de Groq (ver `SECRETOS.md`, sección 5) la app anda igual y Ajustes dice "falta configurar". Para probarla en tu PC: corré el servidor con la variable `GROQ_API_KEY` cargada en tu terminal (no en el repositorio), entrá, activá el interruptor en Ajustes > "Entrada por audio (opcional)" y en Apuntes > "Nuevo apunte" tocá "Micrófono". El texto aparece en la caja y no se guarda hasta que toques "Guardar apunte". Las pruebas automáticas (O7 a O12) usan un proveedor simulado y no llaman a Groq.

