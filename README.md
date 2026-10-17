# AMG · Aㅐ니 Mㅏㄴ들Gㅣ 힘들어서 직접 만듬

**누구나 쉽게 만들 수 있는 초보자들을 위한 애니메이션 툴.** PC에서 쓰는 프레임 애니메이션 제작 앱입니다. 클립 스튜디오처럼 **레이어 × 프레임** 구조로 작업하고,
그림을 붙여넣어 프레임마다 조금씩 옮기며 애니메이션을 만들 수 있어요. 음악을 넣으면 FlipaClip 처럼 타임라인 아래에 소리 크기가 보입니다.

> 진행 순서: **PC 앱(지금)** → 웹 → 모바일. 화면 코드는 하나로 공유하고, 운영체제 기능(파일 대화상자·동영상 인코딩)만
> `src/lib/platform.ts` 에서 나눠 씁니다.

## 다운로드 · 소개 사이트

- 소개 사이트: `site/` — `main` 에 올라오면 `.github/workflows/site.yml` 이 GitHub Pages 로 배포
  (처음 한 번 저장소 **Settings → Pages → Source: GitHub Actions** 설정 필요) → https://crazyjiwoong.github.io/animating/
- 설치 파일: `main` 에 올라오면 `.github/workflows/desktop.yml` 이 Windows·macOS 설치 파일을 만들어
  **GitHub Releases** 에 `v{package.json 버전}` 으로 게시. 사이트의 다운로드 버튼은 항상 최신 릴리스를 가리킵니다.
  새 버전을 내려면 `package.json` 의 `version` 을 올리세요.

| 운영체제 | 파일 | 참고 |
| --- | --- | --- |
| Windows 10/11 (64비트) | `AMG-Setup-Windows.exe` | 서명 인증서가 없어 처음 실행 시 SmartScreen 경고 → **추가 정보 → 실행** |
| macOS (Apple Silicon) | `AMG-macOS.dmg` | 서명 전이라 처음엔 **우클릭 → 열기** |

## 개발

```bash
npm install
npm run dev        # Vite + Electron (코드 수정 즉시 반영)
npm start          # 빌드 후 Electron 으로 실행
npm run dist:win   # Windows 설치 파일 (release/)
npm run dist:mac   # macOS dmg
npm run web        # 브라우저에서 확인 (http://localhost:5173)
```

## 기능

| 영역 | 내용 |
| --- | --- |
| 홈 | 새로 만들기(크기·FPS·배경), 불러오기(`.amg`), 최근 작품(자동 저장, 썸네일). `.amg` 파일을 더블클릭해도 열림 |
| 프레임 속도 | 6/8/12/15/24/30/60fps 선택 시 그 속도로 재생되는 **예시 영상**과 설명 |
| 이미지 | `Ctrl+V` 붙여넣기, 가져오기, 끌어다 놓기 → 이미지 레이어 (이동·크기·회전·반전, 원본 화질 유지). 여러 장을 한 레이어에 프레임 순서대로 |
| 프레임 설정 | 프레임을 **두 번 누르면** → **같은 그림 N개 추가하기**, 빈 프레임, 이동, 비우기, 삭제, 메모, 그림 길이 |
| 그림 길이 | 타임라인 막대 **끝을 끌어** 몇 프레임 동안 보일지 조절 (뒤 그림 밀기/덮어쓰기). 우클릭: 끝까지 늘리기·나누기 |
| 겹쳐 보기 | 현재 프레임 위에 이전 프레임을 반투명하게 (설정 → 보기에서 끄기·불투명도·장 수·색) |
| 그리기 | 브러시(필압·손떨림 보정), 지우개, 도형, 채우기, 스포이드, 이동·변형, 손 |
| 레이어 | 불투명도, 합성 모드 15종, 숨기기, 잠금, 투명 픽셀 잠금, 이름, 순서, 복제, 합치기, 래스터화 |
| 음악 | 타임라인 아래 **소리 크기 파형**, 시작 프레임·앞부분 자르기·볼륨·음소거, 스크럽 사운드 |
| 저장 | 자동 저장(20초) + `Ctrl+S`, 프로젝트 파일(`.amg`, 이전 `.ffanim` 도 열림)로 저장/열기, 닫을 때 저장 확인 |
| 내보내기 | **MP4(H.264+AAC)** / WebM — ffmpeg 로 프레임 단위 정확하게 인코딩(음악·반복 포함), GIF, PNG, PNG 묶음(zip), 스프라이트 시트 |
| 보기 | 격자, 안전 영역, 좌우 반전 보기, 재생 속도 0.25×~2×, `F11` 전체 화면 |

## 구조

```
electron/
  main.cjs              창 · 메뉴 · 파일 대화상자 · 닫기 확인 · ffmpeg 동영상 인코딩
  preload.cjs           화면에 노출하는 안전한 기능 (window.amg)
  dev.mjs               개발 모드 실행
src/
  lib/platform.ts       PC 앱 / 웹 차이를 감추는 층 (파일 열기·저장, 동영상)
  types.ts              데이터 모델 (Project / Layer / Frame / Cel)
  store/editor.ts       상태 + 실행 취소 + 레이어/프레임/노출 조작
  lib/render.ts         프레임 합성
  lib/audio.ts          오디오 디코딩 · 파형 · 재생
  lib/export.ts         동영상 · GIF · PNG 내보내기
  lib/storage.ts        자동 저장(IndexedDB) · .amg 형식
  components/           Home, Editor, Viewport, Timeline, LayerPanel …
site/                   다운로드 · 소개 사이트 (정적 HTML, GitHub Pages)
```
