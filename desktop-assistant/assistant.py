import re
import time
import webbrowser

import pyautogui
import speech_recognition as sr

WAKE_WORDS = ['deepsea', 'deep sea', 'deepsee', 'dipsi', 'dipsy']

# Order matters: more specific patterns should come before broader ones.
SITE_COMMANDS = {
    r'\bforex\s*factory\b': 'https://www.forexfactory.com',
    r'\byoutube\b': 'https://www.youtube.com',
    r'\bgmail\b': 'https://mail.google.com',
    r'\bdeepsea dashboard\b|\bdashboard\b': 'https://deepsea-dashboard.onrender.com',
}

SCROLL_AMOUNT = 600


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


def main():
    recognizer = sr.Recognizer()
    mic = sr.Microphone()

    print('DeepSea desktop assistant starting up...')
    with mic as source:
        recognizer.adjust_for_ambient_noise(source, duration=1)
    print('Ready. Say "DeepSea" to wake it up, then speak a command.')

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
