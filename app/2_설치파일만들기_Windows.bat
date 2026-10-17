@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AMG 설치 파일 만들기
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
echo Windows 설치 파일을 만드는 중이에요... (몇 분 걸려요)
call npm run dist:win || goto :fail
echo.
echo 완료! release 폴더의 AMG-Setup-Windows.exe 를 실행하면 설치돼요.
start "" "%~dp0release"
pause
exit /b 0
:fail
echo [!] 문제가 생겼어요. 위의 메시지를 확인해 주세요.
pause
exit /b 1
