import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { activeRipplesAtT, rippleSvg, generateGlobalRippleFrames, type ActiveRippleVisual } from '../src/main/export/rippleFrames';

const w = 1920;
// maxR = w * (1/12) = 160
// ringSW = max(2, w/400) = 4.8
// dotR   = max(3, w/320) = 6

function click(t: number, x = 100, y = 200): { x: number; y: number; t: number } {
  return { t, x, y };
}

describe('activeRipplesAtT', () => {
  it('returns no ripples when there are no clicks', () => {
    expect(activeRipplesAtT([], 1.0, w)).toEqual([]);
  });

  it('ignores clicks fired in the future (t < click.t)', () => {
    expect(activeRipplesAtT([click(2.0)], 1.5, w)).toEqual([]);
  });

  it('includes a click that fires exactly at t (elapsed 0, alpha 1)', () => {
    const out = activeRipplesAtT([click(1.5)], 1.5, w);
    expect(out).toHaveLength(1);
    expect(out[0].alpha).toBeCloseTo(1);
    expect(out[0].ringRadius).toBe(2);
    expect(out[0].dotRadius).toBeCloseTo(6);
    expect(out[0].ringStrokeWidth).toBeCloseTo(4.8);
    expect(out[0].x).toBe(100);
    expect(out[0].y).toBe(200);
  });

  it('computes mid-animation values at half duration', () => {
    // elapsed 0.4 of 0.8 → half
    const out = activeRipplesAtT([click(1.5)], 1.9, w);
    expect(out).toHaveLength(1);
    expect(out[0].alpha).toBeCloseTo(0.5);
    expect(out[0].ringRadius).toBeCloseTo(0.5 * 160);
  });

  it('drops a ripple once elapsed > RIPPLE_DURATION', () => {
    expect(activeRipplesAtT([click(1.5)], 2.4, w)).toEqual([]);
  });

  it('returns multiple actives when their windows overlap', () => {
    const out = activeRipplesAtT([click(1.2), click(1.6)], 1.9, w);
    // c1 elapsed 0.7 → active, c2 elapsed 0.3 → active
    expect(out).toHaveLength(2);
  });
});

describe('rippleSvg', () => {
  it('returns a minimal empty svg when there are no actives', () => {
    const svg = rippleSvg([], 1920, 1080);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 1920 1080"');
    expect(svg).not.toContain('<circle');
  });

  it('emits two circles per active (ring + dot)', () => {
    const a: ActiveRippleVisual = { x: 100, y: 200, ringRadius: 50, ringStrokeWidth: 4.8, dotRadius: 6, alpha: 0.5 };
    const svg = rippleSvg([a], 1920, 1080);
    expect((svg.match(/<circle/g) || []).length).toBe(2);
    expect(svg).toContain('stroke="#ffcf33"');
    expect(svg).toContain('fill="#ff5470"');
  });
});

describe('generateGlobalRippleFrames', () => {
  let outDir: string;
  beforeEach(async () => { outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'c2m-rip-')); });
  afterEach(async () => { await fs.rm(outDir, { recursive: true, force: true }); });

  it('returns null and writes no files when there are no clicks at all', async () => {
    const r = await generateGlobalRippleFrames({
      clicks: [], totalDuration: 5, fps: 30, videoW: 1920, videoH: 1080, outDir,
    });
    expect(r).toBeNull();
    const files = await fs.readdir(outDir).catch(() => []);
    expect(files.length).toBe(0);
  });

  it('writes ceil(totalDuration*fps) PNG frames using 6-digit numbering', async () => {
    const r = await generateGlobalRippleFrames({
      clicks: [{ x: 100, y: 200, t: 1.5 }],
      totalDuration: 3, fps: 10, videoW: 640, videoH: 360, outDir,
    });
    expect(r).not.toBeNull();
    expect(r!.fps).toBe(10);
    expect(r!.pattern).toBe(path.join(outDir, '%06d.png'));
    const files = (await fs.readdir(outDir)).filter((f) => f.endsWith('.png')).sort();
    expect(files.length).toBe(30);
    expect(files[0]).toBe('000000.png');
    expect(files[29]).toBe('000029.png');
    const head = await fs.readFile(path.join(outDir, '000000.png'));
    expect(head.subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('reuses the cached empty-PNG buffer for frames with no active ripples', async () => {
    // 1 click far past the end → most frames are empty and should share an identical PNG
    await generateGlobalRippleFrames({
      clicks: [{ x: 0, y: 0, t: 100 }],
      totalDuration: 1, fps: 5, videoW: 200, videoH: 200, outDir,
    });
    const files = (await fs.readdir(outDir)).filter((f) => f.endsWith('.png')).sort();
    const first = await fs.readFile(path.join(outDir, files[0]));
    const last = await fs.readFile(path.join(outDir, files[files.length - 1]));
    expect(Buffer.compare(first, last)).toBe(0);
  });

  it('aborts when the signal fires', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(generateGlobalRippleFrames({
      clicks: [{ x: 0, y: 0, t: 0 }],
      totalDuration: 1, fps: 10, videoW: 100, videoH: 100, outDir, signal: ac.signal,
    })).rejects.toThrow(/cancel|キャンセル/i);
  });
});
