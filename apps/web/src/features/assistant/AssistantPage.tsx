import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatEuros, type AssistantImport, type AssistantMessage, type AssistantStatus } from '@autonomous/shared';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button, PageHeader } from '../../components/ui/primitives';
import { api, getApiBaseUrl } from '../../lib/api';
import { pushError } from '../../lib/errorStore';
import { AssistantModelBanner, AssistantSetup } from './AssistantModelPanel';
import { ProposalCard } from './ProposalCard';

type ThreadSummary = { id: string; title: string | null; updatedAt: string };
type ThreadDetail = {
  thread: ThreadSummary;
  messages: AssistantMessage[];
  categories: { key: string; name: string; type: string }[];
};

const DOC = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const READ_STEPS = [
  'Preparando el documento',
  'Cargando el modelo',
  'Leyendo el documento',
  'Ordenando los datos',
];

function isExcel(file: File): boolean {
  return /\.xlsx?$/i.test(file.name) || /spreadsheet|excel/i.test(file.type);
}

function isTable(file: File): boolean {
  return /\.(csv|tsv|json)$/i.test(file.name) || file.type === 'text/csv' || file.type === 'application/json';
}

function isDocument(file: File): boolean {
  if (DOC.has(file.type)) return true;
  return /\.(jpe?g|png|webp|pdf)$/i.test(file.name);
}

