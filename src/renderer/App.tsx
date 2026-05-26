import { EditorProvider, useEditor } from './state/editorStore';
import { HomeScreen } from './home/HomeScreen';
import { EditorLayout } from './editor/EditorLayout';

function Router() {
  const { state } = useEditor();
  return state.screen === 'editor' ? <EditorLayout /> : <HomeScreen />;
}

export default function App() {
  return (
    <EditorProvider>
      <Router />
    </EditorProvider>
  );
}
