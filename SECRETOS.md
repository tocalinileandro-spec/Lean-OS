# Secretos: cómo cargarlos

Lean OS usa cuatro secretos (sección 7 de `docs/VISION.md`). Ninguno va al repositorio: se cargan una sola vez en los lugares de esta guía. `.env` ya está en `.gitignore` y `.env.example` tiene solo los nombres.

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
