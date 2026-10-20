package app.zapp;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.SecureRandom;

/** Constantes e utilitários HTTP para falar com o servidor local (Node). */
final class Cfg {
    static final int PORT = 38419;
    static final String BASE = "http://127.0.0.1:" + PORT;

    private Cfg() {}

    /** Token aleatório por instalação: impede que outros apps do aparelho leiam suas mensagens. */
    static synchronized String token(Context c) {
        SharedPreferences p = c.getApplicationContext().getSharedPreferences("zapp", Context.MODE_PRIVATE);
        String t = p.getString("token", null);
        if (t == null) {
            byte[] b = new byte[16];
            new SecureRandom().nextBytes(b);
            StringBuilder sb = new StringBuilder();
            for (byte x : b) sb.append(String.format("%02x", x));
            t = sb.toString();
            p.edit().putString("token", t).apply();
        }
        return t;
    }

    static HttpURLConnection open(Context c, String path, String method) throws IOException {
        HttpURLConnection h = (HttpURLConnection) new URL(BASE + path).openConnection();
        h.setRequestMethod(method);
        h.setConnectTimeout(4000);
        h.setReadTimeout(20000);
        h.setRequestProperty("X-WA-Key", token(c));
        return h;
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }

    static String post(Context c, String path, String json) throws IOException {
        HttpURLConnection h = open(c, path, "POST");
        h.setRequestProperty("Content-Type", "application/json");
        h.setDoOutput(true);
        OutputStream o = h.getOutputStream();
        o.write(json.getBytes("UTF-8"));
        o.close();
        int code = h.getResponseCode();
        if (code >= 300) throw new IOException("HTTP " + code);
        return new String(readAll(h.getInputStream()), "UTF-8");
    }

    static byte[] getBytes(Context c, String path) {
        try {
            HttpURLConnection h = open(c, path, "GET");
            h.setReadTimeout(5000);
            if (h.getResponseCode() != 200) return null;
            return readAll(h.getInputStream());
        } catch (Exception e) {
            return null;
        }
    }
}
