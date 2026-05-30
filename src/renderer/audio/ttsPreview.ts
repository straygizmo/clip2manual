import { type Segment } from '../../shared/types';
import { computePreviewTimeline, type PreviewSlot } from '../../shared/previewTimeline';

export interface SlotProgressHint {
  slotId: string;
  offsetInSlot: number;
  visibleDuration: number;  // = clipDuration > 0 ? clipDuration : videoSpan
}

export interface TtsPreviewCallbacks {
  onActiveSegment?: (segmentId: string | null) => void;
  /** 現在の映像時刻（秒）。再生ヘッド表示用。 */
  onTime?: (videoTime: number) => void;
  onEnded?: () => void;
  /** rAF 毎に現スロットの進捗を通知。フリーズ/tail/停止中は null。 */
  onSlotProgress?: (hint: SlotProgressHint | null) => void;
}

const DRIFT_THRESHOLD = 0.25; // 秒。再生中、これを超えたら映像時刻を補正する。
const FREEZE_THRESHOLD = 0.05; // 秒。フリーズ中、映像を videoEnd に保つ許容差。

/**
 * 各セグメントの TTS を Web Audio でスケジュール再生し（音声=master clock）、
 * rAF で映像要素を駆動する（区間内はネイティブ再生、区間外は末尾フレームでフリーズ）。
 */
