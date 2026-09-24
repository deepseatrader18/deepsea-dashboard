package com.deepsea.jarviscontrol;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;

        SharedPreferences prefs = context.getSharedPreferences("jarvis_prefs", Context.MODE_PRIVATE);
        String url = prefs.getString("server_url", "");
        if (url == null || url.isEmpty()) return;

        context.startForegroundService(new Intent(context, AlertPollingService.class));
    }
}
