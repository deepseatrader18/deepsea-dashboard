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
