# Product usage data

The T3 Code server sends product usage events to PostHog, associated with a hashed account or
installation identifier. Events include the provider, model, reasoning effort, permission mode,
turn result, duration, and main-agent token totals when available.

Events do not include prompts, responses, file contents, authentication tokens, conversation IDs,
raw provider events, or child-agent output. Child-agent token use is excluded from the totals.

To disable collection, set `T3CODE_TELEMETRY_ENABLED=false` in the server's environment before
starting it. This stops product events from being recorded or sent.

The desktop app reads the variable from your shell profile (for example `~/.zshrc`) on macOS and
Linux, so export it there and restart the app. On Windows, set it as a user environment variable.

## Keeping T3 Code's traffic on your machine

On networks that block or audit outbound connections, set `T3CODE_NO_EXTERNAL_REQUESTS=true`
before starting the server. T3 Code then:

- Stops product usage events, as `T3CODE_TELEMETRY_ENABLED=false` does.
- Skips model list and provider version checks. **Check provider versions** shows as off while the
  variable is set, and your saved choice returns when you remove it.
- Prices usage only from a previously downloaded table or your custom rates.
- Tells the browser to load the web app only from this server, so website icons and images in
  chat do not load.

Provider CLIs such as Codex and Claude still talk to their own services. Actions you start on the
server, such as installing a provider or the preview browser, still download what they need.
Theme search in the browser does not work while the variable is set.

T3 Connect only connects after you sign in, so leave it signed out on these networks. Browsers
connected through this server cannot reach other environments while the variable is set.
