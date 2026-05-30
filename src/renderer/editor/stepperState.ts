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
  const { segments, transcription } = input;
  const hasSegments = segments.length > 0;

  const s1: StepStatus =
    transcription.status === 'running' ? 'running' :
    transcription.status === 'error'   ? 'error'   :
    hasSegments                        ? 'done'    : 'active';

  if (!hasSegments) return [s1, 'locked', 'locked', 'locked'];
  // 後続タスクで step 2-4 を完成させる
  return [s1, 'active', 'active', 'locked'];
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
