package com.deepsea.jarviscontrol;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.InputType;
import android.view.Menu;
import android.view.MenuItem;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

public class MainActivity extends Activity {

    private WebView webView;
    private static final String PREFS = "jarvis_prefs";
    private static final String KEY_URL = "server_url";

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

        String url = getSavedUrl();
        if (url == null || url.isEmpty()) {
            promptForUrl();
        } else {
            webView.loadUrl(url);
        }
    }

    private String getSavedUrl() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        return prefs.getString(KEY_URL, "");
    }

    private void saveUrl(String url) {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        prefs.edit().putString(KEY_URL, url).apply();
    }

    private void promptForUrl() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("http://192.168.1.5:8765");
        String existing = getSavedUrl();
        if (existing != null && !existing.isEmpty()) {
            input.setText(existing);
        }

        new AlertDialog.Builder(this)
                .setTitle("JARVIS Server Address")
                .setMessage("Apne laptop ka local IP address aur port daalein " +
                        "(jaise http://192.168.1.5:8765).\n\n" +
                        "Ye laptop par JARVIS start hone par CMD window mein dikhta hai, " +
                        "ya laptop par 'ipconfig' chala kar 'IPv4 Address' dekh sakte hain. " +
                        "Phone aur laptop dono same WiFi par hone chahiye.")
                .setView(input)
                .setCancelable(false)
                .setPositiveButton("Connect", (dialog, which) -> {
                    String url = input.getText().toString().trim();
                    if (url.isEmpty()) {
                        Toast.makeText(this, "Address zaroori hai", Toast.LENGTH_SHORT).show();
                        promptForUrl();
                        return;
                    }
                    if (!url.startsWith("http://") && !url.startsWith("https://")) {
                        url = "http://" + url;
                    }
                    saveUrl(url);
                    webView.loadUrl(url);
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
            promptForUrl();
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
