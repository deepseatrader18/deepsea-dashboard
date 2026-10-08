package com.deepsea.chat

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.deepsea.chat.data.Chat
import com.deepsea.chat.data.Message

/** Shows a notification for incoming messages while the app is alive but not looking at that chat. */
class Notifier(private val context: Context) {
    private val manager = NotificationManagerCompat.from(context)

    init {
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Messages", NotificationManager.IMPORTANCE_HIGH)
        )
    }

    fun show(chat: Chat, msg: Message) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return

        val intent = Intent(context, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_CHAT_ID, chat.id)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pending = PendingIntent.getActivity(
            context, chat.id.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val body = if (chat.isGroup) "${msg.fromName}: ${msg.text}" else msg.text
        val subtitle = if (chat.unread > 1) "${chat.unread} new messages" else null
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(chat.title)
            .setContentText(body)
            .setSubText(subtitle)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        try {
            manager.notify(chat.id.hashCode(), notification)
        } catch (_: SecurityException) {
        }
    }

    fun cancel(chatId: String) = manager.cancel(chatId.hashCode())

    companion object {
        const val CHANNEL = "messages"
    }
}
