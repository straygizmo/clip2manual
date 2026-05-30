import { describe, it, expect } from 'vitest';
import { formatCaptureSources, type RawSource, type DisplayLike } from '../src/main/captureSources';

const displays: DisplayLike[] = [
  { id: 100, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, primary: true },
  { id: 200, bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, scaleFactor: 1, primary: false },
];

const sources: RawSource[] = [
  { id: 'screen:0:0', name: 'Entire Screen', display_id: '100' },
  { id: 'screen:1:0', name: 'Screen 2',      display_id: '200' },
  { id: 'window:111:0', name: 'メモ帳 - 無題',  display_id: '' },
  { id: 'window:222:0', name: '',               display_id: '' }, // 空タイトル
  { id: 'window:333:0', name: 'clip2manual',    display_id: '' }, // 自身
];

const LABELS = {
  displayPrimary: 'ディスプレイ {{n}}（プライマリ・{{w}}×{{h}}）',
  display: 'ディスプレイ {{n}}（{{w}}×{{h}}）',
};

describe('formatCaptureSources', () => {
  it('lists screens first with primary marker and resolution', () => {
    const out = formatCaptureSources({
      sources, displays, selfMediaSourceId: 'window:333:0', labels: LABELS,
    });
    expect(out[0]).toEqual({ id: 'screen:0:0', kind: 'screen', label: 'ディスプレイ 1（プライマリ・1920×1080）', displayId: 100 });
    expect(out[1]).toEqual({ id: 'screen:1:0', kind: 'screen', label: 'ディスプレイ 2（2560×1440）', displayId: 200 });
  });

  it('drops blank-title windows', () => {
    const out = formatCaptureSources({
      sources, displays, selfMediaSourceId: 'window:333:0', labels: LABELS,
    });
    expect(out.find((s) => s.id === 'window:222:0')).toBeUndefined();
  });

  it('drops the self window by media source id', () => {
    const out = formatCaptureSources({
      sources, displays, selfMediaSourceId: 'window:333:0', labels: LABELS,
    });
    expect(out.find((s) => s.id === 'window:333:0')).toBeUndefined();
  });

  it('keeps a tail of windows after screens, sorted by label', () => {
    const out = formatCaptureSources({
      sources: [
        ...sources,
        { id: 'window:444:0', name: 'A first', display_id: '' },
      ],
      displays, selfMediaSourceId: 'window:333:0', labels: LABELS,
    });
    const windowLabels = out.filter((s) => s.kind === 'window').map((s) => s.label);
    expect(windowLabels).toEqual(['A first', 'メモ帳 - 無題']);
  });

  it('drops screen sources whose display_id does not resolve', () => {
    const out = formatCaptureSources({
      sources: [{ id: 'screen:9:0', name: 'Unknown Display', display_id: '999' }],
      displays, selfMediaSourceId: '', labels: LABELS,
    });
    expect(out).toEqual([]);
  });
});
