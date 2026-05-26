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
});
