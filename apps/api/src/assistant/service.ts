import {
  AppError,
  ErrorCodes,
  assistantAcceptSchema,
  assistantFileSchema,
  assistantImportSchema,
  assistantMessageSchema,
  assistantProposalSchema,
  movementCreateSchema,
  type AssistantAcceptInput,
  type AssistantFile,
  type AssistantImport,
  type AssistantMessage,
  type AssistantProposal,
  type MovementCreateInput,
} from '@autonomous/shared';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { newId, nowIso } from '../db/schema.js';
import type { AppDb } from '../db/sqlite.js';
import { getDataDir } from '../db/sqlite.js';
import { createAssetFromMovement } from '../domain/assets.js';
import { parseImportText } from '../domain/import-export.js';
import { createMovement, deleteMovement } from '../domain/movements.js';
import { buildChatContext, chatPrompt } from './chat.js';
import { MAX_IMAGES } from './catalog.js';
import { loadPromptContext } from './context.js';
import { applyPartyHistory } from './history.js';
import { constrainCategory, extractJsonObject, normalizeModelOutput } from './parse.js';
import { prepareDocument, sniffMime } from './preprocess.js';
import { contextBlock, repairPrompt, systemPrompt } from './prompt.js';
import { reviewProposal } from './review.js';
import { chatText, chatVision, clearReadStep, reportReadStep } from './runtime.js';

export type Upload = { filename: string; mime: string; buffer: Buffer };

type ThreadMode = 'chat' | 'invoice';

type ThreadRow = {
  id: string;
  title: string | null;
  mode?: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  files_json: string;
  proposals_json: string;
  summary: string | null;
  warnings_json: string;
  import_json?: string | null;
  reply_to_id: string | null;
  created_at: string;
};

function parseList<T>(raw: string, schema: { parse: (value: unknown) => T }, fallback: T[]): T[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return fallback;
    return value.map((item) => schema.parse(item));
  } catch {
    return fallback;
  }
}

function parseImportPreview(raw: string | null | undefined): AssistantImport | undefined {
  if (!raw) return undefined;
  try {
    const parsed = assistantImportSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function toMessage(row: MessageRow): AssistantMessage {
  return assistantMessageSchema.parse({
    id: row.id,
    threadId: row.thread_id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    files: parseList(row.files_json, assistantFileSchema, []),
    proposals: parseList(row.proposals_json, assistantProposalSchema, []),
    summary: row.summary ?? undefined,
    warnings: parseList(row.warnings_json, { parse: (v: unknown) => String(v) }, []),
    importPreview: parseImportPreview(row.import_json),
    replyToId: row.reply_to_id ?? undefined,
    createdAt: row.created_at,
  });
}

function safeName(filename: string): string {
  const base = basename(filename).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  return base || 'documento';
}

function insideDataDir(relativePath: string): string {
  const root = resolve(getDataDir());
  const full = resolve(root, relativePath);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Ruta de documento no válida.', 400);
  }
  return full;
}

function workingQuarter(db: AppDb): string | undefined {
  const row = db.prepare(`SELECT working_quarter, active_fiscal_year FROM app_settings WHERE key = 'main'`).get() as
    | { working_quarter: string | null; active_fiscal_year: number | null }
    | undefined;
  return row?.working_quarter ?? undefined;
}

function activeYear(db: AppDb): number {
  const row = db.prepare(`SELECT active_fiscal_year FROM app_settings WHERE key = 'main'`).get() as
    | { active_fiscal_year: number | null }
    | undefined;
  return row?.active_fiscal_year ?? new Date().getUTCFullYear();
}

function threadMode(row: { mode?: string | null }): ThreadMode {
  return row.mode === 'chat' ? 'chat' : 'invoice';
}

export function listThreads(
  db: AppDb,
  mode?: ThreadMode,
): { id: string; title: string | null; updatedAt: string; mode: ThreadMode }[] {
  const rows = (
    mode
      ? db
          .prepare(
            `SELECT id, title, mode, updated_at FROM assistant_threads WHERE mode = ? ORDER BY updated_at DESC LIMIT 20`,
          )
          .all(mode)
      : db
          .prepare(`SELECT id, title, mode, updated_at FROM assistant_threads ORDER BY updated_at DESC LIMIT 20`)
          .all()
  ) as Pick<ThreadRow, 'id' | 'title' | 'mode' | 'updated_at'>[];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
    mode: threadMode(row),
  }));
}

