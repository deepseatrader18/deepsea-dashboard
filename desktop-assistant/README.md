# DeepSea Desktop Assistant (local voice control)

यह एक अलग, आपके **laptop पर locally चलने वाला** Python script है — यह cloud dashboard का हिस्सा नहीं है और Render पर deploy नहीं होता। इसे हर बार आपको खुद अपने laptop पर चलाना होगा।

## अभी क्या कर सकता है

- "DeepSea" बोलने पर जागता है (wake word)
- बोलकर website खोलना: YouTube, Forex Factory, Gmail, DeepSea dashboard
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

- सिर्फ ऊपर बताई गई websites खोल सकता है और scroll कर सकता है — कहीं click करना, type करना, या trade लगाना अभी शामिल नहीं है (जानबूझकर, सुरक्षा के लिए — पहले basic चीज़ें भरोसे से चलनी चाहिए)।
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
