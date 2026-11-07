@echo off
setlocal
cd /d "%~dp0"
echo ======================================
echo   PXL Studio - Android setup
 echo ======================================
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found. Install Node.js 22 or newer first.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm was not found. Reinstall Node.js with npm included.
  pause
  exit /b 1
)
echo Installing Capacitor dependencies...
call npm install
if errorlevel 1 goto failed
if not exist "android\settings.gradle" if not exist "android\settings.gradle.kts" (
  echo Creating Android project...
  call npx cap add android
  if errorlevel 1 goto failed
)
echo Syncing PXL Studio web files into Android project...
call npx cap sync android
if errorlevel 1 goto failed
echo.
echo Setup complete. Opening Android Studio project...
call npx cap open android
if errorlevel 1 (
  echo Could not auto-open Android Studio. Open the android folder manually.
)
echo.
echo To build a debug APK, use Build -^> Build Bundle(s) / APK(s) -^> Build APK(s).
echo Or run 02-build-debug-apk.bat after Gradle has been synced once.
pause
exit /b 0
:failed
echo.
echo Setup failed. Copy the error above and send it for troubleshooting.
pause
exit /b 1
