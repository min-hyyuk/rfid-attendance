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
    echo   Download: https://www.python.org/downloads/
    echo   IMPORTANT: Check "Add Python to PATH"!
    echo.
    start https://www.python.org/downloads/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo   %%i OK
echo.

:: -- 2. Install libraries --
echo [2/4] Installing Python libraries...
pip install pyscard websockets 2>&1
echo.

:: -- 3. Copy to fixed location --
echo [3/4] Installing NFC Reader...
set "INSTALL_DIR=%LOCALAPPDATA%\NFC_Reader"
set "NFC_SCRIPT=%INSTALL_DIR%\nfc_reader.py"
set "NFC_CMD=%INSTALL_DIR%\nfc_reader.cmd"

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

:: Copy nfc_reader.py from same folder as this bat file
set "SOURCE=%~dp0nfc_reader.py"
if not exist "%SOURCE%" (
    echo [ERROR] nfc_reader.py not found next to this bat file.
    echo   Expected: %SOURCE%
    pause
    exit /b 1
)

copy /Y "%SOURCE%" "%NFC_SCRIPT%" >nul
echo   Installed to: %NFC_SCRIPT%

:: Create command wrapper (so user can type "nfc_reader" anywhere)
echo @pythonw "%%LOCALAPPDATA%%\NFC_Reader\nfc_reader.py" %%* > "%NFC_CMD%"
echo   Command wrapper: %NFC_CMD%

:: Add to user PATH if not already
echo %PATH% | findstr /I /C:"%INSTALL_DIR%" >nul 2>&1
if %errorlevel% neq 0 (
    for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USER_PATH=%%B"
    if defined USER_PATH (
        setx PATH "%USER_PATH%;%INSTALL_DIR%" >nul 2>&1
    ) else (
        setx PATH "%INSTALL_DIR%" >nul 2>&1
    )
    set "PATH=%PATH%;%INSTALL_DIR%"
    echo   Added to PATH
)
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
echo oLink.WorkingDirectory = "%INSTALL_DIR%" >> "%SHORTCUT_VBS%"
echo oLink.Description = "ACR122U NFC Reader WebSocket Server" >> "%SHORTCUT_VBS%"
echo oLink.WindowStyle = 7 >> "%SHORTCUT_VBS%"
echo oLink.Save >> "%SHORTCUT_VBS%"

cscript //nologo "%SHORTCUT_VBS%"
del "%SHORTCUT_VBS%" >nul 2>&1

if exist "%STARTUP_DIR%\NFC_Reader.lnk" (
    echo   Startup registered!
) else (
    echo   [WARNING] Startup registration failed.
)
echo.

:: -- 5. Start now --
echo ==================================================
echo   Install Complete!
echo ==================================================
echo.
echo   - Auto-start on Windows boot: ON
echo   - Run manually: nfc_reader (from any terminal)
echo   - Test now:      python "%NFC_SCRIPT%"
echo.
echo   Starting NFC server now...
start "NFC Reader" pythonw "%NFC_SCRIPT%"
echo   NFC server started in background.
echo.
pause
