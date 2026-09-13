# Upgrading Fraser's Mini, M1, and M5

This guide describes Fraser's fork installations, inspected on 2026-09-13. Recheck the running process, service definition, checkout and configuration before deploying; paths and Node versions below are observations, not defaults to impose on another host. SSH aliases from Mini are `m1` and `m5`, using user `fraser`.

The native Android notification implementation first shipped on branch `t3code/adapt-upstream-android-notifications`, commit `d1b3bf1754f5177c89db1e33ee7c80b1ab3843a1`. Use the revision requested for the upgrade and record its full SHA. Merely preparing Firebase credentials does not upgrade an installed server.

## Identify the installation

| Host         | Installed code                                    | Launcher                                      | Listener                                   |
| ------------ | ------------------------------------------------- | --------------------------------------------- | ------------------------------------------ |
| Mini (Linux) | `/home/fraser/Documents/t3code-service`           | systemd user unit `t3code.service`            | `127.0.0.1:3773`; separate Tailscale proxy |
| M1 (macOS)   | `/Users/fraser/Documents/t3code-service`          | LaunchAgent `com.t3tools.t3code.service`      | `0.0.0.0:3773`                             |
| M5 (macOS)   | `/Users/fraser/Applications/T3 Code (Fraser).app` | GUI app; Electron launches its bundled server | `0.0.0.0:3773`                             |

Mini and M1 launch `apps/server/dist/bin.mjs` with `--base-dir ~/.t3`. M5 also uses `~/.t3/userdata`. These are live installations: preserve data, secrets, saved connections and existing network exposure. Do not run a test server against their state. Follow the repository's read-only SQLite snapshot procedure if a backup is needed.

M5 also has Nightly and other app copies with the same bundle identifier. Always quit/open the **absolute Fraser app path**, not the bundle ID or an ambiguous app name. Rebuilding a Git checkout alone does not change the app's embedded `app.asar`.

## Preserve configuration before building

There are two different configuration stages. Both must survive an upgrade.

### Firebase: server runtime

Each host has a service-account key for project `t3-code-fraz5094` at:

- Mini: `/home/fraser/.config/t3code/credentials/firebase-adminsdk.json`
- M1 and M5: `/Users/fraser/.config/t3code/credentials/firebase-adminsdk.json`

The directory is mode `0700`, the file `0600`. Set `T3CODE_FCM_SERVICE_ACCOUNT_FILE` to the host's absolute path. Never print key contents, commit the key, or copy it into an app bundle. The original supplied key was on M5 in Downloads; use the persistent copies above for operation.

| Host | Persistent runtime configuration                                                                                                                           | Activation                                                                |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Mini | `~/.config/systemd/user/t3code.service.d/firebase.conf`                                                                                                    | `systemctl --user daemon-reload`, then restart the service                |
| M1   | `EnvironmentVariables` in `~/Library/LaunchAgents/com.t3tools.t3code.service.plist`                                                                        | Reload the LaunchAgent; `kickstart` alone does not reread an edited plist |
| M5   | `~/Library/LaunchAgents/com.fraser.t3code.firebase-environment.plist` runs `/bin/launchctl setenv T3CODE_FCM_SERVICE_ACCOUNT_FILE <key-path>` at GUI login | Set the variable in the current GUI session too, then quit/reopen Fraser  |

M5's setting belongs to the GUI launch environment so Finder/Dock launches inherit it. A shell export in an SSH session is insufficient. Inspect `launchctl getenv T3CODE_FCM_SERVICE_ACCOUNT_FILE`, then verify the **running desktop and server child** inherited that variable. Capture process environment output privately and print only the expected variable or a match result; other variables may be secrets. The login LaunchAgent sets a path, not private key contents, and does not launch another server.

For Firebase setup and Android compatibility, see [Android notifications](android-notifications.md). `google-services.json` is Android client configuration, not the server's private key. The phone needs a native APK containing this implementation. An old server rejecting `Missing key at ["expoPushToken"]` must be upgraded: the new phone registers `fcmToken`.

### Clerk and T3 Connect: build time and existing runtime settings

Preserve these canonical build inputs:

