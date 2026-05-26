import { describe, it, expect } from 'vitest';
import { synthesize, fetchSpeakers, flattenSpeakers, type FetchLike } from '../src/main/voicevox/ttsClient';

describe('flattenSpeakers', () => {
  it('flattens characters and styles into {speaker,label}', () => {
    const raw = [
      { name: 'ずんだもん', styles: [{ name: 'ノーマル', id: 3 }, { name: 'あまあま', id: 1 }] },
      { name: '四国めたん', styles: [{ name: 'ノーマル', id: 2 }] },
    ];
    expect(flattenSpeakers(raw)).toEqual([
      { speaker: 3, label: 'ずんだもん（ノーマル）' },
      { speaker: 1, label: 'ずんだもん（あまあま）' },
      { speaker: 2, label: '四国めたん（ノーマル）' },
    ]);
  });
});

describe('synthesize', () => {
  it('calls audio_query then synthesis, injects speedScale, returns the wav buffer', async () => {
    const calls: { url: string; init?: any }[] = [];
    const fake: FetchLike = async (url, init) => {
      calls.push({ url, init });
      if (url.includes('/audio_query')) {
        return { ok: true, status: 200, json: async () => ({ speedScale: 1.0, accent_phrases: [] }), arrayBuffer: async () => new ArrayBuffer(0) };
      }
      return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new TextEncoder().encode('WAVDATA').buffer };
    };

    const buf = await synthesize('http://e', { text: 'こんにちは', speaker: 3, speed: 1.3 }, fake);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('/audio_query?text=');
    expect(calls[0].url).toContain('speaker=3');
    expect(calls[1].url).toBe('http://e/synthesis?speaker=3');
    expect(JSON.parse(calls[1].init.body).speedScale).toBe(1.3);
    expect(buf.toString()).toBe('WAVDATA');
  });

  it('throws when audio_query is not ok', async () => {
    const fake: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(synthesize('http://e', { text: 'x', speaker: 3, speed: 1 }, fake)).rejects.toThrow();
  });
});

describe('fetchSpeakers', () => {
  it('GETs /speakers and returns the parsed list', async () => {
    const fake: FetchLike = async (url) => ({
      ok: true, status: 200,
      json: async () => (url.endsWith('/speakers') ? [{ name: 'A', styles: [{ name: 'N', id: 1 }] }] : []),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    expect(await fetchSpeakers('http://e', fake)).toEqual([{ name: 'A', styles: [{ name: 'N', id: 1 }] }]);
  });
});
