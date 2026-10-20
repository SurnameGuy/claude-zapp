package app.zapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Person;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Shader;
import android.graphics.drawable.Icon;

import org.json.JSONObject;

import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Notificações no estilo do WhatsApp: conversa por contato, responder direto, marcar como lida. */
final class Notifier {
    static final String CH_MSG = "messages", CH_CALL = "calls", CH_SVC = "service", GROUP = "zapp.messages";
    static final String ACTION_REPLY = "app.zapp.REPLY", ACTION_READ = "app.zapp.READ", ACTION_REJECT = "app.zapp.REJECT";
    private static final int GREEN = 0xFF25D366;

    private static class Msg { String text, sender; long ts; boolean me; }

    private static final Map<String, List<Msg>> chats = new LinkedHashMap<String, List<Msg>>();
    private static final Map<String, String> titles = new HashMap<String, String>();
    private static final Map<String, Boolean> groups = new HashMap<String, Boolean>();
    private static final Map<String, Bitmap> avatars = new HashMap<String, Bitmap>();

    private Notifier() {}

    static void channels(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel m = new NotificationChannel(CH_MSG, "Mensagens", NotificationManager.IMPORTANCE_HIGH);
        m.enableVibration(true);
        m.enableLights(true);
        m.setLightColor(GREEN);
        m.setShowBadge(true);
        nm.createNotificationChannel(m);
        NotificationChannel call = new NotificationChannel(CH_CALL, "Chamadas", NotificationManager.IMPORTANCE_HIGH);
        call.enableVibration(true);
        nm.createNotificationChannel(call);
        NotificationChannel s = new NotificationChannel(CH_SVC, "Conexão em segundo plano", NotificationManager.IMPORTANCE_MIN);
        s.setShowBadge(false);
        nm.createNotificationChannel(s);
    }

