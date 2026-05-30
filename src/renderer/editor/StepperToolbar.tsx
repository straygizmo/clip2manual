import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Segment, type SpeakerOption } from '../../shared/types';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  ArrowLeft, ArrowRight, Check, CircleAlert, CircleDot, Download, FileText, Lock, Mic, Subtitles, X,
} from 'lucide-react';
import { activeStep, deriveStepStatuses, type StepStatus } from './stepperState';

interface ExportLike { status: 'idle' | 'running' | 'done' | 'error'; percent: number; message: string }
interface TxLike { status: 'idle' | 'running' | 'error'; error: string | null; percent: number }
interface TtsLike { status: 'idle' | 'running' | 'error'; error: string | null; percent: number }

export interface StepperToolbarProps {
  projectName: string;
  segments: Segment[];
  transcription: TxLike;
  tts: TtsLike;
  exportState: ExportLike;
  showSubtitles: boolean;
  defaultSpeaker: number;
  defaultSpeed: number;
  speakers: SpeakerOption[];

  onHome(): void;
  onTranscribe(): void;
  onCancelTranscription(): void;
  onSetDefaultVoice(v: { speaker: number; speed: number }): void;
  onApplyDefaultToAll(): void;
  onLoadSpeakers(): void;
  onGenerateAll(): void;
  onCancelTts(): void;
  onExport(): void;
  onCancelExport(): void;
  onSetShowSubtitles(v: boolean): void;
}

export function StepperToolbar(props: StepperToolbarProps) {
  const { t } = useTranslation();
  const statuses = deriveStepStatuses({
    segments: props.segments,
    transcription: { status: props.transcription.status, error: props.transcription.error },
    tts: { status: props.tts.status, error: props.tts.error },
    export: { status: props.exportState.status },
  });
  const auto = activeStep(statuses);
  const [override, setOverride] = useState<1 | 2 | 3 | 4 | null>(null);
  const prevAutoRef = useRef<1 | 2 | 3 | 4>(auto);

  // auto が前進したら override を解除（自動追従）
  useEffect(() => {
    if (auto > prevAutoRef.current) setOverride(null);
    prevAutoRef.current = auto;
  }, [auto]);

  const current = override ?? auto;

  return (
    <div className="flex flex-col bg-toolbar text-foreground">
      {/* Row 1: ホーム / プロジェクト名 / チップ列 / 字幕 */}
      <div className="flex h-11 items-center gap-2 px-3">
        <Button variant="ghost" size="sm" onClick={props.onHome}>
          <ArrowLeft className="size-4" />{t('editor.home')}
        </Button>
        <span className="truncate font-semibold">{props.projectName}</span>
        <Separator orientation="vertical" className="h-6" />
        <div className="flex flex-1 items-center justify-center gap-1">
          <StepChip n={1} status={statuses[0]} label={t('stepper.step1Label')}
            disabled={statuses[0] === 'done'} active={current === 1}
            onClick={() => statuses[0] !== 'locked' && statuses[0] !== 'done' && setOverride(1)} />
          <ArrowRight className="size-4 text-muted-foreground" />
          <StepChip n={2} status={statuses[1]} label={t('stepper.step2Label')} active={current === 2}
            onClick={() => statuses[1] !== 'locked' && setOverride(2)} />
          <ArrowRight className="size-4 text-muted-foreground" />
          <StepChip n={3} status={statuses[2]} label={t('stepper.step3Label')} active={current === 3}
            onClick={() => statuses[2] !== 'locked' && setOverride(3)} />
          <ArrowRight className="size-4 text-muted-foreground" />
          <StepChip n={4} status={statuses[3]} label={t('stepper.step4Label')} active={current === 4}
            onClick={() => statuses[3] !== 'locked' && setOverride(4)} />
        </div>
        <label className="flex items-center gap-1 text-xs" title={t('editor.showSubtitlesTooltip')}>
          <Subtitles className="size-4" />
          <input
            type="checkbox"
            checked={props.showSubtitles}
            onChange={(e) => props.onSetShowSubtitles(e.currentTarget.checked)}
            className="size-4"
          />
          {t('editor.showSubtitles')}
        </label>
      </div>

      {/* Row 2: アクティブステップの操作パネル */}
      <div className="flex h-11 items-center gap-2 border-t border-border px-3">
        {current === 1 && <Step1Panel {...props} status={statuses[0]} />}
        {current === 2 && <Step2Panel />}
        {current === 3 && <Step3Panel {...props} status={statuses[2]} />}
        {current === 4 && <Step4Panel {...props} status={statuses[3]} />}
      </div>
    </div>
  );
}

function StepChip({
  n, status, label, active, disabled, onClick,
}: { n: number; status: StepStatus; label: string; active: boolean; disabled?: boolean; onClick(): void }) {
  const Icon =
    status === 'done'    ? Check       :
    status === 'running' ? CircleDot   :
    status === 'error'   ? CircleAlert :
    status === 'locked'  ? Lock        : CircleDot;
  const color =
    status === 'error'  ? 'text-destructive' :
    status === 'done'   ? 'text-emerald-500' :
    status === 'locked' ? 'text-muted-foreground' : 'text-foreground';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === 'locked' || disabled}
      className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
        active ? 'border-primary bg-primary/10' : 'border-border bg-background'
      } ${status === 'locked' || disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-muted'}`}
    >
      <Icon className={`size-3.5 ${color}`} />
      <span className="font-medium">{label}</span>
      <span className="sr-only">step {n} status {status}</span>
    </button>
  );
}

