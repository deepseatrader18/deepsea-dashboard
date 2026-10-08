package com.deepsea.chat.data

import android.content.Context
import com.deepsea.chat.BuildConfig

/** Login token, logged-in user id and server URL, kept in SharedPreferences. */
class Session(context: Context) {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString("serverUrl", null) ?: BuildConfig.DEFAULT_SERVER_URL
        set(value) = prefs.edit().putString("serverUrl", value.trim().trimEnd('/')).apply()

    var token: String?
        get() = prefs.getString("token", null)
        set(value) = prefs.edit().putString("token", value).apply()

    var userId: String?
        get() = prefs.getString("userId", null)
        set(value) = prefs.edit().putString("userId", value).apply()

    val loggedIn get() = token != null && userId != null

    fun clear() {
        prefs.edit().remove("token").remove("userId").apply()
    }
}
