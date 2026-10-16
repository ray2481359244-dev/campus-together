@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title CampusTogether Local Preview
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请安装 Node.js 24 LTS 后重试。
  pause
  exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) !== 24) process.exit(1)"
if errorlevel 1 (
  echo 当前 Node.js 版本不符合要求，请使用 Node.js 24 LTS。
  pause
  exit /b 1
)
echo 正在启动碰个头，请保持本窗口运行。
echo 如果提示缺少依赖，请先在项目目录执行 pnpm.cmd install --frozen-lockfile。
node scripts/local.mjs
set "campusExit=%errorlevel%"
echo.
if not "%campusExit%"=="0" echo 启动未完成，请查看上面的提示，或执行 pnpm.cmd doctor。
pause
exit /b %campusExit%
