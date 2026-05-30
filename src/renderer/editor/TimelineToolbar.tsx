import { useTranslation } from 'react-i18next';
import { type Segment } from '../../shared/types';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Play, Pause, Download, X,
  Scissors, SplitSquareHorizontal, ArrowDownToLine,
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

  exportRunning: boolean;
  exportPercent: number;
  onExport: () => void;
  onCancelExport: () => void;
}

export function TimelineToolbar({
  playing, mode, ttsLoading, missingClips, onTogglePlay, onSwitchMode,
  segments, selected, currentTime, ttsBusy, onToggleCut, onSplitAtPlayhead, onMergeNext,
  exportRunning, exportPercent, onExport, onCancelExport,
}: Props) {
  const { t } = useTranslation();

  const isLast = !!selected && segments.length > 0
    && segments[segments.length - 1].id === selected.id;
  const canSplit = !!selected
    && currentTime > selected.videoStart
    && currentTime < selected.videoEnd;

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

      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => selected && onToggleCut(selected.id)}
        disabled={!selected || ttsBusy}
      >
        <Scissors className="size-4" />
        {selected && selected.enabled === false ? t('inspector.enable') : t('inspector.cut')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => selected && onSplitAtPlayhead(selected.id)}
        disabled={!canSplit || ttsBusy}
      >
        <SplitSquareHorizontal className="size-4" />
        {t('inspector.splitAtPlayhead')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => selected && onMergeNext(selected.id)}
        disabled={!selected || isLast || ttsBusy}
      >
        <ArrowDownToLine className="size-4" />
        {t('inspector.mergeNext')}
      </Button>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {exportRunning && (
          <Button variant="ghost" size="sm" onClick={onCancelExport}>
            <X className="size-4" />{t('common.cancel')}
          </Button>
        )}
        <Button size="sm" onClick={onExport} disabled={exportRunning}>
          <Download className="size-4" />
          {exportRunning ? t('preview.exporting', { percent: exportPercent }) : t('preview.export')}
        </Button>
      </div>
    </div>
  );
}