export function createThread(db: AppDb, mode: ThreadMode = 'invoice'): { id: string; mode: ThreadMode } {
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO assistant_threads (id, title, mode, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)`,
  ).run(id, mode, now, now);
  return { id, mode };
}

export function getThread(db: AppDb, threadId: string): {
  thread: { id: string; title: string | null; updatedAt: string; mode: ThreadMode };
  messages: AssistantMessage[];
  categories: { key: string; name: string; type: string }[];
} {
  const thread = db.prepare(`SELECT * FROM assistant_threads WHERE id = ?`).get(threadId) as ThreadRow | undefined;
  if (!thread) throw new AppError(ErrorCodes.NOT_FOUND, 'Conversación no encontrada.', 404);
  const rows = db
    .prepare(`SELECT * FROM assistant_messages WHERE thread_id = ? ORDER BY created_at ASC`)
    .all(threadId) as MessageRow[];
  const categories = db.prepare(`SELECT key, name, type FROM categories ORDER BY name`).all() as {
    key: string;
    name: string;
    type: string;
  }[];
  return {
    thread: { id: thread.id, title: thread.title, updatedAt: thread.updated_at, mode: threadMode(thread) },
    messages: rows.map(toMessage),
    categories,
  };
}

function requireThread(db: AppDb, threadId: string): ThreadRow {
  const thread = db.prepare(`SELECT * FROM assistant_threads WHERE id = ?`).get(threadId) as ThreadRow | undefined;
  if (!thread) throw new AppError(ErrorCodes.NOT_FOUND, 'Conversación no encontrada.', 404);
  return thread;
}

function loadMessage(db: AppDb, threadId: string, messageId: string): MessageRow {
  const row = db
    .prepare(`SELECT * FROM assistant_messages WHERE id = ? AND thread_id = ?`)
    .get(messageId, threadId) as MessageRow | undefined;
  if (!row) throw new AppError(ErrorCodes.NOT_FOUND, 'Mensaje no encontrado.', 404);
  return row;
}

function saveProposals(db: AppDb, messageId: string, proposals: AssistantProposal[]): void {
  db.prepare(`UPDATE assistant_messages SET proposals_json = ? WHERE id = ?`).run(
    JSON.stringify(proposals),
    messageId,
  );
}

function uploadKind(upload: Upload): 'document' | 'table' | 'spreadsheet' | 'unknown' {
  const name = upload.filename.toLowerCase();
  if (/\.(xlsx|xls)$/.test(name) || /spreadsheet|excel/i.test(upload.mime)) return 'spreadsheet';
  if (
    /\.(csv|tsv|json)$/.test(name) ||
    upload.mime === 'text/csv' ||
    upload.mime === 'application/json' ||
    upload.mime === 'text/tab-separated-values'
  ) {
    return 'table';
  }
  if (sniffMime(upload.filename, upload.mime)) return 'document';
  return 'unknown';
}

async function storeUpload(threadId: string, upload: Upload, mime: string): Promise<AssistantFile> {
  const id = newId();
  const relativePath = join('documents', 'inbox', threadId, `${id}-${safeName(upload.filename)}`).replaceAll('\\', '/');
  const full = insideDataDir(relativePath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, upload.buffer);
  return { id, filename: basename(upload.filename) || 'documento', mime, relativePath };
}

function filesOf(row: MessageRow): AssistantFile[] {
  return parseList(row.files_json, assistantFileSchema, []);
}

function touchThread(db: AppDb, thread: ThreadRow, title: string, now: string): void {
  if (!thread.title) {
    db.prepare(`UPDATE assistant_threads SET title = ?, updated_at = ? WHERE id = ?`).run(title.slice(0, 80), now, thread.id);
  } else {
    db.prepare(`UPDATE assistant_threads SET updated_at = ? WHERE id = ?`).run(now, thread.id);
  }
}

function insertUserMessage(
  db: AppDb,
  threadId: string,
  prompt: string,
  files: AssistantFile[],
  replyToId: string | null,
  now: string,
): string {
  const userId = newId();
  db.prepare(
    `INSERT INTO assistant_messages
      (id, thread_id, role, content, files_json, proposals_json, summary, warnings_json, reply_to_id, created_at)
     VALUES (?, ?, 'user', ?, ?, '[]', NULL, '[]', ?, ?)`,
  ).run(userId, threadId, prompt, JSON.stringify(files), replyToId, now);
  return userId;
}

export async function postMessage(
  db: AppDb,
  threadId: string,
  input: { prompt: string; retryMessageId?: string; uploads: Upload[] },
): Promise<{ user: AssistantMessage; assistant: AssistantMessage }> {
  const thread = requireThread(db, threadId);
  if (threadMode(thread) === 'chat') return postChatMessage(db, thread, input);
  return postInvoiceMessage(db, thread, input);
}

async function postChatMessage(
  db: AppDb,
  thread: ThreadRow,
  input: { prompt: string; retryMessageId?: string; uploads: Upload[] },
): Promise<{ user: AssistantMessage; assistant: AssistantMessage }> {
  if (input.uploads.length) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'En el modo Chat no se adjuntan archivos. Cambia a Factura para leer un documento o una tabla.',
      400,
    );
  }
  const prompt = input.prompt.trim().slice(0, 2000);
  if (!prompt) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Escribe una pregunta.', 400);

  const now = nowIso();
  const userId = insertUserMessage(db, thread.id, prompt, [], null, now);
  touchThread(db, thread, prompt, now);

  const prior = db
    .prepare(
      `SELECT role, content FROM assistant_messages
       WHERE thread_id = ? AND id != ? ORDER BY created_at ASC`,
    )
    .all(thread.id, userId) as { role: string; content: string }[];
  const history = prior.slice(-16).map((row) => ({
    role: row.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: row.content.slice(0, 2000),
  }));

  let answer: string;
  try {
    reportReadStep(1, 'Reuniendo tus datos');
    const context = await buildChatContext(db, prompt);
    answer = await chatText(chatPrompt(context), [...history, { role: 'user', content: prompt }]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('Descarga el modelo') ? 409 : 502;
    throw new AppError(status === 409 ? ErrorCodes.CONFLICT : ErrorCodes.INTERNAL, message, status);
  } finally {
    clearReadStep();
  }

  const id = newId();
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO assistant_messages
      (id, thread_id, role, content, files_json, proposals_json, summary, warnings_json, reply_to_id, created_at)
     VALUES (?, ?, 'assistant', ?, '[]', '[]', ?, '[]', ?, ?)`,
  ).run(id, thread.id, answer.trim(), answer.trim().slice(0, 240), userId, createdAt);
  db.prepare(`UPDATE assistant_threads SET updated_at = ? WHERE id = ?`).run(createdAt, thread.id);
  return { user: toMessage(loadMessage(db, thread.id, userId)), assistant: toMessage(loadMessage(db, thread.id, id)) };
}

