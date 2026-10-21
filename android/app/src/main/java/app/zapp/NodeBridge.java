package app.zapp;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.AssetManager;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** Inicia o Node.js embutido (nodejs-mobile) em uma thread do próprio app. */
final class NodeBridge {
    private static boolean started = false;

    private static boolean libsLoaded = false;

    /** Carrega as bibliotecas nativas; se falhar, registra o motivo em vez de derrubar o app. */
    private static synchronized boolean loadLibs(Context c) {
        if (libsLoaded) return true;
        try {
            System.loadLibrary("node");
            System.loadLibrary("zapp-native");
            libsLoaded = true;
            Diag.log(c, "bibliotecas nativas carregadas (node + zapp-native)");
        } catch (Throwable e) {
            Diag.log(c, "FALHA ao carregar biblioteca nativa: " + e);
        }
        return libsLoaded;
    }

    private NodeBridge() {}

    static native int startNode(String[] args);
    static native void setEnv(String key, String value);
    static native void redirectLogs(String path);

    static synchronized void start(final Context ctx) {
        if (started) return;
        started = true;
        final Context app = ctx.getApplicationContext();
        if (!loadLibs(app)) { started = false; return; }
        // Tudo roda na thread "node" (4 MB de pilha): a cópia dos assets não trava mais a thread principal.
        Thread t = new Thread(null, new Runnable() {
            @Override public void run() {
                try {
                    File root = new File(app.getFilesDir(), "app");
                    Diag.log(app, "copiando arquivos do app…");
                    copyIfNeeded(app, root);
                    File data = new File(app.getFilesDir(), "userdata");
                    data.mkdirs();
                    Diag.rotateNodeLog(app);
                    redirectLogs(Diag.nodeLog(app).getPath());
                    setEnv("WA_ROOT", root.getPath());
                    setEnv("WA_PUBLIC", new File(root, "public").getPath());
                    setEnv("WA_DATA", data.getPath());
                    setEnv("WA_KEY", Cfg.token(app));
                    setEnv("PORT", String.valueOf(Cfg.PORT));
                    setEnv("HOME", app.getFilesDir().getPath());
                    setEnv("TMPDIR", app.getCacheDir().getPath());
                    Diag.log(app, "chamando node::Start (boot.cjs)");
                    int code = startNode(new String[]{"node", "--max-old-space-size=384", new File(root, "boot.cjs").getPath()});
                    Diag.log(app, "node::Start retornou com código " + code);
                } catch (Throwable e) {
                    Diag.log(app, "Falha ao iniciar o Node: " + android.util.Log.getStackTraceString(e));
                }
            }
        }, "node", 4 * 1024 * 1024);
        t.start();
    }

    /** Copia servidor + interface dos assets para o armazenamento interno quando a versão muda. */
    private static void copyIfNeeded(Context app, File root) throws IOException {
        AssetManager am = app.getAssets();
        String version;
        InputStream vin = am.open("version.txt");
        version = new String(Cfg.readAll(vin), "UTF-8").trim();
        SharedPreferences p = app.getSharedPreferences("zapp", Context.MODE_PRIVATE);
        if (version.equals(p.getString("assets_v", "")) && new File(root, "server.cjs").exists() && new File(root, "boot.cjs").exists()) return;
        deleteRec(new File(root, "public"));
        root.mkdirs();
        copyAsset(am, "server.cjs", new File(root, "server.cjs"));
        copyAsset(am, "boot.cjs", new File(root, "boot.cjs"));
        copyAsset(am, "public", new File(root, "public"));
        p.edit().putString("assets_v", version).apply();
    }

    private static void copyAsset(AssetManager am, String src, File dst) throws IOException {
        String[] list = am.list(src);
        if (list != null && list.length > 0) {
            dst.mkdirs();
            for (String n : list) copyAsset(am, src + "/" + n, new File(dst, n));
        } else {
            File parent = dst.getParentFile();
            if (parent != null) parent.mkdirs();
            InputStream in = am.open(src);
            OutputStream out = new FileOutputStream(dst);
            byte[] b = new byte[65536];
            int r;
            while ((r = in.read(b)) > 0) out.write(b, 0, r);
            out.close();
            in.close();
        }
    }

    private static void deleteRec(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRec(k);
        f.delete();
    }
}

