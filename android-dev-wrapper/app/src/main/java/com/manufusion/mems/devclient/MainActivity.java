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
import android.util.Base64;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.JavaScriptReplyProxy;
import org.json.JSONObject;
import java.io.OutputStream;
import java.util.Collections;
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
    private static final int SAVE_REPORT_REQUEST = 9048;
    private static final int MAX_REPORT_BYTES = 16 * 1024 * 1024;
    private static final String DEV_ORIGIN = "https://mems-dev-404189184064.africa-south1.run.app";
    private byte[] pendingReport;
    private String pendingReportId;
    private JavaScriptReplyProxy pendingReportReply;
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

        // Origin-scoped native report save; do not expose a broad JavascriptInterface.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "memsFileDownload", Collections.singleton(DEV_ORIGIN),
                (view, message, origin, isMainFrame, reply) -> {
                    if (!isMainFrame || !DEV_ORIGIN.equals(origin.toString())) return;
                    receiveReport(message.getData(), reply);
                });
        }

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
        if (requestCode == SAVE_REPORT_REQUEST) { finishReportSave(resultCode, data); return; }
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

    private void reportReply(JavaScriptReplyProxy reply, String id, String status, String error) {
        if (reply == null) return;
        try { reply.postMessage(new JSONObject().put("id",id).put("status",status).put("error",error).toString()); }
        catch (Exception ignored) { /* Requesting page may have closed. */ }
    }
    private void receiveReport(String raw, JavaScriptReplyProxy reply) {
        String id = "";
        try {
            JSONObject request = new JSONObject(raw == null ? "{}" : raw);
            id = request.optString("id");
            String filename = request.optString("filename"), mime = request.optString("mime"), encoded = request.optString("base64");
            boolean pdf = "application/pdf".equals(mime) && filename.endsWith(".pdf");
            boolean xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".equals(mime) && filename.endsWith(".xlsx");
            if (pendingReportReply != null) { reportReply(reply,id,"error","Another save is in progress."); return; }
            if (!id.matches("[a-zA-Z0-9-]{1,80}") || !filename.matches("[a-zA-Z0-9_.-]{1,180}") || !(pdf || xlsx) || encoded.length() > ((MAX_REPORT_BYTES+2)/3)*4) throw new IOException("Invalid or oversized report.");
            byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
            if (bytes.length < 5 || bytes.length > MAX_REPORT_BYTES || (pdf && !(bytes[0]=='%' && bytes[1]=='P' && bytes[2]=='D' && bytes[3]=='F' && bytes[4]=='-')) || (xlsx && !(bytes[0]=='P' && bytes[1]=='K' && bytes[2]==3 && bytes[3]==4))) throw new IOException("Report signature is invalid.");
            pendingReport = bytes; pendingReportId = id; pendingReportReply = reply;
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(mime); intent.putExtra(Intent.EXTRA_TITLE,filename);
            startActivityForResult(intent,SAVE_REPORT_REQUEST);
        } catch (Exception error) {
            if (pendingReportReply == reply) { pendingReport=null; pendingReportId=null; pendingReportReply=null; }
            reportReply(reply,id,"error","Unable to start file save.");
        }
    }
    private void finishReportSave(int resultCode, Intent data) {
        byte[] bytes=pendingReport; String id=pendingReportId; JavaScriptReplyProxy reply=pendingReportReply;
        pendingReport=null; pendingReportId=null; pendingReportReply=null;
        if (reply==null || bytes==null) return;
        if (resultCode!=RESULT_OK || data==null || data.getData()==null) { reportReply(reply,id,"cancelled",""); return; }
        Uri target=data.getData();
        new Thread(() -> {
            String status="saved", error="";
            try (OutputStream stream=getContentResolver().openOutputStream(target,"w")) {
                if (stream==null) throw new IOException("File destination unavailable.");
                stream.write(bytes); stream.flush();
            } catch (Exception failure) { status="error"; error="Could not write the selected file. Choose another location and try again."; }
            final String outcome=status, detail=error;
            runOnUiThread(() -> { reportReply(reply,id,outcome,detail); if ("saved".equals(outcome)) Toast.makeText(this,"Report saved",Toast.LENGTH_SHORT).show(); });
        },"mems-report-save").start();
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