```dotenv
T3CODE_CLERK_PUBLISHABLE_KEY=<existing publishable key>
T3CODE_CLERK_JWT_TEMPLATE=<existing template>
T3CODE_CLERK_CLI_OAUTH_CLIENT_ID=<existing OAuth client ID>
T3CODE_RELAY_URL=<existing relay URL>
```

Do not paste these placeholders into a build. M5's recovered, working values are saved in `/Users/fraser/.config/t3code/desktop-build.env`. Copy that file to `.env.local` in an isolated build checkout when building the same Fraser configuration. Keep it outside Git. Preserve any additional host-specific settings from the existing service/build configuration rather than replacing them wholesale. M1's service plist also contains Clerk and relay runtime settings.

[`loadRepoEnv`](../../scripts/lib/public-config.ts) maps canonical inputs to the web `VITE_*` names. The desktop embeds its Clerk key; the server embeds public cloud defaults; the web client embeds its cloud configuration. **Rebuild all affected bundles with these values present.** Supplying only runtime variables cannot repair an already-built desktop/web client with empty Clerk values. Never set `VITE_HTTP_URL` or `VITE_WS_URL` for this upgrade.

If a build configuration file is missing, recover the existing values from the last working installation before replacing it. M5's original build contained the configuration even though its source checkout had no `.env.local`. Compare the old and new packaged desktop, web and server bundles, not just the source config. Clerk publishable configuration is distinct from Firebase's private service-account key; no Clerk secret key is needed for this desktop build.

## Build before interrupting a host

1. Inspect checkout changes and the launcher. Use a separate checkout/worktree pinned to the requested SHA; do not reset somebody else's work.
2. Use Node 24 compatible with `package.json`. Last observed paths: Mini `~/.nvm/versions/node/v24.19.0/bin`, M1 `~/.nvm/versions/node/v24.13.1/bin`, M5 `~/.nvm/versions/node/v24.16.0/bin`. Verify availability. On macOS, Homebrew tools are in `/opt/homebrew/bin`.
3. Restore build configuration, then install locked dependencies with `vp i`. If `vp` is unavailable before installation, the configured `pnpm install --frozen-lockfile` bootstraps it; add the checkout's `node_modules/.bin` to PATH afterward.
4. Build and check the artifact before stopping the old process. Retain a rollback copy of the old installation and its launch configuration. Stop only the identified service/app, never processes matched by a broad kill pattern.
5. Restart only when deployment is authorized. A request to prepare configuration or build an APK does not authorize changing live servers.

### Mini and M1: service deployments

From the prepared checkout:

```sh
vp run --filter t3 build
```

The server build task depends on the web build. Do not copy only `bin.mjs`: deploy the complete compatible server distribution, bundled client and runtime dependencies. Preserve the installed checkout's ignored configuration. If building directly in `Documents/t3code-service`, account for the build cleaning/replacing files that the running server serves; prefer staging the build separately and installing during the stop window.

Mini's unit is `~/.config/systemd/user/t3code.service`. Preserve its working directory, Node executable, base directory, existing environment and loopback binding. Its separate `t3code-tailscale-proxy.service` exposes port 3773 on Mini's tailnet address; do not replace this arrangement with a new listener or `tailscale serve` configuration.

After installing the Mini build:

```sh
systemctl --user daemon-reload
systemctl --user restart t3code.service
systemctl --user show t3code.service -p ActiveState -p MainPID -p DropInPaths
```

M1's plist is `~/Library/LaunchAgents/com.t3tools.t3code.service.plist`. Preserve all `ProgramArguments`, `WorkingDirectory`, `EnvironmentVariables`, and log paths. Firebase-edit backups are under `~/.config/t3code/backups/`. Validate it with `plutil -lint`. Reload in the GUI domain using the user's actual UID:

```sh
launchctl bootout "gui/$(id -u)/com.t3tools.t3code.service"
# Install the staged build while the service is stopped.
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.t3tools.t3code.service.plist"
launchctl list com.t3tools.t3code.service
```

Do not regenerate a stock service definition over these customized launchers: doing so can discard Firebase, Clerk or network settings. On a failed deployment, restore the previous build/configuration and start it again; report the failure rather than leaving the host silently offline.

