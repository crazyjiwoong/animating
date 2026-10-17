import { useEffect, useRef } from 'react';

export const FPS_OPTIONS: { fps: number; tag: string; title: string; desc: string }[] = [
  { fps: 6, tag: '러프', title: '6 fps · 러프 테스트', desc: '뚝뚝 끊기는 스톱모션 느낌. 동작 타이밍만 빠르게 확인할 때 좋아요.' },
  { fps: 8, tag: '루프', title: '8 fps · 손그림 루프', desc: '움짤·GIF 루프에 자주 쓰여요. 손맛이 살아 있는 독특한 리듬.' },
  { fps: 12, tag: '추천', title: '12 fps · 애니메이션 표준', desc: 'TV 애니메이션의 “투스(2’s)” 방식. 작업량 대비 가장 자연스러워 손그림 애니메이션에 추천해요.' },
  { fps: 15, tag: '웹', title: '15 fps · 웹 애니메이션', desc: '부드러움과 작업량의 균형. 짧은 웹·SNS 애니메이션에 적당해요.' },
  { fps: 24, tag: '영화', title: '24 fps · 풀 애니메이션', desc: '극장판·영화의 표준 “원스(1’s)”. 매우 부드럽지만 1초에 24장을 그려야 해요.' },
  { fps: 30, tag: '영상', title: '30 fps · 영상 · 모션그래픽', desc: '일반 동영상과 같은 속도. 이미지를 움직이는 모션 작업에 좋아요.' },
  { fps: 60, tag: '초고속', title: '60 fps · 초부드러움', desc: '게임·UI 모션 수준. 이미지 이동/변형 위주 작업에 적합해요.' },
];

/** 선택한 FPS 로 공 튀기기 예시를 재생한다 */
export function FpsDemo({ fps, fill }: { fps: number; fill?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    const start = performance.now();
    const ghosts: number[] = [];
    let lastFrame = -1;
    const loop = 2.0; // 초
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      // 캔버스 크기는 정수여야 한다 — 125% 배율처럼 소수가 나오면 매번 크기를 다시 맞추며 화면이 지워져 깜빡였다
      const W = Math.round(c.clientWidth * dpr);
      const H = Math.round(c.clientHeight * dpr);
      let resized = false;
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
        resized = true;
      }
      const t = (now - start) / 1000;
      const frame = Math.floor(t * fps);
      if (frame === lastFrame && !resized) return;
      const q = (frame / fps) % loop;
      if (frame !== lastFrame) ghosts.push(q);
      lastFrame = frame;
      if (ghosts.length > 4) ghosts.shift();

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1a1d28');
      g.addColorStop(1, '#10121a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // 비율 유지하며 가운데 정렬
      const k = Math.min(W / 320, H / 200);
      ctx.translate((W - 320 * k) / 2, (H - 200 * k) / 2);
      ctx.scale(k, k);

      // 바닥
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (let x = -400; x <= 720; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, 160);
        ctx.lineTo(x, 200);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(-400, 160, 1120, 1.5);

      const ball = (tt: number) => {
        const p = tt / loop; // 0..1 왕복
        const x = 40 + (p < 0.5 ? p * 2 : 2 - p * 2) * 240;
        const bounce = Math.abs(Math.sin(tt * Math.PI * 2));
        const y = 150 - bounce * 105;
        const squash = bounce < 0.12 ? 1 - (0.12 - bounce) * 2.5 : 1 + Math.min(0.12, (1 - bounce) * 0.1);
        return { x, y, squash, bounce };
      };
      // 잔상 (실제로 그려진 프레임 간격이 보인다)
      ghosts.slice(0, -1).forEach((gq, i) => {
        const b = ball(gq);
        ctx.globalAlpha = 0.15 + (i / ghosts.length) * 0.35;
        ctx.strokeStyle = '#8b7bff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.ellipse(b.x, b.y + (1 - b.squash) * 14, 14 / b.squash, 14 * b.squash, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      });
      ctx.globalAlpha = 1;
      const b = ball(q);
      // 그림자
      ctx.fillStyle = `rgba(0,0,0,${0.45 - b.bounce * 0.3})`;
      ctx.beginPath();
      ctx.ellipse(b.x, 160, 16 - b.bounce * 7, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      const bg = ctx.createLinearGradient(b.x - 14, b.y - 14, b.x + 14, b.y + 14);
      bg.addColorStop(0, '#b4a9ff');
      bg.addColorStop(1, '#ff6fb5');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(b.x, b.y + (1 - b.squash) * 14, 14 / b.squash, 14 * b.squash, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.ellipse(b.x - 5, b.y - 6, 4, 3, -0.6, 0, Math.PI * 2);
      ctx.fill();

      // 회전하는 별 (우측 상단)
      ctx.save();
      ctx.translate(282, 42);
      ctx.rotate(q * Math.PI);
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 6 : 15;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 필름스트립 하이라이트
      const strip = stripRef.current;
      if (strip) {
        const idx = frame % fps;
        const kids = strip.children;
        for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('on', i <= idx);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [fps]);
  return (
    <div className="screen" style={fill ? { aspectRatio: 'auto', height: '100%', border: 0, borderRadius: 0 } : undefined}>
      <canvas ref={ref} />
      <div className="badge">{fps} fps 예시</div>
      <div ref={stripRef} className="filmstrip" style={{ position: 'absolute', left: 10, right: 10, bottom: 8, gap: 2 }}>
        {Array.from({ length: fps }, (_, i) => (
          <i key={i} style={{ width: Math.max(3, Math.min(10, 280 / fps - 2)), height: 8 }} />
        ))}
      </div>
    </div>
  );
}

export function FpsPicker({ value, onChange }: { value: number; onChange: (fps: number) => void }) {
  const info = FPS_OPTIONS.find((o) => o.fps === value) ?? {
    fps: value,
    tag: '',
    title: `${value} fps`,
    desc: '사용자 지정 프레임 속도',
  };
  return (
    <div className="field">
      <label>프레임 속도 (1초에 몇 장?)</label>
      <div className="fps-grid">
        {FPS_OPTIONS.map((o) => (
          <button key={o.fps} className={'fps-opt' + (o.fps === value ? ' on' : '')} onClick={() => onChange(o.fps)}>
            <b>{o.fps}</b>
            <span>{o.tag}</span>
          </button>
        ))}
      </div>
      <div className="fps-preview" style={{ marginTop: 6 }}>
        <FpsDemo fps={value} />
        <div className="fps-desc">
          <h4>{info.title}</h4>
          <div>{info.desc}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            1초 = <b style={{ color: 'var(--text)' }}>{value}프레임</b> · 1프레임 = {(1000 / value).toFixed(1)}ms
            <br />
            점선 잔상(직전 프레임들) 간격이 넓을수록 한 장 한 장이 더 크게 움직여요.
          </div>
        </div>
      </div>
    </div>
  );
}
