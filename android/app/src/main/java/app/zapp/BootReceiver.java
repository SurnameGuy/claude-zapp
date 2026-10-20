package app.zapp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Inicia o serviço quando o aparelho liga (ou o app é atualizado). */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            context.startForegroundService(new Intent(context, NodeService.class));
        } catch (Exception e) {
            android.util.Log.e("zapp", "Não foi possível iniciar no boot", e);
        }
    }
}
