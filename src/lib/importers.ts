import { useEditor } from '../store/editor';
import { decodeAudio } from './audio';

export async function importImageBlob(blob: Blob, name = '붙여넣은 이미지') {
  const s = useEditor.getState();
  if (!s.project) return;
  try {
    const bitmap = await createImageBitmap(blob);
    s.importImage(blob, name, bitmap);
  } catch {
    s.toast('이미지를 읽을 수 없어요', 'error');
  }
}

export async function importAudioFile(file: Blob, name: string) {
  const s = useEditor.getState();
  if (!s.project) return;
  try {
    const buffer = await decodeAudio(file);
    s.setAudio({ name, blob: file, buffer, startFrame: 0, trim: 0, volume: 0.9, muted: false });
    const need = Math.ceil(buffer.duration * s.project.fps);
    s.toast(`'${name}' 추가됨 · ${buffer.duration.toFixed(1)}초 (${need}프레임 분량)`, 'success');
  } catch {
    s.toast('이 오디오 형식은 열 수 없어요', 'error');
  }
}

/** 드롭/선택된 파일들을 종류에 따라 가져온다 */
export async function importFiles(files: File[]) {
  for (const f of files) {
    if (f.type.startsWith('image/')) await importImageBlob(f, f.name);
    else if (f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(f.name)) await importAudioFile(f, f.name);
    else useEditor.getState().toast(`${f.name}: 지원하지 않는 파일이에요`, 'error');
  }
}

/** 시스템 클립보드에서 이미지 읽기 (메뉴 버튼용) */
export async function pasteFromSystemClipboard(): Promise<boolean> {
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const type = it.types.find((t) => t.startsWith('image/'));
      if (type) {
        await importImageBlob(await it.getType(type));
        return true;
      }
    }
  } catch {
    /* 권한 없음 */
  }
  return false;
}