async function postInvoiceMessage(
  db: AppDb,
  thread: ThreadRow,
  input: { prompt: string; retryMessageId?: string; uploads: Upload[] },
): Promise<{ user: AssistantMessage; assistant: AssistantMessage }> {
  const prompt = input.prompt.trim().slice(0, 2000);
  let files: AssistantFile[] = [];
  if (input.retryMessageId) {
    const previous = loadMessage(db, thread.id, input.retryMessageId);
    const sourceId = previous.reply_to_id ?? previous.id;
    const source = sourceId === previous.id ? previous : loadMessage(db, thread.id, sourceId);
    files = filesOf(source);
  }

  const spreadsheet = input.uploads.find((upload) => uploadKind(upload) === 'spreadsheet');
  if (spreadsheet) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `«${spreadsheet.filename}» es Excel. Expórtalo a CSV y vuelve a soltarlo.`,
      400,
    );
  }
  const unknown = input.uploads.find((upload) => uploadKind(upload) === 'unknown');
  if (unknown) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `«${unknown.filename}» no es una foto, un PDF ni una tabla CSV, TSV o JSON.`,
      400,
    );
  }
  const tables = input.uploads.filter((upload) => uploadKind(upload) === 'table');
  const documents = input.uploads.filter((upload) => uploadKind(upload) === 'document');
  if (tables.length && (documents.length || files.length)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Separa las fotos de las tablas: envía cada tipo en un mensaje.',
      400,
    );
  }

  if (tables.length) {
    for (const upload of tables) {
      const mime = upload.filename.toLowerCase().endsWith('.json') ? 'application/json' : 'text/csv';
      files.push(await storeUpload(thread.id, upload, mime));
    }
    return saveTableImport(db, thread, prompt, files, tables);
  }

  for (const upload of documents) {
    const mime = sniffMime(upload.filename, upload.mime);
    if (!mime) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `«${upload.filename}» no es una foto (JPEG, PNG, WebP) ni un PDF.`,
        400,
      );
    }
    files.push(await storeUpload(thread.id, upload, mime));
  }
  if (!files.length) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Añade una foto, un PDF o una tabla (CSV, TSV o JSON).', 400);
  }

  const now = nowIso();
  const userId = insertUserMessage(db, thread.id, prompt, files, input.retryMessageId ?? null, now);
  touchThread(db, thread, prompt || files[0]?.filename || 'Documento', now);
  const assistant = await recognize(db, thread.id, userId, prompt, files);
  return { user: toMessage(loadMessage(db, thread.id, userId)), assistant };
}

