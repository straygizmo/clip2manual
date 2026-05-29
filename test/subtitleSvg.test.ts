import { describe, it, expect } from 'vitest';
import { subtitleSvg } from '../src/main/export/subtitleSvg';

const fakeFont = 'AABBCC';   // base64 ダミー

describe('subtitleSvg', () => {
  it('returns null for empty or whitespace text', () => {
    expect(subtitleSvg({ text: '', videoW: 1920, videoH: 1080, fontBase64: fakeFont })).toBeNull();
    expect(subtitleSvg({ text: '   ', videoW: 1920, videoH: 1080, fontBase64: fakeFont })).toBeNull();
  });

  it('returns an svg with viewBox matching videoW/videoH', () => {
    const svg = subtitleSvg({ text: 'hello', videoW: 1920, videoH: 1080, fontBase64: fakeFont })!;
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('viewBox="0 0 1920 1080"');
  });

  it('embeds the font via @font-face with the provided base64', () => {
    const svg = subtitleSvg({ text: 'hello', videoW: 1920, videoH: 1080, fontBase64: fakeFont })!;
    expect(svg).toContain('@font-face');
    expect(svg).toContain('NotoSansJP');
    expect(svg).toContain('data:font/otf;base64,AABBCC');
  });

  it('renders a single <tspan> per wrapped line', () => {
    const svg = subtitleSvg({ text: 'short line', videoW: 1920, videoH: 1080, fontBase64: fakeFont })!;
    const tspans = svg.match(/<tspan/g) ?? [];
    expect(tspans.length).toBe(1);
  });

  it('renders multiple <tspan> for wrapped long text', () => {
    const longText = 'a'.repeat(500); // overflows easily
    const svg = subtitleSvg({ text: longText, videoW: 320, videoH: 240, fontBase64: fakeFont })!;
    const tspans = svg.match(/<tspan/g) ?? [];
    expect(tspans.length).toBeGreaterThanOrEqual(2);
    expect(tspans.length).toBeLessThanOrEqual(3);  // capped at 3 lines
  });

  it('positions text near bottom (y > 0.7 * videoH)', () => {
    const svg = subtitleSvg({ text: 'x', videoW: 1920, videoH: 1080, fontBase64: fakeFont })!;
    const yMatch = svg.match(/<text[^>]*\sy="(\d+(?:\.\d+)?)"/);
    expect(yMatch).not.toBeNull();
    expect(Number(yMatch![1])).toBeGreaterThan(0.7 * 1080);
  });

  it('escapes XML-significant chars in text', () => {
    const svg = subtitleSvg({ text: '<b>&"\'', videoW: 1920, videoH: 1080, fontBase64: fakeFont })!;
    expect(svg).not.toMatch(/<tspan[^>]*><b>/);
    expect(svg).toContain('&lt;');
    expect(svg).toContain('&amp;');
  });
});
