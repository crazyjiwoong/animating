import { createStore, get, set, del, entries } from 'idb-keyval';
import type { Asset, Cel, Frame, Layer, Project, ProjectMeta, Transform } from '../types';
import { blobToCanvas, canvasToBlob } from './canvas';
import { renderThumb } from './render';
import { decodeAudio } from './audio';

const projectsDb = createStore('frameflow-projects', 'projects');
const metaDb = createStore('frameflow-meta', 'meta');

/* 저장 형식: 비트맵은 Blob, 나머지는 평범한 객체 */
interface StoredCel {
  kind: 'raster' | 'image';
  png?: Blob;
  assetId?: string;
  t?: Transform;
}
interface StoredProject {
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string | null;
  layers: Layer[];
  frames: { id: string; memo?: string; cels: Record<string, StoredCel> }[];
  assets: { id: string; name: string; blob: Blob }[];
  audio: { name: string; blob: Blob; startFrame: number; trim: number; volume: number; muted: boolean } | null;
  createdAt: number;
  updatedAt: number;
}

/** 캔버스는 커밋 후 불변이므로 PNG 인코딩 결과를 캐시해 둔다 */
const pngCache = new WeakMap<HTMLCanvasElement, Promise<Blob>>();
function pngOf(c: HTMLCanvasElement) {
  let p = pngCache.get(c);
  if (!p) {
    p = canvasToBlob(c);
    pngCache.set(c, p);
  }
  return p;
}

