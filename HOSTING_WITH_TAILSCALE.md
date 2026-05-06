# Hosting T3 Code With Tailscale

This guide shows how to run the T3 Code web app from this repo and open it from an Android phone, even when the phone is not on the same Wi-Fi network.

The setup uses [Tailscale](https://tailscale.com/) so the site stays private to your tailnet. Do not use Tailscale Funnel for this unless you intentionally want to expose T3 Code to the public internet.

## Requirements

- Bun and Node versions that match this repo's `package.json`.
- Repo dependencies installed with `bun install`.
- At least one provider installed and authenticated on the host machine:
  - Codex: `codex login`
  - Claude: `claude auth login`
  - OpenCode: `opencode auth login`
- Tailscale installed and signed in on both devices:
  - The computer that will host T3 Code.
  - The Android phone that will open it.

Tailscale's Android install guide is here: <https://tailscale.com/docs/install/android>

## Start The Hosted Web App

From the repo root:

```bash
bun run build:start:web
```

This script:

1. Builds `apps/web`.
2. Builds `apps/server`.
3. Starts the server with `--host 0.0.0.0 --no-browser`.

The default port is `3773`, unless that port is unavailable and the server chooses another one. Check the terminal output for the actual URL and port.

To force a specific port:

```bash
bun run --cwd apps/web build
bun run --cwd apps/server build
node apps/server/dist/bin.mjs --host 0.0.0.0 --port 3773 --no-browser
```

## Option 1: Open It Directly Over Tailscale

This is the simplest path.

1. On the host computer, find its Tailscale IP or MagicDNS name:

   ```bash
   tailscale ip -4
   tailscale status
   ```

2. On Android, open the Tailscale app and confirm it is connected to the same tailnet.

3. In the Android browser, open one of these:

   ```text
   http://<tailscale-ip>:3773
   http://<machine-name>:3773
   ```

Replace `3773` with the port printed by the T3 Code server if it picked a different port.

## Option 2: Publish A Private HTTPS URL With Tailscale Serve

Use this if you want a stable HTTPS URL inside your tailnet.

1. Start T3 Code:

   ```bash
   bun run build:start:web
   ```

2. In another terminal on the host computer, proxy the local T3 Code server through Tailscale Serve:

   ```bash
   tailscale serve --bg 127.0.0.1:3773
   ```

   If T3 Code is running on a different port, replace `3773`.

3. Check the private tailnet URL:

   ```bash
   tailscale serve status
   ```

4. Open the `https://...ts.net` URL from the Android browser while Tailscale is connected.

Tailscale Serve is private to your tailnet and follows your tailnet access controls. Tailscale's Serve docs are here: <https://tailscale.com/kb/1242/tailscale-serve>

Tailscale Serve requires HTTPS certificates to be enabled for the tailnet. If they are not enabled yet, the Tailscale CLI can prompt you during setup.

To stop serving the URL:

```bash
tailscale serve reset
```

## Notes

- Keep the host computer awake and online while using T3 Code from Android.
- The coding providers run on the host computer, not on the phone. The phone is only opening the web UI.
- Binding to `0.0.0.0` makes the server reachable from network interfaces on the host. Prefer accessing it through Tailscale, and avoid exposing this port through router port forwarding.
- Tailscale works across networks as long as both devices are signed in to the same tailnet and allowed by your tailnet access rules.
