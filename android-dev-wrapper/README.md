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

## Camera fix (version 2.1.0-dev)

`FileChooserParams.createIntent()` only builds a document picker and ignores the HTML
`capture` attribute, so **Take photo** never reached the camera. When a page asks for
capture of an image, `MainActivity` now starts the system camera app and gives it a
private file in this app's cache folder (shared through a `FileProvider`). If there is
no camera app, the normal picker opens instead. Photos are deleted from the cache when
the app closes. **No camera or storage permission is requested**: the camera app takes
the photo, not this app.

## Installation

The GitHub Actions **Build MEMS DEV Android APK** workflow produces an installable
debug-signed APK as a workflow artifact. It is a **development-only** build.
Installing it may require allowing your Android browser/file manager to install
from this source. Because the old experimental APK was built separately using
an unavailable signing key/package configuration, this wrapper intentionally
uses an isolated application ID and can be installed alongside it.

Never publish this debug-signed build as the production store app.

Every workflow run signs the debug APK with a new debug key, so Android will not install
it over an earlier build: uninstall the previous "Manufusion MEMS DEV" app first.
