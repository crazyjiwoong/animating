#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "[!] Node.js 가 필요해요. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요."
  open https://nodejs.org 2>/dev/null
  read -n 1 -s -r -p "아무 키나 누르면 닫혀요"
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "처음 한 번만 필요한 파일을 받는 중이에요... (몇 분 걸릴 수 있어요)"
  npm install || { read -n 1 -s -r -p "문제가 생겼어요. 아무 키나 누르면 닫혀요"; exit 1; }
fi
echo "macOS 설치 파일을 만드는 중이에요... (몇 분 걸려요)"
if npm run dist:mac; then
  echo ""
  echo "완료! release 폴더의 AMG-macOS.dmg 를 열어 설치하세요."
  open release
else
  read -n 1 -s -r -p "문제가 생겼어요. 아무 키나 누르면 닫혀요"
fi
