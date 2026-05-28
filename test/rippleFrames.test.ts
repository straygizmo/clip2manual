import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { activeRipplesAt, rippleSvg, generateRippleFramesForSlot, type ActiveRippleVisual } from '../src/main/export/rippleFrames';
import { type ClickEvent } from '../src/shared/types';
import { type PreviewSlot } from '../src/shared/previewTimeline';

const slot: PreviewSlot = {
  segmentId: 'seg-001', slotStart: 0, slotDuration: 3,
  videoStart: 1, videoEnd: 2, clipDuration: 2.5,
};
const w = 1920; // 仮想映像幅
// 期待値の事前計算
// maxR = w * (1/12) = 160
// ringSW = max(2, w/400) = max(2, 4.8) = 4.8
// dotR = max(3, w/320) = max(3, 6) = 6

function click(t: number, x = 100, y = 200): ClickEvent {
  return { t, x, y, button: 1 };
}

describe('activeRipplesAt', () => {
  it('returns no ripples when no clicks are in the slot', () => {
    expect(activeRipplesAt([], slot, 0.5, w)).toEqual([]);
  });

  it('ignores clicks outside the slot video range', () => {
    // c.t <= videoStart or c.t > videoEnd are filtered out
    expect(activeRipplesAt([click(0.5)], slot, 0.5, w)).toEqual([]);
    expect(activeRipplesAt([click(1.0)], slot, 0.5, w)).toEqual([]); // boundary: c.t === videoStart is excluded
    expect(activeRipplesAt([click(2.5)], slot, 0.5, w)).toEqual([]); // after videoEnd
  });

  it('includes a click that fires exactly at tSlot (elapsed 0, alpha 1)', () => {
    // click at c.t = 1.5 → fireTimeSlot = 0.5; tSlot = 0.5 → elapsed = 0
    const out = activeRipplesAt([click(1.5)], slot, 0.5, w);
    expect(out).toHaveLength(1);
    expect(out[0].alpha).toBeCloseTo(1);
    expect(out[0].ringRadius).toBe(2); // max(2, 0 * maxR) = 2
    expect(out[0].dotRadius).toBeCloseTo(6);
    expect(out[0].ringStrokeWidth).toBeCloseTo(4.8);
    expect(out[0].x).toBe(100);
    expect(out[0].y).toBe(200);
  });

  it('computes mid-animation values at half duration', () => {
    // fireTimeSlot = 0.5; tSlot = 0.5 + 0.4 = 0.9 → elapsed = 0.4 (half of 0.8)
    const out = activeRipplesAt([click(1.5)], slot, 0.9, w);
    expect(out).toHaveLength(1);
    expect(out[0].alpha).toBeCloseTo(0.5);
    expect(out[0].ringRadius).toBeCloseTo(0.5 * 160); // k * maxR = 80
  });

  it('drops a ripple once elapsed >= RIPPLE_DURATION', () => {
    // fireTimeSlot = 0.5; tSlot = 0.5 + 0.8 = 1.3 → elapsed = 0.8 (expired)
    expect(activeRipplesAt([click(1.5)], slot, 1.3, w)).toEqual([]);
  });

  it('keeps a ripple alive into the freeze region (tSlot > videoSpan)', () => {
    // videoSpan = 1; click at c.t = 1.9 → fireTimeSlot = 0.9
    // tSlot = 1.2 (in freeze, since slotDuration=3 > videoSpan=1) → elapsed = 0.3
    const out = activeRipplesAt([click(1.9)], slot, 1.2, w);
    expect(out).toHaveLength(1);
    expect(out[0].alpha).toBeCloseTo(1 - 0.3 / 0.8, 3);
  });

  it('returns multiple actives when their windows overlap', () => {
    const out = activeRipplesAt([click(1.2), click(1.6)], slot, 1.7, w);
    // c1: fireTimeSlot=0.2, elapsed=1.5 → expired
    // c2: fireTimeSlot=0.6, elapsed=1.1 → expired
    expect(out).toHaveLength(0);
    const out2 = activeRipplesAt([click(1.2), click(1.6)], slot, 1.3, w);
    // c1: fireTimeSlot=0.2, elapsed=1.1 → expired
    // c2: fireTimeSlot=0.6, elapsed=0.7 → active
    expect(out2).toHaveLength(1);
    const out3 = activeRipplesAt([click(1.2), click(1.6)], slot, 0.9, w);
    // c1: fireTimeSlot=0.2, elapsed=0.7 → active
    // c2: fireTimeSlot=0.6, elapsed=0.3 → active
    expect(out3).toHaveLength(2);
  });
});

