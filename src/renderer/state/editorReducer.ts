import { type Project, type Segment } from '../../shared/types';

export interface TranscriptionState {
  status: 'idle' | 'running' | 'error';
  percent: number;
  error: string | null;
}

export interface EditorState {
  screen: 'home' | 'editor';
  projectDir: string | null;
  project: Project | null;
  selectedSegmentId: string | null;
  currentTime: number;
  transcription: TranscriptionState;
}

export type EditorAction =
  | { type: 'OPEN_PROJECT'; projectDir: string; project: Project }
  | { type: 'CLOSE_PROJECT' }
  | { type: 'SELECT_SEGMENT'; id: string }
  | { type: 'SET_CURRENT_TIME'; time: number }
  | { type: 'TRANSCRIPTION_START' }
  | { type: 'TRANSCRIPTION_PROGRESS'; percent: number }
  | { type: 'TRANSCRIPTION_DONE'; segments: Segment[] }
  | { type: 'TRANSCRIPTION_ERROR'; error: string };

export const initialEditorState: EditorState = {
  screen: 'home',
  projectDir: null,
  project: null,
  selectedSegmentId: null,
  currentTime: 0,
  transcription: { status: 'idle', percent: 0, error: null },
};

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'OPEN_PROJECT':
      return {
        ...initialEditorState,
        screen: 'editor',
        projectDir: action.projectDir,
        project: action.project,
        selectedSegmentId: action.project.segments[0]?.id ?? null,
      };
    case 'CLOSE_PROJECT':
      return { ...initialEditorState };
    case 'SELECT_SEGMENT':
      return { ...state, selectedSegmentId: action.id };
    case 'SET_CURRENT_TIME':
      return { ...state, currentTime: action.time };
    case 'TRANSCRIPTION_START':
      return { ...state, transcription: { status: 'running', percent: 0, error: null } };
    case 'TRANSCRIPTION_PROGRESS':
      return { ...state, transcription: { ...state.transcription, percent: action.percent } };
    case 'TRANSCRIPTION_DONE':
      return {
        ...state,
        project: state.project ? { ...state.project, segments: action.segments } : null,
        selectedSegmentId: action.segments[0]?.id ?? null,
        transcription: { status: 'idle', percent: 100, error: null },
      };
    case 'TRANSCRIPTION_ERROR':
      return { ...state, transcription: { status: 'error', percent: 0, error: action.error } };
    default:
      return state;
  }
}
