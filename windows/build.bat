@echo off
setlocal
cd /d "%~dp0"
set "ROOT=%~dp0.."

where dotnet >nul 2>nul
if errorlevel 1 (
    echo [ERROR] .NET 10 SDK is not installed.
    echo Install it from: https://dotnet.microsoft.com/download/dotnet/10.0
    pause
    exit /b 1
)

for %%F in (index.html paint.css paint.js) do (
    if exist "%ROOT%\%%F" (
        copy /Y "%ROOT%\%%F" "%~dp0www\%%F" >nul
    ) else if not exist "%~dp0www\%%F" (
        echo [ERROR] Missing %%F. Put index.html, paint.css and paint.js in the repository root or windows\www.
        pause
        exit /b 1
    )
)

echo.
echo Building PXL Studio as a single Windows x64 EXE...
echo The first build needs internet once to restore the WebView2 NuGet package.
echo The finished application itself works offline.
echo.

dotnet publish PXLStudio.Desktop.csproj ^
  --configuration Release ^
  --runtime win-x64 ^
  --self-contained true ^
  -p:PublishSingleFile=true ^
  -p:IncludeNativeLibrariesForSelfExtract=true ^
  -p:EnableCompressionInSingleFile=true ^
  --output "%ROOT%\dist"

if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. Read the error above.
    pause
    exit /b 1
)

echo.
echo SUCCESS! Your portable app is here:
echo %ROOT%\dist\PXL-Studio.exe
pause
