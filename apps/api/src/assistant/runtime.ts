import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AssistantProgress, AssistantStatus } from '@autonomous/shared';
import { env } from '../config.js';
import { downloadToFile } from './download.js';
import {
  HF_BASE,
  LLAMA_PORT,
  LLAMA_TAG,
  LLAMA_ZIP_NAME,
  LLAMA_ZIP_SHA256,
  LLAMA_ZIP_URL,
  MMPROJ_FILE,
  MMPROJ_MIN_BYTES,
  MODEL_FILE,
  MODEL_LABEL,
  MODEL_MIN_BYTES,
} from './catalog.js';

const execFileAsync = promisify(execFile);

type Listener = (status: AssistantStatus) => void;

const listeners = new Set<Listener>();

let downloading = false;
let loading = false;
let ready = false;
let installedCache = false;
let error: string | null = null;
let progress: AssistantProgress | null = null;
let child: ChildProcess | null = null;
let ownedPid: number | null = null;
let stderrTail = '';
let startPromise: Promise<void> | null = null;

function dir(): string {
  return env.assistantDir;
}

function runtimeDir(): string {
  return join(dir(), 'runtime');
}

function modelsDir(): string {
  return join(dir(), 'models');
}

function modelPath(): string {
  return join(modelsDir(), MODEL_FILE);
}

function mmprojPath(): string {
  return join(modelsDir(), MMPROJ_FILE);
}

function pidPath(): string {
  return join(dir(), 'server.pid');
}

/** Si cambia, el motor que ya esté en marcha se reinicia para aplicar los límites de imagen. */
const LAUNCH_STAMP = 'ctx=8192;image-min-tokens=4;image-max-tokens=768';

function launchStampPath(): string {
  return join(dir(), 'server.launch');
}

function manifestPath(): string {
  return join(dir(), 'manifest.json');
}

export function subscribeAssistant(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  const status = getAssistantStatus();
  for (const listener of listeners) {
    try {
      listener(status);
    } catch {
      listeners.delete(listener);
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function isGguf(path: string): Promise<boolean> {
  let fh: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fh = await open(path, 'r');
    const buf = Buffer.alloc(4);
    await fh.read(buf, 0, 4, 0);
    return buf.toString('utf8') === 'GGUF';
  } catch {
    return false;
  } finally {
    await fh?.close();
  }
}

async function dirBytes(path: string): Promise<number> {
  if (!(await pathExists(path))) return 0;
  const entries = await readdir(path, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const childPath = join(path, entry.name);
    if (entry.isDirectory()) total += await dirBytes(childPath);
    else total += await fileSize(childPath);
  }
  return total;
}

export async function modelInstalled(): Promise<boolean> {
  const modelOk = (await fileSize(modelPath())) >= MODEL_MIN_BYTES && (await isGguf(modelPath()));
  const projOk = (await fileSize(mmprojPath())) >= MMPROJ_MIN_BYTES && (await isGguf(mmprojPath()));
  const exe = await findServerBinary();
  return modelOk && projOk && Boolean(exe);
}

export function getAssistantStatus(): AssistantStatus {
  return {
    installed: installedCache,
    downloading,
    ready,
    loading,
    bytesOnDisk: 0,
    dir: dir(),
    progress,
    error,
    modelLabel: MODEL_LABEL,
  };
}

export async function readAssistantStatus(): Promise<AssistantStatus> {
  installedCache = await modelInstalled();
  if (!installedCache) ready = false;
  return {
    ...getAssistantStatus(),
    bytesOnDisk: await dirBytes(dir()).catch(() => 0),
  };
}

function setProgress(partial: AssistantProgress): void {
  progress = partial;
  emit();
}

const READ_STEPS = 4;

export function reportReadStep(step: number, label: string): void {
  if (downloading) return;
  progress = {
    label,
    received: step,
    total: READ_STEPS,
    percent: Math.round((step / READ_STEPS) * 100),
    fileIndex: step,
    fileCount: READ_STEPS,
  };
  emit();
}

export function clearReadStep(): void {
  if (downloading) return;
  progress = null;
  emit();
}

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function findServerBinary(): Promise<string | null> {
  const name = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const root = runtimeDir();
  if (!(await pathExists(root))) return null;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = join(current, entry.name);
      if (entry.isDirectory()) stack.push(next);
      else if (entry.name === name) return next;
    }
  }
  return null;
}

