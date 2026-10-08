package com.deepsea.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.deepsea.chat.Presence
import com.deepsea.chat.data.Tick
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.math.abs

object Brand {
    val TealDark = Color(0xFF075E54)
    val Teal = Color(0xFF128C7E)
    val Green = Color(0xFF25D366)
    val ReadBlue = Color(0xFF34B7F1)
    val OutBubbleLight = Color(0xFFDCF8C6)
    val OutBubbleDark = Color(0xFF005C4B)
    val ChatBgLight = Color(0xFFECE5DD)
    val ChatBgDark = Color(0xFF0B141A)
}

@Composable
fun DeepSeaTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) {
        darkColorScheme(
            primary = Brand.Green,
            secondary = Brand.Teal,
            primaryContainer = Color(0xFF1F2C34),
            onPrimaryContainer = Color.White,
            surface = Color(0xFF111B21),
            background = Color(0xFF111B21),
        )
    } else {
        lightColorScheme(
            primary = Brand.Teal,
            secondary = Brand.Green,
            primaryContainer = Brand.TealDark,
            onPrimaryContainer = Color.White,
        )
    }
    MaterialTheme(colorScheme = colors, content = content)
}

private val avatarColors = listOf(
    Color(0xFF00A884), Color(0xFF53BDEB), Color(0xFFFF7B54), Color(0xFFA791F7),
    Color(0xFFFFB300), Color(0xFFE86A92), Color(0xFF5E8C61), Color(0xFF3B82F6),
)

@Composable
fun Avatar(name: String, size: Dp = 48.dp, online: Boolean = false) {
    Box {
        Box(
            Modifier
                .size(size)
                .clip(CircleShape)
                .background(avatarColors[abs(name.hashCode()) % avatarColors.size]),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                initials(name),
                color = Color.White,
                fontWeight = FontWeight.SemiBold,
                fontSize = (size.value * 0.38f).sp,
            )
        }
        if (online) {
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .size(size * 0.28f)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surface)
            ) {
                Box(
                    Modifier
                        .align(Alignment.Center)
                        .size(size * 0.2f)
                        .clip(CircleShape)
                        .background(Brand.Green)
                )
            }
        }
    }
}

fun initials(name: String): String =
    name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2)
        .joinToString("") { it.first().uppercase() }.ifEmpty { "?" }

@Composable
fun TickIcon(tick: Tick, modifier: Modifier = Modifier) {
    val muted = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
    when (tick) {
        Tick.PENDING -> Icon(Icons.Default.Schedule, "Sending", modifier.size(14.dp), tint = muted)
        Tick.SENT -> Icon(Icons.Default.Done, "Sent", modifier.size(16.dp), tint = muted)
        Tick.DELIVERED -> Icon(Icons.Default.DoneAll, "Delivered", modifier.size(16.dp), tint = muted)
        Tick.READ -> Icon(Icons.Default.DoneAll, "Read", modifier.size(16.dp), tint = Brand.ReadBlue)
    }
}

private fun sameDay(a: Long, b: Long): Boolean {
    val ca = Calendar.getInstance().apply { timeInMillis = a }
    val cb = Calendar.getInstance().apply { timeInMillis = b }
    return ca.get(Calendar.YEAR) == cb.get(Calendar.YEAR) && ca.get(Calendar.DAY_OF_YEAR) == cb.get(Calendar.DAY_OF_YEAR)
}

fun timeOf(ts: Long): String = SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(ts))

/** Chat-list style: time today, "Yesterday", otherwise a date. */
fun shortStamp(ts: Long): String {
    val now = System.currentTimeMillis()
    return when {
        sameDay(ts, now) -> timeOf(ts)
        sameDay(ts, now - 86_400_000L) -> "Yesterday"
        else -> SimpleDateFormat("dd/MM/yy", Locale.getDefault()).format(Date(ts))
    }
}

/** Header for a run of messages on one day. */
fun dayLabel(ts: Long): String {
    val now = System.currentTimeMillis()
    return when {
        sameDay(ts, now) -> "Today"
        sameDay(ts, now - 86_400_000L) -> "Yesterday"
        else -> SimpleDateFormat("d MMMM yyyy", Locale.getDefault()).format(Date(ts))
    }
}

fun isSameDay(a: Long, b: Long) = sameDay(a, b)

fun presenceText(p: Presence): String = when {
    p.online -> "online"
    p.lastSeen <= 0 -> ""
    else -> "last seen ${shortStamp(p.lastSeen).let { if (it.contains(':')) "today at $it" else it }}"
}
