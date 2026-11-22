# Secretos: cómo cargarlos

Lean OS usa cuatro secretos (sección 7 de `docs/VISION.md`), más cuatro opcionales para el respaldo externo (sección 4 de esta guía) y una opcional para la entrada por audio (sección 5). Ninguno va al repositorio: se cargan una sola vez en los lugares de esta guía. `.env` ya está en `.gitignore` y `.env.example` tiene solo los nombres.

Los comandos de Windows son para `cmd`; en Linux y Mac son los mismos salvo donde se indica. No pegues los secretos en el chat, en commits ni en capturas.

| Secreto | Para qué | Dónde se carga |
| --- | --- | --- |
| `FLY_API_TOKEN` | Desplegar desde GitHub Actions y desde tu PC | Secreto de GitHub Actions y `.env` local |
| `GITHUB_TOKEN` | Que el agente suba código y lea resultados de CI | `.env` local o `gh auth login` |
| `APP_PASSWORD_HASH` | Contraseña de la app (solo su hash) | Secreto de Fly.io |
| `SESSION_SECRET` | Firmar las sesiones | Secreto de Fly.io |

Primero copiá el archivo de ejemplo (una sola vez):

```
copy .env.example .env
```

(en Linux/Mac: `cp .env.example .env`). Después abrí `.env` con el Bloc de notas y completá cada valor a medida que seguís los pasos.

## 1. FLY_API_TOKEN

1. Creá la cuenta en https://fly.io (pide una tarjeta). Instalá `flyctl`:
   - Windows (PowerShell): `iwr https://fly.io/install.ps1 -useb | iex`
   - Linux/Mac: `curl -L https://fly.io/install.sh | sh`
2. Iniciá sesión: `fly auth login`
3. Creá la app. El nombre `lean-os` puede estar tomado: si Fly lo rechaza, elegí otro (por ejemplo `lean-os-tunombre`) y cambialo en **tres** lugares: `app = "..."` en `fly.toml`, `FLY_APP: ...` en `.github/workflows/ci.yml` y los comandos de abajo.
   ```
   fly apps create lean-os
   ```
4. Creá el volumen de datos (una sola vez; es donde vive la base de datos). Elegí la región `eze` (Buenos Aires):
   ```
   fly volumes create lean_os_data --app lean-os --region eze --size 1 --snapshot-retention 60
   ```
   Los snapshots diarios están activados y se conservan **60 días** (el máximo que permite Fly; por defecto son 5). Para comprobarlo después: `fly volumes list --app lean-os` y `fly volumes show <ID>`; si muestra otra cantidad de días: `fly volumes update <ID> --snapshot-retention 60`.
5. Creá un token de despliegue limitado a esta app. Se muestra una sola vez; copialo sin pegarlo en ningún chat:
   ```
   fly tokens create deploy --app lean-os
   ```
6. Cargalo en **GitHub**: repositorio > Settings > Secrets and variables > Actions > New repository secret. Nombre `FLY_API_TOKEN`, valor: el token completo (incluida la palabra que lo precede).
7. Cargalo también en tu `.env` local (en la línea de `FLY_API_TOKEN`, pegá el valor después del signo igual).

Mientras no esté cargado, el CI pasa igual pero salta el despliegue y muestra un aviso "Despliegue salteado". Con el secreto cargado, cada push a `main` con las pruebas en verde despliega con `flyctl deploy --remote-only` y consulta `https://lean-os.fly.dev/health` esperando `ok`.

Primer despliegue a mano (opcional, después de cargar los secretos de los pasos 3 y 4):

```
fly deploy --remote-only --app lean-os
```

## 2. GITHUB_TOKEN

1. GitHub > Settings (de tu usuario) > Developer settings > Personal access tokens > **Fine-grained tokens** > Generate new token.
2. Resource owner: tu usuario. Repository access: **Only select repositories** y elegí solo este repositorio (privado).
3. Permisos de repositorio (todos los demás en "No access"): Contents: Read and write; Pull requests: Read and write; Actions: Read-only; Metadata: Read-only.
4. Vencimiento: el más corto que te resulte cómodo (por ejemplo 90 días).
5. Copiá el token (se muestra una sola vez) en tu `.env`, línea `GITHUB_TOKEN=`. Alternativa sin archivo: `gh auth login`.

