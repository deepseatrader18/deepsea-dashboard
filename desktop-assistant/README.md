# DeepSea Desktop Assistant (local voice control)

यह एक अलग, आपके **laptop पर locally चलने वाला** Python script है — यह cloud dashboard का हिस्सा नहीं है और Render पर deploy नहीं होता। इसे हर बार आपको खुद अपने laptop पर चलाना होगा।

## अभी क्या कर सकता है

- "DeepSea" बोलने पर जागता है (wake word)
- बोलकर website खोलना: YouTube, Forex Factory, Gmail, DeepSea dashboard
- **Apps kholna**: Chrome, Edge, Notepad, Calculator, Paint, File Explorer, Task Manager, Spotify, WhatsApp, VS Code — जैसे "DeepSea, Chrome kholo"
- **Active window band karna**: "ye band karo" / "close this"
- **Media control**: volume up/down/mute, play/pause, next/previous track
- **System actions**: screenshot lena (Desktop पर save होता है), laptop lock करना, shutdown/restart
- **Typing**: "DeepSea, type karo <jo bhi bolna hai>" — जो भी बोलोगे वो active field में type हो जाएगा
- **Clicking**: "click karo" / "double click" / "right click" — mouse जहाँ है वहीं click होता है (आवाज़ से किसी specific button पर click नहीं हो सकता, mouse पहले वहाँ ले जाना होगा)
- "scroll down" / "scroll up" बोलकर current page scroll करना

**हर command confirm होता है, execute होने से पहले:** wake word ("DeepSea") ke baad jo bhi command bolo, assistant use wapas dohrayega ("Aapne bola: ... — pakka?") aur ek **beep** bajega — usi waqt bolo **"haan"** ya **"confirm karo"** (~8 second ke andar), tabhi wo command chalegi. Kuch aur bolo ya chup raho to wo command cancel ho jata hai, kuch nahi hota. Ye galti se — mic ne kuch aur sun liya, ya galat samjha — kisi bhi action ko rokta hai.

**Wake word ("DeepSea") thoda alag-alag sunaayi de sakta hai** — Indian accent mein Google ka speech-to-text kabhi "Gypsy", "Tipsy", "Deepti", "Pepsi", "DC" jaisa sun leta hai. Ye sab bhi wake word list mein add hain, isliye phir bhi kaam kar jayega — lekin best tarika hai "**Deep... Sea**" ko thoda pause ke saath, clearly, mic ke paas bolna.

**Naya mis-hearing mile to khud add kar sakte ho, code change nahi karna:** terminal mein "Heard: ..." line dekho jab tumne "DeepSea" bola tha lekin wo pakad nahi paaya — jo bhi wahan print hua hai (jaise "pepsi" ya "dc"), usko `.env` mein `WAKE_WORDS_EXTRA=` ke aage comma se add kar do (jaise `WAKE_WORDS_EXTRA=xyz,abc`), assistant restart karo.

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
Spotify (अगर set किया हो), DeepSea dashboard browser में खुलता है, और Microsoft Edge की free आवाज़ में एक
welcome line बोली जाती है (साथ ही हर command confirm करते वक़्त भी यही आवाज़ बोलती है)। यह हर terminal
session में सिर्फ एक बार चलता है — दोबारा चलाने के लिए `Ctrl+C` करके फिर से `python assistant.py` run करें।

आवाज़ के लिए **Microsoft Edge TTS** (`edge-tts`) इस्तेमाल होता है — बिल्कुल free, unlimited, कोई API key
या signup नहीं चाहिए (ElevenLabs से switch किया गया क्योंकि उसका free plan API से हर voice block कर देता है)।

### Setup

1. `requirements.txt` दोबारा install करें (नई libraries आई हैं: `numpy`, `sounddevice`, `edge-tts`, `playsound`, `python-dotenv`):
   ```
   pip install -r requirements.txt
   ```
2. Kuch aur karne ki zaroorat nahi — koi account ya API key nahi chahiye, ye seedha chalega.
3. (Optional) Agar voice badalni ho, `desktop-assistant` folder में `.env.example` की copy बनाकर नाम `.env` रखें:
   ```
   cp .env.example .env
   ```
   और `EDGE_TTS_VOICE` line में koi doosra voice naam daal do (list dekhne ke liye `edge-tts --list-voices` chalao).
4. `python assistant.py` फिर से चलाएं। Terminal में "Listening for a double clap..." दिखेगा।

### Customize (`.env` में, code बदले बिना)

| Setting | क्या करता है |
| --- | --- |
| `EDGE_TTS_VOICE` | कौन सी आवाज़ बोलेगी (default `en-IN-NeerjaNeural`) — list ke liye `edge-tts --list-voices` |
| `CLAP_ENABLED` | `false` करने पर clap-trigger पूरी तरह बंद हो जाता है (default `true`) |
| `CLAP_SONG_URI` | Clap पर खुलने वाला Spotify/YouTube link (खाली छोड़ने पर कुछ नहीं खुलता) |
| `CLAP_DASHBOARD_URL` | Clap पर browser में कौन सा URL खुले (default DeepSea dashboard) |
| `CLAP_WELCOME_PHRASE` | Edge TTS जो line बोलेगा |
| `CLAP_SPIKE_RATIO` | कम = ताली पकड़ना आसान, ज़्यादा = false trigger कम (default `6.0`) |

