@echo off
REM 安全的技能文件搜索脚本 - 只搜索已知的技能目录，不全盘扫描

setlocal enabledelayedexpansion

echo 正在搜索技能文件（仅限已知目录）...
echo.

set FOUND=0

REM 1. 应用安装目录下的内置技能
if exist "%~dp0..\skills" (
    echo [内置技能目录] %~dp0..\skills
    dir /b "%~dp0..\skills" 2>nul
    set FOUND=1
)

REM 2. 用户数据目录（%APPDATA%/.closecode/skills）
if exist "%APPDATA%\.closecode\skills" (
    echo.
    echo [用户技能目录] %APPDATA%\.closecode\skills
    dir /b "%APPDATA%\.closecode\skills" 2>nul
    set FOUND=1
)

REM 3. 本地数据目录（%LOCALAPPDATA%/CloseCode/skills）
if exist "%LOCALAPPDATA%\CloseCode\skills" (
    echo.
    echo [本地技能目录] %LOCALAPPDATA%\CloseCode\skills
    dir /b "%LOCALAPPDATA%\CloseCode\skills" 2>nul
    set FOUND=1
)

if !FOUND!==0 (
    echo 未找到任何技能目录
    exit /b 1
)

echo.
echo 搜索完成（用时 ^< 1秒）