Si GitHub rechaza un push que toca `.github/workflows`, el agente deja el archivo en `ci/` y lo anota en `BLOQUEOS.md`; copialo vos a `.github/workflows`.

## 3. APP_PASSWORD_HASH y SESSION_SECRET

Los genera un script del repositorio a partir de la contraseña que elijas (mínimo 8 caracteres). El script imprime solo dos líneas con el hash y el secreto de sesión, nunca la contraseña.

1. Generalos (Windows `cmd`). Con variable de entorno, que no queda en el historial de comandos:
   ```
   set LEAN_OS_PASSWORD=tu contraseña
   node scripts/generar-secretos.ts
   set LEAN_OS_PASSWORD=
   ```
   (La última línea borra la contraseña de la ventana.) También podés correr solo `node scripts/generar-secretos.ts`, escribir la contraseña, apretar Enter y después `Ctrl+Z` y Enter (en Linux/Mac, `Ctrl+D`).
2. Copiá los **valores** (lo que viene después del `=` en cada línea) y cargalos en Fly. Usá **comillas simples** porque el hash tiene signos `$` (en Linux/Mac y PowerShell). En Windows `cmd` usá comillas dobles:
   - Linux/Mac/PowerShell:
     ```
     fly secrets set --app lean-os APP_PASSWORD_HASH='<pegá acá el hash>' SESSION_SECRET='<pegá acá el secreto>'
     ```
   - Windows `cmd`:
     ```
     fly secrets set --app lean-os "APP_PASSWORD_HASH=<pegá acá el hash>" "SESSION_SECRET=<pegá acá el secreto>"
     ```
3. Comprobá que quedaron cargados (muestra solo los nombres): `fly secrets list --app lean-os`

El servidor en producción se niega a arrancar si faltan estos dos secretos.

### Cambiar la contraseña

Volvé a correr `node scripts/generar-secretos.ts` con la contraseña nueva y cargá en Fly **solo** `APP_PASSWORD_HASH` (el comando de arriba sin `SESSION_SECRET`). Las sesiones ya abiertas siguen valiendo hasta que venzan o se cierren; si querés echarlas ya, cambiá también `SESSION_SECRET`.

### Qué cierra las sesiones

- Cambiar `SESSION_SECRET` (con otro valor generado por el script) cierra **todas** las sesiones abiertas en todos los dispositivos: hay que volver a entrar con la contraseña.
- Cerrar sesión en la app invalida solo el token de ese dispositivo.
- Los datos no se tocan en ningún caso: cada dispositivo conserva su copia local.

## 4. Respaldo externo (opcional): Backblaze B2

Es opcional y viene **desactivado**. Cada noche (03:00) el servidor ya guarda un respaldo local. Si lo activás, además sube una copia **cifrada** a tu bucket privado de Backblaze B2, y conserva las últimas 30. Sin activarlo en Ajustes, o sin las cuatro claves, no sale nada del servidor. La app funciona completa sin esto.

Secretos opcionales: `B2_KEY_ID`, `B2_APP_KEY`, `B2_BUCKET` (nombre del bucket, no es secreto pero se carga igual) y `RESPALDO_CLAVE` (clave de cifrado). Todos van a Fly; `.env.example` tiene los nombres vacíos.

1. Creá la cuenta en https://www.backblaze.com/sign-up/cloud-storage (plan gratuito de 10 GB; confirmá en la página que no te pide tarjeta o qué condiciones tiene).
2. Creá un bucket **privado**: B2 Cloud Storage > Buckets > Create a Bucket. Nombre único (por ejemplo `lean-os-respaldo-tunombre`), Files in Bucket are: **Private**. Dejá el cifrado del lado de B2 y Object Lock apagados. Anotá el nombre.
3. Creá una application key **limitada a ese bucket**: Application Keys > Add a New Application Key. Nombre `lean-os`, Allow access to Bucket(s): elegí **solo ese bucket**, Type of Access: **Read and Write**. Copiá `keyID` (será `B2_KEY_ID`) y `applicationKey` (será `B2_APP_KEY`): la clave se muestra **una sola vez**.
4. Generá la clave de cifrado con el script (imprime una línea `RESPALDO_CLAVE=...`; la contraseña de la app se pide igual que en el paso 3 de arriba):
   ```
   node scripts/generar-secretos.ts --con-respaldo
   ```
   Tomá solo el valor de esa línea, lo que va después del signo igual (ya tenés los otros dos cargados; no hace falta volver a cargarlos).
