# DeepSea Desktop Assistant (local voice control)

यह एक अलग, आपके **laptop पर locally चलने वाला** Python script है — यह cloud dashboard का हिस्सा नहीं है और Render पर deploy नहीं होता। इसे हर बार आपको खुद अपने laptop पर चलाना होगा।

## अभी क्या कर सकता है

- "DeepSea" बोलने पर जागता है (wake word)
- बोलकर website खोलना: YouTube, Forex Factory, Gmail, DeepSea dashboard
- **Apps kholna**: Chrome, Edge, Notepad, Calculator, Paint, File Explorer, Task Manager, Spotify, WhatsApp, VS Code — जैसे "DeepSea, Chrome kholo"
- **Active window band karna**: "ye band karo" / "close this"
- **Media control**: volume up/down/mute, play/pause, next/previous track
- **System actions**: screenshot lena (Desktop पर save होता है), laptop lock करना
- **Shutdown/Restart**: पूछने पर एक confirmation step है ("haan" बोलना ज़रूरी है) — गलती से mic कुछ गलत सुन ले तो भी laptop बंद ना हो
- **Typing**: "DeepSea, type karo <jo bhi bolna hai>" — जो भी बोलोगे वो active field में type हो जाएगा
- **Clicking**: "click karo" / "double click" / "right click" — mouse जहाँ है वहीं click होता है (आवाज़ से किसी specific button पर click नहीं हो सकता, mouse पहले वहाँ ले जाना होगा)
- "scroll down" / "scroll up" बोलकर current page scroll करना

## Setup (Windows)

1. Python install करें (अगर पहले से नहीं है): https://www.python.org/downloads/ — install करते वक़्त "Add Python to PATH" ज़रूर टिक करें।
2. यह repo अपने laptop पर clone/download करें, फिर `desktop-assistant` folder में जाएं:
   ```
   cd desktop-assistant
   ```
3. Libraries install करें:
   ```
   pip install -r requirements.txt
   ```
   अगर `PyAudio` install करते वक़्त error आए (Windows पर कभी-कभी होता है), तो यह try करें:
   ```
   pip install pipwin
   pipwin install pyaudio
   ```
4. Assistant चलाएं:
   ```
   python assistant.py
   ```
5. Terminal में "Ready. Say 'DeepSea'..." दिखे तो बोलकर test करें: **"DeepSea"** फिर कुछ सेकंड रुककर **"YouTube kholo"** या **"Forex factory kholo"**।

बंद करने के लिए terminal में `Ctrl+C` दबाएं।

## सीमाएं (अभी के लिए)

- ऊपर बताए गए fixed commands ही समझता है (jo pehle se list mein hain) — ये कोई general AI agent नहीं है jo "jo bhi bolo wo kar de"; sirf yahan diye gaye specific patterns match karta hai. Kisi bhi naye tarah ke command ke liye code mein naya pattern add karna padega.
- Kisi specific screen element ko naam se dhoond ke click/type nahi kar sakta (jaise "Save button dabao") — sirf current mouse position par click karta hai, aur jo bolo wahi type karta hai jahan cursor pehle se hai.
- Microphone आपके laptop का इस्तेमाल होता है, हर बार terminal खुला रखना होगा जब तक चलाना है।
- Internet चाहिए (आवाज़ को टेक्स्ट में बदलने के लिए Google का free service इस्तेमाल होता है)।

## Double-clap trigger + welcome voice (optional, Jarvis-style)

Wake word वाले feature के अलावा, अब एक double-clap trigger भी है: दो बार जल्दी-जल्दी ताली बजाओ तो
Spotify (अगर set किया हो), DeepSea dashboard browser में खुलता है, और ElevenLabs की आवाज़ में एक welcome
line बोली जाती है। यह हर terminal session में सिर्फ एक बार चलता है — दोबारा चलाने के लिए `Ctrl+C` करके
फिर से `python assistant.py` run करें।

### Setup

1. `requirements.txt` दोबारा install करें (नई libraries आई हैं: `numpy`, `sounddevice`, `elevenlabs`, `python-dotenv`):
   ```
   pip install -r requirements.txt
   ```
