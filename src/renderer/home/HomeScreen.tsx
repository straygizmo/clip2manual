import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ScreenRecorder } from '../recorder/screenRecorder';
import { useEditor } from '../state/editorStore';
import type { RecentProject } from '../global';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Circle, Square, FolderOpen, Play, Trash2, Pencil } from 'lucide-react';
import { SourcePicker } from './SourcePicker';
import { DependencyStatus } from './DependencyStatus';

export function HomeScreen() {
  const { t } = useTranslation();
  const { dispatch } = useEditor();
  const recorderRef = useRef<ScreenRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState(() => t('home.statusIdle'));
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [renamingDir, setRenamingDir] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pendingDelete, setPendingDelete] = useState<RecentProject | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const refreshRecent = () => { void window.api.recentProjects().then(setRecent); };
  useEffect(refreshRecent, []);

  async function open(projectDir: string) {
    const { project } = await window.api.openProject(projectDir);
    dispatch({ type: 'OPEN_PROJECT', projectDir, project });
  }

  async function onStart() {
    if (!selectedSourceId) {
      setStatus(t('home.source.notSelected'));
      return;
    }
    try {
      await window.api.notifyRecordingStarted();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const prep = await window.api.prepareCapture(selectedSourceId);
      if (!prep.ok) {
        await window.api.notifyRecordingStopped();
        setStatus(t(`home.source.prepareFailed.${prep.reason}`, { defaultValue: t('home.source.prepareFailed.generic') }));
        return;
      }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  function startRename(r: RecentProject) {
    setRenamingDir(r.projectDir);
    setRenameValue(r.name);
  }
  function cancelRename() {
    setRenamingDir(null);
    setRenameValue('');
  }
  async function commitRename() {
    if (!renamingDir) return;
    const trimmed = renameValue.trim();
    if (!trimmed) { cancelRename(); return; }
    const original = recent.find((x) => x.projectDir === renamingDir)?.name;
    if (trimmed === original) { cancelRename(); return; }
    try {
      await window.api.renameProject(renamingDir, trimmed);
      cancelRename();
      refreshRecent();
    } catch (err) {
      toast.error(t('home.recentRenameFailed', { message: String(err) }));
    }
  }

  async function confirmDelete() {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    try {
      await window.api.trashProject(target.projectDir);
      refreshRecent();
    } catch (err) {
      toast.error(t('home.recentDeleteFailed', { message: String(err) }));
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
          disabled={!recording && !selectedSourceId}
        >
          {recording ? <Square className="size-4" /> : <Circle className="size-4 fill-current" />}
          {recording ? t('home.recordStop') : t('home.recordStart')}
        </Button>
        <SourcePicker
          value={selectedSourceId}
          onChange={setSelectedSourceId}
          disabled={recording}
        />
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
          {recent.map((r) => {
            const isRenaming = renamingDir === r.projectDir;
            return (
              <Card key={r.projectDir} className="flex flex-row items-center gap-3 p-3">
                <Button size="sm" variant="ghost" onClick={() => open(r.projectDir)} disabled={isRenaming}>
                  <Play className="size-4" />
                  {t('home.recentOpen')}
                </Button>
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
                      else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                    }}
                    onBlur={() => void commitRename()}
                    className="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-1 text-sm font-medium outline-none focus:ring-2 focus:ring-ring"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => startRename(r)}
                    title={t('home.recentRename')}
                    className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                  >
                    {r.name}
                  </button>
                )}
                {!isRenaming && (
                  <>
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString()}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      title={t('home.recentRename')}
                      onClick={() => startRename(r)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title={t('home.recentDelete')}
                      onClick={() => setPendingDelete(r)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <DependencyStatus />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => { if (!o) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('home.recentDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && t('home.recentDeleteConfirm', { name: pendingDelete.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('home.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>
              {t('home.recentDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
