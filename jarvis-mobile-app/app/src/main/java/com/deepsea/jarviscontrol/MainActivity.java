package com.deepsea.jarviscontrol;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Menu;
import android.view.MenuItem;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {

    private WebView webView;
    private static final String PREFS = "jarvis_prefs";
    private static final String KEY_URL = "server_url";
    private static final String KEY_PASSCODE = "server_passcode";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.setWebViewClient(new WebViewClient());

        requestNotificationPermissionIfNeeded();

        String url = getSavedUrl();
        if (url == null || url.isEmpty()) {
            promptForServerDetails();
        } else {
            webView.loadUrl(url);
            startAlertService();
        }
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }
    }

    private void startAlertService() {
        startForegroundService(new Intent(this, AlertPollingService.class));
    }

    private String getSavedUrl() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        return prefs.getString(KEY_URL, "");
    }

    private String getSavedPasscode() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        return prefs.getString(KEY_PASSCODE, "");
    }

    private void saveServerDetails(String url, String passcode) {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        prefs.edit().putString(KEY_URL, url).putString(KEY_PASSCODE, passcode).apply();
    }

    private void promptForServerDetails() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);

        final EditText urlInput = new EditText(this);
        urlInput.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        urlInput.setHint("http://192.168.1.5:8765");
        String existingUrl = getSavedUrl();
        if (existingUrl != null && !existingUrl.isEmpty()) urlInput.setText(existingUrl);

        TextView passLabel = new TextView(this);
        passLabel.setText("Mobile passcode (khali chhod sakte ho agar disabled hai):");
        passLabel.setTextColor(Color.DKGRAY);
        int topMargin = (int) (12 * getResources().getDisplayMetrics().density);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = topMargin;
        passLabel.setLayoutParams(lp);

        final EditText passInput = new EditText(this);
        passInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        passInput.setHint("jarvis123");
        passInput.setText(getSavedPasscode());

        layout.addView(urlInput);
        layout.addView(passLabel);
        layout.addView(passInput);

        new AlertDialog.Builder(this)
                .setTitle("JARVIS Server Address")
                .setMessage("Apne laptop ka local IP address aur port daalein " +
                        "(jaise http://192.168.1.5:8765).\n\n" +
                        "Ye laptop par JARVIS start hone par CMD window mein dikhta hai, " +
                        "ya laptop par 'ipconfig' chala kar 'IPv4 Address' dekh sakte hain.")
                .setView(layout)
                .setCancelable(false)
                .setPositiveButton("Connect", (dialog, which) -> {
                    String url = urlInput.getText().toString().trim();
                    String passcode = passInput.getText().toString().trim();
                    if (url.isEmpty()) {
                        Toast.makeText(this, "Address zaroori hai", Toast.LENGTH_SHORT).show();
                        promptForServerDetails();
                        return;
                    }
                    if (!url.startsWith("http://") && !url.startsWith("https://")) {
                        url = "http://" + url;
                    }
                    saveServerDetails(url, passcode);
                    webView.loadUrl(url);
                    startAlertService();
                })
                .show();
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(0, 1, 0, "Server address badlo");
        menu.add(0, 2, 1, "Reload");
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == 1) {
            promptForServerDetails();
            return true;
        } else if (item.getItemId() == 2) {
            webView.reload();
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
