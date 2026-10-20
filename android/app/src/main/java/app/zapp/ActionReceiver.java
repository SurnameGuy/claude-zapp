package app.zapp;

import android.app.NotificationManager;
import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import org.json.JSONObject;

/** Ações das notificações: responder, marcar como lida e recusar chamada. */
public class ActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(final Context context, final Intent intent) {
        final PendingResult pr = goAsync();
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    String a = intent.getAction();
                    String jid = intent.getStringExtra("jid");
                    if (Notifier.ACTION_REPLY.equals(a)) {
                        Bundle r = RemoteInput.getResultsFromIntent(intent);
                        CharSequence text = r == null ? null : r.getCharSequence("reply");
                        if (text != null && text.toString().trim().length() > 0) {
                            JSONObject j = new JSONObject();
                            j.put("jid", jid);
                            j.put("text", text.toString());
                            Cfg.post(context, "/native/reply", j.toString());
                            Notifier.addOwn(context, jid, text.toString());
                        }
                    } else if (Notifier.ACTION_READ.equals(a)) {
                        JSONObject j = new JSONObject();
                        j.put("jid", jid);
                        Cfg.post(context, "/native/read", j.toString());
                        Notifier.cancel(context, jid);
                    } else if (Notifier.ACTION_REJECT.equals(a)) {
                        JSONObject j = new JSONObject();
                        j.put("id", intent.getStringExtra("id"));
                        j.put("from", intent.getStringExtra("from"));
                        Cfg.post(context, "/native/reject-call", j.toString());
                        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(intent.getIntExtra("nid", 0));
                    }
                } catch (Exception e) {
                    android.util.Log.e("zapp", "ação da notificação falhou", e);
                } finally {
                    pr.finish();
                }
            }
        }).start();
    }
}
