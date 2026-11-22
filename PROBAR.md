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
