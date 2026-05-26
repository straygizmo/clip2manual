export const CURRENT_PROJECT_VERSION = 1;

export interface DisplayInfo {
  width: number;        // 録画映像のピクセル幅
  height: number;       // 録画映像のピクセル高さ
  scaleFactor: number;  // OS の表示スケール（例: 1.25）
  originX: number;      // 録画対象ディスプレイの原点（DIP）
  originY: number;
}

export interface ClickEvent {
  x: number;       // 映像内ピクセル座標
  y: number;
  t: number;       // t0 からの相対秒
  button: number; // uiohook: 1=left 2=right 3=middle; 0 if unknown
}

export interface SegmentVoice {
  speaker: number;
  speed: number;
}

export interface Segment {
  id: string;
  videoStart: number;
  videoEnd: number;
  originalText: string;
  correctedText: string;
  ttsAudio: string | null;
  voice: SegmentVoice;
  clicks: ClickEvent[];
  enabled: boolean;
}

export interface ProjectSource {
  video: string;
  narration: string;
  clickLog: string;
  display: DisplayInfo;
}

export interface LLMSettings {
  provider: 'anthropic' | 'openai' | 'azure';
  model: string;
}

export interface TTSSettings {
  defaultSpeaker: number;
  defaultSpeed: number;
}

export type HighlightStyle = 'ripple';
export type TimingMode = 'video-follows-audio';

export interface ProjectSettings {
  highlightStyle: HighlightStyle;
  timingMode: TimingMode;
  llm: LLMSettings;
  tts: TTSSettings;
}

export interface ProjectMeta {
  name: string;
  createdAt: string;
  source: ProjectSource;
}

export interface Project {
  version: number;
  meta: ProjectMeta;
  settings: ProjectSettings;
  segments: Segment[];
}

export function createProject(params: {
  name: string;
  source: ProjectSource;
  createdAt?: string;
}): Project {
  return {
    version: CURRENT_PROJECT_VERSION,
    meta: {
      name: params.name,
      createdAt: params.createdAt ?? new Date().toISOString(),
      source: params.source,
    },
    settings: {
      highlightStyle: 'ripple',
      timingMode: 'video-follows-audio',
      llm: { provider: 'anthropic', model: 'claude-opus-4-7' },
      tts: { defaultSpeaker: 3, defaultSpeed: 1.0 },
    },
    segments: [],
  };
}

/** project.json を開いたときの軽量な構造検証。フル JSON-Schema は導入しない。 */
export function validateProject(value: unknown): Project {
  if (typeof value !== 'object' || value === null) {
    throw new Error('project.json is not an object');
  }
  const p = value as Record<string, unknown>;
  if (p.version !== CURRENT_PROJECT_VERSION) {
    throw new Error(`Unsupported project version: ${String(p.version)}`);
  }
  if (typeof p.meta !== 'object' || p.meta === null) {
    throw new Error('project.json is missing "meta"');
  }
  if (typeof p.settings !== 'object' || p.settings === null) {
    throw new Error('project.json is missing "settings"');
  }
  if (!Array.isArray(p.segments)) {
    throw new Error('project.json "segments" must be an array');
  }
  return value as Project;
}
