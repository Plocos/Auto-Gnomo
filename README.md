# Autonomous

Gestión centralizada de contabilidad y obligaciones fiscales para un trabajador autónomo en España.

**App offline** (Tauri + web local). Cada **perfil** es una carpeta en el PC: nombre + SQLite. Sin registro ni login. La primera vez creas o abres un perfil; al reiniciar se carga el último.

**Una única fuente de verdad:** los movimientos. Trimestres, Modelo 130, Modelo 303 y dashboards se calculan a partir de ellos.

## Stack

- **UI:** React + TypeScript + Vite + Tailwind (`apps/web`)
- **Lógica:** Node.js + Fastify + Zod (`apps/api`)
- **Datos:** SQLite en `{bóveda}/autonomous.db` + `vault.json`
- **Escritorio:** Tauri 2 (`apps/desktop`)
- **Monorepo:** pnpm workspaces

## Requisitos

- Node.js ≥ 22 (SQLite nativo)
- pnpm ≥ 9
- Rust (solo para empaquetar Tauri)

## Arranque rápido (dev navegador)

```bash
cp .env.example .env
pnpm install
pnpm migrate
pnpm seed
pnpm dev
```

- Web: http://localhost:5173
- API: http://localhost:3001
- Dev web: perfil en `./data` (`vault.json` + `autonomous.db`)

## App de escritorio

**Desarrollo** (necesitas Node/pnpm/Rust):

```bash
pnpm install
pnpm dev:desktop
```

**Instalador para el PC** (autocontenido: no hace falta Node en el cliente):

```bash
pnpm build:desktop
```

Genera un setup NSIS con la UI, WebView2 Fixed Runtime y la API embebida. Al abrir un perfil, la API arranca sola en segundo plano (`127.0.0.1:3001`) y usa la carpeta del perfil que elijas.

Abre o crea perfiles (carpetas). Las recientes se recuerdan. Puedes usar una carpeta de Drive; no abras la misma DB desde dos PCs a la vez. Actualizar el instalador **no** cambia ni borra tus bóvedas.

Si la app muestra datos vacíos y en Ajustes la carpeta de datos está en blanco, no crees un perfil nuevo: cierra la app, libera el puerto `3001` y reabre el perfil (ver [docs/BACKUPS.md](docs/BACKUPS.md)).

## Scripts

| Comando | Descripción |
|---|---|
| `pnpm dev` | API + Web (`./data`) |
| `pnpm dev:desktop` | App Tauri (dev) |
| `pnpm build:desktop` | Instalador Windows autocontenido |
| `pnpm migrate` / `pnpm seed` | Schema y datos de ejemplo |

## Backup

Copia la carpeta de la bóveda entera (con la app cerrada). Esa carpeta es tu guardado; el `.exe` solo la abre.

## Estructura

```
apps/web          Frontend
apps/api          API + SQLite
apps/desktop      Shell Tauri
packages/shared   Money, schemas Zod
packages/tax-rules Reglas AEAT
data/             Bóveda de desarrollo
```

## Responsabilidad

Autonomous asiste en el cálculo. La presentación ante AEAT la realiza el usuario.
