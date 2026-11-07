package com.manufusion.mems.devclient;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;

/**
 * Standalone, isolated development wrapper. This activity does not contain
 * any of the MEMS web-app logic; it loads the development Cloud Run origin.
 *
 * Android WebViews do NOT automatically open a file selector for HTML file
 * inputs. The native WebChromeClient.onShowFileChooser callback is required.
 *
 * FileChooserParams.createIntent() only builds a document picker: it ignores the
 * HTML capture attribute, so "Take photo" (capture="environment") never reached
 * the camera. When capture is requested for images, the system camera app is now
 * started and writes the photo to a private file in this app's cache folder
 * (shared through a FileProvider). If there is no camera app the normal picker
 * opens instead. No camera or storage permission is requested.
 */
public final class MainActivity extends Activity {
    private static final String DEV_URL =
        "https://mems-dev-404189184064.africa-south1.run.app/";
    private static final int FILE_CHOOSER_REQUEST = 9047;
    // Keep the long swipe used in the approved low-sensitivity development APK.
    private static final float REFRESH_THRESHOLD_PX = 1024f;
    private static final String CAPTURE_DIR = "captures";
    private static final long CAPTURE_KEEP_MS = 10 * 60 * 1000L;

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileResult;
    private File cameraFile;
    private Uri cameraUri;
    private float startY;
    private float startX;
    private boolean refreshCandidate;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        webView.setBackgroundColor(0xffffffff);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri == null ? "" : uri.getScheme();
                if ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "Cannot open this link", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams
            ) {
                // An earlier pending picker must always be completed.
                finishChooser(null);
                pendingFileResult = filePathCallback;

                if (fileChooserParams.isCaptureEnabled() && acceptsImages(fileChooserParams.getAcceptTypes())) {
                    try {
                        startActivityForResult(buildCameraIntent(), FILE_CHOOSER_REQUEST);
                        return true;
                    } catch (ActivityNotFoundException | SecurityException | IOException | IllegalArgumentException error) {
                        // No camera app, or no way to hand it a file: use the picker below.
                        forgetCapture();
                    }
                }
                try {
                    // createIntent() honors accept types and multiple-selection mode.
                    startActivityForResult(fileChooserParams.createIntent(), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException | SecurityException error) {
                    finishChooser(null);
                    Toast.makeText(MainActivity.this,
                        "No file picker is available on this device",
                        Toast.LENGTH_LONG).show();
                    return true;
                }
            }
        });

        // No toolbar: the website owns all menus and navigation.
        setContentView(webView);
        webView.setOnTouchListener((View view, MotionEvent event) -> {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    startY = event.getY();
                    startX = event.getX();
                    refreshCandidate = !webView.canScrollVertically(-1);
                    break;
                case MotionEvent.ACTION_POINTER_DOWN:
                    refreshCandidate = false;
                    break;
                case MotionEvent.ACTION_UP:
                    float deltaY = event.getY() - startY;
                    float deltaX = Math.abs(event.getX() - startX);
                    if (refreshCandidate && deltaY > REFRESH_THRESHOLD_PX
                        && deltaY > deltaX * 1.7f && !webView.canScrollVertically(-1)) {
                        webView.reload();
                    }
                    refreshCandidate = false;
                    break;
                case MotionEvent.ACTION_CANCEL:
                    refreshCandidate = false;
                    break;
                default:
                    break;
            }
            // Let the WebView handle ordinary gestures, forms, tabs and scrolling.
            return false;
        });
        if (state == null) {
            webView.loadUrl(DEV_URL);
        } else {
            webView.restoreState(state);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST) return;
        ValueCallback<Uri[]> callback = pendingFileResult;
        pendingFileResult = null;
        Uri[] result;
        if (cameraFile != null) {
            // Photo taken with the camera: it was written to our own file. A cancelled camera leaves it empty.
            if (resultCode == RESULT_OK && cameraFile.length() > 0) {
                result = new Uri[] { cameraUri };
                // Keep the file so the page can read it; old captures are removed before the next one and on exit.
                cameraFile = null;
                cameraUri = null;
            } else {
                result = null;
                forgetCapture();
            }
        } else {
            result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        }
        if (callback != null) callback.onReceiveValue(result);
    }

    /** Completes the waiting page request (null = nothing chosen) and drops an unfinished camera file. */
    private void finishChooser(Uri[] value) {
        ValueCallback<Uri[]> callback = pendingFileResult;
        pendingFileResult = null;
        forgetCapture();
        if (callback != null) callback.onReceiveValue(value);
    }

    private static boolean acceptsImages(String[] types) {
        if (types == null || types.length == 0) return true;
        for (String type : types) {
            if (type == null) continue;
            String t = type.trim();
            if (t.isEmpty() || t.startsWith("image/") || t.equals("*/*")) return true;
        }
        return false;
    }

    private Intent buildCameraIntent() throws IOException {
        File dir = new File(getCacheDir(), CAPTURE_DIR);
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Capture folder unavailable");
        purgeCaptures(CAPTURE_KEEP_MS);
        File file = File.createTempFile("capture_", ".jpg", dir);
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".captures", file);
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
        // Some camera apps only honor the grant when it is also attached as ClipData.
        intent.setClipData(ClipData.newRawUri("capture", uri));
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        cameraFile = file;
        cameraUri = uri;
        return intent;
    }

    private void forgetCapture() {
        if (cameraFile != null) {
            //noinspection ResultOfMethodCallIgnored
            cameraFile.delete();
        }
        cameraFile = null;
        cameraUri = null;
    }

    /** Deletes captured photos older than the given age (0 = all of them). */
    private void purgeCaptures(long olderThanMs) {
        File[] files = new File(getCacheDir(), CAPTURE_DIR).listFiles();
        if (files == null) return;
        long limit = System.currentTimeMillis() - olderThanMs;
        for (File f : files) {
            if (olderThanMs == 0 || f.lastModified() < limit) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        finishChooser(null);
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        purgeCaptures(0);
        super.onDestroy();
    }
}
