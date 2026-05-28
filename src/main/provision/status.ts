import { type Tool } from './paths';

export type ProvisionStatus = Record<Tool, boolean>;

/** 各 probe を実行し、例外を投げなければ provisioned=true。probe は resolve* を呼ぶ薄い関数を注入する。 */
export function checkStatus(probes: Record<Tool, () => void>): ProvisionStatus {
  const ok = (fn: () => void): boolean => {
    try { fn(); return true; } catch { return false; }
  };
  return { whisper: ok(probes.whisper), voicevox: ok(probes.voicevox), ffmpeg: ok(probes.ffmpeg) };
}

/** stepIndex 番目（0始まり、全 stepCount 個）の内部進捗 stepPercent(0..100) を全体 0..100 に按分する。 */
export function apportionPercent(stepIndex: number, stepCount: number, stepPercent: number): number {
  if (stepCount <= 0) return 100;
  const per = 100 / stepCount;
  const inner = Math.max(0, Math.min(100, stepPercent)) / 100;
  const v = stepIndex * per + inner * per;
  return Math.round(Math.max(0, Math.min(100, v)));
}
