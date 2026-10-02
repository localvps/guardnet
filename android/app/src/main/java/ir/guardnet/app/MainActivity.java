package ir.guardnet.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * GuardNet for Android: a thin, hardened wrapper around the same web app the
 * browser uses, so calls, chats and screen sharing improvements ship instantly.
 *
 * Built on framework APIs only (no AndroidX) to keep the APK tiny and to keep
 * minSdk 21 viable.
 */
public class MainActivity extends Activity {

    private static final String TAG = "GuardNet";
    static final String BASE_URL = "https://xxxxxx";
    static final String HOST = "xxxxxx";
    static final String DEEP_PREFIX = "guardnet://";
    private static final int REQ_FILE = 4001;
    private static final int REQ_MEDIA = 4002;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingWebPermission;
    private String[] pendingMediaPermissions;
    private boolean pageFailed;
    private long lastBackPress;
    private AudioManager audio;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        Window w = getWindow();
        w.setBackgroundDrawableResource(R.color.brand_bg);
        if (Build.VERSION.SDK_INT >= 21) {
            w.setStatusBarColor(getResources().getColor(R.color.brand_dark));
        }

        web = new WebView(this);
        web.setBackgroundColor(0xFF0E1621);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(false);
        // Calls need audio to start playing without a user gesture (the callee
        // side of a ringing call never has one).
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setGeolocationEnabled(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return handleUrl(req.getUrl().toString());
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap fav) {
                pageFailed = false;
                injectShim(view);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                injectShim(view);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) fail(err.getErrorCode(), err.getDescription());
            }

            @SuppressWarnings("deprecation")
            @Override
            public void onReceivedError(WebView view, int code, String description, String failing) {
                fail(code, description);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        grantWebPermission(request);
                    }
                });
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                pendingWebPermission = null;
                pendingMediaPermissions = null;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                return openFileChooser(callback, params);
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, cm.message() + " @" + cm.lineNumber());
                }
                return true;
            }
        });

        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimetype, long contentLength) {
                download(url, contentDisposition, mimetype);
            }
        });

        if (BuildConfig.DEBUG && Build.VERSION.SDK_INT >= 19) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        String deep = getIntent() != null ? getIntent().getDataString() : null;
        if (deep != null && deep.toLowerCase(Locale.ROOT).startsWith(DEEP_PREFIX)) {
            // Cold start from a link: open the app shell first, then hand over.
            web.loadUrl(BASE_URL);
            web.postDelayed(new Runnable() {
                @Override
                public void run() {
                    dispatchDeepLink(getIntent().getDataString());
                }
            }, 2500);
        } else {
            web.loadUrl(BASE_URL);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String deep = intent.getDataString();
        if (deep != null && deep.toLowerCase(Locale.ROOT).startsWith(DEEP_PREFIX)) {
            if (web == null) return;
            String tail = deep.substring(deep.indexOf("://") + 3).replaceAll("^/+", "");
            if (tail.isEmpty()) return;
            if ("reload".equals(tail)) {
                web.reload();
            } else if (tail.startsWith("audio/")) {
                setAudioMode(tail.substring(6));
            } else {
                dispatchDeepLink(tail);
            }
        }
    }

    /** Same event contract as the Windows client. */
    private void dispatchDeepLink(String url) {
        if (url == null || web == null) return;
        String tail = url.substring(url.indexOf("://") + 3).replaceAll("^/+", "");
        if (tail.isEmpty()) return;
        String js = "window.dispatchEvent(new CustomEvent('guardnet:deeplink',{detail:"
                + JSONObject.quote(tail) + "}))";
        web.evaluateJavascript(js, null);
    }

    /**
     * WebView has no getDisplayMedia, so without this the page would throw a
     * TypeError. Rejecting with NotSupportedError lets the UI show a proper
     * message instead of a broken call button.
     */
    private void injectShim(WebView view) {
        view.evaluateJavascript(
                "(function(){try{"
                        + "if(!window.guardnetApp){window.guardnetApp='android';}"
                        + "var m=navigator.mediaDevices;"
                        + "if(m&&!m.getDisplayMedia){m.getDisplayMedia=function(){"
                        + "var e=new Error('getDisplayMedia is not available in this app');"
                        + "e.name='NotSupportedError';return Promise.reject(e);};}"
                        + "}catch(e){}})();",
                null);
    }

    private void setAudioMode(String mode) {
        if (audio == null) return;
        boolean on = "on".equals(mode) || "communications".equals(mode);
        audio.setMode(on ? AudioManager.MODE_IN_COMMUNICATION : AudioManager.MODE_NORMAL);
    }

    // ---------------------------------------------------------------- navigation

    /** @return true when the URL must not be loaded inside the WebView. */
    private boolean handleUrl(String raw) {
        if (raw == null) return false;
        String url = raw.trim();
        String lower = url.toLowerCase(Locale.ROOT);

        if (lower.startsWith(DEEP_PREFIX)) {
            String tail = url.substring(url.indexOf("://") + 3).replaceAll("^/+", "");
            if ("reload".equals(tail)) {
                if (web != null) web.reload();
            } else if (tail.startsWith("audio/")) {
                setAudioMode(tail.substring(6));
            } else if (web != null) {
                if (pageFailed) {
                    web.loadUrl(BASE_URL);
                }
                dispatchDeepLink(tail);
            }
            return true;
        }

        if (lower.startsWith("intent://")) {
            handleIntentScheme(url);
            return true;
        }

        Uri uri;
        try {
            uri = Uri.parse(url);
        } catch (Exception e) {
            return true;
        }
        String scheme = uri.getScheme();
        if (scheme == null) return true;
        scheme = scheme.toLowerCase(Locale.ROOT);

        if (isAppUrl(uri)) return false;

        if ("http".equals(scheme) || "https".equals(scheme) || "mailto".equals(scheme)
                || "tel".equals(scheme) || "sms".equals(scheme)) {
            openExternal(uri);
            return true;
        }
        // javascript:, file:, content:, about: and anything unknown never load.
        return true;
    }

    private boolean isAppUrl(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null) return false;
        scheme = scheme.toLowerCase(Locale.ROOT);
        if (!"https".equals(scheme)) return false;
        host = host.toLowerCase(Locale.ROOT);
        return host.equals(HOST) || host.endsWith("." + HOST);
    }

    private void openExternal(Uri uri) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, uri)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            toast("برنامه‌ای برای باز کردن این لینک پیدا نشد");
        }
    }

    /**
     * intent:// links can carry component names and extras, which is how the old
     * WebView intent-injection bug worked. Only a plain http(s) browser handoff is
     * honoured here, everything else in the intent is dropped.
     */
    private void handleIntentScheme(String url) {
        try {
            Intent parsed = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
            Uri data = parsed.getData();
            String scheme = data != null && data.getScheme() != null
                    ? data.getScheme().toLowerCase(Locale.ROOT) : "";
            if (!"http".equals(scheme) && !"https".equals(scheme)) return;
            Intent clean = new Intent(Intent.ACTION_VIEW, data)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(clean);
        } catch (Exception e) {
            Log.d(TAG, "blocked intent:// url");
        }
    }

    // ---------------------------------------------------------------- permissions

    private void grantWebPermission(PermissionRequest request) {
        String[] resources = request.getResources();
        if (has(resources, PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID)) {
            request.deny();
            return;
        }
        List<String> needed = new ArrayList<String>();
        if (has(resources, PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                && !granted(Manifest.permission.CAMERA)) {
            needed.add(Manifest.permission.CAMERA);
        }
        if (has(resources, PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                && !granted(Manifest.permission.RECORD_AUDIO)) {
            needed.add(Manifest.permission.RECORD_AUDIO);
        }
        if (needed.isEmpty()) {
            request.grant(resources);
            return;
        }
        pendingWebPermission = request;
        pendingMediaPermissions = needed.toArray(new String[0]);
        requestPermissions(pendingMediaPermissions, REQ_MEDIA);
    }

    private static boolean has(String[] resources, String name) {
        for (String r : resources) {
            if (name.equals(r)) return true;
        }
        return false;
    }

    /** Works on API 21 too, where Context.checkSelfPermission does not exist. */
    private boolean granted(String permission) {
        return getPackageManager().checkPermission(permission, getPackageName())
                == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode != REQ_MEDIA) {
            super.onRequestPermissionsResult(requestCode, permissions, results);
            return;
        }
        boolean all = results.length > 0;
        for (int r : results) {
            if (r != PackageManager.PERMISSION_GRANTED) all = false;
        }
        if (pendingWebPermission != null) {
            if (all) {
                pendingWebPermission.grant(pendingWebPermission.getResources());
            } else {
                pendingWebPermission.deny();
                toast("برای تماس باید دسترسی دوربین و میکروفون داده شود");
            }
        }
        pendingWebPermission = null;
        pendingMediaPermissions = null;
    }

    // ---------------------------------------------------------------- file picker

    private boolean openFileChooser(ValueCallback<Uri[]> callback,
                                    WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
        }
        fileCallback = callback;
        String[] accept = params.getAcceptTypes();
        String type = (accept != null && accept.length > 0 && accept[0] != null
                && !accept[0].trim().isEmpty()) ? accept[0] : "*/*";
        Intent i = new Intent(Intent.ACTION_GET_CONTENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(type);
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        try {
            startActivityForResult(Intent.createChooser(i, getString(R.string.pick_file)), REQ_FILE);
        } catch (ActivityNotFoundException e) {
            fileCallback = null;
            toast("برنامه‌ای برای انتخاب فایل پیدا نشد");
        }
        return true;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (fileCallback == null) {
                super.onActivityResult(requestCode, resultCode, data);
                return;
            }
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileCallback.onReceiveValue(result);
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // ---------------------------------------------------------------- downloads

    private void download(String url, String disposition, String mime) {
        if (url == null) return;
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            toast("دانلود این نوع فایل در برنامه ممکن نیست");
            return;
        }
        Uri uri;
        try {
            uri = Uri.parse(url);
        } catch (Exception e) {
            return;
        }
        String scheme = uri.getScheme();
        if (scheme == null) return;
        scheme = scheme.toLowerCase(Locale.ROOT);
        if (!"http".equals(scheme) && !"https".equals(scheme)) return;

        String name = URLUtil.guessFileName(url, disposition, mime);
        try {
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (dm == null) return;
            DownloadManager.Request req = new DownloadManager.Request(uri);
            if (mime != null) req.setMimeType(mime);
            req.addRequestHeader("User-Agent", web.getSettings().getUserAgentString());
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) req.addRequestHeader("Cookie", cookie);
            if (web.getUrl() != null) req.addRequestHeader("Referer", web.getUrl());
            if (Build.VERSION.SDK_INT >= 29) {
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            } else {
                req.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name);
            }
            req.setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            dm.enqueue(req);
            toast("دانلود شروع شد");
        } catch (Exception e) {
            toast("دانلود ممکن نشد");
        }
    }

    // ---------------------------------------------------------------- misc

    private void fail(int code, CharSequence description) {
        if (web == null || pageFailed) return;
        if (code == -1 /* ERROR_UNSUPPORTED_SCHEME */ || code == -3 /* ERROR_UNSUPPORTED */) return;
        pageFailed = true;
        web.loadDataWithBaseURL(BASE_URL, errorPage(description), "text/html", "utf-8", null);
    }

    private String errorPage(CharSequence description) {
        return "<!doctype html><html dir=\"rtl\" lang=\"fa\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<style>html,body{height:100%;margin:0;background:#0E1621;color:#E6EDF5;"
                + "font-family:Tahoma,system-ui,sans-serif;display:flex;align-items:center;"
                + "justify-content:center;text-align:center}"
                + ".b{background:#2E7CF6;color:#fff;padding:12px 22px;border-radius:10px;"
                + "text-decoration:none;display:inline-block;margin-top:18px}"
                + "p{color:#8FA3BC;font-size:13px;margin:6px 0 0}</style></head><body>"
                + "<div><div style=\"font-size:20px;margin-bottom:8px\">ارتباط برقرار نشد</div>"
                + "<p>" + (description == null ? "" : escapeHtml(description.toString())) + "</p>"
                + "<a class=\"b\" href=\"" + DEEP_PREFIX + "reload\">تلاش دوباره</a>"
                + "</div></body></html>";
    }

    private static String escapeHtml(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    @Override
    public void onBackPressed() {
        if (pageFailed) {
            pageFailed = false;
            web.loadUrl(BASE_URL);
            return;
        }
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackPress < 2000) {
            finish();
        } else {
            lastBackPress = now;
            toast(getString(R.string.exit_hint));
        }
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.onPause();
            CookieManager.getInstance().flush();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onRestoreInstanceState(Bundle saved) {
        super.onRestoreInstanceState(saved);
        if (web != null && web.restoreState(saved) == null) {
            web.loadUrl(BASE_URL);
        }
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        if (web != null) {
            web.stopLoading();
            web.setWebChromeClient(null);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}