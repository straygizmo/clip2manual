import { describe, it, expect } from 'vitest';
import { pickSubtitle } from '../src/shared/subtitleSelect';
import { type Segment } from '../src/shared/types';

function seg(id: string, vs: number, ve: number, corrected: string, original = ''): Segment {
  return {
    id, videoStart: vs, videoEnd: ve, originalText: original, correctedText: corrected,
    ttsAudio: null, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true,
  };
}

const segs = [
  seg('a', 0, 2, 'hello'),
  seg('b', 2, 4, ''),                       // 補正空
  seg('c', 4, 6, '', 'original-c'),         // 補正空＝原文
  seg('d', 6, 8, '   '),                    // 空白のみ＝null
  { ...seg('e', 8, 10, 'cut'), enabled: false },
];

describe('pickSubtitle', () => {
  it('returns null when showSubtitles is false', () => {
    expect(pickSubtitle({
      segments: segs, showSubtitles: false, mode: 'original',
      cursor: { kind: 'original', videoTime: 1 },
    })).toBeNull();
  });

  describe('original mode', () => {
    it('returns correctedText when within [videoStart, videoEnd)', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'original',
        cursor: { kind: 'original', videoTime: 1 },
      })).toBe('hello');
    });

    it('falls back to originalText when correctedText is empty', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'original',
        cursor: { kind: 'original', videoTime: 5 },
      })).toBe('original-c');
    });

    it('returns null when both texts are empty/whitespace', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'original',
        cursor: { kind: 'original', videoTime: 3 },   // segment b: both empty
      })).toBeNull();
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'original',
        cursor: { kind: 'original', videoTime: 7 },   // segment d: whitespace
      })).toBeNull();
    });

    it('skips disabled segments', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'original',
        cursor: { kind: 'original', videoTime: 9 },   // segment e: disabled
      })).toBeNull();
    });

    it('treats videoEnd as exclusive', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'original',
        cursor: { kind: 'original', videoTime: 2 },   // belongs to b, not a
      })).toBeNull();
    });

    it('returns null when no segment contains the time', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'original',
        cursor: { kind: 'original', videoTime: 100 },
      })).toBeNull();
    });
  });

  describe('tts mode', () => {
    it('returns text while offsetInSlot < visibleDuration', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'tts',
        cursor: { kind: 'tts', slotId: 'a', offsetInSlot: 1, visibleDuration: 2 },
      })).toBe('hello');
    });

    it('returns null once offsetInSlot >= visibleDuration (freeze/tail)', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'tts',
        cursor: { kind: 'tts', slotId: 'a', offsetInSlot: 2, visibleDuration: 2 },
      })).toBeNull();
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'tts',
        cursor: { kind: 'tts', slotId: 'a', offsetInSlot: 2.5, visibleDuration: 2 },
      })).toBeNull();
    });

    it('returns null when slotId is not found', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'tts',
        cursor: { kind: 'tts', slotId: 'nope', offsetInSlot: 0, visibleDuration: 2 },
      })).toBeNull();
    });

    it('returns null when both texts are empty', () => {
      expect(pickSubtitle({
        segments: segs, showSubtitles: true, mode: 'tts',
        cursor: { kind: 'tts', slotId: 'b', offsetInSlot: 0, visibleDuration: 2 },
      })).toBeNull();
    });
  });
});
