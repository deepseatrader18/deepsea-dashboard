package com.deepsea.chat.data

import org.json.JSONArray
import org.json.JSONObject

data class User(
    val id: String,
    val phone: String,
    val name: String,
    val about: String,
    val online: Boolean,
    val lastSeen: Long,
) {
    companion object {
        fun from(o: JSONObject) = User(
            id = o.getString("id"),
            phone = o.optString("phone"),
            name = o.optString("name"),
            about = o.optString("about"),
            online = o.optBoolean("online"),
            lastSeen = o.optLong("lastSeen"),
        )
    }
}

enum class Tick { PENDING, SENT, DELIVERED, READ }

data class Message(
    val id: String,
    val clientId: String?,
    val chatId: String,
    val from: String,
    val fromName: String,
    val text: String,
    val ts: Long,
    val deliveredTo: List<String>,
    val readBy: List<String>,
    val pending: Boolean = false,
) {
    /** Ticks as the sender sees them: grey ✓, grey ✓✓, blue ✓✓. */
    fun tick(memberCount: Int): Tick {
        if (pending) return Tick.PENDING
        val others = (memberCount - 1).coerceAtLeast(1)
        return when {
            readBy.size >= others -> Tick.READ
            deliveredTo.size >= others -> Tick.DELIVERED
            else -> Tick.SENT
        }
    }

    companion object {
        fun from(o: JSONObject) = Message(
            id = o.getString("id"),
            clientId = if (o.isNull("clientId")) null else o.optString("clientId"),
            chatId = o.getString("chatId"),
            from = o.getString("from"),
            fromName = o.optString("fromName"),
            text = o.optString("text"),
            ts = o.optLong("ts"),
            deliveredTo = o.optJSONArray("deliveredTo").strings(),
            readBy = o.optJSONArray("readBy").strings(),
        )
    }
}

data class Chat(
    val id: String,
    val type: String,
    val title: String,
    val peer: User?,
    val members: List<User>,
    val lastMessage: Message?,
    val unread: Int,
    val updatedAt: Long,
) {
    val isGroup get() = type == "group"

    companion object {
        fun from(o: JSONObject) = Chat(
            id = o.getString("id"),
            type = o.optString("type"),
            title = o.optString("title"),
            peer = o.optJSONObject("peer")?.let(User::from),
            members = o.optJSONArray("members").objects().map(User::from),
            lastMessage = o.optJSONObject("lastMessage")?.let(Message::from),
            unread = o.optInt("unread"),
            updatedAt = o.optLong("updatedAt"),
        )
    }
}

fun JSONArray?.strings(): List<String> =
    if (this == null) emptyList() else List(length()) { getString(it) }

fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else List(length()) { getJSONObject(it) }