export async function serialize(p: Project): Promise<StoredProject> {
  const used = new Set<string>();
  const frames = await Promise.all(
    p.frames.map(async (f) => {
      const cels: Record<string, StoredCel> = {};
      await Promise.all(
        Object.entries(f.cels).map(async ([lid, c]) => {
          if (!p.layers.some((l) => l.id === lid)) return;
          if (c.kind === 'raster') cels[lid] = { kind: 'raster', png: await pngOf(c.canvas) };
          else {
            used.add(c.assetId);
            cels[lid] = { kind: 'image', assetId: c.assetId, t: c.t };
          }
        }),
      );
      return { id: f.id, memo: f.memo, cels };
    }),
  );
  return {
    version: 1,
    id: p.id,
    name: p.name,
    width: p.width,
    height: p.height,
    fps: p.fps,
    background: p.background,
    layers: p.layers,
    frames,
    assets: Object.values(p.assets)
      .filter((a) => used.has(a.id))
      .map((a) => ({ id: a.id, name: a.name, blob: a.blob })),
    audio: p.audio
      ? { name: p.audio.name, blob: p.audio.blob, startFrame: p.audio.startFrame, trim: p.audio.trim, volume: p.audio.volume, muted: p.audio.muted }
      : null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export async function deserialize(s: StoredProject): Promise<Project> {
  const assets: Record<string, Asset> = {};
  await Promise.all(
    s.assets.map(async (a) => {
      const bitmap = await createImageBitmap(a.blob);
      assets[a.id] = { id: a.id, name: a.name, blob: a.blob, bitmap, width: bitmap.width, height: bitmap.height };
    }),
  );
  const frames: Frame[] = await Promise.all(
    s.frames.map(async (f) => {
      const cels: Record<string, Cel> = {};
      await Promise.all(
        Object.entries(f.cels).map(async ([lid, c]) => {
          if (c.kind === 'raster' && c.png) {
            const canvas = await blobToCanvas(c.png);
            pngCache.set(canvas, Promise.resolve(c.png));
            cels[lid] = { kind: 'raster', canvas };
          } else if (c.kind === 'image' && c.assetId && c.t && assets[c.assetId]) {
            cels[lid] = { kind: 'image', assetId: c.assetId, t: c.t };
          }
        }),
      );
      return { id: f.id, memo: f.memo, cels };
    }),
  );
  let audio: Project['audio'] = null;
  if (s.audio) {
    try {
      const buffer = await decodeAudio(s.audio.blob);
      audio = { ...s.audio, buffer };
    } catch (e) {
      console.warn('오디오 복원 실패', e);
    }
  }
  return {
    id: s.id,
    name: s.name,
    width: s.width,
    height: s.height,
    fps: s.fps,
    background: s.background,
    layers: s.layers,
    frames: frames.length ? frames : [{ id: 'f_0', cels: {} }],
    assets,
    audio,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/* ---------------------------------------------------------------- 브라우저 저장소 */

export async function saveProject(p: Project): Promise<number> {
  const stored = await serialize(p);
  const at = Date.now();
  stored.updatedAt = at;
  const thumb = await canvasToBlob(renderThumb(p, 0, 360, 240), 'image/webp', 0.85).catch(() => undefined);
  await set(p.id, stored, projectsDb);
  const meta: ProjectMeta = {
    id: p.id,
    name: p.name,
    width: p.width,
    height: p.height,
    fps: p.fps,
    frameCount: p.frames.length,
    updatedAt: at,
    thumb,
  };
  await set(p.id, meta, metaDb);
  return at;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await entries<string, ProjectMeta>(metaDb);
  return all.map(([, m]) => m).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Project | null> {
  const s = await get<StoredProject>(id, projectsDb);
  return s ? deserialize(s) : null;
}

export async function deleteProject(id: string) {
  await del(id, projectsDb);
  await del(id, metaDb);
}

export async function renameProject(id: string, name: string) {
  const s = await get<StoredProject>(id, projectsDb);
  const m = await get<ProjectMeta>(id, metaDb);
  if (s) await set(id, { ...s, name }, projectsDb);
  if (m) await set(id, { ...m, name }, metaDb);
}

/* ---------------------------------------------------------------- .ffanim 파일 */
/*
 * 형식: "FFANIM01" (8바이트) + JSON 길이 (uint32 LE) + JSON + 바이너리 덩어리들
 * JSON 안의 Blob 자리는 { $blob: index, type } 로 바뀌고, blobs 배열에 [offset, size] 가 들어간다.
 */
const MAGIC = 'FFANIM01';

export async function exportProjectFile(p: Project): Promise<Blob> {
  const stored = await serialize(p);
  const blobs: Blob[] = [];
  const replacer = (_k: string, v: unknown) => {
    if (v instanceof Blob) {
      blobs.push(v);
      return { $blob: blobs.length - 1, type: v.type };
    }
    return v;
  };
  // JSON.stringify 는 Blob 을 {} 로 만들기 전에 replacer 를 거친다
  const json = JSON.stringify(stored, replacer);
  const sizes = blobs.map((b) => b.size);
  const header = JSON.stringify({ sizes });
  const enc = new TextEncoder();
  const jsonBytes = enc.encode(json);
  const headerBytes = enc.encode(header);
  const lens = new Uint32Array([headerBytes.length, jsonBytes.length]);
  return new Blob([MAGIC, lens.buffer, headerBytes, jsonBytes, ...blobs], { type: 'application/octet-stream' });
}

export async function importProjectFile(file: Blob): Promise<Project> {
  const buf = await file.arrayBuffer();
  const dec = new TextDecoder();
  if (dec.decode(buf.slice(0, 8)) !== MAGIC) throw new Error('FrameFlow 프로젝트 파일이 아니에요');
  const lens = new Uint32Array(buf.slice(8, 16));
  let off = 16;
  const header = JSON.parse(dec.decode(buf.slice(off, off + lens[0]))) as { sizes: number[] };
  off += lens[0];
  const json = dec.decode(buf.slice(off, off + lens[1]));
  off += lens[1];
  const offsets: number[] = [];
  for (const s of header.sizes) {
    offsets.push(off);
    off += s;
  }
  const stored = JSON.parse(json, (_k, v) => {
    if (v && typeof v === 'object' && typeof v.$blob === 'number') {
      const i = v.$blob as number;
      return new Blob([buf.slice(offsets[i], offsets[i] + header.sizes[i])], { type: v.type });
    }
    return v;
  }) as StoredProject;
  const p = await deserialize(stored);
  return p;
}
