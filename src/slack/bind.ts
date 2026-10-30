/**
 * Resolve the working directory for `/pi bind [name|path]`.
 *
 * - absolute or `~/` path → used as-is (must be an existing directory)
 * - bare name (defaults to the channel name) → `<root>/<name>` for each root
 *   in PROJECT_ROOTS; exactly one match is required.
 */

import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export type BindResolution =
  | { ok: true; cwd: string }
  | { ok: false; reason: 'missing' | 'ambiguous' | 'invalid'; candidates: string[] };

const NAME_RE = /^[A-Za-z0-9._-]+$/;

export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function resolveBindTarget(
  input: string,
  channelName: string,
  roots: string[],
): BindResolution {
  const raw = input.trim() || channelName.trim();

  if (raw.startsWith('~') || isAbsolute(raw)) {
    const cwd = resolve(expandHome(raw));
    return isDir(cwd) ? { ok: true, cwd } : { ok: false, reason: 'missing', candidates: [cwd] };
  }

  // Bare names only: no separators or `..`, so a name can't escape its root.
  if (!NAME_RE.test(raw) || raw === '.' || raw === '..') {
    return { ok: false, reason: 'invalid', candidates: [] };
  }

  const matches = [...new Set(roots.map((root) => resolve(expandHome(root), raw)))].filter(isDir);
  if (matches.length === 1) return { ok: true, cwd: matches[0] };
  return matches.length === 0
    ? { ok: false, reason: 'missing', candidates: roots.map((root) => resolve(expandHome(root))) }
    : { ok: false, reason: 'ambiguous', candidates: matches };
}
