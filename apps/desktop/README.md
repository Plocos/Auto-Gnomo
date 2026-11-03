# Autonomous Desktop (Tauri)

Shell de escritorio que:

1. Pide/guarda la carpeta de datos (perfil = bóveda en disco)
2. Arranca la API local en segundo plano (sin ventana)
3. Carga la UI de `@autonomous/web`

## Usuario final

Instala el `.exe` NSIS (`pnpm build:desktop` lo genera). No hace falta Node ni pnpm en el PC.

Al abrir un perfil se usa la **misma carpeta** de siempre (`vault.json` + `autonomous.db`). Reinstalar o actualizar el programa no mueve ni borra esa carpeta.

## Desarrollo

Desde la raíz del monorepo:

```bash
pnpm install
pnpm dev:desktop
```

Requisitos: Node ≥ 22, pnpm ≥ 9 y Rust en el PATH. En dev la API se lanza con `pnpm`/`tsx` contra el monorepo.

## Instalador (Windows)

```bash
pnpm build:desktop
```

Eso:

1. Prepara `src-tauri/api-runtime` (Node 22 portable + API desplegada)
2. Descarga WebView2 Fixed Runtime (si falta)
3. Ejecuta `tauri build` → NSIS

Artefacto típico: `apps/desktop/src-tauri/target/release/bundle/nsis/Auto-Gnomo_*_x64-setup.exe`
