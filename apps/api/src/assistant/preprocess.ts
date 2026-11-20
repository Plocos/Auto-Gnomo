import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanvas, DOMMatrix, Path2D } from '@napi-rs/canvas';
import sharp from 'sharp';
import { MAX_PAGES } from './catalog.js';

const require = createRequire(import.meta.url);

export type PreparedPage = {
  filename: string;
  page: number;
  mime: 'image/jpeg';
  bytes: Buffer;
};

export type PreparedDocument = {
  pageCount: number;
  truncated: boolean;
  text: string;
  pages: PreparedPage[];
  warnings: string[];
};

type PdfItem = { str?: string };
type PdfPage = {
  getTextContent: () => Promise<{ items: PdfItem[] }>;
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: { canvasContext: unknown; viewport: unknown }) => { promise: Promise<void> };
};
type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy?: () => Promise<void> | void;
};

let pdfjsReady: Promise<{
  getDocument: (src: Record<string, unknown>) => { promise: Promise<PdfDoc> };
}> | null = null;

function ensureDom(): void {
  const g = globalThis as unknown as { DOMMatrix?: unknown; Path2D?: unknown };
  if (!g.DOMMatrix) g.DOMMatrix = DOMMatrix;
  if (!g.Path2D) g.Path2D = Path2D;
}

function standardFontsDir(): string {
  const sample = require.resolve('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf');
  return path.join(path.dirname(sample), path.sep);
}

async function loadPdfjs(): Promise<{
  getDocument: (src: Record<string, unknown>) => { promise: Promise<PdfDoc> };
}> {
  if (!pdfjsReady) {
    pdfjsReady = (async () => {
      ensureDom();
      const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as {
        getDocument: (src: Record<string, unknown>) => { promise: Promise<PdfDoc> };
        GlobalWorkerOptions: { workerSrc: string };
      };
      const worker = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
      return pdfjs;
    })();
  }
  return pdfjsReady;
}

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export function sniffMime(filename: string, declared: string): string | null {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const byExt: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    pdf: 'application/pdf',
  };
  const fromExt = byExt[ext];
  if (ALLOWED.has(declared)) return declared;
  if (fromExt) return fromExt;
  return null;
}

async function toJpeg(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

export async function prepareDocument(
  filename: string,
  mime: string,
  bytes: Buffer,
): Promise<PreparedDocument> {
  if (!bytes.length) throw new Error(`«${filename}» está vacío.`);
  if (mime === 'application/pdf') return preparePdf(filename, bytes);
  if (mime.startsWith('image/')) {
    const jpeg = await toJpeg(bytes);
    return {
      pageCount: 1,
      truncated: false,
      text: '',
      warnings: [],
      pages: [{ filename, page: 1, mime: 'image/jpeg', bytes: jpeg }],
    };
  }
  throw new Error(`«${filename}» no es una imagen ni un PDF.`);
}

async function preparePdf(filename: string, bytes: Buffer): Promise<PreparedDocument> {
  const pdfjs = await loadPdfjs();
  let doc: PdfDoc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      disableFontFace: true,
      standardFontDataUrl: standardFontsDir(),
    }).promise;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/password/i.test(message)) {
      throw new Error(`«${filename}» está protegido con contraseña.`);
    }
    throw new Error(`No se pudo abrir «${filename}».`);
  }

  try {
    const total = doc.numPages;
    const truncated = total > MAX_PAGES;
    const limit = Math.min(total, MAX_PAGES);
    const texts: string[] = [];
    const pages: PreparedPage[] = [];
    const warnings: string[] = [];
    if (truncated) warnings.push(`«${filename}» tiene ${total} páginas; solo se leyeron las ${MAX_PAGES} primeras.`);

    for (let n = 1; n <= limit; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => item.str ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) texts.push(text);
    }

    const rendered = process.env.VITEST
      ? await renderPdfBytes(bytes, filename)
      : await renderPdfIsolated(bytes, filename);
    pages.push(...rendered.pages);
    warnings.push(...rendered.warnings);

    const joined = texts.join('\n').slice(0, 8000);
    if (!joined && pages.length === 0) {
      throw new Error(`«${filename}» no tiene texto legible y no se pudo convertir a imagen.`);
    }
    return { pageCount: total, truncated, text: joined, pages, warnings };
  } finally {
    await doc.destroy?.();
  }
}

