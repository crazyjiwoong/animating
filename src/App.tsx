import { useEffect } from 'react';
import { useEditor } from './store/editor';
import { Home } from './components/Home';
import { Editor } from './components/Editor';
import { desktop } from './lib/platform';
import { importProjectFile, saveProject } from './lib/storage';

export function App() {
  const hasProject = useEditor((s) => !!s.project);
  const close = useEditor((s) => s.closeProject);

  // PC 앱: .ffanim 파일을 더블클릭해서 열기
  useEffect(
    () =>
      desktop?.onOpenFile(async (f) => {
        const s = useEditor.getState();
        try {
          if (s.project && s.dirty) await saveProject(s.project);
          s.openProject(await importProjectFile(new Blob([f.data as BlobPart])));
          useEditor.getState().toast(`'${f.name}'을(를) 열었어요`, 'success');
        } catch (e) {
          useEditor.getState().toast((e as Error).message || '파일을 열 수 없어요', 'error');
        }
      }),
    [],
  );

  return hasProject ? <Editor onExit={close} /> : <Home />;
}
