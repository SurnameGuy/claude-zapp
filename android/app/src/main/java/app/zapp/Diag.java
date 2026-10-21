package app.zapp;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileWriter;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** Diagnóstico: grava logs em arquivo e monta um relatório que o usuário pode copiar/compartilhar. */
final class Diag {
    private Diag() {}

    static File nodeLog(Context c) { return new File(c.getFilesDir(), "node.log"); }
    static File nodePrev(Context c) { return new File(c.getFilesDir(), "node.prev.log"); }
    static File javaLog(Context c) { return new File(c.getFilesDir(), "java.log"); }
    static File marker(Context c) { return new File(c.getFilesDir(), "starting.marker"); }

    private static String stamp() { return new SimpleDateFormat("HH:mm:ss.SSS", Locale.US).format(new Date()); }

    static synchronized void log(Context c, String msg) {
        android.util.Log.i("zapp", msg);
        try {
            File f = javaLog(c);
            if (f.length() > 100000) f.delete();
            FileWriter w = new FileWriter(f, true);
            w.write(stamp() + " " + msg + "\n");
            w.close();
        } catch (Exception ignored) { }
    }

    /** Guarda o log do Node anterior (para ver o que aconteceu antes de uma queda). */
    static void rotateNodeLog(Context c) {
        File f = nodeLog(c), p = nodePrev(c);
        if (f.exists() && f.length() > 0) { p.delete(); f.renameTo(p); }
    }

    static void installCrashHandler(final Context c) {
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override public void uncaughtException(Thread t, Throwable e) {
                log(c, "CRASH Java na thread " + t.getName() + ":\n" + android.util.Log.getStackTraceString(e));
                if (prev != null) prev.uncaughtException(t, e);
            }
        });
    }

    private static String tail(File f, int max) {
        try {
            if (!f.exists()) return "(arquivo não existe)";
            long len = f.length();
            InputStream in = new FileInputStream(f);
            if (len > max) in.skip(len - max);
            byte[] b = Cfg.readAll(in);
            String s = new String(b, "UTF-8").trim();
            return s.length() == 0 ? "(vazio)" : s;
        } catch (Exception e) {
            return "(erro ao ler: " + e + ")";
        }
    }

    private static String reasonName(int r) {
        switch (r) {
            case 1: return "EXIT_SELF (o próprio app chamou exit)";
            case 2: return "SIGNALED (morto por sinal)";
            case 3: return "LOW_MEMORY";
            case 4: return "CRASH (exceção Java)";
            case 5: return "CRASH_NATIVE (falha em código nativo)";
            case 6: return "ANR (app travado)";
            case 7: return "INITIALIZATION_FAILURE";
            case 8: return "PERMISSION_CHANGE";
            case 9: return "EXCESSIVE_RESOURCE_USAGE";
            case 10: return "USER_REQUESTED";
            case 11: return "USER_STOPPED";
            case 12: return "DEPENDENCY_DIED";
            case 14: return "FREEZER";
            default: return "OTHER (" + r + ")";
        }
    }

    /** Extrai textos legíveis do tombstone (protobuf) de uma falha nativa. */
    private static String printable(InputStream in, int maxChars) {
        try {
            byte[] b = Cfg.readAll(in);
            StringBuilder out = new StringBuilder(), run = new StringBuilder();
            for (byte x : b) {
                char ch = (char) (x & 0xff);
                if (ch >= 32 && ch < 127) run.append(ch);
                else { if (run.length() >= 6) out.append(run).append('\n'); run.setLength(0); }
                if (out.length() > maxChars) break;
            }
            return out.toString();
        } catch (Exception e) {
            return "";
        }
    }

    static String report(Context c) {
        StringBuilder sb = new StringBuilder();
        sb.append("=== Zapp — relatório de diagnóstico ===\n");
        sb.append("Aparelho: ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL)
                .append(" · Android ").append(Build.VERSION.RELEASE).append(" (API ").append(Build.VERSION.SDK_INT).append(")\n");
        sb.append("ABIs: ").append(java.util.Arrays.toString(Build.SUPPORTED_ABIS)).append("\n\n");
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
                List<ApplicationExitInfo> list = am.getHistoricalProcessExitReasons(c.getPackageName(), 0, 4);
                sb.append("--- Últimas mortes do processo (Android) ---\n");
                if (list.isEmpty()) sb.append("(nenhuma registrada)\n");
                for (ApplicationExitInfo i : list) {
                    sb.append(new SimpleDateFormat("dd/MM HH:mm:ss", Locale.US).format(new Date(i.getTimestamp())))
                            .append(" · ").append(reasonName(i.getReason()))
                            .append(" · status=").append(i.getStatus())
                            .append(" · ").append(i.getProcessName()).append('\n');
                    if (i.getDescription() != null) sb.append("   ").append(i.getDescription()).append('\n');
                    if (i.getReason() == 5) {
                        try {
                            InputStream t = i.getTraceInputStream();
                            if (t != null) sb.append("   [tombstone]\n").append(printable(t, 3500)).append('\n');
                        } catch (Exception ignored) { }
                    }
                }
            } catch (Throwable e) {
                sb.append("(não foi possível ler o histórico: ").append(e).append(")\n");
            }
            sb.append('\n');
        }
        sb.append("--- Log do app (Java) ---\n").append(tail(javaLog(c), 6000)).append("\n\n");
        sb.append("--- Log do Node (execução atual) ---\n").append(tail(nodeLog(c), 6000)).append("\n\n");
        sb.append("--- Log do Node (execução anterior) ---\n").append(tail(nodePrev(c), 6000)).append("\n");
        return sb.toString();
    }
}
