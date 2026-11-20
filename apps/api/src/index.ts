import cors from '@fastify/cors';
import Fastify from 'fastify';
import { env } from './config.js';
import { runMigrations } from './db/migrate.js';
import { closeSqlite, connectSqlite } from './db/sqlite.js';
import { isProfileDir, upgradeLegacyVaultMeta } from './db/vault.js';
import { errorHandler } from './plugins/error-handler.js';
import { stopAssistantRuntime } from './assistant/runtime.js';
import { registerRoutes } from './routes/index.js';

if (process.env.AG_PDF_WORKER === '1') {
  const { runPdfRenderWorker } = await import('./assistant/preprocess.js');
  try {
    await runPdfRenderWorker();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: env.corsOrigin === '*' ? true : env.corsOrigin,
    credentials: true,
  });

  app.setErrorHandler(errorHandler);

  const db = connectSqlite(env.dataDir);
  runMigrations(db);
  if (isProfileDir(env.dataDir)) {
    upgradeLegacyVaultMeta(env.dataDir);
  } else {
    console.warn(
      `DATA_DIR «${env.dataDir}» no es aún un perfil Auto-Gnomo (sin vault.json válido).`,
    );
  }
  await registerRoutes(app);

  const shutdown = async () => {
    stopAssistantRuntime();
    await app.close();
    closeSqlite();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ host: env.host, port: env.port });
  console.log(`API listening on http://${env.host}:${env.port}`);
  console.log(`Data directory: ${env.dataDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
