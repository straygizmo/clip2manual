import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Check, X, Download, Loader2 } from 'lucide-react';

type Tool = 'whisper' | 'voicevox' | 'ffmpeg';
const TOOLS: Tool[] = ['whisper', 'voicevox', 'ffmpeg'];
const LABEL: Record<Tool, string> = {
  whisper: '文字起こし (whisper)',
  voicevox: '音声合成 (VOICEVOX)',
  ffmpeg: '書き出し (ffmpeg)',
};

/** ホーム画面の依存関係セクション: 取得状況の表示と未取得のダウンロード。 */
export function DependencyStatus() {
  const [status, setStatus] = useState<Record<Tool, boolean> | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<{ tool: string; percent: number } | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => { void window.api.setupStatus().then(setStatus); }, []);
  useEffect(() => window.api.onSetupProgress((p) => setProgress(p)), []);

  if (!status) return null;
  const missing = TOOLS.filter((t) => !status[t]);

  const onDownload = async () => {
    cancelledRef.current = false;
    setInstalling(true);
    try {
      const next = await window.api.runSetup();
      setStatus(next);
      toast.success('依存関係の準備が完了しました');
    } catch (e) {
      if (cancelledRef.current) {
        toast.info('ダウンロードをキャンセルしました');
      } else {
        toast.error('ダウンロードに失敗しました', { description: String(e) });
      }
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  };

  const onCancel = () => {
    cancelledRef.current = true;
    void window.api.cancelSetup();
  };

  return (
    <Card className="mt-8 flex flex-col gap-3 p-4">
      <h2 className="text-base font-medium">依存関係</h2>
      <ul className="flex flex-col gap-1.5">
        {TOOLS.map((t) => (
          <li key={t} className="flex items-center gap-2 text-sm">
            <Badge variant={status[t] ? 'secondary' : 'destructive'} className="gap-1">
              {status[t] ? <Check className="size-3" /> : <X className="size-3" />}
              {status[t] ? '取得済み' : '未取得'}
            </Badge>
            <span>{LABEL[t]}</span>
          </li>
        ))}
      </ul>
      {missing.length === 0 ? (
        <p className="text-sm text-muted-foreground">準備完了</p>
      ) : installing ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              {progress ? `${LABEL[progress.tool as Tool] ?? progress.tool} 取得中…` : '準備中…'}
            </span>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              キャンセル
            </Button>
          </div>
          <Progress value={progress?.percent ?? 0} />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Button variant="default" size="sm" className="w-fit" onClick={onDownload}>
            <Download className="size-4" />
            未取得をダウンロード（{missing.length}件）
          </Button>
          <p className="text-xs text-muted-foreground">
            初回は数百MB〜1GB超のダウンロードがあり時間がかかります。
          </p>
        </div>
      )}
    </Card>
  );
}
