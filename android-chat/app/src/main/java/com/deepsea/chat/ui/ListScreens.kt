@file:OptIn(ExperimentalMaterial3Api::class)

package com.deepsea.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.deepsea.chat.ChatViewModel
import com.deepsea.chat.Screen
import com.deepsea.chat.data.Chat
import com.deepsea.chat.data.User
import kotlinx.coroutines.delay

@Composable
fun BrandTopBar(
    title: @Composable () -> Unit,
    onBack: (() -> Unit)? = null,
    actions: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {},
) {
    TopAppBar(
        title = title,
        navigationIcon = {
            if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        },
        actions = actions,
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            navigationIconContentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            actionIconContentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ),
    )
}

// ---------------- Chat list ----------------

@Composable
fun ChatListScreen(vm: ChatViewModel) {
    var menu by remember { mutableStateOf(false) }
    var searching by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            if (searching) {
                BrandTopBar(
                    title = { SearchField(query, { query = it }, "Search chats") },
                    onBack = { searching = false; query = "" },
                )
            } else {
                BrandTopBar(
                    title = { Text("DeepSea Chat", fontWeight = FontWeight.SemiBold) },
                    actions = {
                        IconButton(onClick = { searching = true }) { Icon(Icons.Default.Search, "Search") }
                        IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "Menu") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("New group") }, onClick = { menu = false; vm.navigate(Screen.NewGroup) })
                            DropdownMenuItem(text = { Text("Profile") }, onClick = { menu = false; vm.navigate(Screen.Profile) })
                            DropdownMenuItem(text = { Text("Log out") }, onClick = { menu = false; vm.logout() })
                        }
                    },
                )
            }
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { vm.navigate(Screen.NewChat) },
                containerColor = Brand.Green,
                contentColor = Color.White,
            ) { Icon(Icons.AutoMirrored.Filled.Chat, "New chat") }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (!vm.connected) {
                LinearProgressIndicator(Modifier.fillMaxWidth())
                Text(
                    "Connecting…",
                    Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant).padding(8.dp),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            val shown = vm.chats.filter { query.isBlank() || it.title.contains(query, ignoreCase = true) }
            if (shown.isEmpty()) {
                EmptyHint(
                    if (query.isBlank()) "No chats yet.\nTap the green button to start one."
                    else "No chats match \"$query\""
                )
            }
            LazyColumn(Modifier.fillMaxSize()) {
                items(shown, key = { it.id }) { chat -> ChatRow(vm, chat) }
            }
        }
    }
}

@Composable
private fun ChatRow(vm: ChatViewModel, chat: Chat) {
    val myId = vm.me?.id
    val typingName = vm.typing[chat.id]
    val last = chat.lastMessage
    val online = chat.peer?.let { vm.presenceOf(it).online } == true

    Row(
        Modifier
            .fillMaxWidth()
            .clickable { vm.navigate(Screen.Conversation(chat.id)) }
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(chat.title, online = online)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    chat.title, Modifier.weight(1f), fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                if (last != null) {
                    Text(
                        shortStamp(last.ts), style = MaterialTheme.typography.labelSmall,
                        color = if (chat.unread > 0) Brand.Green else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    )
                }
            }
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (typingName != null) {
                    Text(
                        if (chat.isGroup) "$typingName is typing…" else "typing…",
                        Modifier.weight(1f), color = Brand.Green, maxLines = 1,
                    )
                } else {
                    if (last != null && last.from == myId) {
                        TickIcon(last.tick(chat.members.size))
                        Spacer(Modifier.width(4.dp))
                    }
                    val preview = when {
                        last == null -> if (chat.isGroup) "Group created" else "Say hi 👋"
                        chat.isGroup && last.from != myId -> "${last.fromName}: ${last.text}"
                        else -> last.text
                    }
                    Text(
                        preview, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.65f),
                    )
                }
                if (chat.unread > 0) {
                    Badge(containerColor = Brand.Green, contentColor = Color.White) { Text("${chat.unread}") }
                }
            }
        }
    }
}

@Composable
fun SearchField(value: String, onChange: (String) -> Unit, placeholder: String) {
    TextField(
        value, onChange, Modifier.fillMaxWidth(),
        placeholder = { Text(placeholder) }, singleLine = true,
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Color.Transparent,
            unfocusedContainerColor = Color.Transparent,
            focusedTextColor = MaterialTheme.colorScheme.onPrimaryContainer,
            unfocusedTextColor = MaterialTheme.colorScheme.onPrimaryContainer,
            focusedPlaceholderColor = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.6f),
            unfocusedPlaceholderColor = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.6f),
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
            cursorColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ),
    )
}

@Composable
fun EmptyHint(text: String) {
    Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
        Text(
            text, style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

// ---------------- Contacts (new chat / new group) ----------------

@Composable
private fun rememberUserSearch(vm: ChatViewModel, query: String): List<User>? {
    var results by remember { mutableStateOf<List<User>?>(null) }
    LaunchedEffect(query) {
        delay(250)
        results = vm.searchUsers(query)
    }
    return results
}

@Composable
fun UserRow(vm: ChatViewModel, user: User, selected: Boolean = false, onClick: () -> Unit) {
    val p = vm.presenceOf(user)
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            Avatar(user.name, online = p.online)
            if (selected) {
                Icon(
                    Icons.Default.CheckCircle, null, tint = Brand.Green,
                    modifier = Modifier.align(Alignment.BottomEnd).size(20.dp).clip(CircleShape)
                        .background(MaterialTheme.colorScheme.surface),
                )
            }
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(user.name, fontWeight = FontWeight.SemiBold)
            Text(
                user.about.ifBlank { user.phone }, maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
            )
        }
    }
}

