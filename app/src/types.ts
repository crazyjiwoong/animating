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
  /** 기본 애니메이션 (재생·내보내기 때 자동으로 움직임) */
  motion?: LayerMotion;
  /** 클리핑: 바로 아래(클리핑이 아닌) 레이어에 그림이 있는 곳에만 보임 */
  clip?: boolean;
  /** 색 효과 */
  fx?: LayerFx;
}

export interface LayerFx {
  /** 100 = 그대로 */
  brightness: number;
  contrast: number;
  saturate: number;
  /** 색조 회전 (도) */
  hue: number;
  /** 흐림 (px) */
  blur: number;
  /** 0~100 % */
  grayscale: number;
  sepia: number;
  invert: number;
  /** 빛나기 크기 (px), 0 = 없음 */
  glow: number;
  glowColor: string;
  /** 그림자 크기 (px), 0 = 없음 */
  shadow: number;
  /** 색 입히기 0~100 % */
  tint: number;
  tintColor: string;
}

export type MotionKind = 'none' | 'jitter' | 'boil' | 'shake' | 'bob' | 'sway' | 'spin' | 'swing' | 'pulse';

export interface LayerMotion {
  kind: MotionKind;
  /** 세기 0~100 */
  amount: number;
  /** 1초에 몇 번 (0.25~4) */
  speed: number;
}

/** 카메라 키: 이 프레임에서 카메라가 보는 곳 */
export interface CameraKey {
  /** 프레임을 옮기거나 끼워 넣어도 따라가도록 프레임 id 로 저장 */
  frameId: string;
  /** 화면 가운데가 볼 캔버스 좌표 */
  x: number;
  y: number;
  /** 1 = 그대로, 2 = 2배 확대 */
  zoom: number;
  rotation: number;
  /** 이 키에서 다음 키까지의 움직임 (없으면 카메라 전체 설정) */
  ease?: 'smooth' | 'linear';
}

export interface Camera {
  enabled: boolean;
  keys: CameraKey[];
  ease: 'smooth' | 'linear';
  /** 화면 흔들림 0~100 */
  shake: number;
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
  /** 같은 key 가 연속된 프레임 = 한 그림을 길게 노출(홀드). 함께 편집된다 */
  key?: string;
  /** 커밋된 뒤에는 절대 수정하지 않는다 (undo 스냅샷이 참조를 공유). */
  canvas: HTMLCanvasElement;
}

export interface ImageCel {
  kind: 'image';
  key?: string;
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

/** 레이어 맨 아래에 깔아 두는 참고 영상 (따라 그리기용) */
export interface RefVideo {
  name: string;
  blob: Blob;
  width: number;
  height: number;
  /** 초 */
  duration: number;
  /** 영상이 시작되는 프레임 (0부터) */
  startFrame: number;
  /** 영상 앞부분을 건너뛸 길이 (초) */
  trim: number;
  opacity: number;
  visible: boolean;
  /** 흑백으로 보기 (선이 잘 보이게) */
  gray: boolean;
  /** contain = 영상 전체가 보이게, cover = 캔버스를 꽉 채우게 */
  fit: 'contain' | 'cover';
  /** 내보낼 때도 포함 (기본은 따라 그리기용이라 빠짐) */
  inExport: boolean;
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
  refVideo?: RefVideo | null;
  camera?: Camera;
  createdAt: number;
  updatedAt: number;
}

export type Tool = 'brush' | 'eraser' | 'shape' | 'move' | 'select' | 'camera' | 'fill' | 'picker' | 'hand';

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