### M5: desktop deployment

The source checkout last used was `/Users/fraser/github/t3code-desktop-d1b3bf175`, separate from `/Users/fraser/github/t3code`. Use a fresh revision-specific worktree for later upgrades.

With `.env.local` restored from `~/.config/t3code/desktop-build.env`, build on M5:

```sh
node scripts/build-desktop-artifact.ts \
  --platform mac --target zip --arch arm64 \
  --output-dir /Users/fraser/Downloads/t3code-<revision>
```

Replace `<revision>` with the target revision. This builds desktop, server and web, stages production dependencies and packages the app. Rust/Cargo and Xcode command-line tools must be available; the resource monitor is built too. Do not use `--skip-build` after changing Clerk configuration. Do not use `--target dir` to obtain a retained artifact: this script copies files out of staging, not the unpacked `.app` directory. A ZIP retains the app for installation.

Extract with `ditto -x -k <archive.zip> <staging-directory>`. Before installing:

- Verify source SHA and packaged Firebase sender, plus matching Clerk settings in the desktop, web and server bundles.
- Verify the app signature with `codesign --verify --deep --strict`. The local unsigned build needed ad-hoc signing: `codesign --force --deep --sign - --preserve-metadata=entitlements <staged-app>`, followed by verification. This is a local build, not a notarized release; retain the existing signing workflow if it changes.
- Record the source SHA and SHA-256 of `Contents/Resources/app.asar`. M5's deployed provenance is saved at `~/.config/t3code/installed-desktop-build.json`; the artifact directory also holds `build-provenance.json`. Include which build configuration was used: the source SHA alone does not prove Clerk was included.

Quit exactly `/Users/fraser/Applications/T3 Code (Fraser).app` using `osascript` or its normal Quit action. Wait for its main process and bundled server to exit. Rename the old app to a timestamped sibling backup, move the staged app to that exact installation path, and run:

```sh
open '/Users/fraser/Applications/T3 Code (Fraser).app'
```

A renamed backup is sufficient for application rollback; do not remove or reset the user's T3 data. Do not quit the corrected app at the end of verification.

Replacing/re-signing the app can require renewed macOS file permissions. During this upgrade, Git subprocesses doing `rev-parse --show-toplevel` inside Documents blocked while identical SSH Git probes succeeded. The server listened on port 3773 but HTTP readiness timed out. Unlocking M5 and granting Fraser access to Documents resolved startup. Ask the user to approve the actual macOS prompt (or check Privacy & Security → Files and Folders); do not modify the privacy database or interpret a listening port as readiness.

## Verify before reporting success

Check on the target machine:

1. The running service/app and server child correspond to the new installation. For M5, compare the installed asar hash with build provenance; version `0.0.40` alone did not distinguish the old and new builds.
2. The actual server process inherited the correct Firebase key path. Verify key readability, owner-only permissions and project ID without disclosing key contents. OAuth authorization verifies credentials/connectivity, not delivery to the phone.
3. Both `http://127.0.0.1:3773/.well-known/t3/environment` and `/` respond successfully. Preserve remote/Tailscale reachability and existing connections. Inspect startup logs if readiness fails; M5's logs are under `~/.t3/userdata/logs/`.
4. T3 Connect configuration is present in the served client and bundled desktop/server. Where possible verify the actual connection/sign-in flow; distinguish configuration verification from a completed interactive sign-in.
5. Reconnect the upgraded Android app and use **Refresh notification registration**. The server stores native registrations in `~/.t3/userdata/secrets/direct-fcm-notification-registrations.bin`. Report counts/status only, not device tokens. This file is managed by the server; do not edit it to manufacture a successful registration.
6. If notification delivery testing is in scope, run a task with the phone backgrounded and check completion/attention alerts, ongoing activity and tap navigation. Firebase accepting a send and a token being registered are not proof that the phone displayed it.

Report the deployed SHA, build configuration preservation, restart/readiness result and any verification still requiring the user. If only configuration was staged, say the old build is still running. If another agent is tasked only with building an Android APK, give it the artifact path and do not upgrade these hosts on its behalf.
