# Manufusion MEMS Development Android Wrapper

This project is deliberately isolated from the React/backend MEMS application.
It opens the existing development Cloud Run URL in a minimal full-screen Android
WebView with the same low-sensitivity ~1024-pixel pull-down refresh.

## Important upload fix

HTML `<input type="file">` elements in an Android WebView **require**
`WebChromeClient.onShowFileChooser`. `MainActivity.java` launches the Android
Storage Access Framework selector and completes the callback with its returned
content URI(s). Both single and multiple file uploads are supported. No
broad storage permissions are requested or required.

## Installation

The GitHub Actions **Build MEMS DEV Android APK** workflow produces an installable
debug-signed APK as a workflow artifact. It is a **development-only** build.
Installing it may require allowing your Android browser/file manager to install
from this source. Because the old experimental APK was built separately using
an unavailable signing key/package configuration, this wrapper intentionally
uses an isolated application ID and can be installed alongside it.

Never publish this debug-signed build as the production store app.
