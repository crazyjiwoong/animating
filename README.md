# AMG · Aㅐ니 Mㅏㄴ들Gㅣ 힘들어서 직접 만듬

**누구나 쉽게 만들 수 있는 초보자들을 위한 애니메이션 툴**

이 저장소에는 두 가지가 들어 있어요.

| 폴더 | 무엇 | 바로 쓰는 법 |
| --- | --- | --- |
| [`app/`](app/) | **AMG 앱** (PC 프로그램) | 아래 “앱 실행하기” |
| [`site/`](site/) | **소개 · 다운로드 사이트** | `site/index.html` 을 더블클릭하면 브라우저로 열려요 |

---

## 받기

1. 이 페이지 위쪽의 초록색 **Code** 버튼 → **Download ZIP**
2. 받은 ZIP 파일의 압축을 풀어요

## 앱 실행하기 (처음 한 번 준비)

[Node.js](https://nodejs.org) **LTS 버전**을 설치해 주세요. (설치 프로그램에서 계속 “다음”만 누르면 돼요)

그다음 `app` 폴더에서 아래 파일을 **더블클릭**하세요.

| 하고 싶은 것 | Windows | Mac |
| --- | --- | --- |
| 앱 실행 | `1_실행하기_Windows.bat` | `1_실행하기_Mac.command` |
| 설치 파일 만들기 | `2_설치파일만들기_Windows.bat` | `2_설치파일만들기_Mac.command` |

- 처음 실행할 때는 필요한 파일을 받느라 몇 분 걸려요. 두 번째부터는 바로 켜져요.
- 설치 파일은 `app/release` 폴더에 생겨요 (`AMG-Setup-Windows.exe` / `AMG-macOS.dmg`). 다른 사람에게 이 파일만 주면 돼요.
- Mac 에서 “확인되지 않은 개발자” 창이 뜨면 파일을 **우클릭 → 열기** 하세요.

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
