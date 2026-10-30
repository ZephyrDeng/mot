import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveBindTarget } from '../src/slack/bind.js';

const base = mkdtempSync(join(tmpdir(), 'pitag-bind-'));
const rootA = join(base, 'a');
const rootB = join(base, 'b');
for (const dir of ['a/melora', 'a/shared', 'b/shared', 'b/relay-server']) {
  mkdirSync(join(base, dir), { recursive: true });
}
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('resolveBindTarget', () => {
  it('finds a bare name in exactly one root', () => {
    expect(resolveBindTarget('melora', 'x', [rootA, rootB])).toEqual({
      ok: true,
      cwd: join(rootA, 'melora'),
    });
  });

  it('defaults to the channel name when no argument is given', () => {
    expect(resolveBindTarget('', 'relay-server', [rootA, rootB])).toEqual({
      ok: true,
      cwd: join(rootB, 'relay-server'),
    });
  });

  it('reports ambiguity when several roots match', () => {
    const r = resolveBindTarget('shared', 'x', [rootA, rootB]);
    expect(r).toMatchObject({ ok: false, reason: 'ambiguous' });
  });

  it('reports missing names and paths', () => {
    expect(resolveBindTarget('nope', 'x', [rootA])).toMatchObject({ ok: false, reason: 'missing' });
    expect(resolveBindTarget(join(base, 'nope'), 'x', [rootA])).toMatchObject({
      ok: false,
      reason: 'missing',
    });
  });

  it('accepts an absolute path', () => {
    expect(resolveBindTarget(join(rootB, 'shared'), 'x', [])).toEqual({
      ok: true,
      cwd: join(rootB, 'shared'),
    });
  });

  it('rejects names that could escape a root', () => {
    for (const bad of ['..', '../a', 'a/melora']) {
      expect(resolveBindTarget(bad, 'x', [rootA])).toMatchObject({ ok: false, reason: 'invalid' });
    }
  });
});
