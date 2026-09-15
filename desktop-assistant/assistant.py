import ctypes
import json
import os
import re
import threading
import time
import webbrowser
import winsound
from collections import deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import pyautogui
import sounddevice as sd
import speech_recognition as sr
from dotenv import load_dotenv

load_dotenv()

# Google's speech-to-text regularly mishears "DeepSea" in an Indian accent
# as similarly-sounding real words — observed in practice: "gypsy", "dip
# singh", "tipsy", "deepti", "pepsi", "dc". Listing them as wake words too
# is safe: hearing one only starts listening for a command, and every
# command still needs a separate spoken "haan"/"confirm karo" before it
# does anything.
#
# New mis-hearings keep showing up per voice/accent/mic, so this list is
# also extendable from .env without touching code: add a
# WAKE_WORDS_EXTRA=word one,word two line (comma-separated) and restart.
WAKE_WORDS = [
    'deepsea', 'deep sea', 'deepsee', 'dipsi', 'dipsy',
    'gypsy', 'dip singh', 'tipsy', 'deepti', 'deepsy', 'deepc',
    'pepsi', 'dc',
]
WAKE_WORDS += [w.strip().lower() for w in os.getenv('WAKE_WORDS_EXTRA', '').split(',') if w.strip()]

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

# Every recognized command is repeated back and must be confirmed with one
# of these words before it runs — cuts the chance a speech-recognition
# misfire (or a stray word from background conversation) does something on
# the laptop nobody actually asked for. Deliberately excludes generic verbs
# like "karo" that show up in most Hindi commands themselves, which would
# make confirmation trivially true by accident.
CONFIRM_WORDS = ('haan', 'ha', 'yes', 'confirm')
CONFIRM_TIMEOUT_SECONDS = 8

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

# Edge TTS voice name — full list: run `edge-tts --list-voices` after
# installing, or pick another from https://github.com/rany2/edge-tts.
# Default is a natural Indian-English voice that also handles Hindi words.
EDGE_TTS_VOICE = os.getenv('EDGE_TTS_VOICE', 'en-IN-NeerjaNeural')


def has_wake_word(text):
    lower = text.lower()
    return any(w in lower for w in WAKE_WORDS)


def confirm_action(recognizer, mic, prompt):
    """Speaks/prints a yes-or-no prompt and blocks for one reply. Treats
    anything that isn't a clear yes, including silence or a recognition
    failure, as "no" — a misheard command should never run by default.

    Beeps right before it starts listening, so there's always a clear cue
    for the exact moment it's ready for your "haan"."""
    print(f'-> {prompt} (bolo "haan" ya "confirm karo", {CONFIRM_TIMEOUT_SECONDS} second ke andar)')
    speak_welcome(f'{prompt} Confirm karne ke liye haan boliye.')
    winsound.Beep(1200, 200)
    try:
        with mic as source:
            audio = recognizer.listen(source, timeout=CONFIRM_TIMEOUT_SECONDS, phrase_time_limit=3)
        reply = recognizer.recognize_google(audio, language='en-IN').lower()
        print(f'Heard: {reply}')
        return any(word in reply for word in CONFIRM_WORDS)
    except Exception:
        return False


# Each resolver takes (original_text, lowercased_text) and returns either
# None (no match) or (description, action) — description is what gets
# repeated back for confirmation, action is the zero-arg callable that
# actually does it. Nothing here runs until handle_command confirms it.
# Order matters: more specific patterns first, e.g. typing before the
# generic word-matchers below it that dictated text could otherwise trip.

def _resolve_shutdown(text, lower):
    if re.search(r'\bshutdown\b|\bshut down\b|\blaptop band karo\b|\bpc band karo\b|\bcomputer band karo\b', lower):
        return 'laptop shutdown karna', lambda: os.system('shutdown /s /t 5')
    return None


def _resolve_restart(text, lower):
    if re.search(r'\brestart\b|\breboot\b', lower):
        return 'laptop restart karna', lambda: os.system('shutdown /r /t 5')
    return None


def _resolve_type(text, lower):
    match = re.search(r'\b(?:type karo|likho|type)\s+(.+)', text, re.IGNORECASE)
    if match:
        to_type = match.group(1).strip()
        return f'"{to_type}" type karna', lambda: pyautogui.write(to_type, interval=0.02)
    return None


def _resolve_click(text, lower):
    if 'double click' in lower:
        return 'double click karna', pyautogui.doubleClick
    if 'right click' in lower:
        return 'right click karna', pyautogui.rightClick
    if re.search(r'\bclick\b|\bclick karo\b', lower):
        return 'click karna', pyautogui.click
    return None