2. [ElevenLabs](https://elevenlabs.io) पर account बनाएं (free भी चलेगा), फिर:
   - **API key:** Developers → API Keys → Create Key
   - **Voice ID:** Voices → अपनी पसंद की voice खोलें → Copy Voice ID
3. `desktop-assistant` folder में `.env.example` की copy बनाकर नाम `.env` रखें, और अपनी असली values भरें:
   ```
   cp .env.example .env
   ```
   **Warning:** `.env` file कभी commit या share मत करें, इसमें आपकी private API key है (यह पहले से `.gitignore` में है)।
4. `python assistant.py` फिर से चलाएं। Terminal में "Listening for a double clap..." दिखेगा।

### Customize (`.env` में, code बदले बिना)

| Setting | क्या करता है |
| --- | --- |
| `CLAP_ENABLED` | `false` करने पर clap-trigger पूरी तरह बंद हो जाता है (default `true`) |
| `CLAP_SONG_URI` | Clap पर खुलने वाला Spotify/YouTube link (खाली छोड़ने पर कुछ नहीं खुलता) |
| `CLAP_DASHBOARD_URL` | Clap पर browser में कौन सा URL खुले (default DeepSea dashboard) |
| `CLAP_WELCOME_PHRASE` | ElevenLabs जो line बोलेगा |
| `CLAP_SPIKE_RATIO` | कम = ताली पकड़ना आसान, ज़्यादा = false trigger कम (default `6.0`) |

### Troubleshooting

| Problem | Fix |
| --- | --- |
| Claps पर कुछ नहीं होता | Mic के पास से ताली बजाएं, `CLAP_SPIKE_RATIO` थोड़ा कम करें (जैसे `6.0` से `4.0`) |
| Welcome voice नहीं बोलता | `.env` में `ELEVENLABS_API_KEY` और `ELEVENLABS_VOICE_ID` सही check करें, terminal restart करें |
| "Clap listener disabled" दिखे | Mic किसी और app में exclusive mode में इस्तेमाल हो रहा है, वो app बंद करके फिर से try करें |

## WhatsApp bridge (optional) — फोन से DeepSea से बात करना

ये एक अलग Node.js script (`whatsapp-bridge.js`) है, जो आपके अपने WhatsApp account से
"Message Yourself" chat में **"deepsea"** से शुरू होने वाला message सुनता है, और dashboard
के DeepSea assistant (वही जो Trading Room mic में बोलता है) से reply लाकर वापस WhatsApp
पर भेज देता है। इसमें कोई third-party account (Twilio वगैरह) नहीं चाहिए — सीधे आपके
WhatsApp से QR code scan करके connect होता है, WhatsApp Web जैसे।

**ज़रूरी बात:** यह [WhatsApp की official terms के against](https://www.whatsapp.com/legal/terms-of-service)
है (unofficial automation), इसलिए बहुत कम chance है लेकिन number restrict होने का risk
रहता है। सिर्फ अपने personal use के लिए, कम frequency में इस्तेमाल करें।

### Setup

1. Node.js install करें (अगर पहले से नहीं है): https://nodejs.org — LTS version लें।
2. `desktop-assistant` folder में dependencies install करें:
   ```
   npm install
   ```
3. `.env` में (ऊपर वाले `.env.example` से copy किया हुआ) ये दो values भरें:
   - `WHATSAPP_BRIDGE_TOKEN` — कोई भी random string (जैसे `myDs2026SecretXYZ`) — ये password जैसा है
   - `DASHBOARD_CHAT_URL` — default already सही है (`https://deepsea-dashboard.onrender.com`)
4. **यही `WHATSAPP_BRIDGE_TOKEN` value** Render dashboard पर `deepsea-dashboard` service के
   environment variable के रूप में भी set करनी होगी (Render dashboard → deepsea-dashboard →
   Environment → `WHATSAPP_BRIDGE_TOKEN` add करें, same value) — दोनों तरफ same string होना
   ज़रूरी है, वरना bridge काम नहीं करेगा।
5. Bridge चलाएं:
   ```
   npm start
   ```
6. Terminal में एक QR code दिखेगा — अपने फोन पर WhatsApp खोलें → Settings → Linked Devices →
   Link a Device → उस QR code को scan करें। ये सिर्फ **एक बार** करना है, session save हो जाता है।
7. "DeepSea WhatsApp bridge is ready" दिखने के बाद, अपने फोन से WhatsApp खोलें, khud ko
   message करें ("Message Yourself" — search bar में अपना नाम type करने पर ऊपर दिखता है),
   और likhein:
   ```
   deepsea gold ka trade plan batao
   ```
   कुछ second में DeepSea उसी chat में reply karegi.

Band karne ke liye terminal mein `Ctrl+C` dabayein. Dobara chalane par QR scan nahi karna
padega (jab tak `.wwebjs_auth` folder delete na karo).

### Customize (`.env` में)

| Setting | क्या करता है |
| --- | --- |
| `WHATSAPP_BRIDGE_TOKEN` | Bridge aur dashboard ke beech shared secret — dono jagah same hona chahiye |
| `DASHBOARD_CHAT_URL` | Dashboard ka URL jaha reply lene ke liye call jata hai |
| `ALLOWED_WHATSAPP_CHAT_ID` | Default "Message Yourself" chat use hoti hai; kisi specific number se chalana ho to yaha `91XXXXXXXXXX@c.us` format mein daalein |
