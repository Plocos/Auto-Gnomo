import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { AppError, ErrorCodes } from '@autonomous/shared';
import { env } from '../config.js';
import { getDb } from '../db/sqlite.js';
import {
  acceptProposal,
  createSampleThread,
  createThread,
  discardProposal,
  findStoredFile,
  getThread,
  listThreads,
  postMessage,
  storedFilePath,
  type Upload,
} from '../assistant/service.js';
import {
  beginInstall,
  readAssistantStatus,
  removeAssistantModel,
  subscribeAssistant,
  ensureRuntime,
} from '../assistant/runtime.js';

export async function registerAssistantRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/assistant/status', async () => readAssistantStatus());

  app.post('/api/assistant/install', async (req) => {
    const body = (req.body ?? {}) as { force?: boolean };
    beginInstall(Boolean(body.force));
    return readAssistantStatus();
  });

  app.delete('/api/assistant/model', async () => {
    try {
      await removeAssistantModel();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo borrar el modelo.';
      throw new AppError(ErrorCodes.CONFLICT, message, 409);
    }
    return readAssistantStatus();
  });

  app.get('/api/assistant/install/events', (req, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    let closed = false;
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      unsubscribe();
    };
    const send = (status: unknown) => {
      if (closed) return;
      try {
        raw.write(`data: ${JSON.stringify(status)}\n\n`);
      } catch {
        stop();
      }
    };
    void readAssistantStatus().then(send).catch(stop);
    unsubscribe = subscribeAssistant(send);
    timer = setInterval(() => {
      if (closed) return;
      try {
        raw.write(': ping\n\n');
      } catch {
        stop();
      }
    }, 15000);
    req.raw.on('close', stop);
    raw.on('close', stop);
    raw.on('error', stop);
  });

  app.post('/api/assistant/warmup', async () => {
    await ensureRuntime();
    return readAssistantStatus();
  });

  app.get('/api/assistant/threads', async () => ({ threads: listThreads(getDb()) }));

  app.post('/api/assistant/threads', async () => createThread(getDb()));

  app.get('/api/assistant/threads/:threadId', async (req) => {
    const { threadId } = req.params as { threadId: string };
    return getThread(getDb(), threadId);
  });

  app.get('/api/assistant/files/:fileId', async (req, reply) => {
    const { fileId } = req.params as { fileId: string };
    const file = findStoredFile(getDb(), fileId);
    const path = storedFilePath(file);
    const info = await stat(path);
    return reply
      .header('Content-Type', file.mime)
      .header('Content-Length', String(info.size))
      .header('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`)
      .send(createReadStream(path));
  });

  app.post('/api/assistant/threads/:threadId/messages/:messageId/proposals/:proposalId/accept', async (req) => {
    const { threadId, messageId, proposalId } = req.params as {
      threadId: string;
      messageId: string;
      proposalId: string;
    };
    return acceptProposal(getDb(), threadId, messageId, proposalId, req.body);
  });

  app.post('/api/assistant/threads/:threadId/messages/:messageId/proposals/:proposalId/discard', async (req) => {
    const { threadId, messageId, proposalId } = req.params as {
      threadId: string;
      messageId: string;
      proposalId: string;
    };
    const proposals = await discardProposal(getDb(), threadId, messageId, proposalId);
    return { proposals };
  });

  if (env.nodeEnv !== 'production') {
    app.post('/api/assistant/dev/sample', async () => createSampleThread(getDb()));
  }

  await app.register(async (scope) => {
    await scope.register(multipart, {
      limits: { fileSize: 20 * 1024 * 1024, files: 8, fields: 8 },
    });
    scope.post('/api/assistant/threads/:threadId/messages', async (req) => {
      const { threadId } = req.params as { threadId: string };
      let prompt = '';
      let retryMessageId = '';
      const uploads: Upload[] = [];
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          uploads.push({
            filename: part.filename,
            mime: part.mimetype,
            buffer: await part.toBuffer(),
          });
        } else if (part.fieldname === 'prompt') {
          prompt = String(part.value ?? '');
        } else if (part.fieldname === 'retryMessageId') {
          retryMessageId = String(part.value ?? '');
        }
      }
      return postMessage(getDb(), threadId, {
        prompt,
        retryMessageId: retryMessageId || undefined,
        uploads,
      });
    });
  });
}
