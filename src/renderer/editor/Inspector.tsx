import { useState, useEffect } from 'react';
import { type Segment, type SpeakerOption } from '../../shared/types';
import { useEditor } from '../state/editorStore';
import { projectAssetUrl } from './assetUrl';

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
    return <div style={{ padding: 12, color: '#888' }}>セグメントを選択してください</div>;
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
    : [{ speaker: segment.voice.speaker, label: `話者 ${segment.voice.speaker}` }];

  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      <h3 style={{ marginTop: 0 }}>
        セグメント {index + 1}（{segment.id}）
        {edited && (
          <span style={{ marginLeft: 8, fontSize: 11, color: '#0a7', border: '1px solid #0a7', borderRadius: 4, padding: '1px 5px' }}>
            編集済み
          </span>
        )}
      </h3>
      <div style={{ color: '#666', marginBottom: 8 }}>
        {fmt(segment.videoStart)} – {fmt(segment.videoEnd)}
      </div>

      <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>元の文字起こし（読み取り専用）</div>
      <div style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
        {segment.originalText || '（無音/空）'}
      </div>

      <div style={{ color: '#666', fontSize: 12, marginTop: 8, marginBottom: 4 }}>補正テキスト</div>
      <textarea
        value={segment.correctedText}
        onChange={(e) => dispatch({ type: 'EDIT_SEGMENT_TEXT', id: segment.id, text: e.target.value })}
        onBlur={onBlurText}
        rows={4}
        style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', padding: 8, borderRadius: 4 }}
      />
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={revert} disabled={!edited}>元に戻す</button>
        {saveError && <span style={{ color: '#c00', fontSize: 12 }}>保存に失敗しました</span>}
      </div>

      <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid #eee' }} />

      <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>声（話者）</div>
      <select
        value={segment.voice.speaker}
        onMouseDown={onLoadSpeakers}
        onChange={(e) => setVoice({ speaker: Number(e.target.value), speed: segment.voice.speed })}
        style={{ width: '100%', padding: 4 }}
      >
        {options.map((o) => (
          <option key={o.speaker} value={o.speaker}>{o.label}</option>
        ))}
      </select>

      <div style={{ color: '#666', fontSize: 12, marginTop: 8, marginBottom: 4 }}>速度（{segment.voice.speed.toFixed(2)}）</div>
      <input
        type="range" min={0.5} max={2} step={0.05}
        value={segment.voice.speed}
        onChange={(e) => setVoice({ speaker: segment.voice.speaker, speed: Number(e.target.value) })}
        style={{ width: '100%' }}
      />

      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => onGenerate(segment.id)} disabled={busy || segment.correctedText.trim() === ''}>
          {segment.ttsAudio ? '再生成' : '生成'}
        </button>
        <span style={{ fontSize: 12, color: segment.ttsAudio ? '#0a7' : '#999' }}>
          {segment.ttsAudio ? '生成済み' : '未生成'}
        </span>
      </div>

      {segment.ttsAudio && (
        <div style={{ marginTop: 8 }}>
          <audio controls src={`${projectAssetUrl(segment.ttsAudio, projectDir)}&v=${ttsNonce}`} style={{ width: '100%' }} />
          {speakerLabel && (
            <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>クレジット: VOICEVOX：{speakerLabel}</div>
          )}
        </div>
      )}

      <div style={{ color: '#666', fontSize: 12, marginTop: 8 }}>クリック {segment.clicks.length} 件</div>
    </div>
  );
}
