import { downloadBlob, pickFile } from './id';

/** PC 앱(Electron)에서만 존재하는 기능들 (electron/preload.cjs) */
interface FileEntry {
  name: string;
  path: string;
  data: Uint8Array;
}
interface DesktopBridge {
  platform: string;
  saveDialog(opts: { title?: string; defaultName: string; filters: FileFilter[]; folder?: string }): Promise<string | null>;
  openDialog(opts: { title?: string; filters: FileFilter[]; multiple?: boolean }): Promise<FileEntry[]>;
  writeFile(path: string, data: ArrayBuffer): Promise<boolean>;
  showInFolder(path: string): Promise<void>;
  setDirty(v: boolean): void;
  closeNow(): void;
  onSaveAndClose(cb: () => void): () => void;
  onOpenFile(cb: (f: FileEntry) => void): () => void;
  video: {
    start(o: NativeVideoOptions): Promise<number>;
    frame(id: number, data: ArrayBuffer): Promise<boolean>;
    finish(id: number): Promise<{ ok: boolean; error: string | null }>;
    cancel(id: number): Promise<void>;
  };
}
export interface NativeVideoOptions {
  path: string;
  format: 'mp4' | 'webm';
  width: number;
  height: number;
  fps: number;
  frames: number;
  loopFrames: number;
  quality?: number;
  audio?: { name: string; data: ArrayBuffer; trim: number; delay: number; volume: number };
}
export interface FileFilter {
  name: string;
  extensions: string[];
}

export const desktop: DesktopBridge | null = (window as unknown as { amg?: DesktopBridge }).amg ?? null;
export const isDesktop = !!desktop;

export type FileKind = 'image' | 'audio' | 'project';
const FILTERS: Record<FileKind, FileFilter> = {
  image: { name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
  audio: { name: '음악', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'] },
  project: { name: 'AMG 프로젝트', extensions: ['amg', 'ffanim'] },
};
const ACCEPT: Record<FileKind, string> = { image: 'image/*', audio: 'audio/*', project: '.amg,.ffanim,application/octet-stream' };
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg',
};

/** 파일 고르기: PC 앱은 운영체제 대화상자, 웹은 브라우저 선택 창 */
export async function openFiles(kind: FileKind, multiple = false): Promise<File[]> {
  if (!desktop) return pickFile(ACCEPT[kind], multiple);
  const list = await desktop.openDialog({ filters: [FILTERS[kind]], multiple });
  return list.map((f) => {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    return new File([f.data as BlobPart], f.name, { type: MIME[ext] ?? 'application/octet-stream' });
  });
}

export const fileFilter = (name: string, ...extensions: string[]): FileFilter => ({ name, extensions });

/**
 * 파일로 저장: PC 앱은 저장 위치를 묻고 바로 쓰고, 웹은 다운로드.
 * 취소하면 null, 저장했으면 경로(웹은 파일 이름)를 돌려준다.
 */
export async function saveBlob(blob: Blob, defaultName: string, filter: FileFilter, folder?: string): Promise<string | null> {
  if (!desktop) {
    downloadBlob(blob, defaultName);
    return defaultName;
  }
  const path = await desktop.saveDialog({ defaultName, filters: [filter], folder });
  if (!path) return null;
  await desktop.writeFile(path, await blob.arrayBuffer());
  return path;
}

export async function chooseSavePath(defaultName: string, filter: FileFilter, folder?: string): Promise<string | null> {
  return desktop ? desktop.saveDialog({ defaultName, filters: [filter], folder }) : null;
}

export function baseName(p: string) {
  return p.split(/[\\/]/).pop() ?? p;
}
