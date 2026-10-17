// AMG 소개 사이트

// 1) AMG로 만든 데모 애니메이션: 스프라이트 시트(3열 × 4행, 12프레임)를 12fps 로 재생
(function demo() {
  const el = document.getElementById('demo');
  if (!el) return;
  const COLS = 3;
  const ROWS = 4;
  const FRAMES = 12;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let i = 0;
  const show = () => {
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    el.style.backgroundPosition = `${(c / (COLS - 1)) * 100}% ${(r / (ROWS - 1)) * 100}%`;
  };
  show();
  if (reduce) return;
  setInterval(() => {
    i = (i + 1) % FRAMES;
    show();
  }, 1000 / 12);
})();

// 2) 방문자 운영체제에 맞는 다운로드 버튼을 강조
(function detectOS() {
  const ua = navigator.userAgent;
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Mac/.test(platform));
  let os = null;
  if (!mobile) {
    if (/Win/i.test(platform) || /Windows/i.test(ua)) os = 'win';
    else if (/Mac/i.test(platform) || /Mac OS X/i.test(ua)) os = 'mac';
  }
  if (os) {
    document.querySelectorAll(`.dl[data-os="${os}"]`).forEach((a) => {
      if (a.classList.contains('dl-card')) a.classList.add('recommended');
    });
    // 히어로에서는 내 운영체제 버튼을 앞으로
    const cta = document.querySelector('.cta');
    const mine = cta && cta.querySelector(`.dl[data-os="${os}"]`);
    if (mine) {
      cta.prepend(mine);
      cta.querySelectorAll('.dl').forEach((a) => {
        a.classList.toggle('btn-primary', a === mine);
        a.classList.toggle('btn-ghost', a !== mine);
      });
    }
  }
  if (mobile) {
    const v = document.getElementById('version');
    if (v) v.textContent = '지금은 PC 앱이에요 · 컴퓨터에서 이 페이지를 열어 다운로드하세요 (모바일 버전 준비 중)';
  }
})();

// 3) 최신 버전 정보 (GitHub Releases)
(async function release() {
  try {
    const r = await fetch('https://api.github.com/repos/crazyjiwoong/animating/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const rel = await r.json();
    const date = new Date(rel.published_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const size = (name) => {
      const a = (rel.assets || []).find((x) => x.name === name);
      return a ? ` · ${(a.size / 1024 / 1024).toFixed(0)}MB` : '';
    };
    const info = document.getElementById('release-info');
    if (info) info.textContent = `최신 버전 ${rel.tag_name} · ${date} 업데이트 · 회원가입도, 인터넷 연결도 필요 없어요.`;
    const v = document.getElementById('version');
    if (v && !/PC 앱이에요/.test(v.textContent)) v.textContent = `${rel.tag_name} · Windows 10/11 · macOS (Apple Silicon) · 회원가입 필요 없음`;
    document.querySelectorAll('.dl-card .meta').forEach((m) => {
      const card = m.closest('.dl-card');
      const name = card && card.querySelector('b') && card.querySelector('b').textContent;
      if (name) m.textContent += size(name);
    });
  } catch {
    /* 오프라인이거나 아직 릴리스 전 */
  }
})();
