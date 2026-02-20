# Remote Access Guide (Server on Computer, Client on Phone)

This guide explains how to run T3 Code on one machine and control it from another device (for example, your phone) over a private network like Tailscale.

## Goal

- Run the `apps/server` process on your computer.
- Open the web client from another device.
- Keep Codex running on the computer while controlling it remotely.

## Architecture

T3 Code is already split into backend and frontend roles:

- Backend (`apps/server`):
  - Runs on your computer.
  - Hosts HTTP pages + static assets.
  - Hosts the WebSocket API.
  - Spawns and manages Codex app-server sessions.
  - Reads/writes local state and your local workspace files.
- Frontend (`apps/web`):
  - Runs in the browser on any device.
  - Connects to backend over WebSocket.
  - Renders thread state and sends commands.

Data path:

1. Phone browser opens `http://<computer-tailnet-host>:<port>`.
2. Browser loads the T3 web app from that server.
3. Web app opens a WebSocket to the same server.
4. Server executes provider/terminal/git/file actions on the computer.
5. Server streams updates back to the phone.

Important: your phone never runs Codex itself. The agent process stays on the computer.

## Security Model

- Recommended network boundary: Tailscale tailnet ACLs.
- Optional app-layer auth: set `T3CODE_AUTH_TOKEN` on server start.
- When `T3CODE_AUTH_TOKEN` is enabled, open the UI with `?token=<token>` in the URL so the browser can authenticate WebSocket requests.

Example:

`http://my-macbook.tailnet-name.ts.net:3773/?token=<your-token>`

## Recommended Setup (Production Build)

Use this for reliable "control from phone while away from home".

### 1. Prepare computer

- Ensure Codex CLI is installed and authenticated on the computer.
- Ensure Tailscale is connected on the computer.
- Build the app:

```bash
bun run build
```

### 2. Start server

- Choose a port (default is `3773`).
- Create an auth token (recommended).

```bash
export T3CODE_PORT=3773
export T3CODE_NO_BROWSER=1
export T3CODE_AUTH_TOKEN="$(openssl rand -hex 24)"
bun run start
```

Notes:

- `T3CODE_NO_BROWSER=1` avoids auto-opening a local browser tab.
- Without `T3CODE_AUTH_TOKEN`, anyone with network reachability to your server can open a session.

### 3. Find Tailscale address of computer

```bash
tailscale ip -4
```

Or use MagicDNS hostname (for example `my-macbook.tailnet-name.ts.net`).

### 4. Open from phone

- Ensure your phone is connected to the same Tailscale tailnet.
- In phone browser, open:

```text
http://<tailscale-host-or-ip>:3773/?token=<T3CODE_AUTH_TOKEN>
```

You should now control the agent running on your computer.

## Remote Dev Setup (Hot Reload)

This repo now supports remote dev host wiring directly.

### 1. Pick the public host

Use the computer's Tailscale hostname or IP as `T3CODE_PUBLIC_HOST`.

### 2. Run dev mode

```bash
T3CODE_PUBLIC_HOST=my-macbook.tailnet-name.ts.net bun run dev
```

What this config does:

- Vite dev server is reachable off-machine (`0.0.0.0` bind).
- Server redirects to the public dev URL instead of localhost.
- WebSocket target uses the same public host instead of localhost.
- HMR uses the public host for browser reconnects.

If you also use auth token in dev:

1. set `T3CODE_AUTH_TOKEN=...` before running `bun run dev`
2. open `http://<host>:<web-port>/?token=<token>`

## Operational Tips

- Keep the server process running in `tmux`, `screen`, or a service manager.
- Use a long, random auth token.
- Restrict tailnet access using Tailscale ACLs to only your user/devices.
- Prefer production build for lower moving parts when remote.

## Troubleshooting

- Page loads but no data:
  - Most likely missing/incorrect `?token=` when `T3CODE_AUTH_TOKEN` is set.
- Phone cannot reach host:
  - Verify both devices are connected to Tailscale and can ping each other.
- Dev mode opens localhost URL:
  - Ensure `T3CODE_PUBLIC_HOST` is set before `bun run dev`.
- Live reload not working in remote dev:
  - Ensure `T3CODE_PUBLIC_HOST` resolves on the phone and no conflicting port overrides are set.
