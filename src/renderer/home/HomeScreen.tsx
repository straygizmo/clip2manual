import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScreenRecorder } from '../recorder/screenRecorder';
import { useEditor } from '../state/editorStore';
import type { RecentProject } from '../global';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Circle, Square, FolderOpen, Play, Trash2 } from 'lucide-react';
import { DependencyStatus } from './DependencyStatus';

export function HomeScreen() {
  const { t } = useTranslation();
  const { dispatch } = useEditor();
  const recorderRef = useRef<ScreenRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState(() => t('home.statusIdle'));
  const [recent, setRecent] = useState<RecentProject[]>([]);

  const refreshRecent = () => { void window.api.recentProjects().then(setRecent); };
  useEffect(refreshRecent, []);

  async function open(projectDir: string) {
    const { project } = await window.api.openProject(projectDir);
    dispatch({ type: 'OPEN_PROJECT', projectDir, project });
  }

  async function onStart() {
    try {
      // 最小化アニメーションが録画に写り込まないよう、先にウィンドウを最小化し
      // OS のアニメーション完了を待ってから録画を開始する。
      await window.api.notifyRecordingStarted();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const recorder = new ScreenRecorder();
      await recorder.start();
      await window.api.startRecording();
      recorderRef.current = recorder;
      setRecording(true);
      setStatus(t('home.statusRecording'));
    } catch (err) {
      await window.api.notifyRecordingStopped();
      recorderRef.current = null;
      setRecording(false);
      setStatus(t('home.recordStartFailed', { message: String(err) }));
    }
  }

  async function onStop() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    await window.api.notifyRecordingStopped();
    try {
      const result = await recorder.stop();
      const video = await result.videoBlob.arrayBuffer();
      const audio = await result.audioBlob.arrayBuffer();
      const res = await window.api.stopRecording({
        video, audio, videoWidth: result.videoWidth, videoHeight: result.videoHeight,
      });
      setRecording(false);
      recorderRef.current = null;
      setStatus(t('home.saveSucceeded', { count: res.clickCount }));
      await open(res.projectDir);
    } catch (err) {
      setRecording(false);
      recorderRef.current = null;
      setStatus(t('home.saveFailed', { message: String(err) }));
    }
  }

  // ウィンドウ復帰での自動停止: 録画中だけ購読
  useEffect(() => {
    if (!recording) return;
    const off = window.api.onWindowAutoStop(() => { void onStop(); });
    return off;
    // onStop は ref/state を closures で読むが、recording をトリガにしたいので依存は最小化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  async function onDelete(r: RecentProject) {
    const ok = window.confirm(t('home.recentDeleteConfirm', { name: r.name }));
    if (!ok) return;
    try {
      await window.api.trashProject(r.projectDir);
      refreshRecent();
    } catch (err) {
      window.alert(t('home.recentDeleteFailed', { message: String(err) }));
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t('home.title')}</h1>
      <div className="flex items-center gap-3">
        <Button
          onClick={recording ? onStop : onStart}
          variant={recording ? 'destructive' : 'default'}
          size="lg"
        >
          {recording ? <Square className="size-4" /> : <Circle className="size-4 fill-current" />}
          {recording ? t('home.recordStop') : t('home.recordStart')}
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            window.api
              .openProjectDialog()
              .then((r) => r && dispatch({ type: 'OPEN_PROJECT', projectDir: r.projectDir, project: r.project }))
          }
        >
          <FolderOpen className="size-4" />
          {t('home.openFromFolder')}
        </Button>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{status}</p>

      <h2 className="mt-8 mb-3 text-base font-medium">{t('home.recentTitle')}</h2>
      {recent.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('home.recentEmpty')}</p>
      ) : (
        <div className="flex max-h-52 flex-col gap-2 overflow-y-auto pr-1">
          {recent.map((r) => (
            <Card key={r.projectDir} className="flex flex-row items-center gap-3 p-3">
              <Button size="sm" variant="ghost" onClick={() => open(r.projectDir)}>
                <Play className="size-4" />
                {t('home.recentOpen')}
              </Button>
              <span className="font-medium">{r.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {new Date(r.createdAt).toLocaleString()}
              </span>
              <Button
                size="icon"
                variant="ghost"
                title={t('home.recentDelete')}
                onClick={() => void onDelete(r)}
              >
                <Trash2 className="size-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}
      <DependencyStatus />
    </div>
  );
}