### Troubleshooting

| Problem | Fix |
| --- | --- |
| Claps पर कुछ नहीं होता | Mic के पास से ताली बजाएं, `CLAP_SPIKE_RATIO` थोड़ा कम करें (जैसे `6.0` से `4.0`) |
| Welcome voice नहीं बोलता | Internet connection check करें (edge-tts को internet चाहिए), terminal restart करें |
| "Clap listener disabled" दिखे | Mic किसी और app में exclusive mode में इस्तेमाल हो रहा है, वो app बंद करके फिर से try करें |

## Dashboard ke mic se laptop control (bina WhatsApp ke)

Dashboard (`dashboard.html`, jahan aap login karke "DeepSea" bolte ho) ka mic ab
seedha aapke laptop ko bhi control kar sakta hai — Chrome kholna, lock karna,
gana sunao, wagaira — bilkul waisa hi jaisa `assistant.py` ke terminal mic se
hota hai, bas ab browser se.

**Zaroori:** `python assistant.py` aapke laptop par chalna chahiye (jis laptop
par aap dashboard khol rahe ho, usi par) — dashboard page seedha
`http://127.0.0.1:8765` par (assistant.py ka apna local server) call karta hai,
kyunki Render (jahan dashboard host hai) aapke laptop tak nahi pahunch sakta.
Agar `assistant.py` band hai, to mic pehle jaisa hi normal chat/browser-tab
behavior karta rahega — kuch break nahi hoga.

**Use karna:** dashboard par jaakar "DeepSea" boliye jaise normal karte ho,
fir command boliye (jaise "chrome kholo" ya "gana sunao"). Agar wo ek laptop
command hai, dashboard bolegi "... pakka? haan boliye" — aap bas **"haan"**
boliye (60 second ke andar), command laptop par chal jayegi.

### Kisi doosri jagah se (dusre laptop/city se) apna ghar wala laptop control karna

Ye bhi automatic hai — koi alag setting nahi chahiye. Agar aap kisi **doosre laptop
ya city** se dashboard kholte ho (aapka ghar wala laptop ON hai aur uspar
`python assistant.py` chal raha hai), to dashboard pehle apne hi (jis laptop se
aap abhi dashboard khol rahe ho) 127.0.0.1 try karta hai — wo fail hoga
(kyunki wahan assistant.py nahi chal raha) — fir apne aap **Render ke through
ghar wale laptop tak command relay kar deta hai**. Isme thoda zyada time
(kuch second) lagta hai kyunki dono taraf (aapka browser aur ghar wala
laptop) Render se har ~8 second mein check karte hain, seedha connection
nahi hota.

**Zaroori:** ghar wale laptop par `python assistant.py` chalna zaroori hai
(terminal khula, internet on) — tabhi wo Render se poll kar paayega. Agar
wo band hai, dashboard bolegi "aapka laptop abhi online nahi lag raha".

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
| `ASSISTANT_LOCAL_PORT` / `LOCAL_ASSISTANT_URL` | Laptop-command feature (neeche dekhein) ke liye port — sirf tab badlein agar `8765` pehle se kisi aur cheez ne le rakha ho |

## Phone se laptop control (WhatsApp ke through)

WhatsApp bridge chalu ho to, aap wahi laptop commands (Chrome kholna, lock karna,
media control, wagaira — jo voice se `assistant.py` samajhta hai) apne **phone se
bhi** de sakte hain, sirf typing karke, bina laptop ke paas gaye.

**Zaroori:** dono script — `python assistant.py` (voice wala) aur `npm start`
(WhatsApp bridge) — laptop par **ek saath chalne** chahiye alag-alag terminal
windows mein. Bridge phone se command leke localhost par assistant.py ko bhejta
hai; agar assistant.py band hai, to bridge apne aap normal dashboard chat wapas
try karega.

**Use karna:** phone se "Message Yourself" chat mein likhein, jaise:
```
deepsea chrome kholo
```
DeepSea WhatsApp par wapas puchegi: `Aapne bola: "chrome kholo". chrome kholna — pakka? 60 second ke andar "haan" likho.`
Aap sirf likhein:
```
haan
```
60 second ke andar, tabhi wo command laptop par chalegi. Kuch aur likho ya chup raho to cancel ho jata hai — bilkul voice wale confirm jaisa hi safety gate hai.

Agar text koi laptop command nahi hai (jaise "gold ka trade plan batao"), to bridge use seedha dashboard ke DeepSea assistant ko bhej deta hai, jaisa pehle karta tha.
