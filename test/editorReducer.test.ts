import { describe, it, expect } from 'vitest';
import { editorReducer, initialEditorState } from '../src/renderer/state/editorReducer';
import { createProject, type Project, type Segment } from '../src/shared/types';

function makeProject(): Project {
  return createProject({
    name: 'rec-1',
    source: {
      video: 'assets/raw.webm', narration: 'assets/narration.webm', clickLog: 'assets/clicks.json',
      display: { width: 1920, height: 1080, scaleFactor: 1, originX: 0, originY: 0 },
    },
  });
}
const seg: Segment = {
  id: 'seg-001', videoStart: 0, videoEnd: 1, originalText: 'a', correctedText: 'a',
  ttsAudio: null, voice: { speaker: 3, speed: 1 }, clicks: [], enabled: true,
};

describe('editorReducer', () => {
  it('starts on the home screen', () => {
    expect(initialEditorState.screen).toBe('home');
  });

  it('OPEN_PROJECT switches to the editor', () => {
    const s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    expect(s.screen).toBe('editor');
    expect(s.projectDir).toBe('/d');
    expect(s.selectedSegmentId).toBeNull();
    expect(s.transcription.status).toBe('idle');
  });

  it('CLOSE_PROJECT returns home', () => {
    const open = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    expect(editorReducer(open, { type: 'CLOSE_PROJECT' }).screen).toBe('home');
  });

  it('SELECT_SEGMENT and SET_CURRENT_TIME update state', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'SELECT_SEGMENT', id: 'seg-001' });
    s = editorReducer(s, { type: 'SET_CURRENT_TIME', time: 4.2 });
    expect(s.selectedSegmentId).toBe('seg-001');
    expect(s.currentTime).toBe(4.2);
  });

  it('transcription lifecycle: start -> progress -> done selects first segment', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_START' });
    expect(s.transcription).toEqual({ status: 'running', percent: 0, error: null });
    s = editorReducer(s, { type: 'TRANSCRIPTION_PROGRESS', percent: 42 });
    expect(s.transcription.percent).toBe(42);
    s = editorReducer(s, { type: 'TRANSCRIPTION_DONE', segments: [seg] });
    expect(s.transcription.status).toBe('idle');
    expect(s.project?.segments).toHaveLength(1);
    expect(s.selectedSegmentId).toBe('seg-001');
  });

  it('TRANSCRIPTION_ERROR records the message', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_ERROR', error: 'boom' });
    expect(s.transcription.status).toBe('error');
    expect(s.transcription.error).toBe('boom');
  });

  it('EDIT_SEGMENT_TEXT updates correctedText of the matching segment only', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, {
      type: 'TRANSCRIPTION_DONE',
      segments: [seg, { ...seg, id: 'seg-002', originalText: 'b', correctedText: 'b' }],
    });
    s = editorReducer(s, { type: 'EDIT_SEGMENT_TEXT', id: 'seg-002', text: 'edited' });
    const segs = s.project!.segments;
    expect(segs[0].correctedText).toBe('a'); // 他セグメントは不変
    expect(segs[1].correctedText).toBe('edited'); // 該当セグメントのみ更新
    expect(segs[1].originalText).toBe('b'); // originalText は不変
  });

  it('EDIT_SEGMENT_TEXT is a no-op for an unknown id', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_DONE', segments: [seg] });
    s = editorReducer(s, { type: 'EDIT_SEGMENT_TEXT', id: 'nope', text: 'x' });
    expect(s.project!.segments[0].correctedText).toBe('a');
  });

  it('EDIT_SEGMENT_TEXT is a no-op when no project is open', () => {
    const s = editorReducer(initialEditorState, { type: 'EDIT_SEGMENT_TEXT', id: 'seg-001', text: 'x' });
    expect(s.project).toBeNull();
  });

  it('SET_SEGMENT_VOICE updates only the matching segment voice', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_DONE', segments: [seg, { ...seg, id: 'seg-002' }] });
    s = editorReducer(s, { type: 'SET_SEGMENT_VOICE', id: 'seg-002', voice: { speaker: 8, speed: 1.4 } });
    expect(s.project!.segments[0].voice).toEqual({ speaker: 3, speed: 1 });
    expect(s.project!.segments[1].voice).toEqual({ speaker: 8, speed: 1.4 });
  });

  it('SET_DEFAULT_VOICE updates settings.tts', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'SET_DEFAULT_VOICE', voice: { speaker: 5, speed: 0.9 } });
    expect(s.project!.settings.tts).toEqual({ defaultSpeaker: 5, defaultSpeed: 0.9 });
  });

  it('APPLY_DEFAULT_VOICE_TO_ALL sets every segment voice to the default', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_DONE', segments: [seg, { ...seg, id: 'seg-002', voice: { speaker: 9, speed: 2 } }] });
    s = editorReducer(s, { type: 'SET_DEFAULT_VOICE', voice: { speaker: 5, speed: 0.9 } });
    s = editorReducer(s, { type: 'APPLY_DEFAULT_VOICE_TO_ALL' });
    expect(s.project!.segments.map((x) => x.voice)).toEqual([
      { speaker: 5, speed: 0.9 }, { speaker: 5, speed: 0.9 },
    ]);
  });

  it('tts lifecycle: start -> progress -> generated', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TTS_START' });
    expect(s.tts).toEqual({ status: 'running', percent: 0, error: null });
    s = editorReducer(s, { type: 'TTS_PROGRESS', percent: 50 });
    expect(s.tts.percent).toBe(50);
    s = editorReducer(s, { type: 'TTS_GENERATED', segments: [{ ...seg, ttsAudio: 'tts/seg-001.wav' }] });
    expect(s.tts.status).toBe('idle');
    expect(s.project!.segments[0].ttsAudio).toBe('tts/seg-001.wav');
  });

  it('TTS_ERROR records the message', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TTS_ERROR', error: 'boom' });
    expect(s.tts.status).toBe('error');
    expect(s.tts.error).toBe('boom');
  });

  it('SET_SEGMENTS replaces segments and updates selection when selectId given', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_DONE', segments: [seg, { ...seg, id: 'seg-002' }] });
    s = editorReducer(s, { type: 'SET_SEGMENTS', segments: [{ ...seg, id: 'seg-002' }], selectId: 'seg-002' });
    expect(s.project!.segments).toHaveLength(1);
    expect(s.project!.segments[0].id).toBe('seg-002');
    expect(s.selectedSegmentId).toBe('seg-002');
  });

  it('SET_SEGMENTS without selectId keeps the current selection', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_DONE', segments: [seg] });
    s = editorReducer(s, { type: 'SELECT_SEGMENT', id: 'seg-001' });
    s = editorReducer(s, { type: 'SET_SEGMENTS', segments: [{ ...seg, correctedText: 'x' }] });
    expect(s.selectedSegmentId).toBe('seg-001');
    expect(s.project!.segments[0].correctedText).toBe('x');
  });

  it('RESIZE_BOUNDARY moves the shared boundary on both affected segments', () => {
    let s = editorReducer(initialEditorState, { type: 'OPEN_PROJECT', projectDir: '/d', project: makeProject() });
    s = editorReducer(s, { type: 'TRANSCRIPTION_DONE', segments: [
      { ...seg, videoStart: 0, videoEnd: 2 },
      { ...seg, id: 'seg-002', videoStart: 2, videoEnd: 5 },
    ] });
    s = editorReducer(s, { type: 'RESIZE_BOUNDARY', primaryId: 'seg-001', side: 'right', newTime: 3, duration: 10 });
    expect(s.project!.segments[0].videoEnd).toBe(3);
    expect(s.project!.segments[1].videoStart).toBe(3);
  });

  it('RESIZE_BOUNDARY is a no-op when project is null', () => {
    const s = editorReducer(initialEditorState, { type: 'RESIZE_BOUNDARY', primaryId: 'x', side: 'right', newTime: 1, duration: 10 });
    expect(s.project).toBeNull();
  });
});