type StoredImportRow = {
  row: number;
  ok: boolean;
  errors: string[];
  warnings: string[];
  filename?: string;
  concept?: string;
  fiscalDate?: string;
  type?: string;
  totalCents?: number;
  data?: MovementCreateInput;
  savedId?: string;
};

type StoredImport = {
  status: 'pending' | 'saved';
  filename: string;
  summary: { total: number; ok: number; errors: number; warnings: number };
  rows: StoredImportRow[];
  createdCount?: number;
};

function readStoredImport(raw: string | null | undefined): StoredImport | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as StoredImport;
    if (!value || !Array.isArray(value.rows)) return null;
    return value;
  } catch {
    return null;
  }
}

async function saveTableImport(
  db: AppDb,
  thread: ThreadRow,
  prompt: string,
  files: AssistantFile[],
  uploads: Upload[],
): Promise<{ user: AssistantMessage; assistant: AssistantMessage }> {
  const rows: StoredImportRow[] = [];
  for (const upload of uploads) {
    const text = upload.buffer.toString('utf8');
    const parsed = parseImportText(text);
    if (parsed.rows.length > 500) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'El archivo tiene más de 500 filas. Divídelo.', 400);
    }
    for (const row of parsed.rows) {
      rows.push({
        row: row.row,
        ok: row.ok,
        errors: row.errors,
        warnings: row.warnings,
        filename: upload.filename,
        concept: row.data?.concept,
        fiscalDate: row.data?.fiscalDate,
        type: row.data?.type,
        totalCents: typeof row.data?.totalCents === 'number' ? row.data.totalCents : undefined,
        data: row.data,
      });
    }
  }
  if (rows.length > 500) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'El archivo tiene más de 500 filas. Divídelo.', 400);
  }
  const preview: StoredImport = {
    status: 'pending',
    filename: uploads.map((upload) => upload.filename).join(', '),
    summary: {
      total: rows.length,
      ok: rows.filter((row) => row.ok).length,
      errors: rows.filter((row) => !row.ok).length,
      warnings: rows.filter((row) => row.warnings.length).length,
    },
    rows,
    createdCount: 0,
  };

  const now = nowIso();
  const userId = insertUserMessage(db, thread.id, prompt, files, null, now);
  touchThread(db, thread, prompt || preview.filename || 'Tabla', now);
  const id = newId();
  const summary = `${preview.summary.ok} de ${preview.summary.total} filas listas para guardar.`;
  db.prepare(
    `INSERT INTO assistant_messages
      (id, thread_id, role, content, files_json, proposals_json, summary, warnings_json, import_json, reply_to_id, created_at)
     VALUES (?, ?, 'assistant', ?, ?, '[]', ?, '[]', ?, ?, ?)`,
  ).run(id, thread.id, summary, JSON.stringify(files), summary, JSON.stringify(preview), userId, now);
  return { user: toMessage(loadMessage(db, thread.id, userId)), assistant: toMessage(loadMessage(db, thread.id, id)) };
}

