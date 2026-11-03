import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProfileMeta,
  isProfileDir,
  prepareCreateProfileDir,
  resolveProfileDir,
  PROFILE_KIND,
} from './vault.js';

const dirs: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'autonomous-vault-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('vault profile contract', () => {
  it('rejects empty folder', () => {
    const d = tempDir();
    expect(isProfileDir(d)).toBe(false);
    const r = resolveProfileDir(d);
    expect(r.ok).toBe(false);
  });

  it('rejects vault.json without kind and without db', () => {
    const d = tempDir();
    writeFileSync(
      join(d, 'vault.json'),
      JSON.stringify({ name: 'Antonio', createdAt: '1' }),
      'utf8',
    );
    expect(isProfileDir(d)).toBe(false);
  });

  it('accepts marker kind', () => {
    const d = tempDir();
    createProfileMeta(d, 'Antonio');
    expect(isProfileDir(d)).toBe(true);
    const r = resolveProfileDir(d);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.meta.kind).toBe(PROFILE_KIND);
      expect(r.meta.name).toBe('Antonio');
    }
  });

  it('accepts legacy name + autonomous.db', () => {
    const d = tempDir();
    writeFileSync(
      join(d, 'vault.json'),
      JSON.stringify({ name: 'Legacy', createdAt: '1' }),
      'utf8',
    );
    writeFileSync(join(d, 'autonomous.db'), '');
    expect(isProfileDir(d)).toBe(true);
    const r = resolveProfileDir(d);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.meta.kind).toBe(PROFILE_KIND);
  });

  it('resolves single child profile', () => {
    const parent = tempDir();
    const child = join(parent, 'Antonio');
    mkdirSync(child);
    createProfileMeta(child, 'Antonio');
    writeFileSync(
      join(parent, 'vault.json'),
      JSON.stringify({ name: 'Antonio', createdAt: '1' }),
      'utf8',
    );
    expect(isProfileDir(parent)).toBe(false);
    const r = resolveProfileDir(parent);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dataDir).toBe(child);
  });

  it('prepareCreate refuses existing profile', () => {
    const parent = tempDir();
    const first = prepareCreateProfileDir(parent, 'Ana');
    expect(first.ok).toBe(true);
    const second = prepareCreateProfileDir(parent, 'Ana');
    expect(second.ok).toBe(false);
  });
});
