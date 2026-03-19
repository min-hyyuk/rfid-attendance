@echo off
chcp 65001 >nul 2>&1
title ACR122U NFC 리더기 설치

echo ══════════════════════════════════════════════════
echo   ACR122U NFC 리더기 — 자동 설치 스크립트
echo ══════════════════════════════════════════════════
echo.

:: ── 1. Python 확인 ──────────────────────────────────────
echo [1/4] Python 확인 중...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [오류] Python이 설치되어 있지 않습니다.
    echo.
    echo   다음 링크에서 Python을 설치하세요:
    echo   https://www.python.org/downloads/
    echo.
    echo   ※ 설치 시 "Add Python to PATH" 반드시 체크!
    echo.
    start https://www.python.org/downloads/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo   %%i 확인됨
echo.

:: ── 2. 라이브러리 설치 ──────────────────────────────────
echo [2/4] Python 라이브러리 설치 중...
echo   - pyscard (스마트카드 통신)
echo   - websockets (WebSocket 서버)
echo.
pip install pyscard websockets 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [경고] 라이브러리 설치 중 오류가 발생했습니다.
    echo   pyscard 설치가 안 되면 아래를 확인하세요:
    echo   - Microsoft Visual C++ Build Tools 설치 필요할 수 있음
    echo   - 또는: pip install pyscard --only-binary :all:
    echo.
)
echo.

:: ── 3. nfc_reader.py 경로 확인 ─────────────────────────
echo [3/4] nfc_reader.py 위치 확인 중...
set "SCRIPT_DIR=%~dp0"
set "NFC_SCRIPT=%SCRIPT_DIR%nfc_reader.py"

if not exist "%NFC_SCRIPT%" (
    echo [오류] nfc_reader.py 파일을 찾을 수 없습니다.
    echo   경로: %NFC_SCRIPT%
    pause
    exit /b 1
)
echo   %NFC_SCRIPT% 확인됨
echo.

:: ── 4. 시작프로그램 자동 등록 ───────────────────────────
echo [4/4] Windows 시작프로그램에 등록 중...
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_VBS=%TEMP%\create_nfc_shortcut.vbs"

:: VBScript로 바로가기 생성
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%SHORTCUT_VBS%"
echo sLinkFile = "%STARTUP_DIR%\NFC_Reader.lnk" >> "%SHORTCUT_VBS%"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%SHORTCUT_VBS%"
echo oLink.TargetPath = "pythonw" >> "%SHORTCUT_VBS%"
echo oLink.Arguments = """%NFC_SCRIPT%""" >> "%SHORTCUT_VBS%"
echo oLink.WorkingDirectory = "%SCRIPT_DIR%" >> "%SHORTCUT_VBS%"
echo oLink.Description = "ACR122U NFC Reader WebSocket Server" >> "%SHORTCUT_VBS%"
echo oLink.WindowStyle = 7 >> "%SHORTCUT_VBS%"
echo oLink.Save >> "%SHORTCUT_VBS%"

cscript //nologo "%SHORTCUT_VBS%"
del "%SHORTCUT_VBS%" >nul 2>&1

if exist "%STARTUP_DIR%\NFC_Reader.lnk" (
    echo   시작프로그램 등록 완료!
    echo   경로: %STARTUP_DIR%\NFC_Reader.lnk
) else (
    echo   [경고] 바로가기 생성 실패. 수동으로 등록하세요.
)
echo.

:: ── 5. 지금 바로 실행 ───────────────────────────────────
echo ══════════════════════════════════════════════════
echo   설치 완료!
echo ══════════════════════════════════════════════════
echo.
echo   - NFC 서버가 Windows 시작 시 자동 실행됩니다.
echo   - 지금 바로 NFC 서버를 시작합니다...
echo.

start "NFC Reader" pythonw "%NFC_SCRIPT%"
echo   NFC 서버가 백그라운드에서 시작되었습니다.
echo   브라우저에서 "NFC 연결됨" 뱃지를 확인하세요.
echo.
pause
