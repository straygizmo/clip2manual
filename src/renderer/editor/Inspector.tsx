import { type Segment } from '../../shared/types';

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

export function Inspector({ segment, index }: { segment: Segment | null; index: number }) {
  if (!segment) {
    return <div style={{ padding: 12, color: '#888' }}>セグメントを選択してください</div>;
  }
  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      <h3 style={{ marginTop: 0 }}>セグメント {index + 1}（{segment.id}）</h3>
      <div style={{ color: '#666', marginBottom: 8 }}>{fmt(segment.videoStart)} – {fmt(segment.videoEnd)}</div>
      <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>文字起こし（読み取り専用）</div>
      <div style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
        {segment.originalText || '（無音/空）'}
      </div>
      <div style={{ color: '#666', fontSize: 12, marginTop: 8 }}>クリック {segment.clicks.length} 件</div>
    </div>
  );
}
