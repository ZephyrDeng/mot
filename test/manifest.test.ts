import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildManifest, deriveBotName } from '../src/manifest.js';

/** Drop comments and blank lines so only the actual manifest structure is compared. */
function stripComments(yaml: string): string[] {
  return yaml.split('\n').filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
}

describe('buildManifest', () => {
  it('matches the shipped manifest.yaml by default', () => {
    const shipped = readFileSync(resolve(__dirname, '../manifest.yaml'), 'utf8');
    expect(stripComments(buildManifest())).toEqual(stripComments(shipped));
  });

  it('applies a custom app name, bot name, and slash command', () => {
    const yaml = buildManifest({ name: 'Mot MacBook', command: 'motmac' });

    expect(yaml).toContain('  name: Mot MacBook');
    expect(yaml).toContain('    display_name: mot-macbook');
    expect(yaml).toContain('    - command: /motmac');
    expect(yaml).toContain('description: Manage the Mot MacBook session in this channel');
    expect(yaml).toContain('SLASH_COMMAND=/motmac');
    expect(yaml).not.toContain('/mot\n');
  });

  it('quotes names that are not plain YAML scalars', () => {
    const yaml = buildManifest({ name: 'Mot: laptop #2', botName: 'mot-laptop' });
    expect(yaml).toContain('  name: "Mot: laptop #2"');
  });

  it('rejects invalid input', () => {
    expect(() => buildManifest({ name: '  ' })).toThrow(/--name/);
    expect(() => buildManifest({ name: 'x'.repeat(36) })).toThrow(/35/);
    expect(() => buildManifest({ command: '/Mot Mac' })).toThrow(/SLASH_COMMAND/);
    expect(() => buildManifest({ name: '！！！' })).toThrow(/--bot-name/);
  });
});

describe('deriveBotName', () => {
  it('lowercases, hyphenates spaces, and strips invalid characters', () => {
    expect(deriveBotName('Mot MacBook')).toBe('mot-macbook');
    expect(deriveBotName(' My Bot! (2) ')).toBe('my-bot-2');
  });
});
