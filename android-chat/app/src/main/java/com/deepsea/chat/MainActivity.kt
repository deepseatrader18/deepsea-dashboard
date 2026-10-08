package com.deepsea.chat

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import com.deepsea.chat.ui.App
import com.deepsea.chat.ui.DeepSeaTheme

class MainActivity : ComponentActivity() {
    private val vm: ChatViewModel by viewModels()

    private val askNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // White status-bar icons over the teal top bar.
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        if (Build.VERSION.SDK_INT >= 33) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        if (savedInstanceState == null) openFromIntent(intent)
        setContent {
            DeepSeaTheme {
                App(vm, onExit = { finish() })
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openFromIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        vm.onAppResumed()
    }

    private fun openFromIntent(intent: Intent?) {
        val chatId = intent?.getStringExtra(EXTRA_CHAT_ID) ?: return
        if (!vm.session.loggedIn) return
        if (vm.screen != Screen.Conversation(chatId)) vm.navigate(Screen.Conversation(chatId))
    }

    companion object {
        const val EXTRA_CHAT_ID = "chatId"
    }
}