@Composable
fun NewChatScreen(vm: ChatViewModel) {
    var query by remember { mutableStateOf("") }
    val users = rememberUserSearch(vm, query)
    Scaffold(
        topBar = { BrandTopBar(title = { SearchField(query, { query = it }, "Search name or number") }, onBack = { vm.back() }) },
    ) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize()) {
            item {
                Row(
                    Modifier.fillMaxWidth().clickable { vm.navigate(Screen.NewGroup) }.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(48.dp).clip(CircleShape).background(Brand.Green), contentAlignment = Alignment.Center) {
                        Icon(Icons.Default.Group, null, tint = Color.White)
                    }
                    Spacer(Modifier.width(14.dp))
                    Text("New group", fontWeight = FontWeight.SemiBold)
                }
                HorizontalDivider()
                Text(
                    "People on DeepSea Chat", Modifier.padding(16.dp, 12.dp),
                    style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary,
                )
            }
            if (users != null && users.isEmpty()) item { EmptyHint("Nobody found. Ask your friends to install the app and sign up!") }
            items(users.orEmpty(), key = { it.id }) { user ->
                UserRow(vm, user) { if (!vm.busy) vm.startDirectChat(user) }
            }
        }
    }
}

@Composable
fun NewGroupScreen(vm: ChatViewModel) {
    var query by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    val selected = remember { mutableStateListOf<User>() }
    val users = rememberUserSearch(vm, query)

    Scaffold(
        topBar = { BrandTopBar(title = { Text("New group") }, onBack = { vm.back() }) },
        floatingActionButton = {
            if (selected.isNotEmpty() && name.isNotBlank()) {
                FloatingActionButton(
                    onClick = { if (!vm.busy) vm.createGroup(name.trim(), selected.toList()) },
                    containerColor = Brand.Green, contentColor = Color.White,
                ) { Icon(Icons.Default.Check, "Create group") }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            OutlinedTextField(
                name, { name = it }, Modifier.fillMaxWidth().padding(16.dp, 12.dp),
                label = { Text("Group name") }, singleLine = true,
            )
            if (selected.isNotEmpty()) {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(selected, key = { it.id }) { user ->
                        Column(
                            Modifier.clickable { selected.remove(user) },
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Box {
                                Avatar(user.name, size = 52.dp)
                                Icon(
                                    Icons.Default.Close, "Remove",
                                    Modifier.align(Alignment.BottomEnd).size(18.dp).clip(CircleShape)
                                        .background(MaterialTheme.colorScheme.outline),
                                    tint = Color.White,
                                )
                            }
                            Text(user.name.split(" ").first(), style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
                HorizontalDivider(Modifier.padding(top = 8.dp))
            }
            OutlinedTextField(
                query, { query = it }, Modifier.fillMaxWidth().padding(16.dp, 8.dp),
                placeholder = { Text("Search people to add") }, singleLine = true,
                leadingIcon = { Icon(Icons.Default.Search, null) },
            )
            LazyColumn(Modifier.fillMaxSize()) {
                items(users.orEmpty(), key = { it.id }) { user ->
                    val isSelected = selected.any { it.id == user.id }
                    UserRow(vm, user, selected = isSelected) {
                        if (isSelected) selected.removeAll { it.id == user.id } else selected.add(user)
                    }
                }
            }
        }
    }
}

// ---------------- Profile & chat info ----------------

@Composable
fun ProfileScreen(vm: ChatViewModel) {
    val me = vm.me
    var name by remember(me) { mutableStateOf(me?.name.orEmpty()) }
    var about by remember(me) { mutableStateOf(me?.about.orEmpty()) }
    Scaffold(topBar = { BrandTopBar(title = { Text("Profile") }, onBack = { vm.back() }) }) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Avatar(name.ifBlank { "?" }, size = 120.dp)
            OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("Name") }, singleLine = true)
            OutlinedTextField(about, { about = it }, Modifier.fillMaxWidth(), label = { Text("About") })
            OutlinedTextField(
                me?.phone.orEmpty(), {}, Modifier.fillMaxWidth(), label = { Text("Phone") }, readOnly = true, singleLine = true,
            )
            Button(
                onClick = { vm.updateProfile(name, about) },
                enabled = !vm.busy && name.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Save") }
        }
    }
}

@Composable
fun ChatInfoScreen(vm: ChatViewModel, chatId: String) {
    val chat = vm.chat(chatId)
    Scaffold(topBar = { BrandTopBar(title = { Text(if (chat?.isGroup == true) "Group info" else "Contact info") }, onBack = { vm.back() }) }) { padding ->
        if (chat == null) return@Scaffold
        LazyColumn(Modifier.padding(padding).fillMaxSize()) {
            item {
                Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Avatar(chat.title, size = 120.dp)
                    Spacer(Modifier.height(12.dp))
                    Text(chat.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                    val peer = chat.peer
                    if (peer != null) {
                        Text(peer.phone, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                        Spacer(Modifier.height(8.dp))
                        Text(peer.about, style = MaterialTheme.typography.bodyMedium)
                    } else {
                        Text("Group · ${chat.members.size} members", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                    }
                }
                HorizontalDivider()
            }
            if (chat.isGroup) {
                items(chat.members, key = { it.id }) { member ->
                    UserRow(vm, if (member.id == vm.me?.id) member.copy(name = "You") else member) {}
                }
                item {
                    Row(
                        Modifier.fillMaxWidth().clickable { vm.leaveGroup(chat.id) }.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ExitToApp, null, tint = MaterialTheme.colorScheme.error)
                        Spacer(Modifier.width(16.dp))
                        Text("Exit group", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
}
