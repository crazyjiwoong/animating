import { useEditor } from './store/editor';
import { Home } from './components/Home';
import { Editor } from './components/Editor';

export function App() {
  const hasProject = useEditor((s) => !!s.project);
  const close = useEditor((s) => s.closeProject);
  return hasProject ? <Editor onExit={close} /> : <Home />;
}
