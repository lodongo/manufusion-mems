package com.manufusion.mems.devclient;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
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

/**
 * Standalone, isolated development wrapper. This activity does not contain
 * any of the MEMS web-app logic; it loads the development Cloud Run origin.
 *
 * Android WebViews do NOT automatically open a file selector for HTML file
 * inputs. The native WebChromeClient.onShowFileChooser callback is required.
 */
public final class MainActivity extends Activity {
    private static final String DEV_URL =
        "https://mems-dev-404189184064.africa-south1.run.app/";
    private static final int FILE_CHOOSER_REQUEST = 9047;
    // Keep the long swipe used in the approved low-sensitivity development APK.
    private static final float REFRESH_THRESHOLD_PX = 1024f;

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileResult;
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
                if (pendingFileResult != null) {
                    pendingFileResult.onReceiveValue(null);
                }
                pendingFileResult = filePathCallback;
                try {
                    Intent pick = fileChooserParams.createIntent();
                    // createIntent() honors accept types and multiple-selection mode.
                    startActivityForResult(pick, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException | SecurityException error) {
                    pendingFileResult.onReceiveValue(null);
                    pendingFileResult = null;
                    Toast.makeText(MainActivity.this,
                        "No file picker is available on this device",
                        Toast.LENGTH_LONG).show();
                    return false;
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
        if (pendingFileResult != null) {
            Uri[] uris = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            pendingFileResult.onReceiveValue(uris);
            pendingFileResult = null;
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
        if (pendingFileResult != null) {
            pendingFileResult.onReceiveValue(null);
            pendingFileResult = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