async function ensureRuntimeZip(): Promise<void> {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('La descarga del motor está preparada para Windows de 64 bits.');
  }
  const existing = await findServerBinary();
  if (existing) return;
  const zipPath = join(dir(), LLAMA_ZIP_NAME);
  setProgress({
    label: 'Descargando el motor local',
    received: 0,
    total: null,
    percent: null,
    fileIndex: 1,
    fileCount: 3,
  });
  await downloadToFile(LLAMA_ZIP_URL, zipPath, (received, total, note) => {
    setProgress({
      label: note ?? 'Descargando el motor local',
      received,
      total,
      percent: total ? Math.round((received / total) * 100) : null,
      fileIndex: 1,
      fileCount: 3,
    });
  });
  const digest = await sha256(zipPath);
  if (digest !== LLAMA_ZIP_SHA256) {
    await rm(zipPath, { force: true });
    throw new Error('El motor descargado no coincide con la versión esperada. Vuelve a intentarlo.');
  }
  await mkdir(runtimeDir(), { recursive: true });
  await execFileAsync('tar', ['-xf', zipPath, '-C', runtimeDir()]);
  await rm(zipPath, { force: true });
  if (!(await findServerBinary())) {
    throw new Error('El paquete del motor no incluye llama-server.');
  }
}

async function ensureWeight(file: string, minBytes: number, index: number, label: string): Promise<void> {
  const dest = join(modelsDir(), file);
  if ((await fileSize(dest)) >= minBytes && (await isGguf(dest))) return;
  await rm(dest, { force: true });
  await mkdir(modelsDir(), { recursive: true });
  setProgress({ label, received: 0, total: null, percent: null, fileIndex: index, fileCount: 3 });
  await downloadToFile(`${HF_BASE}/${file}`, dest, (received, total, note) => {
    setProgress({
      label: note ?? label,
      received,
      total,
      percent: total ? Math.round((received / total) * 100) : null,
      fileIndex: index,
      fileCount: 3,
    });
  });
  if ((await fileSize(dest)) < minBytes || !(await isGguf(dest))) {
    await rm(dest, { force: true });
    throw new Error(`«${file}» no se descargó completo. Vuelve a intentarlo.`);
  }
}

