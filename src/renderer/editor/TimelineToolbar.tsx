import { useTranslation } from 'react-i18next';
import { type Segment } from '../../shared/types';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  Play, Pause,
  Scissors, ArrowRightToLine,
} from 'lucide-react';

interface Props {
  playing: boolean;
  mode: 'original' | 'tts';
  ttsLoading: boolean;
  missingClips: boolean;
  onTogglePlay: () => void;
  onSwitchMode: (next: 'original' | 'tts') => void;

  segments: Segment[];
  selected: Segment | null;
  currentTime: number;
  ttsBusy: boolean;
  onToggleCut: (id: string) => void;
  onSplitAtPlayhead: (id: string) => void;
  onMergeNext: (id: string) => void;
}

export function TimelineToolbar({
  playing, mode, ttsLoading, missingClips, onTogglePlay, onSwitchMode,
  segments, selected, currentTime, ttsBusy, onToggleCut, onSplitAtPlayhead, onMergeNext,
}: Props) {
  const { t } = useTranslation();

  const isLast = !!selected && segments.length > 0
    && segments[segments.length - 1].id === selected.id;
  const playheadInside = !!selected
    && currentTime > selected.videoStart
    && currentTime < selected.videoEnd;
  const canSplit = playheadInside;
  const canMerge = playheadInside && !isLast;

  const playOn = selected ? selected.enabled !== false : true;

  return (
    <div className="flex shrink-0 flex-nowrap items-center gap-2 overflow-x-auto bg-muted px-3 py-2 text-foreground">
      <Button size="sm" className="shrink-0" onClick={onTogglePlay} disabled={ttsLoading}>
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        {playing ? t('preview.pause') : t('preview.play')}
      </Button>
      <span className="shrink-0 text-xs text-muted-foreground">{t('preview.audioLabel')}</span>
      <Button
        size="sm"
        className="shrink-0"
        variant={mode === 'original' ? 'default' : 'secondary'}
        onClick={() => onSwitchMode('original')}
        disabled={mode === 'original' || ttsLoading}
      >
        {t('preview.modeOriginal')}
      </Button>
      <Button
        size="sm"
        className="shrink-0"
        variant={mode === 'tts' ? 'default' : 'secondary'}
        onClick={() => onSwitchMode('tts')}
        disabled={mode === 'tts' || ttsLoading}
      >
        {t('preview.modeTts')}
      </Button>
      {ttsLoading && (
        <span className="shrink-0 text-xs text-muted-foreground">{t('preview.ttsLoading')}</span>
      )}
      {missingClips && (
        <span className="shrink-0 text-xs text-amber-500">{t('preview.missingTtsHint')}</span>
      )}

      <Separator orientation="vertical" className="h-6 shrink-0" />

      <label className="flex shrink-0 items-center gap-2 text-xs">
        <Switch
          checked={playOn}
          onCheckedChange={() => selected && onToggleCut(selected.id)}
          disabled={!selected || ttsBusy || mode === 'original'}
        />
        {t('inspector.enabled')}
      </label>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => selected && onSplitAtPlayhead(selected.id)}
        disabled={!canSplit || ttsBusy}
      >
        <Scissors className="size-4" />
        {t('inspector.splitAtPlayhead')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => selected && onMergeNext(selected.id)}
        disabled={!canMerge || ttsBusy}
      >
        <ArrowRightToLine className="size-4" />
        {t('inspector.mergeNext')}
      </Button>
    </div>
  );
}