export async function renderPdfBytes(
  bytes: Buffer,
  filename: string,
): Promise<{ pages: PreparedPage[]; warnings: string[] }> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: standardFontsDir(),
  }).promise;
  const pages: PreparedPage[] = [];
  const warnings: string[] = [];
  try {
    const limit = Math.min(doc.numPages, MAX_PAGES);
    for (let n = 1; n <= limit; n += 1) {
      try {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 1600 / Math.max(base.width, base.height, 1));
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport }).promise;
        const jpeg = await toJpeg(canvas.toBuffer('image/png'));
        pages.push({ filename, page: n, mime: 'image/jpeg', bytes: jpeg });
      } catch {
        warnings.push(`No se pudo convertir la página ${n} de «${filename}» a imagen.`);
      }
    }
  } finally {
    await doc.destroy?.();
  }
  return { pages, warnings };
}

type RenderResult = { pages: { page: number; file: string }[]; warnings: string[] };

export async function runPdfRenderWorker(): Promise<void> {
  const input = process.env.AG_PDF_IN;
  const outDir = process.env.AG_PDF_OUT;
  if (!input || !outDir) throw new Error('Faltan las rutas del PDF.');
  const bytes = await readFile(input);
  const rendered = await renderPdfBytes(bytes, path.basename(input));
  const pages: { page: number; file: string }[] = [];
  for (const page of rendered.pages) {
    const file = `${page.page}.jpg`;
    await writeFile(path.join(outDir, file), page.bytes);
    pages.push({ page: page.page, file });
  }
  const result: RenderResult = { pages, warnings: rendered.warnings };
  await writeFile(path.join(outDir, 'result.json'), JSON.stringify(result));
}

function workerLaunch(): string[] {
  const self = fileURLToPath(import.meta.url);
  if (self.endsWith('server.mjs')) return [process.execPath, self];
  const entry = fileURLToPath(new URL(self.endsWith('.ts') ? '../index.ts' : '../index.js', import.meta.url));
  if (entry.endsWith('.ts')) {
    const preflight = require.resolve('tsx/dist/preflight.cjs');
    const loader = pathToFileURL(require.resolve('tsx/dist/loader.mjs')).href;
    return [process.execPath, '--require', preflight, '--import', loader, entry];
  }
  return [process.execPath, entry];
}

async function renderPdfIsolated(
  bytes: Buffer,
  filename: string,
): Promise<{ pages: PreparedPage[]; warnings: string[] }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ag-pdf-'));
  const warning = `No se pudo convertir «${filename}» a imagen. Se leerá el texto del PDF.`;
  try {
    const input = path.join(dir, 'input.pdf');
    await writeFile(input, bytes);
    const launch = workerLaunch();
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(launch[0] ?? process.execPath, launch.slice(1), {
        env: { ...process.env, AG_PDF_WORKER: '1', AG_PDF_IN: input, AG_PDF_OUT: dir },
        windowsHide: true,
        stdio: 'ignore',
      });
      const timer = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 45_000);
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on('exit', (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    let parsed: RenderResult | null = null;
    try {
      parsed = JSON.parse(await readFile(path.join(dir, 'result.json'), 'utf8')) as RenderResult;
    } catch {
      parsed = null;
    }
    if (!parsed) return { pages: [], warnings: [warning] };
    const pages: PreparedPage[] = [];
    for (const item of parsed.pages) {
      const jpeg = await readFile(path.join(dir, item.file));
      pages.push({ filename, page: item.page, mime: 'image/jpeg', bytes: jpeg });
    }
    if (code !== 0 && pages.length === 0) return { pages: [], warnings: [warning, ...parsed.warnings] };
    return { pages, warnings: parsed.warnings };
  } catch {
    return { pages: [], warnings: [warning] };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
