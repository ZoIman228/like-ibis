# PXL Studio for Android (Capacitor)

This folder wraps the current PXL Studio HTML/CSS/JS app into an Android application. The web app is bundled locally in `www`, so the editor UI itself does not require GitHub Pages or an internet connection after installation.

## Requirements

- Node.js 22 or newer (npm is included with the Node.js installer).
- Android Studio 2025.2.1 or newer for Capacitor 8.
- Android SDK Platform 24 or newer; install Android SDK Build-Tools, Platform-Tools and Command-line Tools from Android Studio's SDK Manager.
- Android Studio supplies the supported JDK; a separate JDK install is usually unnecessary.

## First-time setup (Windows)

1. Install Node.js and Android Studio.
2. Open Android Studio once, finish its setup wizard, then open **Tools → SDK Manager** and install an Android SDK Platform (API 36 is a current stable option) plus **Android SDK Build-Tools**, **Android SDK Platform-Tools** and **Android SDK Command-line Tools**.
3. Extract this ZIP.
4. Double-click `01-setup-android.bat`, or open PowerShell in this folder and run:

   ```powershell
   npm install
   npx cap add android
   npx cap sync android
   npx cap open android
   ```

5. Wait for Gradle sync to finish in Android Studio.
6. To create an installable debug APK, choose **Build → Build Bundle(s) / APK(s) → Build APK(s)** (the wording may vary slightly by Android Studio version).

The debug APK is written to:

`android/app/build/outputs/apk/debug/app-debug.apk`

You can also run `02-build-debug-apk.bat` after the first setup/Gradle sync.

## Updating the web app later

Replace the files in `www` with the updated `index.html`, `paint.css`, and `paint.js`, then run:

```powershell
npx cap sync android
```

Rebuild the APK from Android Studio or by running `02-build-debug-apk.bat`.

## Release APK

For sharing a production build, use **Build → Generate Signed Bundle / APK → APK** in Android Studio and create a keystore. Keep the `.jks` keystore and its passwords backed up securely. You must use the same signing key for future updates installed over the existing app.

## Important notes

- Application ID: `com.zoiman228.pxlstudio`.
- The editor is packaged from local assets in `www`, rather than loaded from the GitHub Pages website.
- Test importing images and saving `.pxl`/PNG files on a physical phone. Android WebView file-download behavior can differ from desktop browsers; native file-picker/save integration may be needed for the smoothest Android experience.
- Capacitor CLI, core, and Android platform are pinned to the Capacitor 8 major line.