def _resolve_screenshot(text, lower):
    if 'screenshot' in lower:
        path = os.path.join(
            os.path.expanduser('~'), 'Desktop', f'deepsea_screenshot_{datetime.now():%Y%m%d_%H%M%S}.png'
        )
        return 'screenshot lena', lambda: pyautogui.screenshot(path)
    return None


def _resolve_lock(text, lower):
    if re.search(r'\block\b|\block karo\b', lower):
        return 'laptop lock karna', ctypes.windll.user32.LockWorkStation
    return None


def _resolve_media(text, lower):
    if re.search(r'\bvolume\s*(up|badhao|increase)\b', lower):
        return 'volume badhana', lambda: pyautogui.press('volumeup', presses=5)
    if re.search(r'\bvolume\s*(down|kam|ghatao|decrease)\b', lower):
        return 'volume kam karna', lambda: pyautogui.press('volumedown', presses=5)
    if 'mute' in lower or 'volume band' in lower:
        return 'mute karna', lambda: pyautogui.press('volumemute')
    if re.search(r'\bnext (song|track)\b|\bagla gaana\b|\bagla gana\b', lower):
        return 'next track', lambda: pyautogui.press('nexttrack')
    if re.search(r'\bprevious (song|track)\b|\bpichla gaana\b|\bpichla gana\b', lower):
        return 'previous track', lambda: pyautogui.press('prevtrack')
    if re.search(r'\bpause\b|\brok do\b|\bplay\b|\bchalao\b', lower):
        return 'play/pause karna', lambda: pyautogui.press('playpause')
    return None


def _resolve_scroll(text, lower):
    if 'scroll down' in lower or 'neeche scroll' in lower:
        return 'neeche scroll karna', lambda: pyautogui.scroll(-SCROLL_AMOUNT)
    if 'scroll up' in lower or 'upar scroll' in lower:
        return 'upar scroll karna', lambda: pyautogui.scroll(SCROLL_AMOUNT)
    return None


def _resolve_close_window(text, lower):
    # A generic "close the active window", not a fuzzy-matched kill of some
    # other named app — that's too easy to get wrong from a misheard name.
    if re.search(r'\b(ye|is|window)\s*(ko)?\s*band karo\b|\bclose (this|window)\b', lower):
        return 'active window band karna', lambda: pyautogui.hotkey('alt', 'f4')
    return None


def _resolve_app(text, lower):
    for pattern, app_cmd in APP_COMMANDS.items():
        if re.search(pattern, lower):
            return f'{app_cmd} kholna', lambda: os.system(f'start "" {app_cmd}')
    return None


# Matches "gana/song/music" plus "sunao/bajao/chalao" in either order, so it
# catches "gana sunao", "youtube par koi gana bajao", "sunao gana", etc.
_SONG_TRIGGER_RE = re.compile(
    r'\b(gana|gaana|song|music)\b.*\b(sunao|bajao|chalao|play)\b'
    r'|\b(sunao|bajao|chalao|play)\b.*\b(gana|gaana|song|music)\b'
)
# Stripped out before the remaining words become the search query — request
# scaffolding, not part of the song name.
_SONG_FILLER_WORDS = {
    'deepsea', 'youtube', 'par', 'pe', 'pr', 'per', 'gana', 'gaana', 'song',
    'music', 'sunao', 'bajao', 'chalao', 'play', 'karo', 'mujhe', 'koi',
    'ek', 'thoda', 'zara', 'jara', 'please', 'abb', 'ab', 'now',
}


def _resolve_play_song(text, lower):
    """"Gana/song sunao" doesn't just open youtube.com — it searches
    YouTube for the requested song (or a generic one if none was named)
    and opens the first result directly, so it actually starts playing."""
    if not _SONG_TRIGGER_RE.search(lower):
        return None

    words = [w for w in re.findall(r"[a-zA-Z']+|[ऀ-ॿ]+", text) if w.lower() not in _SONG_FILLER_WORDS]
    query = ' '.join(words).strip()
    search_query = query or 'trending bollywood songs'

    def action():
        from youtube_search import YoutubeSearch

        results = YoutubeSearch(search_query, max_results=1).to_dict()
        if not results:
            raise RuntimeError(f'"{search_query}" ke liye koi video nahi mila')
        webbrowser.open(f'https://www.youtube.com/watch?v={results[0]["id"]}')

    description = f'YouTube par "{search_query}" chalana' if query else 'YouTube par ek gana chalana'
    return description, action


def _resolve_site(text, lower):
    for pattern, url in SITE_COMMANDS.items():
        if re.search(pattern, lower):
            return f'{url} kholna', lambda: webbrowser.open(url)
    return None


COMMAND_RESOLVERS = [
    _resolve_shutdown,
    _resolve_restart,
    _resolve_type,
    _resolve_click,
    _resolve_screenshot,
    _resolve_lock,
    _resolve_media,
    _resolve_scroll,
    _resolve_close_window,
    _resolve_app,
    _resolve_play_song,
    _resolve_site,
]


