import { createStore, get, set, del, entries } from 'idb-keyval';
import type { Asset, Camera, Cel, Frame, Layer, Project, ProjectMeta, RefVideo, Transform } from '../types';
import { blobToCanvas, canvasToBlob } from './canvas';
import { renderThumb } from './render';
import { decodeAudio } from './audio';
import { uid } from './id';

const projectsDb = createStore('frameflow-projects', 'projects');
const metaDb = createStore('frameflow-meta', 'meta');

/* 저장 형식: 비트맵은 Blob, 나머지는 평범한 객체 */
interface StoredCel {
  kind: 'raster' | 'image';
  key?: string;
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
  refVideo?: RefVideo | null;
  camera?: Camera;
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
          if (c.kind === 'raster') cels[lid] = { kind: 'raster', key: c.key, png: await pngOf(c.canvas) };
          else {
            used.add(c.assetId);
            cels[lid] = { kind: 'image', key: c.key, assetId: c.assetId, t: c.t };
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
    refVideo: p.refVideo ?? null,
    camera: p.camera,
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
  // 같은 PNG(길게 늘린 그림)는 캔버스 하나를 공유한다
  const decoded = new Map<Blob, Promise<HTMLCanvasElement>>();
  const canvasOf = (b: Blob) => {
    let c = decoded.get(b);
    if (!c) {
      c = blobToCanvas(b).then((canvas) => (pngCache.set(canvas, Promise.resolve(b)), canvas));
      decoded.set(b, c);
    }
    return c;
  };
  const shared = new Map<string, Cel>();
  const frames: Frame[] = await Promise.all(
    s.frames.map(async (f) => {
      const cels: Record<string, Cel> = {};
      await Promise.all(
        Object.entries(f.cels).map(async ([lid, c]) => {
          const key = c.key ?? uid('c_');
          if (c.kind === 'raster' && c.png) {
            cels[lid] = { kind: 'raster', key, canvas: await canvasOf(c.png) };
          } else if (c.kind === 'image' && c.assetId && c.t && assets[c.assetId]) {
            cels[lid] = { kind: 'image', key, assetId: c.assetId, t: c.t };
          }
        }),
      );
      return { id: f.id, memo: f.memo, cels };
    }),
  );
  // key 가 같은 셀은 같은 객체로
  for (const f of frames)
    for (const [lid, c] of Object.entries(f.cels)) {
      const id = `${lid}:${c.key}`;
      const hit = shared.get(id);
      if (hit) f.cels[lid] = hit;
      else shared.set(id, c);
    }
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
    refVideo: s.refVideo ?? null,
    camera: s.camera,
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

/* ---------------------------------------------------------------- .amg 프로젝트 파일 */
/*
 * 형식: "AMGPROJ1" (8바이트, 예전 .ffanim 은 "FFANIM01") + JSON 길이 (uint32 LE) + JSON + 바이너리 덩어리들
 * JSON 안의 Blob 자리는 { $blob: index, type } 로 바뀌고, blobs 배열에 [offset, size] 가 들어간다.
 */
const MAGIC = 'AMGPROJ1';
const OLD_MAGICS = ['FFANIM01'];

export async function exportProjectFile(p: Project): Promise<Blob> {
  const stored = await serialize(p);
  const blobs: Blob[] = [];
  const index = new Map<Blob, number>();
  const replacer = (_k: string, v: unknown) => {
    if (v instanceof Blob) {
      // 같은 Blob 은 한 번만 저장
      if (!index.has(v)) {
        blobs.push(v);
        index.set(v, blobs.length - 1);
      }
      return { $blob: index.get(v), type: v.type };
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
  const magic = dec.decode(buf.slice(0, 8));
  if (magic !== MAGIC && !OLD_MAGICS.includes(magic)) throw new Error('AMG 프로젝트 파일이 아니에요');
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
  const made = new Map<number, Blob>();
  const stored = JSON.parse(json, (_k, v) => {
    if (v && typeof v === 'object' && typeof v.$blob === 'number') {
      const i = v.$blob as number;
      if (!made.has(i)) made.set(i, new Blob([buf.slice(offsets[i], offsets[i] + header.sizes[i])], { type: v.type }));
      return made.get(i);
    }
    return v;
  }) as StoredProject;
  const p = await deserialize(stored);
  return p;
}
