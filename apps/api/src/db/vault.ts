import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

export const PROFILE_KIND = 'autonomous-profile' as const;
export const PROFILE_FORMAT_VERSION = 1 as const;

export type VaultMeta = {
  kind: typeof PROFILE_KIND;
  formatVersion: number;
  name: string;
  createdAt: string;
};

export type ResolveProfileOk = { ok: true; dataDir: string; meta: VaultMeta };
export type ResolveProfileErr = { ok: false; message: string };
export type ResolveProfileResult = ResolveProfileOk | ResolveProfileErr;

export function vaultMetaPath(dataDir: string): string {
  return join(dataDir, 'vault.json');
}

export function dbPath(dataDir: string): string {
  return join(dataDir, 'autonomous.db');
}

function parseVaultRaw(dataDir: string): Record<string, unknown> | null {
  const path = vaultMetaPath(dataDir);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Raw meta if vault.json has a usable name (may lack kind). */
export function readVaultMetaLoose(dataDir: string): {
  name: string;
  createdAt: string;
  kind?: string;
  formatVersion?: number;
} | null {
  const raw = parseVaultRaw(dataDir);
  if (!raw) return null;
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
  return {
    name: raw.name.trim(),
    createdAt:
      typeof raw.createdAt === 'string' && raw.createdAt
        ? raw.createdAt
        : new Date().toISOString(),
    kind: typeof raw.kind === 'string' ? raw.kind : undefined,
    formatVersion:
      typeof raw.formatVersion === 'number' ? raw.formatVersion : undefined,
  };
}

export function readVaultMeta(dataDir: string): VaultMeta | null {
  if (!isProfileDir(dataDir)) return null;
  const loose = readVaultMetaLoose(dataDir);
  if (!loose) return null;
  return {
    kind: PROFILE_KIND,
    formatVersion: loose.formatVersion ?? PROFILE_FORMAT_VERSION,
    name: loose.name,
    createdAt: loose.createdAt,
  };
}

export function writeVaultMeta(dataDir: string, meta: VaultMeta): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    vaultMetaPath(dataDir),
    JSON.stringify(
      {
        kind: PROFILE_KIND,
        formatVersion: meta.formatVersion || PROFILE_FORMAT_VERSION,
        name: meta.name,
        createdAt: meta.createdAt,
      },
      null,
      2,
    ),
    'utf8',
  );
}

/** True if folder is an Auto-Gnomo profile (marker or legacy name+db). */
export function isProfileDir(dataDir: string): boolean {
  if (!dataDir || !existsSync(dataDir)) return false;
  try {
    if (!statSync(dataDir).isDirectory()) return false;
  } catch {
    return false;
  }
  const loose = readVaultMetaLoose(dataDir);
  if (!loose) return false;
  if (loose.kind === PROFILE_KIND) return true;
  // Legacy: name + SQLite present (accidental empty vault.json alone is NOT a profile)
  return existsSync(dbPath(dataDir));
}

/** Upgrade legacy vault.json to include kind/formatVersion. No-op if not a profile. */
export function upgradeLegacyVaultMeta(
  dataDir: string,
  opts: { name?: string } = {},
): VaultMeta | null {
  if (!isProfileDir(dataDir)) return null;
  const loose = readVaultMetaLoose(dataDir)!;
  const name = opts.name?.trim() || loose.name;
  const meta: VaultMeta = {
    kind: PROFILE_KIND,
    formatVersion: PROFILE_FORMAT_VERSION,
    name,
    createdAt: loose.createdAt,
  };
  writeVaultMeta(dataDir, meta);
  return meta;
}

/** Create a new profile marker. Fails conceptually if already a profile (caller checks). */
export function createProfileMeta(dataDir: string, name: string): VaultMeta {
  const meta: VaultMeta = {
    kind: PROFILE_KIND,
    formatVersion: PROFILE_FORMAT_VERSION,
    name: name.trim() || basename(dataDir) || 'Perfil',
    createdAt: new Date().toISOString(),
  };
  writeVaultMeta(dataDir, meta);
  return meta;
}

