import { type Segment } from '../../shared/types';
import { computePreviewTimeline, type PreviewSlot } from '../editor/previewTimeline';

export interface TtsPreviewCallbacks {
  onActiveSegment?: (segmentId: string | null) => void;
  onEnded?: () => void;
}

const DRIFT_THRESHOLD = 0.25; // 秒。これを超えたら映像時刻を補正する。

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

  constructor(private cb: TtsPreviewCallbacks = {}) {}

  private ensureCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  /** 各セグメントの TTS をデコードしてタイムラインを構築する。 */
  async load(segments: Segment[], projectDir: string): Promise<void> {
    this.stop();
    const ctx = this.ensureCtx();
    this.buffers.clear();
    const durations = new Map<string, number>();
    for (const seg of segments) {
      if (!seg.ttsAudio) continue;
      try {
        const url = `c2m://asset/${seg.ttsAudio}?p=${encodeURIComponent(projectDir)}`;
        const res = await fetch(url);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(seg.id, buf);
        durations.set(seg.id, buf.duration);
      } catch {
        // デコード失敗は無音区間として扱う（clipDuration=0）
      }
    }
    this.slots = computePreviewTimeline(segments, durations);
    this.positionTime = 0;
  }

  hasSlots(): boolean { return this.slots.length > 0; }
  missingClips(): boolean { return this.slots.some((s) => s.clipDuration === 0); }

  get totalDuration(): number {
    const last = this.slots[this.slots.length - 1];
    return last ? last.slotStart + last.slotDuration : 0;
  }

  /** positionTime から再生する（末尾到達後は先頭から）。 */
  async play(video: HTMLVideoElement): Promise<void> {
    const ctx = this.ensureCtx();
    if (this.slots.length === 0) return;
    if (ctx.state === 'suspended') await ctx.resume();
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

    this.rafId = requestAnimationFrame(this.tick);
  }

  pause(): void {
    this.teardown();
    this.playing = false;
    this.video?.pause();
  }

  stop(): void {
    this.teardown();
    this.playing = false;
    this.video?.pause();
    this.positionTime = 0;
    if (this.activeId !== null) {
      this.activeId = null;
      this.cb.onActiveSegment?.(null);
    }
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
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
      if (offset < videoSpan) {
        if (this.video.paused) void this.video.play().catch(() => {});
        const target = slot.videoStart + offset;
        if (Math.abs(this.video.currentTime - target) > DRIFT_THRESHOLD) this.video.currentTime = target;
      } else {
        if (!this.video.paused) this.video.pause();
        if (Math.abs(this.video.currentTime - slot.videoEnd) > 0.05) this.video.currentTime = slot.videoEnd;
      }
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
