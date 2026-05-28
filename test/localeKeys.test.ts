import { describe, it, expect } from 'vitest';
import ja from '../src/shared/i18n/locales/ja.json';
import en from '../src/shared/i18n/locales/en.json';

function collectKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${k}` : k;
    out.push(...collectKeys(v, next));
  }
  return out.sort();
}

function extractPlaceholders(value: string): string[] {
  return Array.from(value.matchAll(/\{\{(\w+)[^}]*\}\}/g), (m) => m[1]).sort();
}

function flatStrings(obj: unknown, prefix = ''): Array<[string, string]> {
  if (typeof obj === 'string') return [[prefix, obj]];
  if (typeof obj !== 'object' || obj === null) return [];
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${k}` : k;
    out.push(...flatStrings(v, next));
  }
  return out;
}

describe('locale files', () => {
  it('ja and en define the same set of keys', () => {
    const jaKeys = collectKeys(ja);
    const enKeys = collectKeys(en);
    expect(enKeys).toEqual(jaKeys);
  });

  it('each translated string has the same set of placeholders in ja and en', () => {
    const jaMap = new Map(flatStrings(ja));
    const enMap = new Map(flatStrings(en));
    const mismatches: string[] = [];
    for (const [key, jaText] of jaMap) {
      const enText = enMap.get(key);
      if (enText === undefined) continue; // covered by the key-set test
      const jaPh = extractPlaceholders(jaText);
      const enPh = extractPlaceholders(enText);
      if (JSON.stringify(jaPh) !== JSON.stringify(enPh)) {
        mismatches.push(`${key}: ja=${JSON.stringify(jaPh)} en=${JSON.stringify(enPh)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
