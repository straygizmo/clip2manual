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

  it('after transcribe, step 2 active and step 3 active, step 4 locked (editing phase)', () => {
    const r = deriveStepStatuses({
      segments: [seg()],
      transcription: idleTx, tts: idleTts, export: idleExp,
    });
    expect(r).toEqual(['done', 'active', 'active', 'locked']);
  });

  it('step 2 done once any segment has ttsAudio (single-segment regenerate)', () => {
    const r = deriveStepStatuses({
      segments: [seg({ ttsAudio: 'a.wav' }), seg({ id: 's2' })],
      transcription: idleTx, tts: idleTts, export: idleExp,
    });
    expect(r[1]).toBe('done');
    expect(r[2]).toBe('active');
    expect(r[3]).toBe('locked');
  });

  it('step 3 done & step 4 active when all enabled segments have ttsAudio', () => {
    const r = deriveStepStatuses({
      segments: [seg({ ttsAudio: 'a.wav' }), seg({ id: 's2', ttsAudio: 'b.wav' })],
      transcription: idleTx, tts: idleTts, export: idleExp,
    });
    expect(r[2]).toBe('done');
    expect(r[3]).toBe('active');
  });

  it('disabled segments without ttsAudio do not block step 3 completion', () => {
    const r = deriveStepStatuses({
      segments: [seg({ ttsAudio: 'a.wav' }), seg({ id: 's2', enabled: false })],
      transcription: idleTx, tts: idleTts, export: idleExp,
    });
    expect(r[2]).toBe('done');
    expect(r[3]).toBe('active');
  });

  it('step 3 running while TTS is running', () => {
    const r = deriveStepStatuses({
      segments: [seg()],
      transcription: idleTx,
      tts: { status: 'running', error: null },
      export: idleExp,
    });
    expect(r[2]).toBe('running');
  });

  it('step 3 error reflected from tts state', () => {
    const r = deriveStepStatuses({
      segments: [seg()],
      transcription: idleTx,
      tts: { status: 'error', error: 'boom' },
      export: idleExp,
    });
    expect(r[2]).toBe('error');
  });

  it('step 4 running while export running', () => {
    const r = deriveStepStatuses({
      segments: [seg({ ttsAudio: 'a.wav' })],
      transcription: idleTx, tts: idleTts,
      export: { status: 'running' },
    });
    expect(r[3]).toBe('running');
  });

  it('step 4 done after export completes', () => {
    const r = deriveStepStatuses({
      segments: [seg({ ttsAudio: 'a.wav' })],
      transcription: idleTx, tts: idleTts,
      export: { status: 'done' },
    });
    expect(r[3]).toBe('done');
  });

  it('step 4 error when export failed', () => {
    const r = deriveStepStatuses({
      segments: [seg({ ttsAudio: 'a.wav' })],
      transcription: idleTx, tts: idleTts,
      export: { status: 'error' },
    });
    expect(r[3]).toBe('error');
  });
});

describe('activeStep', () => {
  it('returns 1 when only step 1 is active', () => {
    expect(activeStep(['active', 'locked', 'locked', 'locked'])).toBe(1);
  });

  it('prefers running over active (TTS running with editing also active)', () => {
    expect(activeStep(['done', 'active', 'running', 'locked'])).toBe(3);
  });

  it('prefers error over active', () => {
    expect(activeStep(['error', 'active', 'locked', 'locked'])).toBe(1);
  });

  it('falls back to 4 when all done/locked', () => {
    expect(activeStep(['done', 'done', 'done', 'done'])).toBe(4);
  });
});