function Step1Panel(p: StepperToolbarProps & { status: StepStatus }) {
  const { t } = useTranslation();
  if (p.status === 'done') {
    return (
      <>
        <FileText className="size-4 text-emerald-500" />
        <span className="text-xs text-muted-foreground">{t('stepper.step1DoneHint')}</span>
        <span className="text-xs text-muted-foreground">{t('stepper.step1RestartNote')}</span>
      </>
    );
  }
  return (
    <>
      <Button size="sm" variant="default" onClick={p.onTranscribe} disabled={p.status === 'running'}>
        <FileText className="size-4" />{t('stepper.step1Run')}
      </Button>
      {p.status === 'running' && (
        <>
          <span className="text-xs text-muted-foreground">
            {t('stepper.step1RunningHint', { percent: p.transcription.percent })}
          </span>
          <Button variant="ghost" size="sm" onClick={p.onCancelTranscription}>
            <X className="size-4" />{t('common.cancel')}
          </Button>
        </>
      )}
      {p.status === 'error' && (
        <span className="text-xs text-destructive">
          {t('editor.transcribeFailed', { message: p.transcription.error })}
        </span>
      )}
    </>
  );
}

function Step2Panel() {
  const { t } = useTranslation();
  return <span className="text-xs text-muted-foreground">{t('stepper.step2Hint')}</span>;
}

function Step3Panel(p: StepperToolbarProps & { status: StepStatus }) {
  const { t } = useTranslation();
  const busy = p.status === 'running';
  const { onLoadSpeakers } = p;
  // パネルがアクティブになった時点で eager に speakers を取得しておく。
  // 取得前は fallback の「話者 N」が表示され、プルダウンを開いた直後にラベルが
  // 「ずんだもん (ノーマル)」等へ後追いで切り替わって見えるのを防ぐ。
  // onLoadSpeakers は親で毎レンダ新規生成されるため ref で 1 回だけ呼ぶ。
  const requestedRef = useRef(false);
  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    onLoadSpeakers();
  }, [onLoadSpeakers]);
  const opts = p.speakers.length > 0
    ? p.speakers
    : [{ speaker: p.defaultSpeaker, label: t('inspector.speakerFallback', { id: p.defaultSpeaker }) }];
  return (
    <>
      <span className="text-xs text-muted-foreground">{t('editor.defaultVoiceLabel')}</span>
      <Select
        value={String(p.defaultSpeaker)}
        onValueChange={(v) => p.onSetDefaultVoice({ speaker: Number(v), speed: p.defaultSpeed })}
        disabled={busy}
        onOpenChange={(o) => { if (o) p.onLoadSpeakers(); }}
      >
        <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          {opts.map((o) => (
            <SelectItem key={o.speaker} value={String(o.speaker)}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Slider
        className="w-32"
        min={0.5} max={2} step={0.05}
        value={[p.defaultSpeed]}
        onValueChange={([v]) => p.onSetDefaultVoice({ speaker: p.defaultSpeaker, speed: v })}
        disabled={busy}
      />
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{p.defaultSpeed.toFixed(2)}x</span>
      <Button variant="secondary" size="sm" onClick={p.onApplyDefaultToAll} disabled={busy}>
        {t('editor.applyDefaultToAll')}
      </Button>
      <Separator orientation="vertical" className="h-6" />
      <Button size="sm" onClick={p.onGenerateAll} disabled={busy}>
        <Mic className="size-4" />{t('stepper.step3Run')}
      </Button>
      {busy && (
        <>
          <span className="text-xs text-muted-foreground">
            {t('stepper.step3RunningHint', { percent: p.tts.percent })}
          </span>
          {p.tts.percent === 0 && (
            <span className="text-xs text-muted-foreground">{t('editor.engineStartHint')}</span>
          )}
          <Button variant="ghost" size="sm" onClick={p.onCancelTts}>
            <X className="size-4" />{t('common.cancel')}
          </Button>
        </>
      )}
      {p.status === 'error' && (
        <span className="text-xs text-destructive">
          {t('editor.ttsFailed', { message: p.tts.error })}
        </span>
      )}
      {p.status === 'done' && (
        <span className="text-xs text-muted-foreground">{t('stepper.step3DoneHint')}</span>
      )}
    </>
  );
}

function Step4Panel(p: StepperToolbarProps & { status: StepStatus }) {
  const { t } = useTranslation();
  const busy = p.status === 'running';
  return (
    <>
      <Button size="sm" onClick={p.onExport} disabled={busy}>
        <Download className="size-4" />{t('stepper.step4Run')}
      </Button>
      {busy && (
        <>
          <span className="text-xs text-muted-foreground">
            {t('stepper.step4RunningHint', { percent: p.exportState.percent })}
          </span>
          <Button variant="ghost" size="sm" onClick={p.onCancelExport}>
            <X className="size-4" />{t('common.cancel')}
          </Button>
        </>
      )}
      {p.status === 'done' && (
        <span className="text-xs text-emerald-500">{t('stepper.step4DoneHint')}</span>
      )}
      {p.status === 'error' && (
        <span className="text-xs text-destructive">{p.exportState.message}</span>
      )}
    </>
  );
}