def resolve_command(text):
    """Matches text (spoken or typed, e.g. from the WhatsApp bridge)
    against COMMAND_RESOLVERS. Returns (description, action) for the
    first match, or None."""
    lower = text.lower()
    for resolver in COMMAND_RESOLVERS:
        result = resolver(text, lower)
        if result is not None:
            return result
    return None


def handle_command(text, recognizer, mic):
    """Resolves the spoken text to at most one action, repeats it back for
    confirmation, and only then runs it — every command goes through this
    same confirm-first gate, not just the destructive ones, so a
    speech-recognition misfire never silently does something on the
    laptop nobody actually asked for."""
    result = resolve_command(text)
    if result is None:
        print(f'-> Command not recognized: "{text}"')
        return

    description, action = result
    if confirm_action(recognizer, mic, f'Aapne bola: "{text}". {description} — pakka?'):
        try:
            action()
            print(f'-> Done: {description}')
        except Exception as exc:
            print(f'-> Action failed: {exc}')
    else:
        print(f'-> Cancelled: {description}')


# --- Optional: lets the WhatsApp bridge (whatsapp-bridge.js) trigger these
# same laptop commands from your phone, not just chat with the dashboard.
# It POSTs here on localhost instead of speaking into the mic; confirmation
# happens as a WhatsApp reply instead of a spoken "haan". Only starts if
# WHATSAPP_BRIDGE_TOKEN is set, and every request must carry that same
# token, so nothing else on the laptop (or network) can trigger actions
# through it.
WHATSAPP_BRIDGE_TOKEN = os.getenv('WHATSAPP_BRIDGE_TOKEN', '')
REMOTE_COMMAND_PORT = int(os.getenv('ASSISTANT_LOCAL_PORT', '8765'))
REMOTE_CONFIRM_TIMEOUT_SECONDS = 60

_pending_remote_command = None
_pending_remote_lock = threading.Lock()


class _RemoteCommandHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        return bool(WHATSAPP_BRIDGE_TOKEN) and self.headers.get('x-bridge-token') == WHATSAPP_BRIDGE_TOKEN

    def do_POST(self):
        global _pending_remote_command
        if not self._authorized():
            self._send_json(401, {'error': 'unauthorized'})
            return

        length = int(self.headers.get('Content-Length', 0) or 0)
        raw = self.rfile.read(length) if length else b'{}'
        try:
            data = json.loads(raw or b'{}')
        except ValueError:
            data = {}

        if self.path == '/command':
            text = (data.get('text') or '').strip()
            result = resolve_command(text) if text else None
            if result is None:
                self._send_json(200, {'matched': False})
                return
            description, action = result
            with _pending_remote_lock:
                _pending_remote_command = (description, action, time.time() + REMOTE_CONFIRM_TIMEOUT_SECONDS)
            self._send_json(200, {'matched': True, 'description': description})

        elif self.path == '/confirm':
            with _pending_remote_lock:
                pending = _pending_remote_command
                _pending_remote_command = None
            if not pending or time.time() > pending[2]:
                self._send_json(200, {'ok': False})
                return
            description, action = pending[0], pending[1]
            try:
                action()
                self._send_json(200, {'ok': True, 'description': description})
            except Exception as exc:
                self._send_json(200, {'ok': False, 'error': str(exc)})

        else:
            self._send_json(404, {'error': 'not found'})

    def log_message(self, *args):
        pass  # keep the assistant's own terminal output uncluttered


def remote_command_server():
    server = ThreadingHTTPServer(('127.0.0.1', REMOTE_COMMAND_PORT), _RemoteCommandHandler)
    print(f'-> WhatsApp command bridge listening on http://127.0.0.1:{REMOTE_COMMAND_PORT}')
    server.serve_forever()


def speak_welcome(text):
    # Microsoft Edge's free neural text-to-speech (no API key, no signup,
    # no usage limit) — switched from ElevenLabs because its free tier
    # blocks all voices ("Free users cannot use library voices via the API").
    try:
        import asyncio
        import tempfile

        import edge_tts
        from playsound import playsound

        async def _generate():
            communicate = edge_tts.Communicate(text, voice=EDGE_TTS_VOICE)
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
                path = f.name
            await communicate.save(path)
            return path

        mp3_path = asyncio.run(_generate())
        try:
            playsound(mp3_path)
        finally:
            os.remove(mp3_path)
    except Exception as exc:
        print(f'-> Voice failed: {exc}')


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

    if WHATSAPP_BRIDGE_TOKEN:
        threading.Thread(target=remote_command_server, daemon=True).start()
    else:
        print('-> WhatsApp command bridge disabled (WHATSAPP_BRIDGE_TOKEN not set in .env)')

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
                winsound.Beep(1500, 150)
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
