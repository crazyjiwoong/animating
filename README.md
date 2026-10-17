# AMG · Aㅐ니 Mㅏㄴ들Gㅣ 힘들어서 직접 만듬

**누구나 쉽게 만들 수 있는 초보자들을 위한 애니메이션 툴**

이 저장소에는 두 가지가 들어 있어요.

| 폴더 | 무엇 | 바로 쓰는 법 |
| --- | --- | --- |
| [`app/`](app/) | **AMG 앱** (PC 프로그램) | 아래 “앱 실행하기” |
| [`site/`](site/) | **소개 · 다운로드 사이트** | `site/index.html` 을 더블클릭하면 브라우저로 열려요 |

---

## 그냥 쓰고 싶어요 (설치 1분)

**설치 파일 하나만 받아서 더블클릭하면 끝**이에요. Node.js 같은 건 필요 없어요.

| | 파일 | 하는 일 |
| --- | --- | --- |
| Windows (추천) | `AMG-Setup-Windows.exe` | 더블클릭 → 질문 없이 바로 설치되고 AMG가 켜져요. 바탕화면에 아이콘도 생겨요 |
| Windows (설치 없이) | `AMG-Portable-Windows.exe` | 더블클릭하면 설치 없이 바로 실행 (USB에 넣고 다니기 좋아요) |
| Mac | `AMG-macOS.dmg` | 열어서 AMG 아이콘을 응용 프로그램 폴더로 끌어다 놓기 |

> 처음 실행할 때 Windows “PC 보호” 창이 뜨면 **추가 정보 → 실행**, Mac 은 **우클릭 → 열기**를 눌러 주세요.
> (아직 코드 서명 인증서가 없어서 나오는 안내예요)

**파일 받는 곳**
- 공개 후: 소개 사이트의 **다운로드** 버튼 (로그인 필요 없음)
- 지금(공개 전): 저장소 **Actions → AMG 설치 파일 빌드 → 최근 실행 → 아래 Artifacts** 에서 `AMG-Windows` / `AMG-macOS` (GitHub 로그인 필요)

---

## 직접 만들어 보고 싶어요 (개발자용)

코드를 고쳐서 직접 실행하거나 설치 파일을 만들 때만 필요해요.

1. 저장소 위쪽 **Code → Download ZIP** 으로 받아 압축을 풀어요
2. [Node.js](https://nodejs.org) **LTS** 를 설치해요
3. `app` 폴더에서 더블클릭:

| 하고 싶은 것 | Windows | Mac |
| --- | --- | --- |
| 앱 실행 | `1_실행하기_Windows.bat` | `1_실행하기_Mac.command` |
| 설치 파일 만들기 → `app/release` | `2_설치파일만들기_Windows.bat` | `2_설치파일만들기_Mac.command` |

## 사이트 고치기 · 올리기

- 문구는 `site/index.html`, 디자인은 `site/style.css` 를 메모장 등으로 고치면 돼요.
- 그림은 `site/assets/` 폴더에 있어요.
- `site` 폴더를 통째로 아무 웹 호스팅(GitHub Pages, Netlify, 카페24 등)에 올리면 그대로 사이트가 돼요.

## 자동으로 되는 것 (GitHub)

| 언제 | 무엇이 | 설정 파일 |
| --- | --- | --- |
| `app/` 을 고쳐서 올리면 | Windows · Mac 설치 파일을 자동으로 만들어요 (Actions → Artifacts) | `.github/workflows/app.yml` |
| `main` 에 합치면 | 설치 파일을 공개 다운로드(Releases)로 올려요 → 사이트 다운로드 버튼이 작동 | `.github/workflows/app.yml` |
| `main` 에 합치면 | 사이트를 `https://crazyjiwoong.github.io/animating/` 에 올려요 (처음 한 번 Settings → Pages → Source: GitHub Actions) | `.github/workflows/site.yml` |
