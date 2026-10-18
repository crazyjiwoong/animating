import { isVideoFile, loadRefVideo } from './refvideo';
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

const isImage = (f: File) => f.type.startsWith('image/');

/** 여러 장을 한 레이어에 프레임 순서대로 넣는다 (파일 이름 순) */
export async function importImageSequence(files: File[]) {
  const s = useEditor.getState();
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  try {
    const items = await Promise.all(sorted.map(async (f) => ({ blob: f as Blob, name: f.name, bitmap: await createImageBitmap(f) })));
    s.importImageSequence(items);
  } catch {
    s.toast('이미지를 읽을 수 없어요', 'error');
  }
}

export async function replaceCurrentImage(file: File) {
  try {
    useEditor.getState().replaceImage(file, file.name, await createImageBitmap(file));
  } catch {
    useEditor.getState().toast('이미지를 읽을 수 없어요', 'error');
  }
}

/** 드롭/선택된 파일들을 종류에 따라 가져온다 */
/** 영상을 레이어 맨 아래 참고 영상으로 깔기 */
export async function importRefVideo(blob: Blob, name: string) {
  const s = useEditor.getState();
  try {
    const r = await loadRefVideo(blob, name);
    const prev = s.project?.refVideo;
    // 바꿔 끼울 때는 보기 설정을 그대로
    s.setRefVideo(prev ? { ...prev, name, blob, width: r.width, height: r.height, duration: r.duration, trim: 0 } : r);
    s.toast('참고 영상을 깔았어요 · 레이어 패널 맨 아래에서 조절해요', 'success');
  } catch (e) {
    s.toast(`${name}: ${(e as Error).message}`, 'error');
  }
}

export async function importFiles(files: File[]) {
  const images = files.filter(isImage);
  if (images.length > 1) {
    useEditor.getState().set({ dialog: { type: 'imageImport', files: images } });
    files = files.filter((f) => !isImage(f));
  }
  for (const f of files) {
    if (isImage(f)) await importImageBlob(f, f.name);
    else if (isVideoFile(f)) await importRefVideo(f, f.name);
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
