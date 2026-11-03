import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
/** Monorepo root en desarrollo; en el bundle empaquetado puede no existir. */
const repoRoot = resolve(__dirname, '../../..');
config({ path: resolve(repoRoot, '.env') });

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.API_HOST ?? '127.0.0.1',
  port: Number(process.env.API_PORT ?? 3001),
  // En escritorio Tauri siempre pasa DATA_DIR (carpeta del perfil del usuario).
  dataDir: process.env.DATA_DIR ?? resolve(repoRoot, 'data'),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
};