export class TtsPreviewController {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private slots: PreviewSlot[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private rafId: number | null = null;
  private startCtxTime = 0; // previewTime=0 に対応する ctx.currentTime
  private positionTime = 0; // 一時停止位置（秒）
  private playing = false;
  private video: HTMLVideoElement | null = null;
  private activeId: string | null = null;
  private playGen = 0; // play() の await 中に pause/stop が来た場合の無効化用
  private loadGen = 0; // load() の await 中に別の load が来た場合、古い側の書き込みを破棄するための世代カウンタ

  constructor(private cb: TtsPreviewCallbacks = {}) {}

  private ensureCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  /** 各セグメントの TTS をデコードしてタイムラインを構築する。
   *  並行 load が来た場合は新しい方が勝つ（古い load の途中結果は反映しない）。 */
  async load(segments: Segment[], projectDir: string): Promise<void> {
    await this.stop();
    const myGen = ++this.loadGen;
    const ctx = this.ensureCtx();
    const nextBuffers = new Map<string, AudioBuffer>();
    const durations = new Map<string, number>();
    for (const seg of segments) {
      if (!seg.ttsAudio) continue;
      try {
        const url = `c2m://asset/${seg.ttsAudio}?p=${encodeURIComponent(projectDir)}`;
        const res = await fetch(url);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        if (myGen !== this.loadGen) return; // 後続の load に取って代わられた
        nextBuffers.set(seg.id, buf);
        durations.set(seg.id, buf.duration);
      } catch {
        if (myGen !== this.loadGen) return;
        // デコード失敗は無音区間として扱う（clipDuration=0）
      }
    }
    if (myGen !== this.loadGen) return;
    this.buffers = nextBuffers;
    this.slots = computePreviewTimeline(segments, durations);
    this.positionTime = 0;
  }

  hasSlots(): boolean { return this.slots.length > 0; }
  missingClips(): boolean { return this.slots.some((s) => s.clipDuration === 0); }

  get totalDuration(): number {
    const last = this.slots[this.slots.length - 1];
    return last ? last.slotStart + last.slotDuration : 0;
  }

  /** positionTime から再生する（末尾到達後は先頭から）。実際に再生を開始したら true。 */
  async play(video: HTMLVideoElement): Promise<boolean> {
    const ctx = this.ensureCtx();
    if (this.slots.length === 0) return false;
    const gen = ++this.playGen;
    if (ctx.state === 'suspended') await ctx.resume();
    if (gen !== this.playGen) return false; // resume 待ちの間に pause/stop/別の play が来た
    this.teardown();
    this.video = video;
    this.playing = true;

    const from = this.positionTime >= this.totalDuration ? 0 : this.positionTime;
    this.positionTime = from;
    this.startCtxTime = ctx.currentTime - from;

    for (const slot of this.slots) {
      const buf = this.buffers.get(slot.segmentId);
      if (!buf) continue;
      const clipEnd = slot.slotStart + buf.duration;
      if (from >= clipEnd) continue; // この区間の音声は再生済み
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      const when = this.startCtxTime + slot.slotStart;
      if (when >= ctx.currentTime) {
        src.start(when);
      } else {
        src.start(ctx.currentTime, from - slot.slotStart); // 区間途中から
      }
      this.sources.push(src);
    }

    const slot = this.slotAt(from) ?? this.slots[0];
    const videoSpan = Math.max(0, slot.videoEnd - slot.videoStart);
    video.currentTime = slot.videoStart + Math.min(Math.max(0, from - slot.slotStart), videoSpan);
    try { await video.play(); } catch { /* autoplay 制限は無視 */ }
    if (gen !== this.playGen) return false; // video.play() 待ちの間に中断された

    this.rafId = requestAnimationFrame(this.tick);
    return true;
  }

  pause(): void {
    this.playGen++; // 進行中の play() の await を無効化する
    // 直近の rAF からの誤差を避け、音声クロックから正確な位置を確定する
    if (this.ctx && this.playing) this.positionTime = this.ctx.currentTime - this.startCtxTime;
    this.teardown();
    this.playing = false;
    this.video?.pause();
    this.cb.onSlotProgress?.(null);
  }

  /** 完全停止して AudioContext も閉じる。close() は async なので、呼び出し側は
   *  await すること。await しないと、後続で <audio> 要素を play しても音声出力
   *  デバイスがまだ TTS の ctx に握られて鳴らない / 歪む。 */
  async stop(): Promise<void> {
    this.playGen++;
    this.teardown();
    this.playing = false;
    this.video?.pause();
    this.video = null;
    this.positionTime = 0;
    if (this.activeId !== null) {
      this.activeId = null;
      this.cb.onActiveSegment?.(null);
    }
    this.cb.onSlotProgress?.(null);
    const ctxToClose = this.ctx;
    this.ctx = null;
    if (ctxToClose && ctxToClose.state !== 'closed') {
      try { await ctxToClose.close(); } catch { /* 既に closed の競合は無視 */ }
    }
  }

  dispose(): void {
    void this.stop(); // unmount 時のクリーンアップは fire-and-forget で十分
  }

  private tick = (): void => {
    const ctx = this.ctx;
    if (!ctx || !this.video || !this.playing) return;
    const previewTime = ctx.currentTime - this.startCtxTime;
    this.positionTime = previewTime;
    if (previewTime >= this.totalDuration) {
      this.finish();
      return;
    }

    const slot = this.slotAt(previewTime);
    if (slot) {
      if (slot.segmentId !== this.activeId) {
        this.activeId = slot.segmentId;
        this.cb.onActiveSegment?.(slot.segmentId);
      }
      const offset = previewTime - slot.slotStart;
      const videoSpan = Math.max(0, slot.videoEnd - slot.videoStart);
      // 再生ヘッド用に現在の映像時刻を通知（区間内は進行、区間外は末尾で保持）
      this.cb.onTime?.(offset < videoSpan ? slot.videoStart + offset : slot.videoEnd);
      const visibleDuration = slot.clipDuration > 0 ? slot.clipDuration : videoSpan;
      this.cb.onSlotProgress?.({ slotId: slot.segmentId, offsetInSlot: offset, visibleDuration });
      if (offset < videoSpan) {
        if (this.video.paused) void this.video.play().catch(() => {});
        const target = slot.videoStart + offset;
        if (Math.abs(this.video.currentTime - target) > DRIFT_THRESHOLD) this.video.currentTime = target;
      } else {
        if (!this.video.paused) this.video.pause();
        if (Math.abs(this.video.currentTime - slot.videoEnd) > FREEZE_THRESHOLD) this.video.currentTime = slot.videoEnd;
      }
    } else {
      this.cb.onSlotProgress?.(null);
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  private finish(): void {
    this.teardown();
    this.playing = false;
    this.video?.pause();
    this.positionTime = 0;
    this.activeId = null;
    this.cb.onActiveSegment?.(null);
    this.cb.onSlotProgress?.(null);
    this.cb.onEnded?.();
  }

  private slotAt(t: number): PreviewSlot | null {
    for (const s of this.slots) {
      if (t >= s.slotStart && t < s.slotStart + s.slotDuration) return s;
    }
    return null;
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
