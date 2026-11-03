# Backups

Cada **bóveda** es una carpeta con:

- `vault.json` — nombre del perfil
- `autonomous.db` (+ WAL/SHM si existen)
- `documents/` — adjuntos

Esa carpeta es el archivo de guardado. Instalar, actualizar o reinstalar Auto-Gnomo **no** mueve ni regenera la bóveda: el programa solo recibe la ruta (`DATA_DIR`) y abre el SQLite existente (migraciones idempotentes).

Cierra la app antes de copiar. Puedes sincronizar la carpeta con Drive; no abras la misma bóveda desde dos PCs a la vez.

## Perfil «vacío» o carpeta de datos en blanco

Si Auto-Gnomo carga el perfil pero las pantallas salen vacías y en Ajustes la **carpeta de datos** está en blanco, los archivos suelen seguir en disco: la API en el puerto `3001` se ha quedado colgada (SQLite + Drive) o hay una instancia huérfana.

Pasos:

1. Cierra Auto-Gnomo por completo.
2. Libera el puerto `3001` (PowerShell):

```powershell
Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { taskkill /F /T /PID $_.OwningProcess }
```

3. Vuelve a abrir con `pnpm dev:desktop` y elige el perfil reciente (p. ej. `G:\Mi unidad\Auto-Gnomo\Antonio`).
4. Comprueba en Ajustes que la ruta es la de Drive y que los movimientos reaparecen.

**No** crees un perfil nuevo con el mismo nombre encima de la carpeta buena: eso genera una DB vacía y confunde la lista de recientes.

La carpeta `./data` del monorepo es solo para `pnpm dev` (navegador); no es la bóveda de escritorio.