5. **ADVERTENCIA: guardá `RESPALDO_CLAVE` aparte, ahora**, en tu gestor de contraseñas o en un papel, fuera de Fly. Sin esa clave los respaldos de B2 **no se pueden abrir, nunca**, y nadie puede recuperarla. Si la perdés, tenés que generar otra y los respaldos viejos quedan inservibles.
6. Cargalos en Fly (Linux/Mac/PowerShell; en Windows `cmd` poné cada `NOMBRE=valor` entre comillas dobles):
   ```
   fly secrets set --app lean-os B2_KEY_ID='<tu keyID>' B2_APP_KEY='<tu applicationKey>' B2_BUCKET='<nombre del bucket>' RESPALDO_CLAVE='<la clave del paso 4>'
   ```
   Comprobá los nombres: `fly secrets list --app lean-os`.
7. Activalo en la app: Ajustes > "Respaldo externo (opcional)" > **Activar** (hace falta tener la sesión iniciada). El estado debe pasar de "falta configurar" a "activo". Para probarlo sin esperar a la noche: **Respaldar ahora**; debe aparecer el último resultado con la fecha, y el archivo `lean-os-AAAA-MM-DD.json.enc` en el bucket.
8. Para desactivarlo: el mismo interruptor. No se borra nada del bucket.

### Restaurar desde B2

1. Entrá a B2 Cloud Storage > Buckets > tu bucket > Browse Files y descargá el `lean-os-AAAA-MM-DD.json.enc` que quieras.
2. Con el servidor **vacío** (o con `--reemplazar`, que pisa los datos y antes guarda una copia), corré con la clave guardada. Linux/Mac:
   ```
   RESPALDO_CLAVE='<la clave guardada>' node scripts/restaurar.ts lean-os-AAAA-MM-DD.json.enc
   ```
   Windows `cmd`:
   ```
   set RESPALDO_CLAVE=<la clave guardada>
   node scripts/restaurar.ts lean-os-AAAA-MM-DD.json.enc
   set RESPALDO_CLAVE=
   ```
   Con una clave equivocada no restaura nada y lo avisa. En Fly, el script corre dentro de la máquina (`fly ssh console`, con el archivo subido a `/data`); la guía de restauración general es la misma que para los `.json`.

## 5. Entrada por audio (opcional): Groq

Es opcional y viene **desactivada**. Si la activás, en la captura rápida de apuntes aparece un botón de micrófono: grabás una idea, el servidor manda el audio a Groq (modelo Whisper) para transcribirlo y el texto cae en la caja de captura para que lo revises y lo guardes vos. El audio **no se guarda** en ningún lado: el servidor lo descarta apenas responde. Sin activarla en Ajustes, o sin la clave, no sale ningún audio. La app funciona completa sin esto.

Secreto opcional: `GROQ_API_KEY`. Va a Fly; `.env.example` tiene el nombre vacío. La clave nunca llega al navegador ni al .exe: solo la usa el servidor.

1. Creá la cuenta en https://console.groq.com (hay plan gratuito; confirmá en la página qué te pide).
2. Creá la clave: en la consola, API Keys > Create API Key. Poné un nombre (por ejemplo `lean-os`) y copiala: se muestra **una sola vez**.
3. Cargala en Fly (Linux/Mac/PowerShell; en Windows `cmd` poné `GROQ_API_KEY=<tu clave>` entre comillas dobles):
   ```
   fly secrets set --app lean-os GROQ_API_KEY='<tu clave de Groq>'
   ```
   Comprobá el nombre: `fly secrets list --app lean-os`.
4. Activala en la app: Ajustes > "Entrada por audio (opcional)" > marcá el interruptor (hace falta tener la sesión iniciada). El estado debe pasar de "falta configurar" a "activo".
5. Para desactivarla: el mismo interruptor.

**Cuota gratuita:** el plan gratuito de Groq tiene un tope diario de uso. Si se agota, la app avisa "se agotó la cuota" y podés seguir escribiendo; se renueva solo con el tiempo. Pasar a un plan pago sería una decisión y un costo tuyos. Los límites exactos están en la página de Groq y pueden cambiar.

Cuando el micrófono funciona, el navegador te pide permiso la primera vez que tocás el botón.
