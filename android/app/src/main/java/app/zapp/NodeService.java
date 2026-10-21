package app.zapp;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;

/** Serviço em primeiro plano: mantém o Node rodando e transforma eventos do servidor em notificações. */
public class NodeService extends Service {
    private Thread sse;
    private volatile boolean stop = false;
    private PowerManager.WakeLock wakeLock;
    private String lastStatus = "";
    private boolean dead = false;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        Diag.installCrashHandler(this);
        Diag.log(this, "NodeService.onCreate");
        try {
            Notifier.channels(this);
            Notification n = Notifier.foreground(this, "Iniciando…");
            if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(1, n);
        } catch (Throwable e) {
            // Android 12+ recusa foreground service iniciado em segundo plano (ex.: reinício automático após um crash).
            // Antes isso derrubava o app em loop ("falhas constantes"); agora o serviço só desiste.
            Diag.log(this, "startForeground recusado: " + e);
            dead = true;
            stopSelf();
            return;
        }
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "zapp:connection");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Diag.log(this, "NodeService.onStartCommand");
        if (dead) return START_NOT_STICKY;
        try { NodeBridge.start(this); } catch (Throwable e) { Diag.log(this, "Falha ao iniciar o Node: " + e); }
        if (sse == null) {
            sse = new Thread(new Runnable() { @Override public void run() { loop(); } }, "zapp-events");
            sse.setDaemon(true);
            sse.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stop = true;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    private void loop() {
        while (!stop) {
            try {
                HttpURLConnection h = Cfg.open(this, "/native/events", "GET");
                h.setReadTimeout(80000);
                BufferedReader r = new BufferedReader(new InputStreamReader(h.getInputStream(), "UTF-8"));
                String line;
                while (!stop && (line = r.readLine()) != null) {
                    if (line.startsWith("data:")) handle(line.substring(5).trim());
                }
                r.close();
            } catch (Exception e) {
                // servidor ainda iniciando ou reconectando: tenta de novo
            }
            try { Thread.sleep(2000); } catch (InterruptedException ignored) { }
        }
    }

    private void handle(String raw) {
        try {
            JSONObject o = new JSONObject(raw);
            String type = o.optString("type");
            if ("msg".equals(type)) {
                if (!MainActivity.visible) Notifier.message(this, o);
            } else if ("read".equals(type)) {
                Notifier.cancel(this, o.optString("jid"));
            } else if ("call".equals(type)) {
                Notifier.call(this, o);
            } else if ("loggedout".equals(type)) {
                Notifier.simple(this, "Sessão encerrada", "Abra o app para conectar de novo.");
            } else if ("state".equals(type)) {
                String s = o.optString("status");
                if (!s.equals(lastStatus)) {
                    lastStatus = s;
                    String text = "open".equals(s) ? "Conectado · recebendo mensagens"
                            : "unpaired".equals(s) || "pairing".equals(s) ? "Aguardando vínculo · abra o app" : "Reconectando…";
                    ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(1, Notifier.foreground(this, text));
                }
            }
        } catch (Exception e) {
            android.util.Log.e("zapp", "evento inválido", e);
        }
    }
}

