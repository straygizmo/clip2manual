import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScreenRecorder } from '../recorder/screenRecorder';
import { useEditor } from '../state/editorStore';
import type { RecentProject } from '../global';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Circle, Square, FolderOpen, Play } from 'lucide-react';
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
    const recorder = new ScreenRecorder();
    try {
      await recorder.start();
      await window.api.startRecording();
      recorderRef.current = recorder;
      setRecording(true);
      setStatus(t('home.statusRecording'));
    } catch (err) {
      recorderRef.current = null;
      setRecording(false);
      setStatus(t('home.recordStartFailed', { message: String(err) }));
    }
  }

  async function onStop() {
    const recorder = recorderRef.current;
    if (!recorder) return;
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
            </Card>
          ))}
        </div>
      )}
      <DependencyStatus />
    </div>
  );
}
