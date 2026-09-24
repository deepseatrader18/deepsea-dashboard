package com.deepsea.jarviscontrol;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

public class AlertPollingService extends Service {

    private static final String CHANNEL_BG = "jarvis_bg";
    private static final String CHANNEL_ALERT = "jarvis_alert";
    private static final long POLL_INTERVAL_MS = 15000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean running = false;

    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            poll();
            handler.postDelayed(this, POLL_INTERVAL_MS);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(1, buildForegroundNotification());
        if (!running) {
            running = true;
            handler.post(pollRunnable);
        }
        return START_STICKY;
    }

    private void poll() {
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                SharedPreferences prefs = getSharedPreferences("jarvis_prefs", MODE_PRIVATE);
                String base = prefs.getString("server_url", "");
                String pass = prefs.getString("server_passcode", "");
                if (base == null || base.isEmpty()) return;
                if (base.endsWith("/")) base = base.substring(0, base.length() - 1);

                String urlStr = base + "/api/urgent_poll?passcode=" + Uri.encode(pass == null ? "" : pass);
                conn = (HttpURLConnection) new URL(urlStr).openConnection();
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);

                if (conn.getResponseCode() == 200) {
                    StringBuilder sb = new StringBuilder();
                    BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                    br.close();

                    JSONObject obj = new JSONObject(sb.toString());
                    JSONArray alerts = obj.optJSONArray("alerts");
                    if (alerts != null) {
                        for (int i = 0; i < alerts.length(); i++) {
                            showAlertNotification(alerts.getString(i));
                        }
                    }
                }
            } catch (Exception e) {
                // Network hiccup, try again next cycle.
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private void showAlertNotification(String text) {
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification n = new Notification.Builder(this, CHANNEL_ALERT)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle("JARVIS Alert")
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setPriority(Notification.PRIORITY_HIGH)
                .setCategory(Notification.CATEGORY_ALARM)
                .setAutoCancel(true)
                .setContentIntent(contentIntent)
                .build();

        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.notify((int) System.currentTimeMillis(), n);
    }

    private void createChannels() {
        NotificationManager nm = getSystemService(NotificationManager.class);

        NotificationChannel bg = new NotificationChannel(
                CHANNEL_BG, "JARVIS Background", NotificationManager.IMPORTANCE_MIN);
        bg.setShowBadge(false);
        nm.createNotificationChannel(bg);

        NotificationChannel alert = new NotificationChannel(
                CHANNEL_ALERT, "JARVIS Urgent Alerts", NotificationManager.IMPORTANCE_HIGH);
        alert.setDescription("Loud alerts JARVIS sends when something needs your attention.");
        alert.enableVibration(true);
        alert.setVibrationPattern(new long[]{0, 500, 250, 500, 250, 500});
        alert.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
        nm.createNotificationChannel(alert);
    }

    private Notification buildForegroundNotification() {
        return new Notification.Builder(this, CHANNEL_BG)
                .setSmallIcon(android.R.drawable.ic_menu_info_details)
                .setContentTitle("JARVIS Alert Monitor")
                .setContentText("Watching for urgent alerts from JARVIS")
                .setPriority(Notification.PRIORITY_MIN)
                .build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacks(pollRunnable);
        super.onDestroy();
    }
}
