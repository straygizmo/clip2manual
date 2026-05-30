import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { type Segment, type SpeakerOption } from '../../shared/types';
import { useEditor } from '../state/editorStore';
import { projectAssetUrl } from './assetUrl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RotateCcw } from 'lucide-react';

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

interface Props {
  segment: Segment | null;
  index: number;
  speakers: SpeakerOption[];
  projectDir: string;
  ttsNonce: number;
  busy: boolean;
  onLoadSpeakers: () => void;
  onGenerate: (id: string) => void;
}

export function Inspector({ segment, index, speakers, projectDir, ttsNonce, busy, onLoadSpeakers, onGenerate }: Props) {
  const { t } = useTranslation();
  const { state, dispatch } = useEditor();
  const [saveError, setSaveError] = useState<string | null>(null);

  // セグメント切替時に前のセグメントの保存エラー表示を消す
  useEffect(() => { setSaveError(null); }, [segment?.id]);

  if (!segment) {
    return <div className="p-3 text-sm text-muted-foreground">{t('inspector.selectPrompt')}</div>;
  }

  const edited = segment.correctedText !== segment.originalText;

  const persist = async (segments: Segment[]) => {
    try {
      await window.api.updateSegments(segments);
      setSaveError(null);
    } catch (err) {
      setSaveError(String(err));
    }
  };

  const onBlurText = () => {
    if (state.project) void persist(state.project.segments);
  };

  const revert = () => {
    if (!state.project) return;
    const segments = state.project.segments.map((s) =>
      s.id === segment.id ? { ...s, correctedText: s.originalText } : s,
    );
    dispatch({ type: 'EDIT_SEGMENT_TEXT', id: segment.id, text: segment.originalText });
    void persist(segments);
  };

  const setVoice = (voice: { speaker: number; speed: number }) => {
    if (!state.project) return;
    const segments = state.project.segments.map((s) => (s.id === segment.id ? { ...s, voice } : s));
    dispatch({ type: 'SET_SEGMENT_VOICE', id: segment.id, voice });
    void persist(segments);
  };

  const speakerLabel = speakers.find((s) => s.speaker === segment.voice.speaker)?.label;
  // 話者一覧が未取得でも現在の speaker を選べるよう、フォールバック option を用意する。
  const options = speakers.length > 0
    ? speakers
    : [{ speaker: segment.voice.speaker, label: t('inspector.speakerFallback', { id: segment.voice.speaker }) }];

  return (
    <div className="p-3 text-sm">
      <h3 className="mt-0 text-sm font-semibold">
        {t('inspector.title', { index: index + 1, id: segment.id })}
        {edited && (
          <Badge variant="outline" className="ml-2">{t('inspector.editedBadge')}</Badge>
        )}
      </h3>
      <div className="mb-2 text-muted-foreground">
        {fmt(segment.videoStart)} – {fmt(segment.videoEnd)}
      </div>

      <div className="mb-1 text-xs text-muted-foreground">{t('inspector.originalLabel')}</div>
      <div className="mt-1 whitespace-pre-wrap rounded-md bg-muted p-2 text-muted-foreground">
        {segment.originalText || t('inspector.emptyText')}
      </div>

      <Label htmlFor="inspector-corrected-text" className="mt-2 mb-1 block text-xs text-muted-foreground">{t('inspector.correctedLabel')}</Label>
      <Textarea
        id="inspector-corrected-text"
        value={segment.correctedText}
        onChange={(e) => dispatch({ type: 'EDIT_SEGMENT_TEXT', id: segment.id, text: e.target.value })}
        onBlur={onBlurText}
        disabled={busy}
        rows={4}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={revert} disabled={!edited || busy}>
          <RotateCcw className="size-4" />{t('inspector.revert')}
        </Button>
        {saveError && <span className="text-xs text-destructive">{t('inspector.saveFailed')}</span>}
      </div>

      <Separator className="my-3" />

      <Label className="mb-1 block text-xs text-muted-foreground">{t('inspector.voiceLabel')}</Label>
      <Select
        value={String(segment.voice.speaker)}
        onValueChange={(v) => setVoice({ speaker: Number(v), speed: segment.voice.speed })}
        disabled={busy}
        onOpenChange={(o) => { if (o) onLoadSpeakers(); }}
      >
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.speaker} value={String(o.speaker)}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Label className="mt-2 mb-1 block text-xs text-muted-foreground">{t('inspector.speedLabel', { value: segment.voice.speed.toFixed(2) })}</Label>
      <Slider
        min={0.5}
        max={2}
        step={0.05}
        value={[segment.voice.speed]}
        onValueChange={([v]) => setVoice({ speaker: segment.voice.speaker, speed: v })}
        disabled={busy}
      />

      <div className="mt-2.5 flex items-center gap-2">
        <Button size="sm" onClick={() => onGenerate(segment.id)} disabled={busy || segment.correctedText.trim() === ''}>
          {segment.ttsAudio ? t('inspector.regenerate') : t('inspector.generate')}
        </Button>
        <span className={segment.ttsAudio ? 'text-xs font-medium text-emerald-400' : 'text-xs text-muted-foreground'}>
          {segment.ttsAudio ? t('inspector.statusGenerated') : t('inspector.statusNotGenerated')}
        </span>
      </div>

      {segment.ttsAudio && (
        <div className="mt-2">
          <audio controls src={`${projectAssetUrl(segment.ttsAudio, projectDir)}&v=${ttsNonce}`} className="w-full" />
          <div className="mt-1 text-xs text-muted-foreground">
            {speakerLabel ? t('inspector.creditWithSpeaker', { speaker: speakerLabel }) : t('inspector.credit')}
          </div>
        </div>
      )}

      {!segment.enabled && (
        <div className="mt-2 text-xs text-amber-500">{t('inspector.cutBadge')}</div>
      )}
      <div className="mt-2 text-xs text-muted-foreground">{t('inspector.clickCount', { count: segment.clicks.length })}</div>
    </div>
  );
}
