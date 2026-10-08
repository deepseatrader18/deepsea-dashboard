package com.deepsea.chat

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.viewModelScope
import com.deepsea.chat.data.Api
import com.deepsea.chat.data.Chat
import com.deepsea.chat.data.Message
import com.deepsea.chat.data.Session
import com.deepsea.chat.data.User
import com.deepsea.chat.data.strings
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.UUID

sealed interface Screen {
    data object Login : Screen
    data object ChatList : Screen
    data object NewChat : Screen
    data object NewGroup : Screen
    data object Profile : Screen
    data class Conversation(val chatId: String) : Screen
    data class ChatInfo(val chatId: String) : Screen
}

data class Presence(val online: Boolean, val lastSeen: Long)

class ChatViewModel(app: Application) : AndroidViewModel(app) {
    val session = Session(app)
    private val api = Api(session)
    private val notifier = Notifier(app)

    // ---- navigation ----
    val backStack = mutableStateListOf<Screen>(if (session.loggedIn) Screen.ChatList else Screen.Login)
    val screen get() = backStack.last()

    fun navigate(to: Screen) {
        backStack.add(to)
        if (to is Screen.Conversation) openChat(to.chatId)
    }

    fun back(): Boolean {
        if (backStack.size <= 1) return false
        backStack.removeAt(backStack.lastIndex)
        return true
    }

    private fun resetTo(to: Screen) {
        backStack.clear()
        backStack.add(to)
    }

