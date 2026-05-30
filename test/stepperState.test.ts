import { describe, it, expect } from 'vitest';
import { deriveStepStatuses, activeStep } from '../src/renderer/editor/stepperState';
import { type Segment } from '../src/shared/types';

const seg = (over: Partial<Segment> = {}): Segment => ({
  id: 's1', videoStart: 0, videoEnd: 1, originalText: '', correctedText: '',
  ttsAudio: null, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true, ...over,
});

const idleTx = { status: 'idle' as const, error: null };
const idleTts = { status: 'idle' as const, error: null };
const idleExp = { status: 'idle' as const };

describe('deriveStepStatuses', () => {
  it('initial state: only step 1 is active, steps 2-4 are locked', () => {
    const r = deriveStepStatuses({
      segments: [], transcription: idleTx, tts: idleTts, export: idleExp,
    });
    expect(r).toEqual(['active', 'locked', 'locked', 'locked']);
  });

  it('step 1 is running while transcription is running', () => {
    const r = deriveStepStatuses({
      segments: [],
      transcription: { status: 'running', error: null },
      tts: idleTts, export: idleExp,
    });
    expect(r[0]).toBe('running');
  });

  it('step 1 is error when transcription failed', () => {
    const r = deriveStepStatuses({
      segments: [],
      transcription: { status: 'error', error: 'boom' },
      tts: idleTts, export: idleExp,
    });
    expect(r[0]).toBe('error');
  });

  it('step 1 is done when segments exist', () => {
    const r = deriveStepStatuses({
      segments: [seg()],
      transcription: idleTx, tts: idleTts, export: idleExp,
    });
    expect(r[0]).toBe('done');
  });
});

describe('activeStep', () => {
  it('returns 1 when only step 1 is active', () => {
    expect(activeStep(['active', 'locked', 'locked', 'locked'])).toBe(1);
  });
});
