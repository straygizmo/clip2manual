import { useState } from 'react';
import { type Segment } from '../../shared/types';
import { useEditor } from '../state/editorStore';

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

export function Inspector({ segment, index }: { segment: Segment | null; index: number }) {
  const { state, dispatch } = useEditor();
  const [saveError, setSaveError] = useState<string | null>(null);

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

  const onBlur = () => {
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
        onBlur={onBlur}
        rows={4}
        style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', padding: 8, borderRadius: 4 }}
      />

      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={revert} disabled={!edited}>元に戻す</button>
        {saveError && <span style={{ color: '#c00', fontSize: 12 }}>保存に失敗しました</span>}
      </div>

      <div style={{ color: '#666', fontSize: 12, marginTop: 8 }}>クリック {segment.clicks.length} 件</div>
    </div>
  );
}
