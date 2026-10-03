import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs, USAGE } from './cli';

describe('parseArgs', () => {
  it('resolves --dir to an absolute path', () => {
    expect(parseArgs(['--dir', 'foo/bar'])).toEqual({ dir: resolve('foo/bar'), allowWrite: false, lang: expect.any(String) });
  });
  it('expands a leading ~', () => {
    expect(parseArgs(['--dir', '~/Markpin']).dir).toBe(join(homedir(), 'Markpin'));
    expect(parseArgs(['--dir', '~']).dir).toBe(homedir());
  });
  it('throws the usage text when --dir is missing or has no value', () => {
    expect(() => parseArgs([])).toThrow(USAGE);
    expect(() => parseArgs(['--dir'])).toThrow(USAGE);
  });
  it('defaults to read-only and locale-based lang', () => {
    expect(parseArgs(['--dir', 'x'], { locale: 'ko-KR' })).toEqual({ dir: resolve('x'), allowWrite: false, lang: 'ko' });
    expect(parseArgs(['--dir', 'x'], { locale: 'en-US' })).toEqual({ dir: resolve('x'), allowWrite: false, lang: 'en' });
    expect(parseArgs(['--dir', 'x'], { locale: 'ja-JP' }).lang).toBe('ja');
    expect(parseArgs(['--dir', 'x'], { locale: 'es-419' }).lang).toBe('es');
    expect(parseArgs(['--dir', 'x'], { locale: 'pt-PT' }).lang).toBe('pt-BR');
    expect(parseArgs(['--dir', 'x'], { locale: 'pt_BR' }).lang).toBe('pt-BR');
    expect(parseArgs(['--dir', 'x'], { locale: 'de-AT' }).lang).toBe('de');
    expect(parseArgs(['--dir', 'x'], { locale: 'fr-CA' }).lang).toBe('fr');
    expect(parseArgs(['--dir', 'x'], { locale: 'zh-CN' }).lang).toBe('en');
  });
  it('accepts --allow-write and --lang (case-insensitive)', () => {
    expect(parseArgs(['--dir', 'x', '--allow-write', '--lang', 'en'], { locale: 'ko-KR' })).toEqual({ dir: resolve('x'), allowWrite: true, lang: 'en' });
    expect(parseArgs(['--allow-write', '--dir', 'x'], { locale: 'en-US' }).allowWrite).toBe(true);
    expect(parseArgs(['--dir', 'x', '--lang', 'pt-br']).lang).toBe('pt-BR');
    expect(parseArgs(['--dir', 'x', '--lang', 'FR']).lang).toBe('fr');
  });
  it('accepts --flag=value (MCP Registry named arguments)', () => {
    expect(parseArgs(['--dir=foo/bar', '--lang=de'], { locale: 'en-US' })).toEqual({ dir: resolve('foo/bar'), allowWrite: false, lang: 'de' });
    expect(parseArgs(['--dir=~/Markpin']).dir).toBe(join(homedir(), 'Markpin'));
    expect(parseArgs(['--dir=a=b']).dir).toBe(resolve('a=b'));
    expect(() => parseArgs(['--dir='])).toThrow(USAGE);
  });
  it('rejects an unknown --lang', () => {
    expect(() => parseArgs(['--dir', 'x', '--lang', 'xx'])).toThrow(USAGE);
    expect(() => parseArgs(['--dir', 'x', '--lang', 'pt'])).toThrow(USAGE);
    expect(() => parseArgs(['--dir', 'x', '--lang'])).toThrow(USAGE);
  });
});
