# Autonomous

Gestión centralizada de contabilidad y obligaciones fiscales para un trabajador autónomo en España.

**Aplicación de escritorio**, offline. Cada **perfil** es una carpeta en el PC: nombre + SQLite. Sin registro ni login. La primera vez creas o abres un perfil; al reiniciar se carga el último.

**Una única fuente de verdad:** los movimientos. Trimestres, Modelo 130, Modelo 303 y dashboards se calculan a partir de ellos.

## Stack

- **Ventana:** Tauri 2 (`apps/desktop`)
- **Interfaz:** React + TypeScript + Vite + Tailwind, solo dentro de esa ventana (`apps/web`)
- **Lógica:** Node.js + Fastify + Zod (`apps/api`), en local
- **Datos:** SQLite en `{bóveda}/autonomous.db` + `vault.json`
- **Monorepo:** pnpm workspaces

## Requisitos

- Node.js ≥ 22 (SQLite nativo)
- pnpm ≥ 9
- Rust (en el PATH, para la ventana de escritorio)

## Arranque

```bash
pnpm install
pnpm dev
```

Se abre la ventana de Auto-Gnomo. Al elegir un perfil, la API arranca sola en `127.0.0.1:3001`.

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
| `pnpm dev` | App de escritorio (desarrollo) |
| `pnpm build:desktop` | Instalador Windows autocontenido |
| `pnpm dev:api` | API suelta, sin ventana (bóveda en `./data`) |
| `pnpm migrate` / `pnpm seed` | Schema y datos de ejemplo de esa bóveda |

## Backup

Copia la carpeta de la bóveda entera (con la app cerrada). Esa carpeta es tu guardado; el `.exe` solo la abre.

## Estructura

```
apps/desktop      Ventana Tauri
apps/web          Interfaz de esa ventana
apps/api          API + SQLite
packages/shared   Money, schemas Zod
packages/tax-rules Reglas AEAT
data/             Bóveda de `pnpm dev:api`
```

## Responsabilidad

Autonomous asiste en el cálculo. La presentación ante AEAT la realiza el usuario.
