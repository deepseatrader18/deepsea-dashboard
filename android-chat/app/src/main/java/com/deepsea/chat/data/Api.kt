package com.deepsea.chat.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class ApiException(message: String) : Exception(message)

/** Thin REST client for chat-server. Every call runs on the IO dispatcher. */
class Api(private val session: Session) {
    val http: OkHttpClient = OkHttpClient.Builder()
        // Render's free tier can take ~60s to wake up.
        .connectTimeout(90, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()

    private val json = "application/json".toMediaType()

    private suspend fun call(method: String, path: String, body: JSONObject? = null): String =
        withContext(Dispatchers.IO) {
            val builder = Request.Builder().url(session.serverUrl + path)
            session.token?.let { builder.header("Authorization", "Bearer $it") }
            when (method) {
                "GET" -> builder.get()
                else -> builder.method(method, (body ?: JSONObject()).toString().toRequestBody(json))
            }
            val response = try {
                http.newCall(builder.build()).execute()
            } catch (e: Exception) {
                throw ApiException("Can't reach server: ${e.message}")
            }
            response.use {
                val text = it.body?.string().orEmpty()
                if (!it.isSuccessful) {
                    val error = runCatching { JSONObject(text).optString("error") }.getOrNull()
                    throw ApiException(error?.takeIf { e -> e.isNotBlank() } ?: "Server error ${it.code}")
                }
                text
            }
        }

    suspend fun register(phone: String, name: String, password: String): Pair<String, User> {
        val o = JSONObject(call("POST", "/api/register", JSONObject().put("phone", phone).put("name", name).put("password", password)))
        return o.getString("token") to User.from(o.getJSONObject("user"))
    }

    suspend fun login(phone: String, password: String): Pair<String, User> {
        val o = JSONObject(call("POST", "/api/login", JSONObject().put("phone", phone).put("password", password)))
        return o.getString("token") to User.from(o.getJSONObject("user"))
    }

    suspend fun me(): User = User.from(JSONObject(call("GET", "/api/me")))

    suspend fun updateMe(name: String, about: String): User =
        User.from(JSONObject(call("PUT", "/api/me", JSONObject().put("name", name).put("about", about))))

    suspend fun users(query: String): List<User> =
        JSONArray(call("GET", "/api/users?q=" + URLEncoder.encode(query, "UTF-8"))).objects().map(User::from)

    suspend fun chats(): List<Chat> = JSONArray(call("GET", "/api/chats")).objects().map(Chat::from)

    suspend fun openDirect(userId: String): Chat =
        Chat.from(JSONObject(call("POST", "/api/chats/direct", JSONObject().put("userId", userId))))

    suspend fun createGroup(name: String, memberIds: List<String>): Chat =
        Chat.from(JSONObject(call("POST", "/api/chats/group", JSONObject().put("name", name).put("memberIds", JSONArray(memberIds)))))

    suspend fun leaveGroup(chatId: String) {
        call("POST", "/api/chats/$chatId/leave")
    }

    suspend fun messages(chatId: String): List<Message> =
        JSONArray(call("GET", "/api/chats/$chatId/messages")).objects().map(Message::from)
}
