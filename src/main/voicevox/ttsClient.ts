import { type SpeakerOption } from '../../shared/types';

export interface SynthesizeInput {
  text: string;
  speaker: number;
  speed: number;
}

export interface RawSpeakerStyle {
  name: string;
  id: number;
}
export interface RawSpeaker {
  name: string;
  styles: RawSpeakerStyle[];
}

/** テストで差し替え可能な最小 fetch 型。本番では global fetch を使う。 */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const defaultFetch = globalThis.fetch as unknown as FetchLike;

/** /speakers の構造をレンダラ向けの {speaker,label} 配列に平坦化する。 */
export function flattenSpeakers(raw: RawSpeaker[]): SpeakerOption[] {
  const out: SpeakerOption[] = [];
  for (const c of raw) {
    for (const s of c.styles) {
      out.push({ speaker: s.id, label: `${c.name}（${s.name}）` });
    }
  }
  return out;
}

/** /speakers を取得する。 */
export async function fetchSpeakers(baseUrl: string, fetchFn: FetchLike = defaultFetch): Promise<RawSpeaker[]> {
  const res = await fetchFn(`${baseUrl}/speakers`);
  if (!res.ok) throw new Error(`/speakers failed (${res.status})`);
  return (await res.json()) as RawSpeaker[];
}

/** audio_query → speedScale 設定 → synthesis の順で合成し wav バイト列を返す。 */
export async function synthesize(
  baseUrl: string,
  input: SynthesizeInput,
  fetchFn: FetchLike = defaultFetch,
): Promise<Buffer> {
  const q = await fetchFn(
    `${baseUrl}/audio_query?text=${encodeURIComponent(input.text)}&speaker=${input.speaker}`,
    { method: 'POST' },
  );
  if (!q.ok) throw new Error(`audio_query failed (${q.status})`);
  const query = (await q.json()) as Record<string, unknown>;
  query['speedScale'] = input.speed;

  const s = await fetchFn(`${baseUrl}/synthesis?speaker=${input.speaker}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  if (!s.ok) throw new Error(`synthesis failed (${s.status})`);
  return Buffer.from(await s.arrayBuffer());
}
