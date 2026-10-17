export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'lighter'
  | 'hue'
  | 'color'
  | 'luminosity';

export type LayerKind = 'raster' | 'image';

export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  locked: boolean;
  /** 투명 픽셀 잠금: 이미 그려진 픽셀 위에만 칠해짐 */
  alphaLock: boolean;
  opacity: number;
  blend: BlendMode;
  /** 타임라인/레이어 패널에 표시되는 색 태그 */
  color: string;
}

/** 이미지 레이어용 비파괴 변형. x/y = 이미지 중심의 캔버스 좌표 */
export interface Transform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
}

export interface RasterCel {
  kind: 'raster';
  /** 커밋된 뒤에는 절대 수정하지 않는다 (undo 스냅샷이 참조를 공유). */
  canvas: HTMLCanvasElement;
}

export interface ImageCel {
  kind: 'image';
  assetId: string;
  t: Transform;
}

export type Cel = RasterCel | ImageCel;

export interface Frame {
  id: string;
  /** layerId → cel. 없으면 빈 셀 */
  cels: Record<string, Cel>;
  memo?: string;
}

export interface Asset {
  id: string;
  name: string;
  blob: Blob;
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export interface FrameSound {
  /** 0~1 정규화된 음량 */
  level: number;
  /** 검출된 주파수 (Hz), 무음이거나 불명확하면 null */
  freq: number | null;
  /** MIDI 노트 번호 */
  midi: number | null;
  /** 검출 신뢰도 0~1 */
  clarity: number;
}

export interface AudioTrack {
  name: string;
  blob: Blob;
  buffer: AudioBuffer;
  /** 음악이 시작되는 프레임 (0부터) */
  startFrame: number;
  /** 음악 앞부분을 건너뛸 길이 (초) */
  trim: number;
  volume: number;
  muted: boolean;
}

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  /** null = 투명 */
  background: string | null;
  /** 아래 → 위 순서 */
  layers: Layer[];
  frames: Frame[];
  assets: Record<string, Asset>;
  audio: AudioTrack | null;
  createdAt: number;
  updatedAt: number;
}

export type Tool = 'brush' | 'eraser' | 'move' | 'fill' | 'picker' | 'hand';

export interface ProjectMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  updatedAt: number;
  thumb?: Blob;
}
