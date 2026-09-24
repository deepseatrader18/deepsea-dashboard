# JARVIS Control (mobile app)

A minimal Android app that opens the JARVIS mobile control panel
(served by `web_control.py` in the main JARVIS project) inside a native
WebView, so it can be installed like a normal app.

This folder only exists here so GitHub Actions can build the `.apk` file
(this sandbox cannot download the Android SDK directly). It is not part
of the deepsea-dashboard web app.

Build: pushing to this folder (or running the workflow manually) triggers
`.github/workflows/jarvis-mobile-apk.yml`, which produces a debug APK as
a downloadable build artifact named `jarvis-control-apk`.
