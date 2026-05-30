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
  const { segments, transcription, tts, export: ex } = input;
  const hasSegments = segments.length > 0;
  const someHasAudio = segments.some((s) => !!s.ttsAudio);
  const enabled = segments.filter((s) => s.enabled !== false);
  const allEnabledHaveAudio = hasSegments && enabled.length > 0 && enabled.every((s) => !!s.ttsAudio);

  const s1: StepStatus =
    transcription.status === 'running' ? 'running' :
    transcription.status === 'error'   ? 'error'   :
    hasSegments                        ? 'done'    : 'active';

  const s2: StepStatus =
    !hasSegments  ? 'locked' :
    someHasAudio  ? 'done'   : 'active';

  const s3: StepStatus =
    !hasSegments              ? 'locked'  :
    tts.status === 'running'  ? 'running' :
    tts.status === 'error'    ? 'error'   :
    allEnabledHaveAudio       ? 'done'    : 'active';

  const s4: StepStatus =
    !allEnabledHaveAudio      ? 'locked'  :
    ex.status === 'running'   ? 'running' :
    ex.status === 'error'     ? 'error'   :
    ex.status === 'done'      ? 'done'    : 'active';

  return [s1, s2, s3, s4];
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
