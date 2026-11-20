# Autonomous Desktop (Tauri)

Shell de escritorio que:

1. Pide/guarda la carpeta de datos (perfil = bóveda en disco)
2. Arranca la API local en segundo plano (sin ventana)
3. Carga la UI de `@autonomous/web`
4. Comprueba actualizaciones firmadas vía GitHub Releases

## Usuario final

Instala el `.exe` NSIS (`pnpm build:desktop` lo genera). No hace falta Node ni pnpm en el PC.

Al abrir un perfil se usa la **misma carpeta** de siempre (`vault.json` + `autonomous.db`). Reinstalar o actualizar el programa no mueve ni borra esa carpeta.

En **Configuración → Actualizaciones** (o con el aviso al arrancar) la app descarga el instalador firmado desde GitHub Releases, lo aplica y se reinicia.

## Desarrollo

Desde la raíz del monorepo:

```bash
pnpm install
pnpm dev:desktop
```

Requisitos: Node ≥ 22, pnpm ≥ 9 y Rust en el PATH. En dev la API se lanza con `pnpm`/`tsx` contra el monorepo.

## Claves de firma (updater)

El updater de Tauri **siempre** verifica firma. Generar el par **una sola vez** (ya generado en esta máquina de desarrollo):

```powershell
npx --yes @tauri-apps/cli@2 signer generate -w "$env:USERPROFILE\.tauri\autognomo.key" --ci
```

| Archivo | Uso |
|---------|-----|
| `%USERPROFILE%\.tauri\autognomo.key.pub` | Contenido en `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` (seguro en el repo) |
| `%USERPROFILE%\.tauri\autognomo.key` | **Privada.** Nunca al repo. Solo en tu PC o secretos de CI |

Si pierdes la privada, los clientes ya instalados **no** podrán actualizar con una clave nueva.

Variables al firmar el build:

- `TAURI_SIGNING_PRIVATE_KEY` — contenido de la clave o ruta al fichero
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — solo si la clave tiene contraseña

## Instalador (Windows)

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\autognomo.key" -Raw
pnpm build:desktop
```

Eso:

1. Prepara `src-tauri/api-runtime` (Node 22 portable + API desplegada)
2. Descarga WebView2 Fixed Runtime (si falta)
3. Ejecuta `tauri build` → NSIS + artefactos de updater (`.nsis.zip` + `.sig`)

El instalador lleva WebView2 Fixed Runtime (~190 MB o más). Las actualizaciones también son grandes: es esperado.

Artefactos típicos:

- `…/bundle/nsis/Auto-Gnomo_<ver>_x64-setup.exe` — instalación limpia
- `…/bundle/nsis/Auto-Gnomo_<ver>_x64-setup.nsis.zip` + `.sig` — updater

## Checklist de release (GitHub Releases)

Endpoint de la app:

`https://github.com/Plocos/Auto-Gnomo/releases/latest/download/latest.json`

Los assets deben ser **descargables sin autenticación** (repo público o releases/assets públicos).

1. Subir la misma semver en:
   - `apps/desktop/src-tauri/tauri.conf.json` → `version`
   - `apps/desktop/src-tauri/Cargo.toml` → `version`
   - `apps/desktop/package.json` → `version`
2. Exportar la clave privada en la sesión (ver arriba) y ejecutar `pnpm build:desktop`.
3. Crear un GitHub Release con tag `vX.Y.Z`.
4. Subir el `.exe`, el `.nsis.zip`, el `.sig` y un `latest.json`:

```json
{
  "version": "0.2.0",
  "notes": "Qué cambia…",
  "pub_date": "2026-11-03T18:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contenido íntegro del fichero .sig>",
      "url": "https://github.com/Plocos/Auto-Gnomo/releases/download/v0.2.0/Auto-Gnomo_0.2.0_x64-setup.nsis.zip"
    }
  }
}
```

5. Probar: app con versión anterior → Configuración → Buscar actualizaciones → Instalar → reinicio → nueva versión.

CI/CD automático de releases queda fuera de este flujo manual.