describe('rippleSvg', () => {
  it('returns a minimal empty svg when there are no actives', () => {
    const svg = rippleSvg([], 1920, 1080);
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="1920"');
    expect(svg).toContain('height="1080"');
    expect(svg).toContain('viewBox="0 0 1920 1080"');
    expect(svg).not.toContain('<circle');
  });

  it('emits two circles per active (ring + dot)', () => {
    const a: ActiveRippleVisual = {
      x: 100, y: 200, ringRadius: 50, ringStrokeWidth: 4.8, dotRadius: 6, alpha: 0.5,
    };
    const svg = rippleSvg([a], 1920, 1080);
    const circles = svg.match(/<circle/g);
    expect(circles).not.toBeNull();
    expect(circles!.length).toBe(2);
    expect(svg).toContain('stroke="#ffcf33"');
    expect(svg).toContain('fill="#ff5470"');
    expect(svg).toContain('cx="100"');
    expect(svg).toContain('cy="200"');
  });

  it('scales the number of circles with active count', () => {
    const make = (x: number): ActiveRippleVisual => ({
      x, y: 0, ringRadius: 10, ringStrokeWidth: 2, dotRadius: 3, alpha: 1,
    });
    const svg = rippleSvg([make(1), make(2), make(3)], 100, 100);
    const circles = svg.match(/<circle/g)!;
    expect(circles.length).toBe(6); // 2 per active * 3
  });

  it('renders opacity per active', () => {
    const a: ActiveRippleVisual = {
      x: 0, y: 0, ringRadius: 1, ringStrokeWidth: 1, dotRadius: 1, alpha: 0.25,
    };
    const svg = rippleSvg([a], 10, 10);
    // both circles share the same alpha → opacity="0.250" (fixed to 3 decimal places)
    const occurrences = (svg.match(/opacity="0\.25/g) || []).length;
    expect(occurrences).toBe(2);
  });
});

describe('generateRippleFramesForSlot', () => {
  let outDir: string;
  beforeEach(async () => { outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-rip-')); });
  afterEach(async () => { await fs.rm(outDir, { recursive: true, force: true }); });

  it('returns null and writes no files when no clicks fall in the slot', async () => {
    const r = await generateRippleFramesForSlot({
      slot, clicks: [], fps: 30, videoW: 1920, videoH: 1080, outDir,
    });
    expect(r).toBeNull();
    const files = await fs.readdir(outDir).catch(() => []);
    expect(files.length).toBe(0);
  });

  it('writes ceil(slotDuration*fps) PNG frames and returns the pattern', async () => {
    const r = await generateRippleFramesForSlot({
      slot, clicks: [{ t: 1.5, x: 100, y: 200, button: 1 }],
      fps: 10, videoW: 640, videoH: 360, outDir,
    });
    expect(r).not.toBeNull();
    expect(r!.fps).toBe(10);
    expect(r!.pattern).toBe(path.join(outDir, '%05d.png'));
    const files = (await fs.readdir(outDir)).filter((f) => f.endsWith('.png')).sort();
    // slotDuration=3, fps=10 → 30 frames numbered 00000..00029
    expect(files.length).toBe(30);
    expect(files[0]).toBe('00000.png');
    expect(files[29]).toBe('00029.png');
    // each file starts with PNG signature
    const head = await fs.readFile(path.join(outDir, '00000.png'));
    expect(head.subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('aborts when the signal fires', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(generateRippleFramesForSlot({
      slot, clicks: [{ t: 1.5, x: 0, y: 0, button: 1 }],
      fps: 10, videoW: 100, videoH: 100, outDir, signal: ac.signal,
    })).rejects.toThrow(/cancel|キャンセル/i);
  });
});
