@echo off
title ACR122U NFC Reader - Install

echo ==================================================
echo   ACR122U NFC Reader - Auto Install
echo ==================================================
echo.

:: -- 1. Check Python --
echo [1/4] Checking Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Python is not installed.
    echo.
    echo   Download Python from:
    echo   https://www.python.org/downloads/
    echo.
    echo   IMPORTANT: Check "Add Python to PATH" during install!
    echo.
    start https://www.python.org/downloads/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo   %%i OK
echo.

:: -- 2. Install libraries --
echo [2/4] Installing Python libraries...
echo   - pyscard (smart card)
echo   - websockets (WebSocket server)
echo.
pip install pyscard websockets 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [WARNING] Some libraries may have failed to install.
    echo   If pyscard fails, try:
    echo   pip install pyscard --only-binary :all:
    echo.
)
echo.

:: -- 3. Check nfc_reader.py --
echo [3/4] Checking nfc_reader.py...
set "SCRIPT_DIR=%~dp0"
set "NFC_SCRIPT=%SCRIPT_DIR%nfc_reader.py"

if not exist "%NFC_SCRIPT%" (
    echo [ERROR] nfc_reader.py not found.
    echo   Path: %NFC_SCRIPT%
    pause
    exit /b 1
)
echo   Found: %NFC_SCRIPT%
echo.

:: -- 4. Register Windows Startup --
echo [4/4] Registering Windows Startup...
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_VBS=%TEMP%\create_nfc_shortcut.vbs"

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
    echo   Startup shortcut created!
    echo   Path: %STARTUP_DIR%\NFC_Reader.lnk
) else (
    echo   [WARNING] Shortcut creation failed.
)
echo.

:: -- 5. Start now --
echo ==================================================
echo   Install Complete!
echo ==================================================
echo.
echo   - NFC server will auto-start on Windows boot.
echo   - Starting NFC server now...
echo.

start "NFC Reader" pythonw "%NFC_SCRIPT%"
echo   NFC server started in background.
echo   Check "NFC Connected" badge in browser.
echo.
pause