    static Notification foreground(Context c, String text) {
        PendingIntent pi = PendingIntent.getActivity(c, 0, new Intent(c, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(c, CH_SVC)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(c.getString(R.string.fg_title))
                .setContentText(text)
                .setContentIntent(pi)
                .setOngoing(true)
                .setShowWhen(false)
                .build();
    }

    static void simple(Context c, String title, String text) {
        PendingIntent pi = PendingIntent.getActivity(c, 0, new Intent(c, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(c, CH_MSG).setSmallIcon(R.drawable.ic_stat).setColor(GREEN)
                .setContentTitle(title).setContentText(text).setContentIntent(pi).setAutoCancel(true).build();
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(("simple" + title).hashCode(), n);
    }

    static synchronized void message(Context c, JSONObject o) {
        String jid = o.optString("jid");
        if (jid.length() == 0) return;
        List<Msg> list = chats.get(jid);
        if (list == null) { list = new ArrayList<Msg>(); chats.put(jid, list); }
        Msg m = new Msg();
        m.text = o.optString("text");
        m.sender = o.optString("sender");
        m.ts = o.optLong("ts") * 1000L;
        if (m.ts == 0) m.ts = System.currentTimeMillis();
        list.add(m);
        while (list.size() > 8) list.remove(0);
        titles.put(jid, o.optString("chat"));
        groups.put(jid, o.optBoolean("group"));
        post(c, jid, false);
    }

    /** Depois de responder pela notificação: mostra a resposta e tira o "enviando". */
    static synchronized void addOwn(Context c, String jid, String text) {
        List<Msg> list = chats.get(jid);
        if (list == null) { list = new ArrayList<Msg>(); chats.put(jid, list); }
        Msg m = new Msg();
        m.text = text; m.me = true; m.ts = System.currentTimeMillis();
        list.add(m);
        post(c, jid, true);
    }

    private static void post(Context c, String jid, boolean quiet) {
        List<Msg> list = chats.get(jid);
        if (list == null || list.isEmpty()) return;
        String title = titles.containsKey(jid) ? titles.get(jid) : "Mensagem";
        boolean group = Boolean.TRUE.equals(groups.get(jid));
        Bitmap av = avatar(c, jid);

        Person me = new Person.Builder().setName("Você").build();
        Notification.MessagingStyle st = new Notification.MessagingStyle(me);
        if (group) { st.setConversationTitle(title); st.setGroupConversation(true); }
        Person.Builder pb = new Person.Builder().setName(title);
        if (av != null) pb.setIcon(Icon.createWithBitmap(av));
        Person contact = pb.build();
        for (Msg m : list) {
            Person who = null;
            if (!m.me) {
                if (group && m.sender != null && m.sender.length() > 0) who = new Person.Builder().setName(m.sender).build();
                else who = contact;
            }
            st.addMessage(new Notification.MessagingStyle.Message(m.text, m.ts, who));
        }

        int id = jid.hashCode();
        Intent open = new Intent(c, MainActivity.class).putExtra("jid", jid).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent openPi = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Intent reply = new Intent(c, ActionReceiver.class).setAction(ACTION_REPLY).putExtra("jid", jid);
        PendingIntent replyPi = PendingIntent.getBroadcast(c, id, reply, PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        RemoteInput ri = new RemoteInput.Builder("reply").setLabel("Responder").build();
        Notification.Action replyAct = new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_stat), "Responder", replyPi)
                .addRemoteInput(ri).setSemanticAction(Notification.Action.SEMANTIC_ACTION_REPLY).setAllowGeneratedReplies(true).build();

        Intent read = new Intent(c, ActionReceiver.class).setAction(ACTION_READ).putExtra("jid", jid);
        PendingIntent readPi = PendingIntent.getBroadcast(c, id + 1, read, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Action readAct = new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_stat), "Marcar como lida", readPi)
                .setSemanticAction(Notification.Action.SEMANTIC_ACTION_MARK_AS_READ).build();

        Msg last = list.get(list.size() - 1);
        Notification.Builder b = new Notification.Builder(c, CH_MSG)
                .setSmallIcon(R.drawable.ic_stat).setColor(GREEN).setStyle(st)
                .setContentIntent(openPi).setAutoCancel(true).setCategory(Notification.CATEGORY_MESSAGE)
                .setGroup(GROUP).setWhen(last.ts).setShowWhen(true).setOnlyAlertOnce(quiet)
                .addAction(replyAct).addAction(readAct);
        if (av != null) b.setLargeIcon(av);

        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(id, b.build());
        summary(c, nm);
    }

    private static void summary(Context c, NotificationManager nm) {
        if (chats.size() < 2) { if (chats.isEmpty()) nm.cancel(0); return; }
        int total = 0;
        for (List<Msg> l : chats.values()) total += l.size();
        Notification s = new Notification.Builder(c, CH_MSG).setSmallIcon(R.drawable.ic_stat).setColor(GREEN)
                .setStyle(new Notification.InboxStyle().setSummaryText(total + " mensagens de " + chats.size() + " conversas"))
                .setGroup(GROUP).setGroupSummary(true).setAutoCancel(true).setOnlyAlertOnce(true)
                .setContentIntent(PendingIntent.getActivity(c, 0, new Intent(c, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)).build();
        nm.notify(0, s);
    }

    static synchronized void cancel(Context c, String jid) {
        if (jid == null || chats.remove(jid) == null) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(jid.hashCode());
        summary(c, nm);
    }

    static void call(Context c, JSONObject o) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        int id = ("call" + o.optString("id")).hashCode();
        String name = o.optString("name", "Contato");
        boolean video = o.optBoolean("video");
        if (o.optBoolean("live")) {
            Intent rej = new Intent(c, ActionReceiver.class).setAction(ACTION_REJECT)
                    .putExtra("id", o.optString("id")).putExtra("from", o.optString("from")).putExtra("nid", id);
            PendingIntent rejPi = PendingIntent.getBroadcast(c, id, rej, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            PendingIntent openPi = PendingIntent.getActivity(c, 0, new Intent(c, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification n = new Notification.Builder(c, CH_CALL).setSmallIcon(R.drawable.ic_stat).setColor(GREEN)
                    .setContentTitle(name).setContentText(video ? "Chamada de vídeo do WhatsApp" : "Chamada de voz do WhatsApp")
                    .setCategory(Notification.CATEGORY_CALL).setContentIntent(openPi).setTimeoutAfter(35000)
                    .addAction(new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_stat), "Recusar", rejPi).build()).build();
            nm.notify(id, n);
        } else {
            nm.cancel(id);
            if ("missed".equals(o.optString("result"))) simple(c, "Chamada perdida", name);
        }
    }

    private static Bitmap avatar(Context c, String jid) {
        if (avatars.containsKey(jid)) return avatars.get(jid);
        Bitmap out = null;
        try {
            byte[] raw = Cfg.getBytes(c, "/api/avatar/" + URLEncoder.encode(jid, "UTF-8"));
            if (raw != null) {
                Bitmap src = BitmapFactory.decodeByteArray(raw, 0, raw.length);
                if (src != null) {
                    int s = 128;
                    Bitmap scaled = Bitmap.createScaledBitmap(src, s, s, true);
                    out = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888);
                    Canvas cv = new Canvas(out);
                    Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
                    p.setShader(new BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
                    cv.drawCircle(s / 2f, s / 2f, s / 2f, p);
                }
            }
        } catch (Exception ignored) { }
        avatars.put(jid, out);
        return out;
    }
}
