#!/usr/bin/env node
/**
 * Prepara Node portable + API en un solo bundle ESM para Tauri (Windows x64).
 * Evita node_modules profundos que rompen NSIS (MAX_PATH).
 * Salida: apps/desktop/src-tauri/api-runtime/{node.exe,app/server.mjs}
 */
import { execSync } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  cpSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, '..');
const repoRoot = join(desktopRoot, '../..');
const srcTauri = join(desktopRoot, 'src-tauri');
const outDir = join(srcTauri, 'api-runtime');
const appDir = join(outDir, 'app');
const cacheDir = join(srcTauri, '.api-runtime-cache');

const NODE_VERSION = process.env.AUTONOMOUS_NODE_VERSION ?? '22.14.0';
const NODE_ZIP = `node-v${NODE_VERSION}-win-x64.zip`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}`;
const FORCE = process.argv.includes('--force');

function run(cmd, cwd = repoRoot) {
  console.log('>', cmd);
  execSync(cmd, { cwd, stdio: 'inherit', env: process.env, shell: true });
}

async function download(url, dest) {
  console.log('Descargando', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  await pipeline(res.body, createWriteStream(dest));
}

function extractZip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  const ps = `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`, {
    stdio: 'inherit',
  });
}

function findNodeExe(extractedRoot) {
  for (const name of readdirSync(extractedRoot)) {
    const candidate = join(extractedRoot, name, 'node.exe');
    if (existsSync(candidate)) return candidate;
  }
  const direct = join(extractedRoot, 'node.exe');
  if (existsSync(direct)) return direct;
  throw new Error(`No se encontró node.exe en ${extractedRoot}`);
}

async function ensureNodeExe(targetExe) {
  if (!FORCE && existsSync(targetExe) && statSync(targetExe).size > 1_000_000) {
    console.log('node.exe ya presente');
    return;
  }
  mkdirSync(cacheDir, { recursive: true });
  const zipPath = join(cacheDir, NODE_ZIP);
  if (FORCE || !existsSync(zipPath)) {
    await download(NODE_URL, zipPath);
  } else {
    console.log('Usando zip en caché', zipPath);
  }
  const extractTo = join(cacheDir, `node-v${NODE_VERSION}-win-x64-extract`);
  if (existsSync(extractTo)) rmSync(extractTo, { recursive: true, force: true });
  extractZip(zipPath, extractTo);
  const srcExe = findNodeExe(extractTo);
  mkdirSync(dirname(targetExe), { recursive: true });
  cpSync(srcExe, targetExe);
  console.log('Copiado node.exe →', targetExe);
}

async function main() {
  console.log('Preparando api-runtime en', outDir);

  run('pnpm --filter @autonomous/shared build');
  run('pnpm --filter @autonomous/tax-rules build');
  run('pnpm --filter @autonomous/api build');

  if (existsSync(appDir)) rmSync(appDir, { recursive: true, force: true });
  mkdirSync(appDir, { recursive: true });

  const entry = join(repoRoot, 'apps/api/dist/index.js').replace(/\\/g, '/');
  const outfile = join(appDir, 'server.mjs').replace(/\\/g, '/');

  // Bundle único: sin árbol node_modules (NSIS + MAX_PATH).
  const esbuildCandidates = [
    join(desktopRoot, 'node_modules/.bin/esbuild.CMD'),
    join(desktopRoot, 'node_modules/.bin/esbuild'),
    join(desktopRoot, 'node_modules/esbuild/bin/esbuild'),
    join(repoRoot, 'node_modules/.bin/esbuild.CMD'),
    join(repoRoot, 'node_modules/.bin/esbuild'),
  ];
  const esbuildBin = esbuildCandidates.find((p) => existsSync(p));
  if (!esbuildBin) {
    throw new Error(
      'No se encontró esbuild. Desde la raíz: pnpm install (devDependency de @autonomous/desktop).',
    );
  }
  const quote = (p) => `"${p.replace(/\\/g, '/')}"`;
  run(
    `${quote(esbuildBin)} ${quote(entry)} --bundle --platform=node --format=esm --packages=bundle --outfile=${quote(outfile)} --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"`,
  );

  if (!existsSync(join(appDir, 'server.mjs'))) {
    throw new Error('No se generó server.mjs');
  }

  writeFileSync(
    join(appDir, 'package.json'),
    JSON.stringify({ name: 'autonomous-api-runtime', type: 'module', private: true }, null, 2),
    'utf8',
  );

  await ensureNodeExe(join(outDir, 'node.exe'));

  writeFileSync(
    join(outDir, 'READY'),
    JSON.stringify(
      {
        nodeVersion: NODE_VERSION,
        entry: 'app/server.mjs',
        preparedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log('api-runtime listo (bundle ESM).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