/**
 * Rename / touch meta for an already-open profile.
 * Does NOT create a profile from an empty folder.
 */
export function ensureVaultMeta(
  dataDir: string,
  opts: { name?: string; fallbackName?: string } = {},
): VaultMeta {
  if (isProfileDir(dataDir)) {
    return (
      upgradeLegacyVaultMeta(dataDir, { name: opts.name }) ??
      createProfileMeta(
        dataDir,
        opts.name?.trim() || opts.fallbackName || basename(dataDir) || 'Perfil',
      )
    );
  }
  throw new Error(
    `La carpeta «${dataDir}» no es un perfil de Auto-Gnomo (falta vault.json válido).`,
  );
}

function listImmediateProfileChildren(parent: string): string[] {
  if (!existsSync(parent)) return [];
  let entries: string[];
  try {
    entries = readdirSync(parent);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const child = join(parent, entry);
    try {
      if (!statSync(child).isDirectory()) continue;
    } catch {
      continue;
    }
    if (isProfileDir(child)) out.push(child);
  }
  return out;
}

/**
 * Resolve a path to a profile directory.
 * - If path is a profile → use it
 * - Else if exactly one child profile → use that (Antonio/Antonio case)
 * - Else error with a clear message
 */
export function resolveProfileDir(path: string): ResolveProfileResult {
  const dataDir = path.trim();
  if (!dataDir) {
    return { ok: false, message: 'La ruta de la carpeta está vacía' };
  }
  if (!existsSync(dataDir)) {
    return {
      ok: false,
      message: `La carpeta «${dataDir}» no existe`,
    };
  }
  try {
    if (!statSync(dataDir).isDirectory()) {
      return { ok: false, message: `«${dataDir}» no es una carpeta` };
    }
  } catch {
    return { ok: false, message: `No se pudo leer «${dataDir}»` };
  }

  if (isProfileDir(dataDir)) {
    const meta = upgradeLegacyVaultMeta(dataDir)!;
    return { ok: true, dataDir, meta };
  }

  const children = listImmediateProfileChildren(dataDir);
  if (children.length === 1) {
    const child = children[0]!;
    const meta = upgradeLegacyVaultMeta(child)!;
    return { ok: true, dataDir: child, meta };
  }
  if (children.length > 1) {
    const list = children.map((c) => `• ${c}`).join('\n');
    return {
      ok: false,
      message: `«${dataDir}» no es un perfil, pero contiene varios. Abre uno de estos:\n${list}`,
    };
  }

  return {
    ok: false,
    message: `«${basename(dataDir) || dataDir}» no es un perfil de Auto-Gnomo. Elige la carpeta que contiene vault.json (creada con «Crear perfil»), no una carpeta padre genérica.`,
  };
}

export function sanitizeProfileFolderName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.+$/g, '')
    .trim();
  return cleaned || 'Perfil';
}

export function joinProfilePath(parent: string, name: string): string {
  const base = parent.replace(/[\\/]+$/, '');
  const folder = sanitizeProfileFolderName(name);
  const sep = parent.includes('/') && !parent.includes('\\') ? '/' : '\\';
  return `${base}${sep}${folder}`;
}

/**
 * Prepare a new profile directory under parent (or at path if name omitted).
 * Refuses if the target is already a profile.
 */
export function prepareCreateProfileDir(
  parentOrPath: string,
  name?: string,
): ResolveProfileResult {
  const base = parentOrPath.trim();
  if (!base) {
    return { ok: false, message: 'La ruta de la carpeta está vacía' };
  }
  const profileName = name?.trim();
  if (!profileName) {
    return { ok: false, message: 'Indica un nombre para el perfil' };
  }
  const dataDir = joinProfilePath(base, profileName);
  if (isProfileDir(dataDir)) {
    return {
      ok: false,
      message: `Ya existe un perfil en «${dataDir}»`,
    };
  }
  mkdirSync(dataDir, { recursive: true });
  const meta = createProfileMeta(dataDir, profileName);
  return { ok: true, dataDir, meta };
}
