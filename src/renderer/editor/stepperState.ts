import { type Segment } from '../../shared/types';

export type StepStatus = 'locked' | 'active' | 'running' | 'done' | 'error';
export type StepStatuses = [StepStatus, StepStatus, StepStatus, StepStatus];

export interface StepInputs {
  segments: Segment[];
  transcription: { status: 'idle' | 'running' | 'error'; error: string | null };
  tts: { status: 'idle' | 'running' | 'error'; error: string | null };
  export: { status: 'idle' | 'running' | 'done' | 'error' };
}

export function deriveStepStatuses(input: StepInputs): StepStatuses {
  const { segments } = input;
  const hasSegments = segments.length > 0;
  if (!hasSegments) return ['active', 'locked', 'locked', 'locked'];
  // 仮実装。後続タスクで本実装に置き換える
  return ['done', 'active', 'active', 'locked'];
}

export function activeStep(s: StepStatuses): 1 | 2 | 3 | 4 {
  const running = s.findIndex((x) => x === 'running');
  if (running >= 0) return (running + 1) as 1 | 2 | 3 | 4;
  const err = s.findIndex((x) => x === 'error');
  if (err >= 0) return (err + 1) as 1 | 2 | 3 | 4;
  const act = s.findIndex((x) => x === 'active');
  if (act >= 0) return (act + 1) as 1 | 2 | 3 | 4;
  return 4;
}
