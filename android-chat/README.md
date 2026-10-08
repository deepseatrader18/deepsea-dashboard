# DeepSea Chat (Android)

A WhatsApp-style messaging app: Kotlin + Jetpack Compose, talking to
`chat-server/` (Node + WebSocket).

## Features
- Sign up / log in with phone number + password
- One-to-one chats and group chats (create, view members, exit)
- Realtime messages over WebSocket, with offline queue (sent when you reconnect)
- Ticks: 🕓 sending, ✓ sent, ✓✓ delivered, blue ✓✓ read
- "typing…", online / last seen
- Unread badges, chat search, notifications for new messages
- Light and dark theme, WhatsApp-like colours

## Get the APK
GitHub Actions (`.github/workflows/android-chat.yml`) builds it on every push
that touches `android-chat/`:
- any branch → Actions → latest "Android Chat APK" run → artifact `DeepSeaChat-apk`
- `main` → Releases → **DeepSea Chat (latest)** → `DeepSeaChat.apk`

Install it on the phone (allow "Install unknown apps" when asked).

## Server
Deploy the `deepsea-chat` service from `render.yaml` (Render → Blueprint
sync). Its URL is assumed to be `https://deepsea-chat.onrender.com`; if Render
gives a different one, change it from **Server settings** on the login screen
(or `DEFAULT_SERVER_URL` in `app/build.gradle.kts`). Set `REDIS_URL` on the
service, otherwise accounts and chats are lost whenever the free instance
restarts.

Run locally: `cd chat-server && npm install && npm start` (port 3100), then use
`http://<your-PC-LAN-IP>:3100` as the server URL in the app.

## Limits (v1)
- Text only — no photos, voice notes or calls yet
- No push notifications when the app is fully closed (needs Firebase Cloud
  Messaging); notifications work while the app is running in the background
- Messages are not end-to-end encrypted
