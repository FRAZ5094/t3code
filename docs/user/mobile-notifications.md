# Mobile notifications

On Android, pair your phone with an environment and enable **Device Notifications** in Settings. You can choose alerts for completed tasks, failures, approval requests, and agent questions. Completion alerts include a preview of the assistant’s answer. Tap an alert to open its thread.

Your environment needs Firebase push delivery configured by its operator. This fork supports Android push through direct, Tailscale, and relay connections without signing in to T3 Connect. Once registered, the phone does not need to keep a connection to the environment open; the environment needs Internet access to Firebase.

Enable **Ongoing Agent Activity** to follow work without opening the app. Each environment has its own card, showing up to five threads. Finished results remain visible for up to 15 minutes. Dismissing a card keeps it hidden for that run without disabling alerts. Turning off ongoing activity removes the cards; turning it back on restores current work when the environment is connected.

Ordinary alerts stay quiet while the app is foregrounded. Activity cards continue to update. Notification permission and channels are controlled in Android Settings. Android 7.0 or newer and Google Play services are required. Android 16 can promote ongoing activity to a Live Update, subject to system settings and device support. Force-stopping the app prevents push delivery until you open it again.

On iOS, sign in to T3 Connect, link your environments, and enable **Device Notifications** or **Live Activity Updates**. Your environment must have agent activity publishing enabled. iOS delivery continues to use the configured T3 relay and Apple push credentials.
