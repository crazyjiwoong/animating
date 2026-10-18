export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings) {
  return c.getContext('2d', opts) as CanvasRenderingContext2D;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const boundsCache = new WeakMap<HTMLCanvasElement, Rect | null>();
/** alphaBounds 캐시판 — 커밋된 캔버스는 바뀌지 않으므로 안전 */
export function cachedBounds(c: HTMLCanvasElement): Rect | null {
  if (!boundsCache.has(c)) boundsCache.set(c, alphaBounds(c));
  return boundsCache.get(c)!;
}

/** 불투명 픽셀이 있는 영역. 비어 있으면 null */
export function alphaBounds(c: HTMLCanvasElement): Rect | null {
  const { width: w, height: h } = c;
  const data = ctx2d(c, { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/**
 * 스캔라인 페인트통. reference 의 색을 기준으로 영역을 잡고, 결과 마스크를 color 로 칠한 캔버스를 돌려준다.
 */
export function floodFillMask(
  reference: HTMLCanvasElement,
  sx: number,
  sy: number,
  color: string,
  tolerance: number,
  expand = 1,
): HTMLCanvasElement | null {
  const w = reference.width;
  const h = reference.height;
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const src = ctx2d(reference, { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const i0 = (sy * w + sx) * 4;
  const tr = src[i0],
    tg = src[i0 + 1],
    tb = src[i0 + 2],
    ta = src[i0 + 3];
  const tol = tolerance * 4;
  const match = (p: number) => {
    const i = p * 4;
    return (
      Math.abs(src[i] - tr) + Math.abs(src[i + 1] - tg) + Math.abs(src[i + 2] - tb) + Math.abs(src[i + 3] - ta) <= tol
    );
  };
  const mask = new Uint8Array(w * h);
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    let p = y * w + x;
    while (x >= 0 && !mask[p] && match(p)) {
      x--;
      p--;
    }
    x++;
    p++;
    let up = false,
      down = false;
    while (x < w && !mask[p] && match(p)) {
      mask[p] = 1;
      if (y > 0) {
        const q = p - w;
        if (!mask[q] && match(q)) {
          if (!up) {
            stack.push(x, y - 1);
            up = true;
          }
        } else up = false;
      }
      if (y < h - 1) {
        const q = p + w;
        if (!mask[q] && match(q)) {
          if (!down) {
            stack.push(x, y + 1);
            down = true;
          }
        } else down = false;
      }
      x++;
      p++;
    }
  }
  // 선 아래로 살짝 확장해서 안티앨리어싱 틈을 메운다
  let m = mask;
  for (let e = 0; e < expand; e++) {
    const n = new Uint8Array(m);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (m[p]) continue;
        if ((x > 0 && m[p - 1]) || (x < w - 1 && m[p + 1]) || (y > 0 && m[p - w]) || (y < h - 1 && m[p + w])) n[p] = 1;
      }
    }
    m = n;
  }
  const out = createCanvas(w, h);
  const octx = ctx2d(out);
  const img = octx.createImageData(w, h);
  const [r, g, b] = hexToRgb(color);
  const d = img.data;
  for (let p = 0; p < m.length; p++) {
    if (m[p]) {
      const i = p * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

let checker: CanvasPattern | null = null;
export function checkerPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (checker) return checker;
  const c = createCanvas(16, 16);
  const x = ctx2d(c);
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 16, 16);
  x.fillStyle = '#e4e6ec';
  x.fillRect(0, 0, 8, 8);
  x.fillRect(8, 8, 8, 8);
  checker = ctx.createPattern(c, 'repeat')!;
  return checker;
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type, quality));
}

export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const c = createCanvas(bmp.width, bmp.height);
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}