    // ---- state ----
    var me by mutableStateOf<User?>(null)
        private set
    var chats by mutableStateOf<List<Chat>>(emptyList())
        private set
    val messages = mutableStateMapOf<String, List<Message>>()
    val presence = mutableStateMapOf<String, Presence>()
    val typing = mutableStateMapOf<String, String>() // chatId -> who is typing
    var connected by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false)
        private set

    private val openChatId get() = (screen as? Screen.Conversation)?.chatId
    private val inForeground
        get() = ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)

    init {
        if (session.loggedIn) startSession()
    }

    fun chat(chatId: String) = chats.firstOrNull { it.id == chatId }

    fun presenceOf(user: User): Presence = presence[user.id] ?: Presence(user.online, user.lastSeen)

    // ---- auth ----
    fun login(serverUrl: String, phone: String, password: String) = authenticate(serverUrl) {
        api.login(phone, password)
    }

    fun register(serverUrl: String, phone: String, name: String, password: String) = authenticate(serverUrl) {
        api.register(phone, name, password)
    }

    private fun authenticate(serverUrl: String, block: suspend () -> Pair<String, User>) {
        session.serverUrl = serverUrl
        launchBusy {
            val (token, user) = block()
            session.token = token
            session.userId = user.id
            me = user
            resetTo(Screen.ChatList)
            startSession()
        }
    }

    fun logout() {
        socket?.close(1000, "logout")
        socket = null
        reconnectJob?.cancel()
        session.clear()
        me = null
        chats = emptyList()
        messages.clear()
        presence.clear()
        resetTo(Screen.Login)
    }

    fun updateProfile(name: String, about: String) = launchBusy {
        me = api.updateMe(name, about)
        back()
    }

    // ---- chats ----
    private fun startSession() {
        viewModelScope.launch {
            runCatching { me = api.me() }.onFailure {
                if (it.message?.contains("Not logged in") == true) {
                    logout()
                    return@launch
                }
            }
            refreshChats()
        }
        connect()
    }

    fun refreshChats() {
        viewModelScope.launch {
            runCatching { api.chats() }.onSuccess { chats = it }.onFailure { error = it.message }
        }
    }

    private fun openChat(chatId: String) {
        notifier.cancel(chatId)
        viewModelScope.launch {
            runCatching { api.messages(chatId) }.onSuccess { loaded ->
                val pending = messages[chatId].orEmpty().filter { it.pending }
                messages[chatId] = loaded + pending
            }
            markRead(chatId)
        }
    }

    fun startDirectChat(user: User) = launchBusy {
        val chat = api.openDirect(user.id)
        upsertChat(chat)
        backStack.removeAt(backStack.lastIndex) // replace the New Chat screen
        navigate(Screen.Conversation(chat.id))
    }

    fun createGroup(name: String, members: List<User>) = launchBusy {
        val chat = api.createGroup(name, members.map { it.id })
        upsertChat(chat)
        resetTo(Screen.ChatList)
        navigate(Screen.Conversation(chat.id))
    }

    fun leaveGroup(chatId: String) = launchBusy {
        api.leaveGroup(chatId)
        chats = chats.filterNot { it.id == chatId }
        messages.remove(chatId)
        resetTo(Screen.ChatList)
    }

    suspend fun searchUsers(query: String): List<User> =
        runCatching { api.users(query) }.getOrElse { error = it.message; emptyList() }

    fun send(chatId: String, text: String) {
        val trimmed = text.trim()
        val user = me ?: return
        if (trimmed.isEmpty()) return
        val clientId = UUID.randomUUID().toString()
        val local = Message(
            id = clientId, clientId = clientId, chatId = chatId, from = user.id, fromName = user.name,
            text = trimmed, ts = System.currentTimeMillis(), deliveredTo = emptyList(), readBy = emptyList(),
            pending = true,
        )
        messages[chatId] = messages[chatId].orEmpty() + local
        trySend(local)
    }

    private fun trySend(msg: Message) {
        socket?.send(
            JSONObject().put("type", "send").put("chatId", msg.chatId).put("text", msg.text)
                .put("clientId", msg.clientId).toString()
        )
    }

    private var lastTypingSent = 0L
    fun onTyping(chatId: String) {
        val now = System.currentTimeMillis()
        if (now - lastTypingSent < 2000) return
        lastTypingSent = now
        socket?.send(JSONObject().put("type", "typing").put("chatId", chatId).toString())
    }

    private fun markRead(chatId: String) {
        socket?.send(JSONObject().put("type", "read").put("chatId", chatId).toString())
        chats = chats.map { if (it.id == chatId) it.copy(unread = 0) else it }
    }

    fun onAppResumed() {
        openChatId?.let { markRead(it); notifier.cancel(it) }
        if (session.loggedIn && socket == null) connect()
    }

    private fun upsertChat(chat: Chat) {
        chats = (listOf(chat) + chats.filterNot { it.id == chat.id }).sortedByDescending { it.updatedAt }
    }

    private fun launchBusy(block: suspend () -> Unit) {
        viewModelScope.launch {
            busy = true
            error = null
            try {
                block()
            } catch (e: Exception) {
                error = e.message ?: "Something went wrong"
            } finally {
                busy = false
            }
        }
    }

    // ---- realtime ----
    private var socket: WebSocket? = null
    private var reconnectJob: Job? = null
    private var retryDelay = 1000L
    private val typingJobs = mutableMapOf<String, Job>()

    private fun connect() {
        val token = session.token ?: return
        val request = Request.Builder().url("${session.serverUrl}/ws?token=$token").build()
        socket = api.http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                viewModelScope.launch { onConnected(webSocket) }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                viewModelScope.launch { handleEvent(JSONObject(text)) }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                viewModelScope.launch { onDisconnected(webSocket, code) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                viewModelScope.launch { onDisconnected(webSocket, null) }
            }
        })
    }

    private fun onConnected(ws: WebSocket) {
        if (ws !== socket) return
        connected = true
        retryDelay = 1000L
        refreshChats()
        openChatId?.let { openChat(it) }
        // Flush anything typed while offline.
        messages.values.flatten().filter { it.pending }.forEach(::trySend)
    }

    private fun onDisconnected(ws: WebSocket, code: Int?) {
        if (ws !== socket) return
        socket = null
        connected = false
        if (code == 4001) { logout(); return }
        if (!session.loggedIn) return
        reconnectJob?.cancel()
        reconnectJob = viewModelScope.launch {
            delay(retryDelay)
            retryDelay = (retryDelay * 2).coerceAtMost(30_000L)
            if (socket == null && session.loggedIn) connect()
        }
    }

    private fun handleEvent(e: JSONObject) {
        when (e.optString("type")) {
            "message" -> {
                val msg = Message.from(e.getJSONObject("message"))
                val chat = Chat.from(e.getJSONObject("chat"))
                val existing = messages[msg.chatId].orEmpty()
                    .filterNot { it.id == msg.id || (msg.clientId != null && it.clientId == msg.clientId) }
                messages[msg.chatId] = (existing + msg).sortedBy { it.ts }
                typing.remove(msg.chatId)
                upsertChat(chat)
                if (msg.from != me?.id) {
                    if (openChatId == msg.chatId && inForeground) markRead(msg.chatId)
                    else notifier.show(chat, msg)
                }
            }
            "receipt" -> {
                val chatId = e.getString("chatId")
                val id = e.getString("messageId")
                val delivered = e.optJSONArray("deliveredTo").strings()
                val read = e.optJSONArray("readBy").strings()
                messages[chatId]?.let { list ->
                    messages[chatId] = list.map { if (it.id == id) it.copy(deliveredTo = delivered, readBy = read) else it }
                }
                chats = chats.map { c ->
                    val last = c.lastMessage
                    if (c.id == chatId && last != null && last.id == id)
                        c.copy(lastMessage = last.copy(deliveredTo = delivered, readBy = read))
                    else c
                }
            }
            "presence" -> presence[e.getString("userId")] =
                Presence(e.optBoolean("online"), e.optLong("lastSeen"))
            "typing" -> {
                val chatId = e.getString("chatId")
                typing[chatId] = e.optString("name")
                typingJobs[chatId]?.cancel()
                typingJobs[chatId] = viewModelScope.launch {
                    delay(3500)
                    typing.remove(chatId)
                }
            }
        }
    }

    override fun onCleared() {
        socket?.close(1000, null)
    }
}