export async function confirmImport(db: AppDb, threadId: string, messageId: string): Promise<AssistantMessage> {
  const row = loadMessage(db, threadId, messageId);
  const preview = readStoredImport(row.import_json);
  if (!preview) throw new AppError(ErrorCodes.NOT_FOUND, 'No hay una tabla pendiente en este mensaje.', 404);
  let created = preview.createdCount ?? preview.rows.filter((item) => item.savedId).length;
  for (const item of preview.rows) {
    if (!item.ok || !item.data || item.savedId) continue;
    const parsed = movementCreateSchema.safeParse(item.data);
    if (!parsed.success) {
      item.ok = false;
      item.errors.push('La fila ya no es válida.');
      continue;
    }
    const result = await createMovement(db, { ...parsed.data, source: 'import', status: 'confirmed' });
    item.savedId = String(result.movement.id);
    created += 1;
    preview.createdCount = created;
    db.prepare(`UPDATE assistant_messages SET import_json = ? WHERE id = ?`).run(JSON.stringify(preview), messageId);
  }
  const pending = preview.rows.some((item) => item.ok && item.data && !item.savedId);
  preview.status = pending ? 'pending' : 'saved';
  preview.createdCount = created;
  preview.summary.ok = preview.rows.filter((item) => item.ok).length;
  preview.summary.errors = preview.rows.filter((item) => !item.ok).length;
  const summary = preview.status === 'saved'
    ? `Guardadas ${created} filas.`
    : `Guardadas ${created} filas. Quedan filas sin guardar.`;
  db.prepare(`UPDATE assistant_messages SET import_json = ?, summary = ?, content = ? WHERE id = ?`).run(
    JSON.stringify(preview),
    summary,
    summary,
    messageId,
  );
  return toMessage(loadMessage(db, threadId, messageId));
}

async function recognize(
  db: AppDb,
  threadId: string,
  userMessageId: string,
  prompt: string,
  files: AssistantFile[],
): Promise<AssistantMessage> {
  reportReadStep(1, 'Preparando el documento');
  try {
    return await recognizeInner(db, threadId, userMessageId, prompt, files);
  } finally {
    clearReadStep();
  }
}