async function writeManifest(): Promise<void> {
  await writeFile(
    manifestPath(),
    JSON.stringify(
      {
        runtimeTag: LLAMA_TAG,
        modelFile: MODEL_FILE,
        mmprojFile: MMPROJ_FILE,
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

let installTask: Promise<void> | null = null;

export function beginInstall(force: boolean): void {
  if (downloading) return;
  downloading = true;
  error = null;
  progress = {
    label: 'Preparando la descarga',
    received: 0,
    total: null,
    percent: null,
    fileIndex: 0,
    fileCount: 3,
  };
  emit();
  installTask = runInstall(force)
    .catch((err: unknown) => {
      error = err instanceof Error ? err.message : String(err);
    })
    .finally(() => {
      downloading = false;
      progress = null;
      installTask = null;
      emit();
    });
}

async function runInstall(force: boolean): Promise<void> {
  await mkdir(dir(), { recursive: true });
  if (force) {
    stopAssistantRuntime();
    installedCache = false;
    await rm(runtimeDir(), { recursive: true, force: true });
    await rm(modelPath(), { force: true });
    await rm(`${modelPath()}.part`, { force: true });
    await rm(mmprojPath(), { force: true });
    await rm(`${mmprojPath()}.part`, { force: true });
    await rm(join(dir(), LLAMA_ZIP_NAME), { force: true });
    await rm(join(dir(), `${LLAMA_ZIP_NAME}.part`), { force: true });
    await rm(manifestPath(), { force: true });
  }
  await ensureRuntimeZip();
  await ensureWeight(MODEL_FILE, MODEL_MIN_BYTES, 2, 'Descargando el modelo (unos 5 GB)');
  await ensureWeight(MMPROJ_FILE, MMPROJ_MIN_BYTES, 3, 'Descargando el lector de imágenes');
  await writeManifest();
  installedCache = true;
}

export function installInFlight(): Promise<void> | null {
  return installTask;
}

export async function removeAssistantModel(): Promise<void> {
  if (downloading) throw new Error('Espera a que termine la descarga.');
  const pid = child?.pid ?? ownedPid ?? (await readPid());
  stopAssistantRuntime();
  const deadline = Date.now() + 8000;
  while (pid && alive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  installedCache = false;
  ready = false;
  error = null;
  await rm(modelPath(), { force: true });
  await rm(mmprojPath(), { force: true });
  await rm(runtimeDir(), { recursive: true, force: true });
  await rm(manifestPath(), { force: true });
  await rm(pidPath(), { force: true });
  emit();
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readPid(): Promise<number | null> {
  try {
    const raw = await readFile(pidPath(), 'utf8');
    const pid = Number(raw.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

let stopping = false;

export function stopAssistantRuntime(extraPid?: number | null): void {
  const pid = extraPid ?? child?.pid ?? ownedPid;
  stopping = true;
  child = null;
  ownedPid = null;
  ready = false;
  loading = false;
  if (!pid) {
    stopping = false;
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* ya cerrado */
    }
  }
  void rm(pidPath(), { force: true });
}

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${LLAMA_PORT}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitUntilReady(pid: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    if (await healthy()) {
      ready = true;
      loading = false;
      error = null;
      emit();
      return;
    }
    if (!alive(pid)) {
      throw new Error(`El motor se cerró al cargar el modelo. ${stderrTail.slice(-400)}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('El modelo tardó demasiado en cargarse.');
}

async function launchMatches(): Promise<boolean> {
  try {
    return (await readFile(launchStampPath(), 'utf8')).trim() === LAUNCH_STAMP;
  } catch {
    return false;
  }
}

async function waitUntilStopped(pid: number | null): Promise<void> {
  if (!pid) return;
  const deadline = Date.now() + 8000;
  while (alive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function spawnServer(): Promise<void> {
  const exe = await findServerBinary();
  if (!exe) throw new Error('Falta el motor local. Descárgalo de nuevo.');
  stderrTail = '';
  const proc = spawn(
    exe,
    [
      '-m',
      modelPath(),
      '--mmproj',
      mmprojPath(),
      '-c',
      '8192',
      '--image-min-tokens',
      '4',
      '--image-max-tokens',
      '768',
      '--host',
      '127.0.0.1',
      '--port',
      String(LLAMA_PORT),
      '-ngl',
      '99',
    ],
    { cwd: join(exe, '..'), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  child = proc;
  ownedPid = proc.pid ?? null;
  if (ownedPid) await writeFile(pidPath(), String(ownedPid));
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-4000);
  });
  proc.on('exit', (code) => {
    if (child === proc) {
      child = null;
      ownedPid = null;
      ready = false;
      loading = false;
      if (!stopping) {
        error = `El motor se cerró (código ${code ?? '?'}). ${stderrTail.slice(-400)}`.trim();
      }
      emit();
    }
    stopping = false;
  });
  if (!ownedPid) throw new Error('No se pudo arrancar el motor local.');
  await writeFile(launchStampPath(), LAUNCH_STAMP);
  await waitUntilReady(ownedPid);
}

export async function ensureRuntime(): Promise<void> {
  if (!(await modelInstalled())) {
    throw new Error('Descarga el modelo antes de leer documentos.');
  }
  if (ready && (await healthy()) && (await launchMatches())) return;
  if (!startPromise) {
    loading = true;
    error = null;
    emit();
    startPromise = (async () => {
      const runningPid = child?.pid ?? ownedPid ?? (await readPid());
      if ((await healthy()) && (await launchMatches())) {
        ready = true;
        loading = false;
        emit();
        return;
      }
      if (runningPid && alive(runningPid)) {
        stopAssistantRuntime(runningPid);
        await waitUntilStopped(runningPid);
      }
      await spawnServer();
    })()
      .catch((err: unknown) => {
        ready = false;
        error = err instanceof Error ? err.message : String(err);
        throw err;
      })
      .finally(() => {
        startPromise = null;
        loading = false;
        emit();
      });
  }
  await startPromise;
  if (!ready) throw new Error(error ?? 'El modelo no llegó a arrancar.');
}

type ImagePart = { mime: string; base64: string };

export async function chatVision(system: string, userText: string, images: ImagePart[]): Promise<string> {
  reportReadStep(2, 'Cargando el modelo');
  await ensureRuntime();
  reportReadStep(3, 'Leyendo el documento');
  const content: unknown[] = [{ type: 'text', text: userText }];
  for (const image of images) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${image.mime};base64,${image.base64}` },
    });
  }
  return postChat(system, [{ role: 'user', content }], true);
}

export async function chatText(
  system: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  reportReadStep(2, 'Cargando el modelo');
  await ensureRuntime();
  reportReadStep(3, 'Respondiendo');
  return postChat(system, messages, false);
}

async function postChat(
  system: string,
  messages: { role: 'user' | 'assistant'; content: unknown }[],
  withFormat: boolean,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: MODEL_LABEL,
    temperature: withFormat ? 0 : 0.2,
    max_tokens: withFormat ? 4096 : 2048,
    messages: [{ role: 'system', content: system }, ...messages],
  };
  if (withFormat) body.response_format = { type: 'json_object' };
  const res = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    if (withFormat && res.status === 400) return postChat(system, messages, false);
    if (/mtmd/i.test(detail)) {
      throw new Error('No se pudo leer la imagen. Prueba con una foto más nítida o con menos páginas.');
    }
    throw new Error(`El modelo respondió ${res.status}. ${detail}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = json.choices?.[0]?.message?.content;
  if (!text?.trim()) throw new Error('El modelo no devolvió texto.');
  return text;
}
