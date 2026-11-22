import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadToFile } from './download.js';

const payload = Buffer.from('abcdefghijklmnopqrstuvwxyz');

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

describe('downloadToFile', () => {
  let server: Server | null = null;
  let dir = '';

  afterEach(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  it('reanuda el archivo a medias cuando la conexión se corta', async () => {
    let hits = 0;
    server = createServer((req, res) => {
      hits += 1;
      const range = req.headers.range;
      if (!range) {
        if (hits === 1) {
          res.writeHead(200, { 'content-length': String(payload.length) });
          res.write(payload.subarray(0, 10));
          return;
        }
        res.writeHead(200, { 'content-length': String(payload.length) });
        res.end(payload);
        return;
      }
      const start = Number(String(range).replace(/^bytes=/, '').split('-')[0]);
      const slice = payload.subarray(start);
      res.writeHead(206, {
        'content-length': String(slice.length),
        'content-range': `bytes ${start}-${payload.length - 1}/${payload.length}`,
      });
      res.end(slice);
    });
    const port = await listen(server);
    dir = await mkdtemp(join(tmpdir(), 'autognomo-dl-'));
    const dest = join(dir, 'file.bin');

    await downloadToFile(`http://127.0.0.1:${port}/file.bin`, dest, () => {}, {
      stallMs: 200,
      responseMs: 2_000,
      maxAttempts: 4,
    });

    expect(hits).toBeGreaterThanOrEqual(2);
    expect((await readFile(dest)).equals(payload)).toBe(true);
  });

  it('no duplica bytes si el servidor ignora Range y manda el archivo entero', async () => {
    let hits = 0;
    server = createServer((_req, res) => {
      hits += 1;
      if (hits === 1) {
        res.writeHead(200, { 'content-length': String(payload.length) });
        res.write(payload.subarray(0, 8));
        return;
      }
      res.writeHead(200, { 'content-length': String(payload.length) });
      res.end(payload);
    });
    const port = await listen(server);
    dir = await mkdtemp(join(tmpdir(), 'autognomo-dl-'));
    const dest = join(dir, 'file.bin');

    await downloadToFile(`http://127.0.0.1:${port}/file.bin`, dest, () => {}, {
      stallMs: 200,
      responseMs: 2_000,
      maxAttempts: 4,
    });

    expect((await readFile(dest)).equals(payload)).toBe(true);
  });

  it('no reintenta un 404', async () => {
    let hits = 0;
    server = createServer((_req, res) => {
      hits += 1;
      res.writeHead(404);
      res.end();
    });
    const port = await listen(server);
    dir = await mkdtemp(join(tmpdir(), 'autognomo-dl-'));

    await expect(
      downloadToFile(`http://127.0.0.1:${port}/missing`, join(dir, 'file.bin'), () => {}, {
        stallMs: 200,
        maxAttempts: 4,
      }),
    ).rejects.toThrow(/404/);
    expect(hits).toBe(1);
  });
});
