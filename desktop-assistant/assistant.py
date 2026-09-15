import ctypes
import os
import re
import threading
import time
import webbrowser
from collections import deque
from datetime import datetime

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

# Launched with `start "" <value>` (Windows shell), which resolves both
# plain .exe names on PATH (notepad, calc, mspaint, explorer, taskmgr) and
# registered URI/App-Execution-Alias handlers (spotify:, whatsapp:, ms-*:).
APP_COMMANDS = {
    r'\bchrome\b': 'chrome',
    r'\bedge\b': 'msedge',
    r'\bnotepad\b': 'notepad',
    r'\bcalculator\b|\bcalc\b': 'calc',
    r'\bpaint\b': 'mspaint',
    r'\bfile\s*explorer\b|\bfiles\b': 'explorer',
    r'\btask\s*manager\b': 'taskmgr',
    r'\bspotify\b': 'spotify:',
    r'\bwhatsapp\b': 'whatsapp:',
    r'\bvs\s*code\b|\bvisual studio code\b': 'code',
}

SCROLL_AMOUNT = 600

# Phrases that must be spoken back exactly (in the confirmation reply) before
# a destructive system action runs — cuts the chance a speech-recognition
# misfire shuts the machine down.
CONFIRM_WORDS = ('haan', 'ha', 'yes', 'confirm', 'karo')
CONFIRM_TIMEOUT_SECONDS = 6

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


def confirm_action(recognizer, mic, prompt):
    """Speaks/prints a yes-or-no prompt and blocks for one reply. Used only
    before destructive actions (shutdown/restart) — treats anything that
    isn't a clear yes, including silence or a recognition failure, as "no",
    since a misheard "shutdown" should never proceed by default."""
    print(f'-> {prompt} (bolo "haan" {CONFIRM_TIMEOUT_SECONDS} second ke andar, warna cancel ho jayega)')
    speak_welcome(f'{prompt} Confirm karne ke liye haan boliye.')
    try:
        with mic as source:
            audio = recognizer.listen(source, timeout=CONFIRM_TIMEOUT_SECONDS, phrase_time_limit=3)
        reply = recognizer.recognize_google(audio, language='en-IN').lower()
        print(f'Heard: {reply}')
        return any(word in reply for word in CONFIRM_WORDS)
    except Exception:
        return False


def handle_command(text, recognizer, mic):
    lower = text.lower()

    # --- Destructive system actions: confirm before running ----------------
    if re.search(r'\bshutdown\b|\bshut down\b|\blaptop band karo\b|\bpc band karo\b|\bcomputer band karo\b', lower):
        if confirm_action(recognizer, mic, 'Laptop shutdown karna hai?'):
            print('-> Shutting down')
            os.system('shutdown /s /t 5')
        else:
            print('-> Shutdown cancelled')
        return

    if re.search(r'\brestart\b|\breboot\b', lower):
        if confirm_action(recognizer, mic, 'Laptop restart karna hai?'):
            print('-> Restarting')
            os.system('shutdown /r /t 5')
        else:
            print('-> Restart cancelled')
        return

    # --- Typing: "type karo <text>" / "likho <text>" — must come before the
    # other checks below since the dictated text could itself contain words
    # like "open" or "close" that would otherwise match a different command.
    type_match = re.search(r'\b(?:type karo|likho|type)\s+(.+)', text, re.IGNORECASE)
    if type_match:
        to_type = type_match.group(1).strip()
        pyautogui.write(to_type, interval=0.02)
        print(f'-> Typed: "{to_type}"')
        return

    # --- Clicking (at the current mouse position — voice can't point at a
    # spot on screen, so move the mouse there yourself first) --------------
    if 'double click' in lower:
        pyautogui.doubleClick()
        print('-> Double-clicked')
        return
    if 'right click' in lower:
        pyautogui.rightClick()
        print('-> Right-clicked')
        return
    if re.search(r'\bclick\b|\bclick karo\b', lower):
        pyautogui.click()
        print('-> Clicked')
        return

    # --- Screenshot / lock ---------------------------------------------
    if 'screenshot' in lower:
        path = os.path.join(
            os.path.expanduser('~'), 'Desktop', f'deepsea_screenshot_{datetime.now():%Y%m%d_%H%M%S}.png'
        )
        try:
            pyautogui.screenshot(path)
            print(f'-> Screenshot saved: {path}')
        except Exception as exc:
            print(f'-> Screenshot failed: {exc}')
        return

    if re.search(r'\block\b|\block karo\b', lower):
        ctypes.windll.user32.LockWorkStation()
        print('-> Locked')
        return

    # --- Media control ---------------------------------------------------
    if re.search(r'\bvolume\s*(up|badhao|increase)\b', lower):
        pyautogui.press('volumeup', presses=5)
        print('-> Volume up')
        return
    if re.search(r'\bvolume\s*(down|kam|ghatao|decrease)\b', lower):
        pyautogui.press('volumedown', presses=5)
        print('-> Volume down')
        return
    if 'mute' in lower or 'volume band' in lower:
        pyautogui.press('volumemute')
        print('-> Muted')
        return
    if re.search(r'\bnext (song|track)\b|\bagla gaana\b|\bagla gana\b', lower):
        pyautogui.press('nexttrack')
        print('-> Next track')
        return
    if re.search(r'\bprevious (song|track)\b|\bpichla gaana\b|\bpichla gana\b', lower):
        pyautogui.press('prevtrack')
        print('-> Previous track')
        return
    if re.search(r'\bpause\b|\brok do\b|\bplay\b|\bchalao\b', lower):
        pyautogui.press('playpause')
        print('-> Play/pause')
        return

    # --- Scroll ------------------------------------------------------------
    if 'scroll down' in lower or 'neeche scroll' in lower:
        pyautogui.scroll(-SCROLL_AMOUNT)
        print('-> Scrolled down')
        return

    if 'scroll up' in lower or 'upar scroll' in lower:
        pyautogui.scroll(SCROLL_AMOUNT)
        print('-> Scrolled up')
        return

    # --- Close the active window (Alt+F4) — a generic "close this", not a
    # fuzzy-matched kill of some other named app; that's too easy to get
    # wrong from a misheard app name. -------------------------------------
    if re.search(r'\b(ye|is|window)\s*(ko)?\s*band karo\b|\bclose (this|window)\b', lower):
        pyautogui.hotkey('alt', 'f4')
        print('-> Closed active window')
        return

    # --- Open an app ---------------------------------------------------
    for pattern, app_cmd in APP_COMMANDS.items():
        if re.search(pattern, lower):
            os.system(f'start "" {app_cmd}')
            print(f'-> Opened {app_cmd}')
            return

    # --- Open a website --------------------------------------------------
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
                handle_command(text, recognizer, mic)
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
