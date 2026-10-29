@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title CampusTogether Competition Demo
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 24 LTS 和 pnpm 11.5.1，并执行 pnpm.cmd install --frozen-lockfile。
  pause
  exit /b 1
)
echo 正在准备独立的本地参赛演示，请保持窗口运行。
echo 首次使用请先安装锁文件中的依赖；这里不下载或升级依赖。
node scripts/demo.mjs
set "campusExit=%errorlevel%"
echo.
if not "%campusExit%"=="0" echo 启动未完成，请查看提示及 docs/competition/LOCAL_DEMO.md。
pause
exit /b %campusExit%
