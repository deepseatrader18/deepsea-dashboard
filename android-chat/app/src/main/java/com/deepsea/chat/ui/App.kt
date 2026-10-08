package com.deepsea.chat.ui

import androidx.activity.compose.BackHandler
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import com.deepsea.chat.ChatViewModel
import com.deepsea.chat.Screen

@Composable
fun App(vm: ChatViewModel, onExit: () -> Unit) {
    BackHandler {
        if (!vm.back()) onExit()
    }

    when (val screen = vm.screen) {
        Screen.Login -> LoginScreen(vm)
        Screen.ChatList -> ChatListScreen(vm)
        Screen.NewChat -> NewChatScreen(vm)
        Screen.NewGroup -> NewGroupScreen(vm)
        Screen.Profile -> ProfileScreen(vm)
        is Screen.Conversation -> ConversationScreen(vm, screen.chatId)
        is Screen.ChatInfo -> ChatInfoScreen(vm, screen.chatId)
    }

    // Login shows its own inline error; everywhere else errors pop up.
    val error = vm.error
    if (error != null && vm.screen != Screen.Login) {
        AlertDialog(
            onDismissRequest = { vm.error = null },
            confirmButton = { TextButton(onClick = { vm.error = null }) { Text("OK") } },
            text = { Text(error) },
        )
    }
}
