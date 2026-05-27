import { EditorProvider, useEditor } from './state/editorStore';
import { HomeScreen } from './home/HomeScreen';
import { EditorLayout } from './editor/EditorLayout';
import { Toaster } from '@/components/ui/sonner';

function Router() {
  const { state } = useEditor();
  return state.screen === 'editor' ? <EditorLayout /> : <HomeScreen />;
}

export default function App() {
  return (
    <EditorProvider>
      <Router />
      <Toaster position="bottom-right" />
    </EditorProvider>
  );
}
