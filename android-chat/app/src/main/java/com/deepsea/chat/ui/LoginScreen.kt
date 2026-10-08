package com.deepsea.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.deepsea.chat.ChatViewModel

@Composable
fun LoginScreen(vm: ChatViewModel) {
    var registering by rememberSaveable { mutableStateOf(false) }
    var server by rememberSaveable { mutableStateOf(vm.session.serverUrl) }
    var phone by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var showServer by rememberSaveable { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Spacer(Modifier.height(32.dp))
        Box(
            Modifier.size(88.dp).clip(CircleShape).background(Brand.Green),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Default.Forum, null, tint = Color.White, modifier = Modifier.size(48.dp))
        }
        Text("DeepSea Chat", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(
            if (registering) "Create your account" else "Log in with your phone number",
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
        )
        Spacer(Modifier.height(8.dp))

        OutlinedTextField(
            phone, { phone = it }, Modifier.fillMaxWidth(),
            label = { Text("Phone number") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
        )
        if (registering) {
            OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("Your name") }, singleLine = true)
        }
        OutlinedTextField(
            password, { password = it }, Modifier.fillMaxWidth(),
            label = { Text("Password") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        )
        if (showServer) {
            OutlinedTextField(
                server, { server = it }, Modifier.fillMaxWidth(),
                label = { Text("Server URL") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            )
        }

        vm.error?.let { Text(it, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center) }

        Button(
            onClick = {
                if (registering) vm.register(server, phone, name, password) else vm.login(server, phone, password)
            },
            enabled = !vm.busy && phone.isNotBlank() && password.isNotBlank() && (!registering || name.isNotBlank()),
            modifier = Modifier.fillMaxWidth().height(50.dp),
        ) {
            if (vm.busy) CircularProgressIndicator(Modifier.size(22.dp), color = Color.White, strokeWidth = 2.dp)
            else Text(if (registering) "Create account" else "Log in")
        }
        if (vm.busy) {
            Text(
                "First connection can take up to a minute while the server wakes up…",
                style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center,
            )
        }
        TextButton(onClick = { registering = !registering; vm.error = null }) {
            Text(if (registering) "Already have an account? Log in" else "New here? Create an account")
        }
        TextButton(onClick = { showServer = !showServer }) {
            Text(if (showServer) "Hide server settings" else "Server settings", style = MaterialTheme.typography.bodySmall)
        }
    }
}
