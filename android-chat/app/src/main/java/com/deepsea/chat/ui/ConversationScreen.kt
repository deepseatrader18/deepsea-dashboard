@file:OptIn(ExperimentalMaterial3Api::class)

package com.deepsea.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.deepsea.chat.ChatViewModel
import com.deepsea.chat.Screen
import com.deepsea.chat.data.Chat
import com.deepsea.chat.data.Message

@Composable
fun ConversationScreen(vm: ChatViewModel, chatId: String) {
    val chat = vm.chat(chatId)
    val msgs = vm.messages[chatId].orEmpty()
    val myId = vm.me?.id
    var draft by rememberSaveable(chatId) { mutableStateOf("") }
    val listState = rememberLazyListState()
    val dark = isSystemInDarkTheme()

    // Keep the newest message in view (list is reversed, so index 0 is the bottom).
    LaunchedEffect(msgs.size) { if (msgs.isNotEmpty()) listState.animateScrollToItem(0) }

    Scaffold(
        contentWindowInsets = WindowInsets(0),
        topBar = {
            BrandTopBar(
                onBack = { vm.back() },
                title = {
                    Row(
                        Modifier.clickable { vm.navigate(Screen.ChatInfo(chatId)) },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(chat?.title ?: "?", size = 38.dp)
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(chat?.title ?: "", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                            val subtitle = chat?.let { subtitleFor(vm, it) }.orEmpty()
                            if (subtitle.isNotEmpty()) {
                                Text(subtitle, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .background(if (dark) Brand.ChatBgDark else Brand.ChatBgLight)
        ) {
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(),
                state = listState,
                reverseLayout = true,
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                val reversed = msgs.asReversed()
                itemsIndexed(reversed, key = { _, m -> m.clientId ?: m.id }) { index, msg ->
                    val older = reversed.getOrNull(index + 1)
                    Column {
                        if (older == null || !isSameDay(older.ts, msg.ts)) DayChip(dayLabel(msg.ts))
                        val showName = chat?.isGroup == true && msg.from != myId && older?.from != msg.from
                        MessageBubble(msg, mine = msg.from == myId, memberCount = chat?.members?.size ?: 2, showName = showName, dark = dark)
                    }
                }
            }
            InputBar(
                draft,
                onChange = {
                    draft = it
                    if (it.isNotBlank()) vm.onTyping(chatId)
                },
                onSend = {
                    vm.send(chatId, draft)
                    draft = ""
                },
            )
        }
    }
}

private fun subtitleFor(vm: ChatViewModel, chat: Chat): String {
    vm.typing[chat.id]?.let { return if (chat.isGroup) "$it is typing…" else "typing…" }
    if (!vm.connected) return "connecting…"
    val peer = chat.peer
    return if (chat.isGroup || peer == null) {
        chat.members.joinToString(", ") { if (it.id == vm.me?.id) "You" else it.name }
    } else {
        presenceText(vm.presenceOf(peer))
    }
}

@Composable
private fun DayChip(label: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
        Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f), shadowElevation = 1.dp) {
            Text(label, Modifier.padding(horizontal = 10.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun MessageBubble(msg: Message, mine: Boolean, memberCount: Int, showName: Boolean, dark: Boolean) {
    val bubbleColor = when {
        mine && dark -> Brand.OutBubbleDark
        mine -> Brand.OutBubbleLight
        dark -> Color(0xFF202C33)
        else -> Color.White
    }
    val shape = if (mine) RoundedCornerShape(12.dp, 2.dp, 12.dp, 12.dp) else RoundedCornerShape(2.dp, 12.dp, 12.dp, 12.dp)
    Box(Modifier.fillMaxWidth(), contentAlignment = if (mine) Alignment.CenterEnd else Alignment.CenterStart) {
        Surface(
            color = bubbleColor,
            shape = shape,
            shadowElevation = 1.dp,
            modifier = Modifier.widthIn(min = 80.dp, max = 300.dp),
        ) {
            Column(Modifier.padding(start = 10.dp, end = 8.dp, top = 6.dp, bottom = 4.dp)) {
                if (showName) {
                    Text(
                        msg.fromName, color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold,
                    )
                }
                Text(msg.text, style = MaterialTheme.typography.bodyLarge)
                Row(Modifier.align(Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        timeOf(msg.ts), style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f),
                    )
                    if (mine) {
                        Spacer(Modifier.width(3.dp))
                        TickIcon(msg.tick(memberCount))
                    }
                }
            }
        }
    }
}

@Composable
private fun InputBar(value: String, onChange: (String) -> Unit, onSend: () -> Unit) {
    val dark = isSystemInDarkTheme()
    Row(
        Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .imePadding()
            .padding(6.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        TextField(
            value, onChange,
            Modifier.weight(1f),
            placeholder = { Text("Message") },
            maxLines = 5,
            shape = RoundedCornerShape(24.dp),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = if (dark) Color(0xFF202C33) else Color.White,
                unfocusedContainerColor = if (dark) Color(0xFF202C33) else Color.White,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
            ),
        )
        Spacer(Modifier.width(6.dp))
        FilledIconButton(
            onClick = onSend,
            enabled = value.isNotBlank(),
            modifier = Modifier.size(52.dp),
            shape = CircleShape,
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = Brand.Teal, contentColor = Color.White,
                disabledContainerColor = Brand.Teal.copy(alpha = 0.6f), disabledContentColor = Color.White,
            ),
        ) {
            Icon(Icons.AutoMirrored.Filled.Send, "Send")
        }
    }
}