export function AssistantPage() {
  const qc = useQueryClient();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [base, setBase] = useState('');
  const [reading, setReading] = useState(false);
  const [outgoing, setOutgoing] = useState<{ text: string; files: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getApiBaseUrl().then(setBase);
  }, []);

  const threads = useQuery({
    queryKey: ['assistant-threads'],
    queryFn: () => api<{ threads: ThreadSummary[] }>('/api/assistant/threads'),
  });

  useEffect(() => {
    if (threadId) return;
    const first = threads.data?.threads[0];
    if (first) setThreadId(first.id);
  }, [threads.data, threadId]);

  const detail = useQuery({
    queryKey: ['assistant-thread', threadId],
    enabled: Boolean(threadId),
    queryFn: () => api<ThreadDetail>(`/api/assistant/threads/${threadId}`),
  });

  const status = useQuery({
    queryKey: ['assistant-status'],
    queryFn: () => api<AssistantStatus>('/api/assistant/status'),
    refetchInterval: reading ? 700 : false,
  });

  const report = (err: unknown): Error => {
    pushError(err, 'IA');
    return err instanceof Error ? err : new Error('Error de la IA');
  };

  const send = useMutation({
    mutationFn: async (input: { prompt: string; files: File[]; retryMessageId?: string }) => {
      let id = threadId;
      if (!id) {
        const created = await api<{ id: string }>('/api/assistant/threads', { method: 'POST', json: {} });
        id = created.id;
      }
      const form = new FormData();
      form.set('prompt', input.prompt);
      if (input.retryMessageId) form.set('retryMessageId', input.retryMessageId);
      for (const file of input.files) form.append('file', file, file.name);
      const result = await api<{ assistant: AssistantMessage }>(`/api/assistant/threads/${id}/messages`, {
        method: 'POST',
        body: form,
      });
      return { id, result };
    },
    onMutate: () => setReading(true),
    onSuccess: async ({ id }) => {
      setThreadId(id);
      await qc.invalidateQueries({ queryKey: ['assistant-thread', id] });
      await qc.invalidateQueries({ queryKey: ['assistant-threads'] });
      await qc.invalidateQueries({ queryKey: ['movements'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      await qc.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (err) => {
      pushError(err, 'IA');
    },
    onSettled: () => setReading(false),
  });

  const messages = detail.data?.messages ?? [];

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, send.isPending, threadId, outgoing]);

  const addFiles = (list: FileList | File[]) => {
    const next = [...files];
    for (const file of list) {
      if (isExcel(file)) {
        pushError(new Error(`«${file.name}» es Excel. Expórtalo a CSV y vuelve a soltarlo.`), 'IA');
        continue;
      }
      if (!isTable(file) && !isDocument(file)) {
        pushError(new Error(`«${file.name}» no es una foto, un PDF ni una tabla CSV, TSV o JSON.`), 'IA');
        continue;
      }
      const incomingTable = isTable(file);
      const hasTable = next.some(isTable);
      const hasDoc = next.some(isDocument);
      if ((incomingTable && hasDoc) || (!incomingTable && hasTable)) {
        pushError(new Error('Separa las fotos de las tablas: envía cada tipo en un mensaje.'), 'IA');
        continue;
      }
      next.push(file);
    }
    setFiles(next.slice(0, 8));
  };

  const createNew = async () => {
    const created = await api<{ id: string }>('/api/assistant/threads', { method: 'POST', json: {} });
    setThreadId(created.id);
    setPrompt('');
    setFiles([]);
    await qc.invalidateQueries({ queryKey: ['assistant-threads'] });
  };

  const loadSample = async () => {
    const created = await api<{ id: string }>('/api/assistant/dev/sample', { method: 'POST' });
    setThreadId(created.id);
    await qc.invalidateQueries({ queryKey: ['assistant-threads'] });
    await qc.invalidateQueries({ queryKey: ['assistant-thread', created.id] });
  };

  const saveImport = async (message: AssistantMessage) => {
    try {
      await api(`/api/assistant/threads/${message.threadId}/messages/${message.id}/import`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['assistant-thread', threadId] });
      await qc.invalidateQueries({ queryKey: ['movements'] });
      await qc.invalidateQueries({ queryKey: ['alerts'] });
    } catch (err) {
      throw report(err);
    }
  };

  const installed = Boolean(status.data?.installed);
  const tablesOnly = files.length > 0 && files.every(isTable);
  const readProgress = status.data?.downloading ? null : status.data?.progress ?? null;
  const readStep = Math.min(READ_STEPS.length - 1, Math.max(0, (readProgress?.fileIndex ?? 1) - 1));
  const canSend =
    !send.isPending && (tablesOnly || (installed && (Boolean(prompt.trim()) || files.length > 0)));

  const submit = () => {
    if (!canSend) return;
    const text = prompt;
    const sentFiles = files;
    setOutgoing({ text, files: sentFiles.map((file) => file.name) });
    setPrompt('');
    setFiles([]);
    void send.mutateAsync({ prompt: text, files: sentFiles }).catch(() => {
      setPrompt(text);
      setFiles(sentFiles);
    }).finally(() => setOutgoing(null));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {installed && <AssistantModelBanner warm />}
      <PageHeader
        title="IA"
        subtitle="Pregunta, pide un movimiento o suelta una factura. No se guarda nada hasta que lo confirmas."
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {threads.data && threads.data.threads.length > 0 && (
              <select
                className="border border-surface-border bg-surface-field px-2 py-1 text-[12px]"
                value={threadId ?? ''}
                onChange={(event) => setThreadId(event.target.value || null)}
                aria-label="Conversación"
              >
                {!threadId && <option value="">Nueva</option>}
                {threads.data.threads.map((thread) => (
                  <option key={thread.id} value={thread.id}>
                    {thread.title || 'Sin título'}
                  </option>
                ))}
              </select>
            )}
            <Button variant="default" onClick={() => void createNew()}>Nueva conversación</Button>
            {import.meta.env.DEV && (
              <Button variant="ghost" onClick={() => void loadSample()}>Probar con un ejemplo</Button>
            )}
          </div>
        }
      />
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto pr-1">
        {status.isFetched && !installed && <div className="mb-3"><AssistantSetup /></div>}
        {messages.length === 0 && (
          <p className="mt-6 text-center text-[13px] text-surface-muted">
            Pregunta por tus datos, pide un movimiento de prueba o suelta una factura, un PDF o una tabla.
          </p>
        )}
        <div className="mt-3 space-y-3">
          {messages.map((message) => (
            <div key={message.id}>
              {message.role === 'user' ? (
                <div className="ml-auto max-w-[40rem] rounded-2xl bg-surface-accent-soft px-3 py-2 text-[13px] text-surface-ink" style={{ width: 'fit-content' }}>
                  {message.content || 'Archivo adjunto'}
                  {message.files.length > 0 && (
                    <p className="mt-1 text-[12px] text-surface-muted">{message.files.map((file) => file.filename).join(', ')}</p>
                  )}
                </div>
              ) : (
                <div className="max-w-[46rem] space-y-2">
                  {!message.importPreview && (message.content || message.summary) && (
                    <AssistantMarkdown text={message.content || message.summary || ''} />
                  )}
                  {message.warnings.map((warning) => (
                    <p key={warning} className="text-[12px] text-surface-warn">{warning}</p>
                  ))}
                  {message.importPreview && (
                    <ImportCard preview={message.importPreview} busy={send.isPending} onSave={() => saveImport(message)} />
                  )}
                  {message.proposals.map((proposal) => {
                    if (proposal.status !== 'pending') {
                      return (
                        <p key={proposal.id} className="text-[12px] text-surface-muted">
                          {proposal.concept || 'Movimiento'} · {proposal.status === 'accepted' ? 'aceptado' : 'descartado'}
                        </p>
                      );
                    }
                    const file = message.files.find((item) => item.id === proposal.fileId) ?? message.files[0];
                    return (
                      <ProposalCard
                        key={proposal.id}
                        proposal={proposal}
                        categories={detail.data?.categories ?? []}
                        previewUrl={file && isDocumentMime(file.mime) ? `${base}/api/assistant/files/${file.id}` : undefined}
                        previewMime={file?.mime}
                        busy={send.isPending}
                        onAccept={async (body) => {
                          try {
                            await api(
                              `/api/assistant/threads/${message.threadId}/messages/${message.id}/proposals/${proposal.id}/accept`,
                              { method: 'POST', json: body },
                            );
                            await qc.invalidateQueries({ queryKey: ['assistant-thread', threadId] });
                            await qc.invalidateQueries({ queryKey: ['movements'] });
                            await qc.invalidateQueries({ queryKey: ['alerts'] });
                          } catch (err) {
                            throw report(err);
                          }
                        }}
                        onDiscard={async () => {
                          try {
                            await api(
                              `/api/assistant/threads/${message.threadId}/messages/${message.id}/proposals/${proposal.id}/discard`,
                              { method: 'POST' },
                            );
                            await qc.invalidateQueries({ queryKey: ['assistant-thread', threadId] });
                          } catch (err) {
                            throw report(err);
                          }
                        }}
                        onRetry={async (note) => {
                          await send.mutateAsync({ prompt: note, files: [], retryMessageId: message.id });
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {outgoing && send.isPending && (
            <div className="ml-auto max-w-[40rem] rounded-2xl bg-surface-accent-soft px-3 py-2 text-[13px] text-surface-ink" style={{ width: 'fit-content' }}>
              {outgoing.text || 'Archivo adjunto'}
              {outgoing.files.length > 0 && (
                <p className="mt-1 text-[12px] text-surface-muted">{outgoing.files.join(', ')}</p>
              )}
            </div>
          )}
          {send.isPending && (
            <div className="rounded-2xl border border-surface-border bg-surface-panel p-2" role="status" aria-live="polite">
              <Thinking label={tablesOnly ? 'Leyendo la tabla…' : files.some(isDocument) ? (readProgress?.label ?? 'Preparando el documento') : 'Pensando…'} />
              {files.some(isDocument) && !tablesOnly && (
                <>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-border" role="progressbar" aria-valuenow={readProgress?.percent ?? (readStep + 1) * 25} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-1.5 bg-surface-accent" style={{ width: `${readProgress?.percent ?? (readStep + 1) * 25}%` }} />
                  </div>
                  <ol className="mt-2 space-y-1">
                    {READ_STEPS.map((step, index) => (
                      <li key={step} className={`text-[12px] ${index === readStep ? 'text-surface-ink' : 'text-surface-muted'}`}>
                        {index < readStep ? '✓' : index === readStep ? '→' : '·'} {step}
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <form
        className={`mt-2 rounded-2xl border bg-surface-panel p-2 ${drag ? 'border-surface-accent' : 'border-surface-border'}`}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDrag(false);
          addFiles(event.dataTransfer.files);
        }}
      >
        {files.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="flex items-center gap-1 rounded-full border border-surface-border bg-surface-field px-2 py-0.5 text-[12px]">
                <span>{file.name}</span>
                <button
                  type="button"
                  className="text-surface-muted"
                  aria-label={`Quitar ${file.name}`}
                  onClick={() => setFiles(files.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          className="max-h-40 w-full resize-none bg-transparent px-1 py-1 text-[13px] outline-none disabled:opacity-50"
          rows={2}
          value={prompt}
          disabled={send.isPending}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Pregunta, pide un movimiento o suelta aquí una factura, un PDF o una tabla"
        />
        <div className="mt-1 flex items-center justify-between">
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-full border border-surface-border text-lg leading-none text-surface-ink hover:bg-surface-hover disabled:opacity-40"
            aria-label="Adjuntar archivo"
            disabled={send.isPending}
            onClick={() => fileRef.current?.click()}
          >
            +
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf,.csv,.tsv,.json,text/csv,application/json"
            multiple
            className="sr-only"
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Enviar"
            className="grid h-8 w-8 place-items-center rounded-full bg-surface-accent text-surface-on disabled:opacity-40"
          >
            ↑
          </button>
        </div>
      </form>
    </div>
  );
}

function Thinking({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-[13px] text-surface-ink">
      <span className="flex items-center gap-1" aria-hidden>
        {[0, 1, 2].map((dot) => (
          <span key={dot} className="thinking-dot h-1.5 w-1.5 rounded-full bg-surface-accent" />
        ))}
      </span>
      {label}
    </p>
  );
}

function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="assistant-md text-[13px] leading-relaxed text-surface-ink">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}

function isDocumentMime(mime: string): boolean {
  return mime.startsWith('image/') || mime === 'application/pdf';
}

function ImportCard({
  preview,
  busy,
  onSave,
}: {
  preview: AssistantImport;
  busy: boolean;
  onSave: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const okRows = preview.rows.filter((row) => row.ok);
  const badRows = preview.rows.filter((row) => !row.ok);
  return (
    <article className="border border-surface-border bg-surface-panel p-3">
      <h3 className="text-[13px] font-semibold text-surface-ink">{preview.filename}</h3>
      <p className="mt-1 text-[13px] text-surface-ink">
        {preview.summary.ok} de {preview.summary.total} filas válidas
        {preview.summary.errors > 0 ? ` · ${preview.summary.errors} con error` : ''}
        {preview.createdCount ? ` · guardadas ${preview.createdCount}` : ''}
      </p>
      {okRows.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12px] text-surface-ink">
          {okRows.slice(0, 12).map((row) => (
            <li key={`${row.filename ?? ''}-${row.row}`}>
              {row.fiscalDate ?? '—'} · {row.concept ?? 'Sin concepto'}
              {typeof row.totalCents === 'number' ? ` · ${formatEuros(row.totalCents)}` : ''}
            </li>
          ))}
          {okRows.length > 12 && <li className="text-surface-muted">y {okRows.length - 12} más</li>}
        </ul>
      )}
      {badRows.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12px] text-surface-danger">
          {badRows.slice(0, 8).map((row) => (
            <li key={`err-${row.filename ?? ''}-${row.row}`}>
              Fila {row.row}: {row.errors[0] ?? 'no válida'}
            </li>
          ))}
          {badRows.length > 8 && <li>y {badRows.length - 8} errores más</li>}
        </ul>
      )}
      {preview.status !== 'saved' && preview.summary.ok > 0 && (
        <div className="mt-3">
          <Button
            variant="primary"
            disabled={busy || saving}
            onClick={() => {
              setSaving(true);
              void onSave().finally(() => setSaving(false));
            }}
          >
            {saving ? 'Guardando…' : 'Guardar filas válidas'}
          </Button>
        </div>
      )}
      {preview.status === 'saved' && (
        <p className="mt-2 text-[12px] text-surface-muted">Filas válidas guardadas.</p>
      )}
    </article>
  );
}