async function recognizeInner(
  db: AppDb,
  threadId: string,
  userMessageId: string,
  prompt: string,
  files: AssistantFile[],
): Promise<AssistantMessage> {
  const warnings: string[] = [];
  const prepared: {
    file: AssistantFile;
    text: string;
    pages: { mime: 'image/jpeg'; bytes: Buffer; page: number }[];
  }[] = [];

  for (const file of files) {
    const full = insideDataDir(file.relativePath);
    let bytes: Buffer;
    try {
      bytes = await readFile(full);
    } catch {
      throw new AppError(ErrorCodes.NOT_FOUND, `No encuentro «${file.filename}». Vuelve a adjuntarlo.`, 404);
    }
    try {
      const doc = await prepareDocument(file.filename, file.mime, bytes);
      file.pageCount = doc.pageCount;
      file.truncated = doc.truncated;
      warnings.push(...doc.warnings);
      prepared.push({
        file,
        text: doc.text,
        pages: doc.pages.map((page) => ({ mime: page.mime, bytes: page.bytes, page: page.page })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError(ErrorCodes.VALIDATION_ERROR, message, 400);
    }
  }

  const ctx = loadPromptContext(db, activeYear(db));
  const lines = [
    contextBlock(ctx),
    '',
    `Indicación de la persona: ${prompt || '(ninguna)'}`,
  ];
  const images: { mime: string; base64: string }[] = [];
  const order: string[] = [];
  for (const doc of prepared) {
    lines.push('', `Archivo ${doc.file.filename} (${doc.file.pageCount ?? doc.pages.length} páginas):`);
    if (doc.text) lines.push(doc.text);
    for (const page of doc.pages) {
      if (images.length >= MAX_IMAGES) {
        warnings.push('Había más páginas de las que se pueden mirar de una vez; se omitieron las últimas.');
        break;
      }
      images.push({ mime: page.mime, base64: page.bytes.toString('base64') });
      order.push(`${doc.file.filename} página ${page.page}`);
    }
  }
  if (order.length) lines.push('', `Imágenes adjuntas, en este orden: ${order.join('; ')}.`);

  let modelText: string;
  try {
    modelText = await chatVision(systemPrompt(), lines.join('\n'), images);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('Descarga el modelo') ? 409 : 502;
    throw new AppError(status === 409 ? ErrorCodes.CONFLICT : ErrorCodes.INTERNAL, message, status);
  }

  let normalized: ReturnType<typeof normalizeModelOutput>;
  try {
    reportReadStep(4, 'Ordenando los datos');
    normalized = normalizeModelOutput(extractJsonObject(modelText), {
      files: prepared.map((doc) => ({
        id: doc.file.id,
        filename: doc.file.filename,
        truncated: doc.file.truncated,
      })),
      temporalCriterion: ctx.temporalCriterion,
    });
  } catch {
    try {
      const repaired = await chatVision(systemPrompt(), repairPrompt(modelText), []);
      reportReadStep(4, 'Ordenando los datos');
      normalized = normalizeModelOutput(extractJsonObject(repaired), {
        files: prepared.map((doc) => ({
          id: doc.file.id,
          filename: doc.file.filename,
          truncated: doc.file.truncated,
        })),
        temporalCriterion: ctx.temporalCriterion,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'La respuesta del modelo no era JSON.';
      throw new AppError(ErrorCodes.INTERNAL, message, 502);
    }
  }

  const quarter = workingQuarter(db);
  const proposals = normalized.proposals.map((proposal) =>
    reviewProposal(db, applyPartyHistory(constrainCategory(proposal, ctx.categoryKeys), ctx.history), quarter),
  );
  if (!proposals.length) {
    warnings.push('No se reconoció ningún movimiento. Precisa si es factura o ticket y vuelve a intentarlo.');
  }

  const id = newId();
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO assistant_messages
      (id, thread_id, role, content, files_json, proposals_json, summary, warnings_json, reply_to_id, created_at)
     VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    threadId,
    normalized.summary,
    JSON.stringify(files),
    JSON.stringify(proposals),
    normalized.summary,
    JSON.stringify(warnings),
    userMessageId,
    createdAt,
  );
  db.prepare(`UPDATE assistant_threads SET updated_at = ? WHERE id = ?`).run(createdAt, threadId);
  return toMessage(loadMessage(db, threadId, id));
}

function blank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function acceptToMovement(body: AssistantAcceptInput, documentId?: string): MovementCreateInput {
  const vatTreatment = body.vatTreatment || undefined;
  return {
    type: body.type,
    invoiceDate: body.invoiceDate,
    fiscalDate: body.fiscalDate,
    dueDate: blank(body.dueDate),
    settlementDate: blank(body.settlementDate),
    invoiceNumber: blank(body.invoiceNumber),
    partyName: blank(body.partyName),
    partyNif: blank(body.partyNif),
    concept: body.concept.trim(),
    categoryKey: blank(body.categoryKey),
    taxBaseCents: body.taxBaseCents,
    vatRateBps: body.vatRateBps,
    irpfRateBps: body.irpfRateBps ?? 0,
    professionalUseBps: body.professionalUseBps ?? 10_000,
    taxDeductibleBps: body.taxDeductibleBps ?? 10_000,
    expenseNature: body.expenseNature ?? 'current',
    vatTreatment,
    coefficientBps: body.coefficientBps,
    inServiceDate: blank(body.inServiceDate),
    notes: blank(body.notes),
    documentId,
    status: 'confirmed',
    source: 'assistant',
  };
}

async function attachDocument(
  db: AppDb,
  file: AssistantFile | undefined,
  movementId: string,
): Promise<string | undefined> {
  if (!file) return undefined;
  const docId = newId();
  const relativePath = join('documents', `${docId}-${safeName(file.filename)}`).replaceAll('\\', '/');
  const source = insideDataDir(file.relativePath);
  const dest = insideDataDir(relativePath);
  await mkdir(join(dest, '..'), { recursive: true });
  await copyFile(source, dest);
  db.prepare(
    `INSERT INTO documents (id, filename, path, mime_type, movement_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(docId, file.filename, relativePath, file.mime, movementId, nowIso());
  return docId;
}

function otherPendingUseFile(db: AppDb, fileId: string, exceptProposalId: string): boolean {
  const rows = db.prepare(`SELECT proposals_json FROM assistant_messages WHERE role = 'assistant'`).all() as {
    proposals_json: string;
  }[];
  for (const row of rows) {
    const proposals = parseList(row.proposals_json, assistantProposalSchema, []);
    if (proposals.some((item) => item.id !== exceptProposalId && item.status === 'pending' && item.fileId === fileId)) {
      return true;
    }
  }
  return false;
}

async function retireInbox(db: AppDb, file: AssistantFile, permanentRelative: string): Promise<void> {
  const rows = db.prepare(`SELECT id, files_json FROM assistant_messages`).all() as {
    id: string;
    files_json: string;
  }[];
  for (const row of rows) {
    const files = parseList(row.files_json, assistantFileSchema, []);
    let changed = false;
    for (const item of files) {
      if (item.relativePath === file.relativePath) {
        item.relativePath = permanentRelative;
        changed = true;
      }
    }
    if (changed) {
      db.prepare(`UPDATE assistant_messages SET files_json = ? WHERE id = ?`).run(JSON.stringify(files), row.id);
    }
  }
  const source = insideDataDir(file.relativePath);
  const dest = insideDataDir(permanentRelative);
  if (source !== dest) await rm(source, { force: true });
}

export async function acceptProposal(
  db: AppDb,
  threadId: string,
  messageId: string,
  proposalId: string,
  body: unknown,
): Promise<{ movement: Record<string, unknown>; issues: { message: string; severity: string }[] }> {
  const parsed = assistantAcceptSchema.parse(body);
  if ((parsed.expenseNature ?? 'current') === 'fixed_asset' && !(parsed.coefficientBps && parsed.coefficientBps > 0)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Para inmovilizado indica el coeficiente de amortización (%).',
      400,
    );
  }
  const row = loadMessage(db, threadId, messageId);
  if (row.role !== 'assistant') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Solo se aceptan propuestas del asistente.', 400);
  }
  const proposals = parseList(row.proposals_json, assistantProposalSchema, []);
  const proposal = proposals.find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== 'pending') {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Esa propuesta ya no está pendiente.', 404);
  }

  const files = filesOf(row);
  const file = proposal.fileId ? files.find((item) => item.id === proposal.fileId) : files[0];
  const settingsQuarter = workingQuarter(db);

  let documentId: string | undefined;
  let permanentRelative: string | undefined;
  if (file) {
    const attached = await attachDocument(db, file, 'pending');
    if (!attached) {
      throw new AppError(ErrorCodes.INTERNAL, 'No se pudo guardar el documento.', 500);
    }
    documentId = attached;
    const doc = db.prepare(`SELECT path FROM documents WHERE id = ?`).get(documentId) as { path: string } | undefined;
    permanentRelative = doc?.path;
  }

  const input = acceptToMovement(parsed, documentId);
  let created: { movement: Record<string, unknown>; issues: { message: string; severity: string }[] };
  try {
    created = await createMovement(db, input, { workingQuarter: settingsQuarter });
  } catch (err) {
    if (documentId) {
      db.prepare(`DELETE FROM documents WHERE id = ?`).run(documentId);
      if (permanentRelative) await rm(insideDataDir(permanentRelative), { force: true });
    }
    throw err;
  }

  const movementId = String(created.movement.id);
  if (documentId) {
    db.prepare(`UPDATE documents SET movement_id = ? WHERE id = ?`).run(movementId, documentId);
    db.prepare(`UPDATE movements SET document_id = ? WHERE id = ?`).run(documentId, movementId);
  }

  if ((parsed.expenseNature ?? 'current') === 'fixed_asset') {
    try {
      await createAssetFromMovement(db, movementId, {
        coefficientBps: parsed.coefficientBps ?? 0,
        inServiceDate: blank(parsed.inServiceDate) ?? parsed.fiscalDate,
      });
    } catch (err) {
      await deleteMovement(db, movementId);
      if (documentId) {
        db.prepare(`DELETE FROM documents WHERE id = ?`).run(documentId);
        if (permanentRelative) await rm(insideDataDir(permanentRelative), { force: true });
      }
      throw err;
    }
  }

  proposal.status = 'accepted';
  proposal.movementId = movementId;
  proposal.type = parsed.type;
  proposal.documentKind = parsed.documentKind;
  proposal.invoiceDate = parsed.invoiceDate;
  proposal.fiscalDate = parsed.fiscalDate;
  proposal.concept = parsed.concept;
  proposal.partyName = blank(parsed.partyName);
  proposal.partyNif = blank(parsed.partyNif);
  proposal.invoiceNumber = blank(parsed.invoiceNumber);
  proposal.taxBaseCents = parsed.taxBaseCents;
  proposal.vatRateBps = parsed.vatRateBps;
  proposal.irpfRateBps = parsed.irpfRateBps;
  proposal.professionalUseBps = parsed.professionalUseBps;
  proposal.taxDeductibleBps = parsed.taxDeductibleBps;
  proposal.expenseNature = parsed.expenseNature ?? 'current';
  proposal.categoryKey = blank(parsed.categoryKey);
  proposal.notes = blank(parsed.notes);
  proposal.vatTreatment = parsed.vatTreatment || undefined;
  saveProposals(db, messageId, proposals);
  db.prepare(`UPDATE assistant_threads SET updated_at = ? WHERE id = ?`).run(nowIso(), threadId);

  if (file && permanentRelative && !otherPendingUseFile(db, file.id, proposalId)) {
    await retireInbox(db, file, permanentRelative);
  }

  return created;
}

export async function discardProposal(
  db: AppDb,
  threadId: string,
  messageId: string,
  proposalId: string,
): Promise<AssistantProposal[]> {
  const row = loadMessage(db, threadId, messageId);
  const proposals = parseList(row.proposals_json, assistantProposalSchema, []);
  const proposal = proposals.find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== 'pending') {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Esa propuesta ya no está pendiente.', 404);
  }
  proposal.status = 'discarded';
  saveProposals(db, messageId, proposals);
  db.prepare(`UPDATE assistant_threads SET updated_at = ? WHERE id = ?`).run(nowIso(), threadId);
  return proposals;
}

export function findStoredFile(db: AppDb, fileId: string): AssistantFile {
  const rows = db.prepare(`SELECT files_json FROM assistant_messages`).all() as { files_json: string }[];
  for (const row of rows) {
    const files = parseList(row.files_json, assistantFileSchema, []);
    const found = files.find((file) => file.id === fileId);
    if (found) return found;
  }
  throw new AppError(ErrorCodes.NOT_FOUND, 'Archivo no encontrado.', 404);
}

export function storedFilePath(file: AssistantFile): string {
  return insideDataDir(file.relativePath);
}

export async function createSampleThread(db: AppDb): Promise<{ id: string }> {
  const { id } = createThread(db);
  const today = new Date().toISOString().slice(0, 10);
  const proposal: AssistantProposal = {
    id: newId(),
    status: 'pending',
    documentKind: 'invoice',
    type: 'expense',
    invoiceDate: today,
    fiscalDate: today,
    partyName: 'Papelería Norte',
    partyNif: 'B12345678',
    concept: 'Folios y carpetas',
    taxBaseCents: 1000,
    vatRateBps: 2100,
    vatCents: 210,
    irpfRateBps: 0,
    irpfWithheldCents: 0,
    totalCents: 1210,
    professionalUseBps: 10_000,
    taxDeductibleBps: 10_000,
    deductionOrigin: 'model',
    expenseNature: 'current',
    evidence: 'Ejemplo para revisar la ficha sin el modelo.',
    missingFields: [],
    warnings: ['Propuesta de ejemplo, no sale de un documento.'],
  };
  const reviewed = reviewProposal(db, proposal, workingQuarter(db));
  const messageId = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO assistant_messages
      (id, thread_id, role, content, files_json, proposals_json, summary, warnings_json, reply_to_id, created_at)
     VALUES (?, ?, 'assistant', ?, '[]', ?, ?, '[]', NULL, ?)`,
  ).run(messageId, id, 'Ejemplo de lectura.', JSON.stringify([reviewed]), 'Ejemplo de lectura.', now);
  db.prepare(`UPDATE assistant_threads SET title = ?, updated_at = ? WHERE id = ?`).run('Ejemplo', now, id);
  return { id };
}
