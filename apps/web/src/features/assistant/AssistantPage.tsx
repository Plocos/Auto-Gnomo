import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { AssistantMessage, AssistantStatus } from '@autonomous/shared';
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

const ACCEPT = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function fileOk(file: File): boolean {
  if (ACCEPT.has(file.type)) return true;
  return /\.(jpe?g|png|webp|pdf)$/i.test(file.name);
}

export function AssistantPage() {
  const qc = useQueryClient();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [base, setBase] = useState('');

  useEffect(() => {
    void getApiBaseUrl().then(setBase);
  }, []);

  const threads = useQuery({
    queryKey: ['assistant-threads'],
    queryFn: () => api<{ threads: ThreadSummary[] }>('/api/assistant/threads'),
  });

  useEffect(() => {
    const first = threads.data?.threads[0];
    if (!threadId && first) setThreadId(first.id);
  }, [threads.data, threadId]);

  const detail = useQuery({
    queryKey: ['assistant-thread', threadId],
    enabled: Boolean(threadId),
    queryFn: () => api<ThreadDetail>(`/api/assistant/threads/${threadId}`),
  });

  const status = useQuery({
    queryKey: ['assistant-status'],
    queryFn: () => api<AssistantStatus>('/api/assistant/status'),
  });

  const report = (err: unknown): Error => {
    pushError(err, 'Asistente');
    return err instanceof Error ? err : new Error('Error del asistente');
  };

  const send = useMutation({
    mutationFn: async (input: { prompt: string; files: File[]; retryMessageId?: string }) => {
      let id = threadId;
      if (!id) {
        const created = await api<{ id: string }>('/api/assistant/threads', { method: 'POST' });
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
    onSuccess: async ({ id }) => {
      setThreadId(id);
      setPrompt('');
      setFiles([]);
      await qc.invalidateQueries({ queryKey: ['assistant-thread', id] });
      await qc.invalidateQueries({ queryKey: ['assistant-threads'] });
    },
    onError: (err) => {
      pushError(err, 'Asistente');
    },
  });

  const addFiles = (list: FileList | File[]) => {
    const next = [...files];
    for (const file of list) {
      if (!fileOk(file)) {
        pushError(new Error(`«${file.name}» no es JPEG, PNG, WebP ni PDF.`), 'Asistente');
        continue;
      }
      next.push(file);
    }
    setFiles(next.slice(0, 8));
  };

  const createNew = async () => {
    const created = await api<{ id: string }>('/api/assistant/threads', { method: 'POST' });
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

  const messages = detail.data?.messages ?? [];
  const installed = status.data?.installed;

  if (!status.isFetched) {
    return (
      <div>
        <PageHeader title="Asistente" />
        <p className="text-[13px] text-surface-muted">Comprobando el modelo…</p>
      </div>
    );
  }

  if (!installed) {
    return (
      <div>
        <PageHeader title="Asistente" />
        <AssistantSetup />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AssistantModelBanner warm />
      <PageHeader
        title="Asistente"
        subtitle="Lee facturas y gastos en este PC. No se guarda nada hasta que aceptas."
        actions={
          <div className="flex gap-1.5">
            <Button variant="default" onClick={() => void createNew()}>Nueva conversación</Button>
            {import.meta.env.DEV && (
              <Button variant="ghost" onClick={() => void loadSample()}>Probar con un ejemplo</Button>
            )}
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {messages.length === 0 && (
          <p className="mt-3 text-[13px] text-surface-muted">
            Suelta una o varias fotos o PDF y, si quieres, una indicación: «es un ticket», «son tres facturas», «esto es dieta».
          </p>
        )}
        <div className="mt-3 space-y-3">
          {messages.map((message) => (
            <div key={message.id}>
              {message.role === 'user' ? (
                <p className="text-[13px] text-surface-ink">
                  <span className="text-surface-muted">Tú: </span>
                  {message.content || 'Documento adjunto'}
                  {message.files.length > 0 && (
                    <span className="text-surface-muted"> · {message.files.map((file) => file.filename).join(', ')}</span>
                  )}
                </p>
              ) : (
                <div className="space-y-2">
                  {message.summary && <p className="text-[13px] text-surface-ink">{message.summary}</p>}
                  {message.warnings.map((warning) => (
                    <p key={warning} className="text-[12px] text-surface-warn">{warning}</p>
                  ))}
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
                        previewUrl={file ? `${base}/api/assistant/files/${file.id}` : undefined}
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
          {send.isPending && (
            <p className="text-[13px] text-surface-muted" role="status">Leyendo el documento… puede tardar alrededor de un minuto.</p>
          )}
        </div>
      </div>
      <form
        className="mt-2 border border-surface-border bg-surface-panel p-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!installed) return;
          void send.mutateAsync({ prompt, files }).catch(() => undefined);
        }}
      >
        <div
          className={`border border-dashed px-2 py-3 text-[12px] ${drag ? 'border-surface-accent bg-surface-accent/5' : 'border-surface-border'}`}
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
          <label className="block cursor-pointer">
            Suelta aquí fotos o PDF, o pulsa para elegirlos.
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
              multiple
              className="sr-only"
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </label>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2">
                  <span>{file.name}</span>
                  <button
                    type="button"
                    className="text-surface-accent"
                    onClick={() => setFiles(files.filter((_, i) => i !== index))}
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className="mt-2 block text-[11px] text-surface-muted">
          Indicación
          <textarea
            className="mt-0.5 w-full border border-surface-border bg-white px-2 py-1 text-ui"
            rows={2}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Es una factura recibida de material de oficina"
          />
        </label>
        <div className="mt-2">
          <Button variant="primary" type="submit" disabled={send.isPending || !installed || files.length === 0}>
            {send.isPending ? 'Leyendo…' : 'Leer documentos'}
          </Button>
        </div>
      </form>
    </div>
  );
}
