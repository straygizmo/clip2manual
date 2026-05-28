import { type Project, type Segment, type SegmentVoice, type ProjectSettings } from '../../shared/types';

export interface TranscriptionState {
  status: 'idle' | 'running' | 'error';
  percent: number;
  error: string | null;
}

export interface TtsState {
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
  tts: TtsState;
}

export type EditorAction =
  | { type: 'OPEN_PROJECT'; projectDir: string; project: Project }
  | { type: 'CLOSE_PROJECT' }
  | { type: 'SELECT_SEGMENT'; id: string }
  | { type: 'SET_CURRENT_TIME'; time: number }
  | { type: 'EDIT_SEGMENT_TEXT'; id: string; text: string }
  | { type: 'TRANSCRIPTION_START' }
  | { type: 'TRANSCRIPTION_PROGRESS'; percent: number }
  | { type: 'TRANSCRIPTION_DONE'; segments: Segment[] }
  | { type: 'TRANSCRIPTION_ERROR'; error: string }
  | { type: 'SET_SEGMENT_VOICE'; id: string; voice: SegmentVoice }
  | { type: 'SET_DEFAULT_VOICE'; voice: SegmentVoice }
  | { type: 'APPLY_DEFAULT_VOICE_TO_ALL' }
  | { type: 'TTS_START' }
  | { type: 'TTS_PROGRESS'; percent: number }
  | { type: 'TTS_GENERATED'; segments: Segment[] }
  | { type: 'TTS_ERROR'; error: string }
  | { type: 'SET_SEGMENTS'; segments: Segment[]; selectId?: string }
  | { type: 'SET_SETTINGS'; settings: ProjectSettings };

export const initialEditorState: EditorState = {
  screen: 'home',
  projectDir: null,
  project: null,
  selectedSegmentId: null,
  currentTime: 0,
  transcription: { status: 'idle', percent: 0, error: null },
  tts: { status: 'idle', percent: 0, error: null },
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
    case 'EDIT_SEGMENT_TEXT':
      if (!state.project) return state;
      return {
        ...state,
        project: {
          ...state.project,
          segments: state.project.segments.map((s) =>
            s.id === action.id ? { ...s, correctedText: action.text } : s,
          ),
        },
      };
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
    case 'SET_SEGMENT_VOICE':
      if (!state.project) return state;
      return {
        ...state,
        project: {
          ...state.project,
          segments: state.project.segments.map((s) =>
            s.id === action.id ? { ...s, voice: action.voice } : s,
          ),
        },
      };
    case 'SET_DEFAULT_VOICE':
      if (!state.project) return state;
      return {
        ...state,
        project: {
          ...state.project,
          settings: {
            ...state.project.settings,
            tts: { defaultSpeaker: action.voice.speaker, defaultSpeed: action.voice.speed },
          },
        },
      };
    case 'APPLY_DEFAULT_VOICE_TO_ALL': {
      if (!state.project) return state;
      const v = {
        speaker: state.project.settings.tts.defaultSpeaker,
        speed: state.project.settings.tts.defaultSpeed,
      };
      return {
        ...state,
        project: {
          ...state.project,
          segments: state.project.segments.map((s) => ({ ...s, voice: { ...v } })),
        },
      };
    }
    case 'TTS_START':
      return { ...state, tts: { status: 'running', percent: 0, error: null } };
    case 'TTS_PROGRESS':
      return { ...state, tts: { ...state.tts, percent: action.percent } };
    case 'TTS_GENERATED':
      return {
        ...state,
        project: state.project ? { ...state.project, segments: action.segments } : null,
        tts: { status: 'idle', percent: 100, error: null },
      };
    case 'TTS_ERROR':
      return { ...state, tts: { status: 'error', percent: 0, error: action.error } };
    case 'SET_SEGMENTS':
      if (!state.project) return state;
      return {
        ...state,
        project: { ...state.project, segments: action.segments },
        selectedSegmentId: action.selectId ?? state.selectedSegmentId,
      };
    case 'SET_SETTINGS':
      if (!state.project) return state;
      return {
        ...state,
        project: { ...state.project, settings: action.settings },
      };
    default:
      return state;
  }
}
