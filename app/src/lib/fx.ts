import type { LayerFx } from '../types';

export const DEFAULT_FX: LayerFx = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hue: 0,
  blur: 0,
  grayscale: 0,
  sepia: 0,
  invert: 0,
  glow: 0,
  glowColor: '#ffffff',
  shadow: 0,
  tint: 0,
  tintColor: '#ff6fb5',
};

/** 초보자용 한 번 누르기 효과 */
export const FX_PRESETS: { name: string; fx: Partial<LayerFx>; swatch: string }[] = [
  { name: '원래대로', fx: {}, swatch: 'linear-gradient(135deg,#ffd23f,#ff6fb5)' },
  { name: '흑백', fx: { grayscale: 100, contrast: 110 }, swatch: 'linear-gradient(135deg,#eee,#333)' },
  { name: '옛날 사진', fx: { sepia: 85, contrast: 95, brightness: 105 }, swatch: 'linear-gradient(135deg,#e8d3a9,#7a5a33)' },
  { name: '선명하게', fx: { contrast: 125, saturate: 140 }, swatch: 'linear-gradient(135deg,#ff2d55,#00c2ff)' },
  { name: '따뜻하게', fx: { tint: 18, tintColor: '#ff9a3c', saturate: 115 }, swatch: 'linear-gradient(135deg,#ffcf7a,#ff7a3c)' },
  { name: '차갑게', fx: { tint: 18, tintColor: '#3c8bff', saturate: 90 }, swatch: 'linear-gradient(135deg,#bfe0ff,#3c6bff)' },
  { name: '밤', fx: { brightness: 60, saturate: 70, tint: 25, tintColor: '#1f2a6b' }, swatch: 'linear-gradient(135deg,#2b3470,#0b0d22)' },
  { name: '네온', fx: { glow: 14, glowColor: '#7df9ff', saturate: 160, brightness: 110 }, swatch: 'linear-gradient(135deg,#7df9ff,#ff4fd8)' },
  { name: '꿈결', fx: { blur: 2, glow: 18, glowColor: '#ffd6f5', brightness: 110, saturate: 85 }, swatch: 'linear-gradient(135deg,#ffe3f7,#c7b8ff)' },
  { name: '그림자', fx: { shadow: 12 }, swatch: 'linear-gradient(135deg,#888,#222)' },
  { name: '실루엣', fx: { brightness: 0 }, swatch: '#111' },
  { name: '반전', fx: { invert: 100 }, swatch: 'linear-gradient(135deg,#00e5ff,#ff1744)' },
];

export function isDefaultFx(fx?: LayerFx) {
  if (!fx) return true;
  return (Object.keys(DEFAULT_FX) as (keyof LayerFx)[]).every((k) => k === 'glowColor' || k === 'tintColor' || fx[k] === DEFAULT_FX[k]);
}

/** ctx.filter 문자열. scale = 실제 출력 배율 (흐림·빛 크기를 맞추기 위해) */
export function filterString(fx: LayerFx, scale: number) {
  const f: string[] = [];
  if (fx.brightness !== 100) f.push(`brightness(${fx.brightness}%)`);
  if (fx.contrast !== 100) f.push(`contrast(${fx.contrast}%)`);
  if (fx.saturate !== 100) f.push(`saturate(${fx.saturate}%)`);
  if (fx.hue) f.push(`hue-rotate(${fx.hue}deg)`);
  if (fx.grayscale) f.push(`grayscale(${fx.grayscale}%)`);
  if (fx.sepia) f.push(`sepia(${fx.sepia}%)`);
  if (fx.invert) f.push(`invert(${fx.invert}%)`);
  if (fx.blur) f.push(`blur(${(fx.blur * scale).toFixed(2)}px)`);
  if (fx.glow) {
    const g = (fx.glow * scale).toFixed(2);
    f.push(`drop-shadow(0 0 ${g}px ${fx.glowColor})`, `drop-shadow(0 0 ${(fx.glow * scale * 0.5).toFixed(2)}px ${fx.glowColor})`);
  }
  if (fx.shadow) {
    const d = (fx.shadow * scale * 0.5).toFixed(2);
    f.push(`drop-shadow(${d}px ${d}px ${(fx.shadow * scale).toFixed(2)}px rgba(0,0,0,0.55))`);
  }
  return f.length ? f.join(' ') : 'none';
}
