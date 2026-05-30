import { type Segment } from '../../shared/types';

export interface SlotProgressHint {
  slotId: string;
  offsetInSlot: number;
  visibleDuration: number;
}

export interface TtsPreviewCallbacks {
  onActiveSegment?: (segmentId: string | null) => void;
  /** 現在の映像時刻（秒）。再生ヘッド表示用。 */
  onTime?: (videoTime: number) => void;
  onEnded?: () => void;
  /** rAF 毎に現スロットの進捗を通知。新モデルでは常に null（互換のため残置）。 */
  onSlotProgress?: (hint: SlotProgressHint | null) => void;
}

/**
 * 各セグメントの TTS 音声を Web Audio でスケジュール再生する。
 *
 * モデル: 映像 (<video>) を主時計とし、各セグメントの TTS 音声を
 * `videoStart` 秒から始まるよう ctx.currentTime にアンカーしてスケジュールする。
 * 元音声モードと同様、映像は 0 から連続して再生され、ギャップ区間や
 * 先頭の未使用区間（seg[0].videoStart > 0 の場合）も映像として見える。
 * 再生ヘッドは `video.currentTime` を素直に通知するため一定速度で進む。
 */
export class TtsPreviewController {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private segments: Segment[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private rafId: number | null = null;
  /** ctx.currentTime と video.currentTime=0 が一致するよう取った時刻アンカー。 */
  private startCtxTime = 0;
  /** すべての TTS 音声が鳴り終わる ctx 時刻。video.ended 後の鳴り残り判定に使う。 */
  private audioEndCtxTime = 0;
  private playing = false;
  private video: HTMLVideoElement | null = null;
  private activeId: string | null = null;
  private playGen = 0;
  private loadGen = 0;

  constructor(private cb: TtsPreviewCallbacks = {}) {}

  private ensureCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  /** 各セグメントの TTS をデコードして保持する。
   *  並行 load が来た場合は新しい方が勝つ（古い load の途中結果は反映しない）。 */
  async load(segments: Segment[], projectDir: string): Promise<void> {
    await this.stop();
    const myGen = ++this.loadGen;
    const ctx = this.ensureCtx();
    const nextBuffers = new Map<string, AudioBuffer>();
    for (const seg of segments) {
      if (!seg.ttsAudio) continue;
      try {
        const url = `c2m://asset/${seg.ttsAudio}?p=${encodeURIComponent(projectDir)}`;
        const res = await fetch(url);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        if (myGen !== this.loadGen) return;
        nextBuffers.set(seg.id, buf);
      } catch {
        if (myGen !== this.loadGen) return;
        // デコード失敗はサイレント扱い（その segment は音声無しで映像のみ）
      }
    }
    if (myGen !== this.loadGen) return;
    this.buffers = nextBuffers;
    this.segments = [...segments];
  }

  hasSlots(): boolean { return this.segments.length > 0; }

  /** enabled なセグメントのうち TTS バッファを持たないものがあれば true。
   *  UI 上の「TTS未生成のセグメントは無音で再生されます」ヒント表示用。 */
  missingClips(): boolean {
    return this.segments.some(
      (s) => s.enabled !== false && (!s.ttsAudio || !this.buffers.has(s.id)),
    );
  }

  /** video.currentTime から再生開始。 */
  async play(video: HTMLVideoElement): Promise<boolean> {
    const ctx = this.ensureCtx();
    if (this.segments.length === 0) return false;
    const gen = ++this.playGen;
    if (ctx.state === 'suspended') await ctx.resume();
    if (gen !== this.playGen) return false;
    this.teardown();
    this.video = video;
    this.playing = true;

    // 映像終端付近で押した場合は先頭から再生し直す
    if (Number.isFinite(video.duration) && video.duration > 0
        && video.currentTime >= video.duration - 0.05) {
      video.currentTime = 0;
    }
    const videoTime = video.currentTime;

    // ctx.currentTime と video.currentTime=0 を対応付けるアンカー
    this.startCtxTime = ctx.currentTime - videoTime;
    this.audioEndCtxTime = 0;

    // enabled な各セグメントの TTS 音声を videoStart 時刻にスケジュール
    for (const seg of this.segments) {
      if (seg.enabled === false) continue;
      const buf = this.buffers.get(seg.id);
      if (!buf) continue;
      const when = this.startCtxTime + seg.videoStart;
      const seekOffset = ctx.currentTime - when; // 0 より大なら「すでに開始位置を過ぎた」
      if (seekOffset >= buf.duration) continue; // 音声がすでに鳴り終わっている
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      if (seekOffset <= 0) {
        src.start(when);
      } else {
        src.start(ctx.currentTime, seekOffset);
      }
      this.sources.push(src);
      const audioEnd = when + buf.duration;
      if (audioEnd > this.audioEndCtxTime) this.audioEndCtxTime = audioEnd;
    }

    try { await video.play(); } catch { /* autoplay 制限は無視 */ }
    if (gen !== this.playGen) return false;

    this.rafId = requestAnimationFrame(this.tick);
    return true;
  }

  pause(): void {
    this.playGen++;
    this.teardown();
    this.playing = false;
    this.video?.pause();
    // video.currentTime はブラウザが保持するため、resume 時は再度 play() を呼ぶだけ。
    this.cb.onSlotProgress?.(null);
  }

  /** 完全停止して AudioContext も閉じる。await 必須（後続の <audio> 再生時に
   *  音声デバイスが確実に解放されている状態にするため）。 */
  async stop(): Promise<void> {
    this.playGen++;
    this.teardown();
    this.playing = false;
    this.video?.pause();
    this.video = null;
    if (this.activeId !== null) {
      this.activeId = null;
      this.cb.onActiveSegment?.(null);
    }
    this.cb.onSlotProgress?.(null);
    const ctxToClose = this.ctx;
    this.ctx = null;
    if (ctxToClose && ctxToClose.state !== 'closed') {
      try { await ctxToClose.close(); } catch { /* 競合は無視 */ }
    }
  }

  dispose(): void {
    void this.stop();
  }

  private tick = (): void => {
    const ctx = this.ctx;
    if (!ctx || !this.video || !this.playing) return;
    const videoTime = this.video.currentTime;
    this.cb.onTime?.(videoTime);

    // アクティブセグメントを videoTime から判定（enabled な範囲に入っているもの）
    const active = this.segments.find(
      (s) => s.enabled !== false && videoTime >= s.videoStart && videoTime < s.videoEnd,
    );
    const activeId = active?.id ?? null;
    if (activeId !== this.activeId) {
      this.activeId = activeId;
      this.cb.onActiveSegment?.(activeId);
    }

    // 終了判定: 映像が終端に達して、かつ全 TTS が鳴り終わっている
    const videoEnded = this.video.ended
      || (Number.isFinite(this.video.duration) && this.video.duration > 0
          && videoTime >= this.video.duration - 0.05);
    const audioEnded = this.audioEndCtxTime === 0 || ctx.currentTime >= this.audioEndCtxTime;
    if (videoEnded && audioEnded) {
      this.finish();
      return;
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  private finish(): void {
    this.teardown();
    this.playing = false;
    this.video?.pause();
    this.activeId = null;
    this.cb.onActiveSegment?.(null);
    this.cb.onSlotProgress?.(null);
    this.cb.onEnded?.();
  }

  private teardown(): void {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* 既に停止済み */ }
      s.disconnect();
    }
    this.sources = [];
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
