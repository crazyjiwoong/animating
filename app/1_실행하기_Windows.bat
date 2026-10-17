@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AMG 실행하기
where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js 가 필요해요. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  start https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo 처음 한 번만 필요한 파일을 받는 중이에요... (몇 분 걸릴 수 있어요)
  call npm install || goto :fail
)
echo AMG 를 실행해요...
call npm start || goto :fail
exit /b 0
:fail
echo [!] 문제가 생겼어요. 위의 메시지를 확인해 주세요.
pause
exit /b 1
