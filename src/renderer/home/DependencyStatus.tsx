import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Check, X, Download, Loader2 } from 'lucide-react';

type Tool = 'whisper' | 'voicevox' | 'ffmpeg';
const TOOLS: Tool[] = ['whisper', 'voicevox', 'ffmpeg'];
const TOOL_LABEL_KEY: Record<Tool, string> = {
  whisper: 'deps.toolWhisper',
  voicevox: 'deps.toolVoicevox',
  ffmpeg: 'deps.toolFfmpeg',
};

/** ホーム画面の依存関係セクション: 取得状況の表示と未取得のダウンロード。 */
export function DependencyStatus() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Record<Tool, boolean> | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<{ tool: string; percent: number } | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => { void window.api.setupStatus().then(setStatus); }, []);
  useEffect(() => window.api.onSetupProgress((p) => setProgress(p)), []);
  // 1ツール成功ごとに main から届くスナップショットで badges を即時更新する
  // （後続ツールが失敗して runSetup() 全体が reject されても成功分は反映済みになる）。
  useEffect(() => window.api.onSetupStatusChanged((s) => setStatus(s)), []);

  if (!status) return null;
  const missing = TOOLS.filter((tool) => !status[tool]);

  const onDownload = async () => {
    cancelledRef.current = false;
    setInstalling(true);
    try {
      const next = await window.api.runSetup();
      setStatus(next);
      toast.success(t('deps.toastReady'));
    } catch (e) {
      if (cancelledRef.current) {
        toast.info(t('deps.toastCancelled'));
      } else {
        toast.error(t('deps.toastFailed'), { description: String(e) });
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

  const progressLabel = progress
    ? (TOOLS.includes(progress.tool as Tool)
        ? t(TOOL_LABEL_KEY[progress.tool as Tool])
        : progress.tool)
    : null;

  return (
    <Card className="mt-8 flex flex-col gap-3 p-4">
      <h2 className="text-base font-medium">{t('deps.title')}</h2>
      <ul className="flex flex-col gap-1.5">
        {TOOLS.map((tool) => (
          <li key={tool} className="flex items-center gap-2 text-sm">
            <Badge
              variant={status[tool] ? 'secondary' : 'destructive'}
              className={status[tool] ? 'gap-1 bg-green-500 text-white border-transparent' : 'gap-1'}
            >
              {status[tool] ? <Check className="size-3" /> : <X className="size-3" />}
              {status[tool] ? t('deps.installed') : t('deps.missing')}
            </Badge>
            <span>{t(TOOL_LABEL_KEY[tool])}</span>
          </li>
        ))}
      </ul>
      {missing.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('deps.ready')}</p>
      ) : installing ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              {progressLabel ? t('deps.installingTool', { label: progressLabel }) : t('deps.installingGeneric')}
            </span>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          </div>
          <Progress value={progress?.percent ?? 0} />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Button variant="default" size="sm" className="w-fit" onClick={onDownload}>
            <Download className="size-4" />
            {t('deps.downloadButton', { count: missing.length })}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t('deps.downloadHint')}
          </p>
        </div>
      )}
    </Card>
  );
}
