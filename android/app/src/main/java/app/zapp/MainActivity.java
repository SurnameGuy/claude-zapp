package app.zapp;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.graphics.Typeface;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ScrollView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.List;

/** Tela única: um WebView que mostra a interface servida pelo Node local. */
public class MainActivity extends Activity {
    static volatile boolean visible = false;

    private static final int REQ_FILE = 1, REQ_PERM = 2, REQ_GEO = 3, REQ_NOTIF = 4;

    private WebView web;
    private View splash;
    private ValueCallback<Uri[]> fileCb;
    private Uri cameraUri;
    private PermissionRequest pendingPerm;
    private GeolocationPermissions.Callback geoCb;
    private String geoOrigin;
    private String pendingOpen;
    private boolean pageReady = false;
    private FrameLayout rootView;
    private View diagView;
    private volatile boolean serverOk = false;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Diag.installCrashHandler(this);
        final boolean crashedBefore = Diag.marker(this).exists();
        try { new java.io.FileOutputStream(Diag.marker(this)).close(); } catch (Exception ignored) { }
        Diag.log(this, "MainActivity.onCreate (queda anterior: " + crashedBefore + ")");
        FrameLayout root = new FrameLayout(this);
        rootView = root;
        web = new WebView(this);
        setupWebView();
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        splash = buildSplash();
        root.addView(splash, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        if (crashedBefore) showDiag("O app foi encerrado antes de terminar de iniciar na última vez. Copie o relatório abaixo e envie para quem está ajudando.");

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
        }
        startForegroundService(new Intent(this, NodeService.class));
        waitForServer();
        handleIntent(getIntent());
    }

    private View buildSplash() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setGravity(Gravity.CENTER);
        l.setBackgroundColor(Color.WHITE);
        ProgressBar pb = new ProgressBar(this);
        TextView t = new TextView(this);
        t.setText("Iniciando…");
        t.setTextColor(0xFF8A8A8E);
        t.setPadding(0, 24, 0, 0);
        l.addView(pb);
        l.addView(t);
        return l;
    }

    private void setupWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setGeolocationEnabled(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setBackgroundColor(Color.WHITE);
        WebView.setWebContentsDebuggingEnabled(true);
        web.addJavascriptInterface(new Bridge(), "Android");
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("127.0.0.1".equals(u.getHost())) return false;
                openExternal(u.toString());
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                pageReady = true;
                splash.setVisibility(View.GONE);
                openPending();
            }

            @Override
            public void onReceivedError(final WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    pageReady = false;
                    splash.setVisibility(View.VISIBLE);
                    v.postDelayed(new Runnable() { @Override public void run() { loadApp(); } }, 2500);
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try {
                    Intent i;
                    if (p.isCaptureEnabled()) {
                        ContentValues v = new ContentValues();
                        v.put(MediaStore.Images.Media.DISPLAY_NAME, "zapp_" + System.currentTimeMillis() + ".jpg");
                        v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                        cameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                        i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        i.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                    } else {
                        cameraUri = null;
                        i = p.createIntent();
                    }
                    startActivityForResult(i, REQ_FILE);
                } catch (Exception e) {
                    fileCb = null;
                    cb.onReceiveValue(null);
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest r) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        List<String> need = new ArrayList<String>();
                        for (String res : r.getResources()) {
                            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
                                need.add(Manifest.permission.RECORD_AUDIO);
                        }
                        if (need.isEmpty()) { r.grant(r.getResources()); return; }
                        pendingPerm = r;
                        requestPermissions(need.toArray(new String[0]), REQ_PERM);
                    }
                });
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    cb.invoke(origin, true, false);
                } else {
                    geoCb = cb;
                    geoOrigin = origin;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, REQ_GEO);
                }
            }
        });

        web.setDownloadListener(new android.webkit.DownloadListener() {
            @Override
            public void onDownloadStart(String url, String ua, String cd, String mime, long len) {
                try {
                    DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                    String cookie = CookieManager.getInstance().getCookie(url);
                    if (cookie != null) r.addRequestHeader("Cookie", cookie);
                    r.addRequestHeader("X-WA-Key", Cfg.token(MainActivity.this));
                    String fn = URLUtil.guessFileName(url, cd, mime);
                    r.setTitle(fn);
                    r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fn);
                    ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
                    Toast.makeText(MainActivity.this, "Baixando " + fn, Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Não foi possível baixar o arquivo", Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    /** Espera o servidor local responder e então carrega a interface. */
    private void waitForServer() {
        new Thread(new Runnable() {
            @Override public void run() {
                for (int i = 0; i < 120; i++) {
                    try {
                        HttpURLConnection h = Cfg.open(MainActivity.this, "/api/state", "GET");
                        h.setReadTimeout(2000);
                        if (h.getResponseCode() == 200) {
                            serverOk = true;
                            Diag.marker(MainActivity.this).delete();
                            Diag.log(MainActivity.this, "servidor respondeu OK");
                            runOnUiThread(new Runnable() { @Override public void run() { loadApp(); } });
                            return;
                        }
                    } catch (Exception ignored) { }
                    if (i == 50) runOnUiThread(new Runnable() { @Override public void run() { if (!serverOk) showDiag("O servidor interno não respondeu em 25 segundos."); } });
                    try { Thread.sleep(500); } catch (InterruptedException ignored) { }
                }
            }
        }, "wait-server").start();
    }

    /** Tela de diagnóstico: relatório com logs que o usuário pode copiar ou compartilhar. */
    private void showDiag(String why) {
        if (diagView != null) rootView.removeView(diagView);
        final String report = Diag.report(this);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setBackgroundColor(Color.WHITE);
        box.setPadding(24, 24, 24, 24);
        TextView title = new TextView(this);
        title.setText("Diagnóstico");
        title.setTextSize(22);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(Color.BLACK);
        TextView why2 = new TextView(this);
        why2.setText(why);
        why2.setTextColor(0xFF555555);
        why2.setPadding(0, 8, 0, 16);
        ScrollView sv = new ScrollView(this);
        TextView body = new TextView(this);
        body.setText(report);
        body.setTextSize(11);
        body.setTypeface(Typeface.MONOSPACE);
        body.setTextColor(Color.BLACK);
        body.setTextIsSelectable(true);
        sv.addView(body);
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, 16, 0, 0);
        Button copy = new Button(this); copy.setText("Copiar");
        Button share = new Button(this); share.setText("Enviar");
        Button retry = new Button(this); retry.setText("Tentar de novo");
        Button close = new Button(this); close.setText("Fechar");
        copy.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) {
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("diagnostico", report));
            Toast.makeText(MainActivity.this, "Relatório copiado", Toast.LENGTH_SHORT).show();
        } });
        share.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_TEXT, report);
            startActivity(Intent.createChooser(i, "Enviar relatório"));
        } });
        retry.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) {
            hideDiag();
            try { startForegroundService(new Intent(MainActivity.this, NodeService.class)); } catch (Exception e) { Diag.log(MainActivity.this, "retry: " + e); }
            loadApp();
        } });
        close.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { hideDiag(); } });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        row.addView(copy, lp); row.addView(share, lp); row.addView(retry, lp); row.addView(close, lp);
        box.addView(title); box.addView(why2);
        box.addView(sv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        box.addView(row);
        diagView = box;
        rootView.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void hideDiag() {
        if (diagView != null) { rootView.removeView(diagView); diagView = null; }
    }

    private void loadApp() { web.loadUrl(Cfg.BASE + "/?k=" + Cfg.token(this)); }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception e) {
            Toast.makeText(this, "Nenhum app encontrado para abrir isto", Toast.LENGTH_SHORT).show();
        }
    }

    private void handleIntent(Intent i) {
        if (i == null) return;
        String jid = i.getStringExtra("jid");
        if (jid != null) { pendingOpen = jid; i.removeExtra("jid"); openPending(); }
    }

    private void openPending() {
        if (pendingOpen == null || !pageReady) return;
        String js = "window.zappOpen&&window.zappOpen(" + JSONObject.quote(pendingOpen) + ")";
        pendingOpen = null;
        web.evaluateJavascript(js, null);
    }

    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); handleIntent(intent); }
    @Override protected void onResume() { super.onResume(); visible = true; }
    @Override protected void onPause() { visible = false; super.onPause(); }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.zappBack?window.zappBack():false", new ValueCallback<String>() {
            @Override public void onReceiveValue(String v) { if (!"true".equals(v)) moveTaskToBack(true); }
        });
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_FILE || fileCb == null) return;
        Uri[] out = null;
        if (res == RESULT_OK) {
            if (cameraUri != null && (data == null || data.getData() == null)) out = new Uri[]{cameraUri};
            else out = WebChromeClient.FileChooserParams.parseResult(res, data);
        } else if (cameraUri != null) {
            try { getContentResolver().delete(cameraUri, null, null); } catch (Exception ignored) { }
        }
        fileCb.onReceiveValue(out);
        fileCb = null;
        cameraUri = null;
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (req == REQ_PERM && pendingPerm != null) {
            if (ok) pendingPerm.grant(pendingPerm.getResources()); else pendingPerm.deny();
            pendingPerm = null;
        } else if (req == REQ_GEO && geoCb != null) {
            geoCb.invoke(geoOrigin, ok, false);
            geoCb = null;
        }
    }

    /** Funções que a interface (JavaScript) pode chamar. */
    private class Bridge {
        @JavascriptInterface
        public void haptic(int ms) {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v != null) v.vibrate(VibrationEffect.createOneShot(Math.max(1, ms), VibrationEffect.DEFAULT_AMPLITUDE));
        }

        @JavascriptInterface
        public void setBars(final boolean dark) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    int c = dark ? 0xFF18181A : 0xFFF7F7F7;
                    getWindow().setStatusBarColor(c);
                    getWindow().setNavigationBarColor(c);
                    View d = getWindow().getDecorView();
                    int f = d.getSystemUiVisibility();
                    int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    d.setSystemUiVisibility(dark ? (f & ~light) : (f | light));
                }
            });
        }

        @JavascriptInterface
        public void openUrl(final String url) { runOnUiThread(new Runnable() { @Override public void run() { openExternal(url); } }); }

        @JavascriptInterface
        public void share(final String text) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                    i.putExtra(Intent.EXTRA_TEXT, text);
                    startActivity(Intent.createChooser(i, null));
                }
            });
        }

        @JavascriptInterface
        public void requestNotifPermission() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
                    else openNotificationSettings();
                }
            });
        }

        @JavascriptInterface
        public void openNotificationSettings() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
                }
            });
        }

        @JavascriptInterface
        public void requestBatteryExemption() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    try {
                        startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
                    } catch (Exception e) {
                        startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                    }
                }
            });
        }

        @JavascriptInterface
        public void showDiagnostics() {
            runOnUiThread(new Runnable() { @Override public void run() { showDiag("Relatório solicitado em Ajustes."); } });
        }

        @JavascriptInterface
        public void setBadge(int n) { /* sem suporte padrão no Android */ }
    }
}
