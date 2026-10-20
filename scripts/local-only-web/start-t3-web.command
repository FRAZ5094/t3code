#!/bin/sh
# macOS and Linux twin of start-t3-web.cmd: starts the T3 Code web app from
# this checkout with T3 Code's own outbound requests turned off. Provider CLIs
# still reach their own services. Double-click it in Finder or run it from a
# shell after `pnpm install` and `pnpm exec vp run --filter t3 build`.
# It also runs from the root of a folder made by build-portable.ts.
cd "$(dirname "$0")" || exit 1
[ -f apps/server/dist/bin.mjs ] || cd ../.. || exit 1

if [ ! -f apps/server/dist/bin.mjs ]; then
  echo "T3 Code is not built yet. In $(pwd) run:"
  echo "  pnpm install"
  echo "  pnpm exec vp run --filter t3 build"
  exit 1
fi

export T3CODE_NO_EXTERNAL_REQUESTS=true
export T3CODE_TELEMETRY_ENABLED=false

exec node apps/server/dist/bin.mjs "$@"
