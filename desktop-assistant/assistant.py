import os
import re
import threading
import time
import webbrowser
from collections import deque

import numpy as np
import pyautogui
import sounddevice as sd
import speech_recognition as sr
from dotenv import load_dotenv

load_dotenv()

WAKE_WORDS = ['deepsea', 'deep sea', 'deepsee', 'dipsi', 'dipsy']

# Order matters: more specific patterns should come before broader ones.
SITE_COMMANDS = {
    r'\bforex\s*factory\b': 'https://www.forexfactory.com',
    r'\byoutube\b': 'https://www.youtube.com',
    r'\bgmail\b': 'https://mail.google.com',
    r'\bdeepsea dashboard\b|\bdashboard\b': 'https://deepsea-dashboard.onrender.com',
}

SCROLL_AMOUNT = 600

# --- Double-clap trigger (Jarvis-style), optional ---------------------------
CLAP_ENABLED = os.getenv('CLAP_ENABLED', 'true').lower() != 'false'
CLAP_SONG_URI = os.getenv('CLAP_SONG_URI', '')
CLAP_DASHBOARD_URL = os.getenv('CLAP_DASHBOARD_URL', 'https://deepsea-dashboard.onrender.com')
CLAP_WELCOME_PHRASE = os.getenv('CLAP_WELCOME_PHRASE', 'Wake up. Welcome home, sir. DeepSea dashboard is ready.')
CLAP_SPIKE_RATIO = float(os.getenv('CLAP_SPIKE_RATIO', '6.0'))
CLAP_WINDOW_SECONDS = 0.35
CLAP_MIN_GAP_SECONDS = 0.05
CLAP_SAMPLE_RATE = 16000
CLAP_BLOCK_SIZE = 512

ELEVENLABS_API_KEY = os.getenv('ELEVENLABS_API_KEY', '')
ELEVENLABS_VOICE_ID = os.getenv('ELEVENLABS_VOICE_ID', '')


def has_wake_word(text):
    lower = text.lower()
    return any(w in lower for w in WAKE_WORDS)


def handle_command(text):
    lower = text.lower()

    if 'scroll down' in lower or 'neeche scroll' in lower:
        pyautogui.scroll(-SCROLL_AMOUNT)
        print('-> Scrolled down')
        return

    if 'scroll up' in lower or 'upar scroll' in lower:
        pyautogui.scroll(SCROLL_AMOUNT)
        print('-> Scrolled up')
        return

    for pattern, url in SITE_COMMANDS.items():
        if re.search(pattern, lower):
            webbrowser.open(url)
            print(f'-> Opened {url}')
            return

    print(f'-> Command not recognized: "{text}"')


def speak_welcome(text):
    if not ELEVENLABS_API_KEY or not ELEVENLABS_VOICE_ID:
        print('-> ElevenLabs voice skipped (ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID not set in .env)')
        return
    try:
        from elevenlabs.client import ElevenLabs

        client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
        audio = client.text_to_speech.convert(
            voice_id=ELEVENLABS_VOICE_ID,
            model_id='eleven_multilingual_v2',
            output_format='pcm_24000',
            text=text,
        )
        pcm_bytes = b''.join(audio)
        samples = np.frombuffer(pcm_bytes, dtype=np.int16)
        sd.play(samples, samplerate=24000)
        sd.wait()
    except Exception as exc:
        print(f'-> ElevenLabs voice failed: {exc}')


def handle_double_clap():
    print('-> Double clap detected')
    if CLAP_SONG_URI:
        webbrowser.open(CLAP_SONG_URI)
        print(f'-> Opened {CLAP_SONG_URI}')
    if CLAP_DASHBOARD_URL:
        webbrowser.open(CLAP_DASHBOARD_URL)
        print(f'-> Opened {CLAP_DASHBOARD_URL}')
    speak_welcome(CLAP_WELCOME_PHRASE)


def clap_listener():
    """Watches mic input for two loud spikes close together and fires handle_double_clap().

    Runs on its own sounddevice stream, separate from the SpeechRecognition mic loop,
    so it needs a mic that supports shared/simultaneous access (the Windows default).
    Triggers once per run, same as the guide it's based on.
    """
    recent_levels = deque(maxlen=50)
    clap_times = []
    triggered = False

    def audio_callback(indata, frames, callback_time, status):
        nonlocal triggered
        if triggered:
            return
        level = float(np.abs(indata).mean())
        baseline = (sum(recent_levels) / len(recent_levels)) if recent_levels else 0.0
        recent_levels.append(level)

        if baseline > 0 and level > baseline * CLAP_SPIKE_RATIO:
            now = time.monotonic()
            if not clap_times or now - clap_times[-1] >= CLAP_MIN_GAP_SECONDS:
                clap_times.append(now)
            while len(clap_times) > 2:
                clap_times.pop(0)
            if len(clap_times) == 2 and clap_times[1] - clap_times[0] <= CLAP_WINDOW_SECONDS:
                triggered = True
                threading.Thread(target=handle_double_clap, daemon=True).start()

    try:
        with sd.InputStream(
            channels=1,
            samplerate=CLAP_SAMPLE_RATE,
            blocksize=CLAP_BLOCK_SIZE,
            callback=audio_callback,
        ):
            print('-> Listening for a double clap...')
            while not triggered:
                time.sleep(0.1)
    except Exception as exc:
        print(f'-> Clap listener disabled: {exc}')


def main():
    recognizer = sr.Recognizer()
    mic = sr.Microphone()

    print('DeepSea desktop assistant starting up...')
    with mic as source:
        recognizer.adjust_for_ambient_noise(source, duration=1)
    print('Ready. Say "DeepSea" to wake it up, then speak a command.')

    if CLAP_ENABLED:
        threading.Thread(target=clap_listener, daemon=True).start()

    awaiting_command = False
    while True:
        try:
            with mic as source:
                audio = recognizer.listen(source, timeout=5, phrase_time_limit=6)
            text = recognizer.recognize_google(audio, language='en-IN')
            print(f'Heard: {text}')

            if awaiting_command:
                handle_command(text)
                awaiting_command = False
            elif has_wake_word(text):
                print('Ji, boliye...')
                awaiting_command = True

        except sr.WaitTimeoutError:
            continue
        except sr.UnknownValueError:
            continue
        except sr.RequestError as exc:
            print(f'Speech recognition service error: {exc}')
            time.sleep(2)
        except KeyboardInterrupt:
            print('\nStopping.')
            break


if __name__ == '__main__':
    main()
