# Local-only web build

Fraser runs T3 Code at work as a web-only server that sends nothing out except provider (harness) traffic. People may call it the "work version", "no external calls version", or "local-only web". It is the same fork as the full desktop install. Only the launcher's environment differs, so home and desktop use keep every feature.

## How it works

`T3CODE_NO_EXTERNAL_REQUESTS=true` (see `apps/server/src/externalRequests.ts`) turns off telemetry, provider update checks, and the LiteLLM pricing fetch. It also adds a Content Security Policy that keeps the web page on the local server, which blocks Clerk, PostHog, T3 Connect, theme search, and connecting to other environments. The launchers also set `T3CODE_TELEMETRY_ENABLED=false`. Nothing in the user's settings changes.

Provider CLIs still reach their own services, and `gh` or `az` may contact GitHub or Azure if they are installed.

## Files

- `scripts/local-only-web/start-t3-web.cmd` (Windows) and `start-t3-web.command` (macOS) set the variables and run `apps/server/dist/bin.mjs`. They work from a built checkout or from the root of a portable folder.
- `scripts/local-only-web/build-portable.ts` assembles a folder that needs only Node on the target machine. It holds the server bundle, web client, launcher, and the native runtime externals for the target platform.

## Building the Windows folder

```sh
vp run --filter t3 build
pnpm exec node scripts/local-only-web/build-portable.ts --platform win --arch x64
```

The output goes to the gitignored `release-local-web/t3-web-win32-x64/`. Copy that folder to the Windows machine and double-click `start-t3-web.cmd`. No install step is needed.

## Status

This work lives on the local branch `fraser/work-web-mode` and is not pushed. It was checked on macOS: with the variables set, the server made no outside connections and the browser made no external requests. The Windows launcher has not been run on Windows yet.
