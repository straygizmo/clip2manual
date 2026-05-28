import { useState, useEffect } from 'react';
import { type Segment, type SpeakerOption } from '../../shared/types';
import { useEditor } from '../state/editorStore';
import { toggleEnabled, mergeWithNext, splitAt } from '../state/segmentOps';
import { projectAssetUrl } from './assetUrl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Scissors, SplitSquareHorizontal, ArrowDownToLine, RotateCcw } from 'lucide-react';

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
  const { state, dispatch } = useEditor();
  const [saveError, setSaveError] = useState<string | null>(null);

  // セグメント切替時に前のセグメントの保存エラー表示を消す
  useEffect(() => { setSaveError(null); }, [segment?.id]);

  if (!segment) {
    return <div className="p-3 text-sm text-muted-foreground">セグメントを選択してください</div>;
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

  const segments = state.project?.segments ?? [];
  const isLast = segments.length > 0 && segments[segments.length - 1].id === segment.id;
  const canSplit = state.currentTime > segment.videoStart && state.currentTime < segment.videoEnd;

  const applyOps = (next: Segment[], selectId: string) => {
    dispatch({ type: 'SET_SEGMENTS', segments: next, selectId });
    void persist(next); // persist は失敗時に saveError を立てる（テキスト編集と同じ扱い）
  };
  const onToggleCut = () => applyOps(toggleEnabled(segments, segment.id), segment.id);
  const onMerge = () => applyOps(mergeWithNext(segments, segment.id), segment.id);
  const onSplit = () => {
    const newId = `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    applyOps(splitAt(segments, segment.id, state.currentTime, newId), newId);
  };

  const speakerLabel = speakers.find((s) => s.speaker === segment.voice.speaker)?.label;
  // 話者一覧が未取得でも現在の speaker を選べるよう、フォールバック option を用意する。
  const options = speakers.length > 0
    ? speakers
    : [{ speaker: segment.voice.speaker, label: `話者 ${segment.voice.speaker}` }];

  return (
    <div className="p-3 text-sm">
      <h3 className="mt-0 text-sm font-semibold">
        セグメント {index + 1}（{segment.id}）
        {edited && (
          <Badge variant="outline" className="ml-2">編集済み</Badge>
        )}
      </h3>
      <div className="mb-2 text-muted-foreground">
        {fmt(segment.videoStart)} – {fmt(segment.videoEnd)}
      </div>

      <div className="mb-1 text-xs text-muted-foreground">元の文字起こし（読み取り専用）</div>
      <div className="mt-1 whitespace-pre-wrap rounded-md bg-muted p-2 text-muted-foreground">
        {segment.originalText || '（無音/空）'}
      </div>

      <Label htmlFor="inspector-corrected-text" className="mt-2 mb-1 block text-xs text-muted-foreground">補正テキスト</Label>
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
          <RotateCcw className="size-4" />元に戻す
        </Button>
        {saveError && <span className="text-xs text-destructive">保存に失敗しました</span>}
      </div>

      <Separator className="my-3" />

      <Label className="mb-1 block text-xs text-muted-foreground">声（話者）</Label>
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

      <Label className="mt-2 mb-1 block text-xs text-muted-foreground">速度（{segment.voice.speed.toFixed(2)}）</Label>
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
          {segment.ttsAudio ? '再生成' : '生成'}
        </Button>
        <span className={segment.ttsAudio ? 'text-xs text-primary' : 'text-xs text-muted-foreground'}>
          {segment.ttsAudio ? '生成済み' : '未生成'}
        </span>
      </div>

      {segment.ttsAudio && (
        <div className="mt-2">
          <audio controls src={`${projectAssetUrl(segment.ttsAudio, projectDir)}&v=${ttsNonce}`} className="w-full" />
          <div className="mt-1 text-xs text-muted-foreground">
            クレジット: VOICEVOX{speakerLabel ? `：${speakerLabel}` : ''}
          </div>
        </div>
      )}

      <Separator className="my-3" />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onToggleCut} disabled={busy}>
          <Scissors className="size-4" />{segment.enabled ? 'カット' : '有効化'}
        </Button>
        <Button variant="outline" size="sm" onClick={onSplit} disabled={!canSplit || busy}>
          <SplitSquareHorizontal className="size-4" />分割（再生ヘッド位置）
        </Button>
        <Button variant="outline" size="sm" onClick={onMerge} disabled={isLast || busy}>
          <ArrowDownToLine className="size-4" />次と結合
        </Button>
      </div>
      {!segment.enabled && (
        <div className="mt-1.5 text-xs text-amber-500">カット中（プレビュー/書き出しで除外）</div>
      )}
      <div className="mt-2 text-xs text-muted-foreground">クリック {segment.clicks.length} 件</div>
    </div>
  );
}
