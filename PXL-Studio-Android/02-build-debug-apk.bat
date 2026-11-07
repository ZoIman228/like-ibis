@echo off
setlocal
cd /d "%~dp0"
if not exist "android\gradlew.bat" (
  echo Android project is not initialized. Run 01-setup-android.bat first.
  pause
  exit /b 1
)
echo Syncing latest web files...
call npx cap sync android
if errorlevel 1 goto failed
cd android
echo Building debug APK...
call gradlew.bat assembleDebug
if errorlevel 1 goto failed
echo.
echo APK created:
echo %CD%\app\build\outputs\apk\debug\app-debug.apk
explorer "%CD%\app\build\outputs\apk\debug"
pause
exit /b 0
:failed
echo.
echo Build failed. Copy the error above for troubleshooting.
pause
exit /b 1
