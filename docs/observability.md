# Observability

This server now has one observability model:

- pretty logs to stdout for humans
- completed spans written to a local NDJSON trace file
- optional OTLP export for traces and metrics

The local trace file is the source of truth for persisted diagnostics.

## Quick Start

If you just want a local Grafana stack and working telemetry in a few minutes, use `grafana/otel-lgtm`.

### 1. Start a local LGTM stack

Grafana publishes a single-container dev/test image for local OpenTelemetry work:

```bash
docker run --name lgtm \
  -p 3000:3000 \
  -p 4317:4317 \
  -p 4318:4318 \
  --rm -ti \
  grafana/otel-lgtm
```

Wait for the container to report that the collector and stack are ready, then open `http://localhost:3000`.

Grafana login:

- username: `admin`
- password: `admin`

### 2. Point T3 Code at the local collector

Our server exporters use OTLP HTTP, so set full OTLP HTTP endpoints:

```bash
export T3CODE_OTLP_TRACES_URL=http://localhost:4318/v1/traces
export T3CODE_OTLP_METRICS_URL=http://localhost:4318/v1/metrics
```

Optional but useful:

```bash
export T3CODE_OTLP_SERVICE_NAME=t3-local
export T3CODE_TRACE_MIN_LEVEL=Info
```

### 3. Run the app you care about

#### Published CLI

```bash
npx t3
```

#### Monorepo web/server dev

```bash
bun dev
```

#### Monorepo desktop dev

```bash
bun dev:desktop
```

#### Packaged desktop app

Launch it from a terminal in the same environment so the desktop process inherits `T3CODE_OTLP_*`.

Important:

- the desktop app forwards these env vars to the embedded backend process
- launching from Finder / Spotlight / Start Menu / dock icons usually will not inject new shell env vars

### 4. Where to look in Grafana

For this app today:

- traces: use the `Tempo` data source
- metrics: use the `Prometheus` data source
- logs: do not expect much in `Loki` yet, because T3 Code does not export OTLP logs as a separate signal

The useful first stop is usually `Explore`:

1. Open `Explore`
2. Pick `Tempo` to inspect traces
3. Search for spans by service name, span name, or span attributes
4. Switch to `Prometheus` to inspect counters and latency metrics

### 5. Keep the local trace file enabled too

Even when exporting to LGTM, the server still writes the local NDJSON trace file. That is useful for:

- quick local `jq` inspection
- debugging before Grafana is open
- checking raw span/event payloads

So the normal local-dev setup is:

- pretty stdout for live debugging
- local trace file for raw inspection
- LGTM for search, aggregation, and dashboards

## What Gets Recorded

### Traces

Every completed span is written as one NDJSON record to `serverTracePath`.

Default path:

```txt
<baseDir>/<userdata|dev>/logs/server.trace.ndjson
```

In normal runs that resolves from `T3CODE_HOME`. In dev mode it uses `dev/logs`; otherwise it uses `userdata/logs`.

The trace record shape lives in `apps/server/src/observability/TraceRecord.ts`.

Useful fields:

- `name`: span name
- `traceId`, `spanId`, `parentSpanId`: correlation
- `durationMs`: elapsed time
- `attributes`: structured context
- `events`: embedded log events and custom events
- `exit`: `Success`, `Failure`, or `Interrupted`

### Logs

Application logs are not persisted as a separate file anymore.

- `Logger.consolePretty()` writes human-readable logs to stdout
- `Logger.tracerLogger` turns `Effect.log...` calls inside an active span into span events
- logs emitted outside a span are stdout-only

That means if you want a log message to survive into the trace file, it needs to happen inside a traced effect.

### Metrics

Metrics are first-class in code, but they are not written to a local file.

- local persistence: none
- remote export: OTLP only, when configured

Metric definitions live in `apps/server/src/observability/Metrics.ts`.

## Runtime Wiring

The server observability layer is assembled in `apps/server/src/observability/Layers/Observability.ts`.

It provides:

- pretty stdout logger
- `Logger.tracerLogger`
- local NDJSON tracer
- optional OTLP trace exporter
- optional OTLP metrics exporter
- Effect trace-level and timing refs

## Config

### Local Trace File

- `T3CODE_TRACE_FILE`: override the trace file path
- `T3CODE_TRACE_MAX_BYTES`: per-file rotation size, default `10485760`
- `T3CODE_TRACE_MAX_FILES`: rotated file count, default `10`
- `T3CODE_TRACE_BATCH_WINDOW_MS`: flush window, default `200`
- `T3CODE_TRACE_MIN_LEVEL`: minimum trace level, default `Info`
- `T3CODE_TRACE_TIMING_ENABLED`: enable timing metadata, default `true`

### OTLP Export

- `T3CODE_OTLP_TRACES_URL`: OTLP trace endpoint
- `T3CODE_OTLP_METRICS_URL`: OTLP metric endpoint
- `T3CODE_OTLP_EXPORT_INTERVAL_MS`: export interval, default `10000`
- `T3CODE_OTLP_SERVICE_NAME`: service name, default `t3-server`

If the OTLP URLs are unset, local tracing still works and metrics simply stay in-process.

## Common Run Modes

### CLI or `npx t3`

This is the easiest way to test observability outside the monorepo:

```bash
export T3CODE_OTLP_TRACES_URL=http://localhost:4318/v1/traces
export T3CODE_OTLP_METRICS_URL=http://localhost:4318/v1/metrics
export T3CODE_OTLP_SERVICE_NAME=t3-cli

npx t3
```

### Monorepo `bun dev`

`bun dev` forwards your shell environment to the server process, so the same OTLP vars work:

```bash
T3CODE_OTLP_TRACES_URL=http://localhost:4318/v1/traces \
T3CODE_OTLP_METRICS_URL=http://localhost:4318/v1/metrics \
T3CODE_OTLP_SERVICE_NAME=t3-dev \
bun dev
```

### Monorepo `bun dev:desktop`

Desktop dev mode also inherits the shell environment, and the Electron main process forwards OTLP env vars to the child backend:

```bash
T3CODE_OTLP_TRACES_URL=http://localhost:4318/v1/traces \
T3CODE_OTLP_METRICS_URL=http://localhost:4318/v1/metrics \
T3CODE_OTLP_SERVICE_NAME=t3-desktop-dev \
bun dev:desktop
```

### Packaged desktop app

For packaged builds, start the app from a terminal if you want one-off local OTLP config:

```bash
T3CODE_OTLP_TRACES_URL=http://localhost:4318/v1/traces \
T3CODE_OTLP_METRICS_URL=http://localhost:4318/v1/metrics \
T3CODE_OTLP_SERVICE_NAME=t3-desktop \
<launch-your-desktop-app-from-this-shell>
```

If you launch the app from the OS UI instead, the env vars usually will not be present.

## How To Read The Trace File

The trace file is NDJSON, so `jq` is the easiest way to explore it.

### Tail everything

```bash
tail -f "$T3CODE_HOME/userdata/logs/server.trace.ndjson"
```

### Show failures only

```bash
jq -c 'select(.exit._tag != "Success") | {
  name,
  durationMs,
  exit,
  attributes
}' "$T3CODE_HOME/userdata/logs/server.trace.ndjson"
```

### Find slow spans

```bash
jq -c 'select(.durationMs > 1000) | {
  name,
  durationMs,
  traceId,
  spanId
}' "$T3CODE_HOME/userdata/logs/server.trace.ndjson"
```

### Inspect embedded log events

```bash
jq -c 'select(any(.events[]?; .attributes["effect.logLevel"] != null)) | {
  name,
  durationMs,
  events: [
    .events[]
    | select(.attributes["effect.logLevel"] != null)
    | {
        message: .name,
        level: .attributes["effect.logLevel"]
      }
  ]
}' "$T3CODE_HOME/userdata/logs/server.trace.ndjson"
```

### Follow one trace

```bash
jq -r 'select(.traceId == "TRACE_ID_HERE") | [
  .name,
  .spanId,
  (.parentSpanId // "-"),
  .durationMs
] | @tsv' "$T3CODE_HOME/userdata/logs/server.trace.ndjson"
```

### Filter provider work

```bash
jq -c 'select(.attributes["provider.thread_id"] == "thread_123") | {
  name,
  durationMs,
  provider: .attributes["provider.kind"],
  model: .attributes["provider.model"],
  exit: .exit._tag
}' "$T3CODE_HOME/userdata/logs/server.trace.ndjson"
```

### Filter orchestration commands

```bash
jq -c 'select(.attributes["orchestration.command_type"] != null) | {
  name,
  durationMs,
  commandType: .attributes["orchestration.command_type"],
  aggregateKind: .attributes["orchestration.aggregate_kind"]
}' "$T3CODE_HOME/userdata/logs/server.trace.ndjson"
```

### Filter git activity

```bash
jq -c 'select(.attributes["git.operation"] != null) | {
  name,
  durationMs,
  operation: .attributes["git.operation"],
  cwd: .attributes["git.cwd"],
  hookEvents: [
    .events[]
    | select(.name == "git.hook.started" or .name == "git.hook.finished")
  ]
}' "$T3CODE_HOME/userdata/logs/server.trace.ndjson"
```

## What Is Instrumented Today

Current high-value span and metric boundaries include:

- Effect RPC websocket request spans from `effect/rpc`
- RPC request metrics in `apps/server/src/observability/RpcInstrumentation.ts`
- startup phases
- orchestration command processing
- provider session and turn operations
- git command execution and git hook events
- terminal session lifecycle
- sqlite query execution

Provider event NDJSON logging still exists separately for provider-runtime event streams. That is not the same artifact as the server trace file.

## How To Instrument New Code

### 1. Create or reuse a span

Prefer existing `Effect.fn("name")` boundaries where possible. For ad hoc work, wrap it:

```ts
import { Effect } from "effect";

const runThing = Effect.gen(function* () {
  yield* Effect.annotateCurrentSpan({
    "thing.id": "abc123",
    "thing.kind": "example",
  });

  yield* Effect.logInfo("starting thing");
  return yield* doWork();
}).pipe(Effect.withSpan("thing.run"));
```

### 2. Add metrics with the pipeable API

Use `withMetrics(...)` from `apps/server/src/observability/Metrics.ts`.

```ts
import { Effect } from "effect";

import { someCounter, someDuration, withMetrics } from "../observability/Metrics.ts";

const program = doWork().pipe(
  withMetrics({
    counter: someCounter,
    timer: someDuration,
    attributes: {
      operation: "work",
    },
  }),
);
```

Use low-cardinality metric attributes only.

Good metric labels:

- operation kind
- method name
- provider kind
- outcome

Bad metric labels:

- raw thread IDs
- command IDs
- file paths
- cwd
- full prompts
- high-cardinality model strings when a normalized family label would do

Put that detailed context on spans instead.

### 3. Use span annotations for high-cardinality detail

```ts
yield *
  Effect.annotateCurrentSpan({
    "provider.thread_id": input.threadId,
    "provider.request_id": input.requestId,
    "git.cwd": input.cwd,
  });
```

### 4. Use logs as span events

If you want a trace to tell the story of what happened, log inside the span:

```ts
yield * Effect.logInfo("starting provider turn");
yield * Effect.logDebug("waiting for approval response");
```

Those messages will show up as span events in the trace file because `Logger.tracerLogger` is installed.

## Practical Workflows

### “Why did this request fail?”

1. Find failed spans with `exit._tag != "Success"`.
2. Group by `traceId`.
3. Inspect sibling spans and embedded log events.
4. Look at attributes like `provider.thread_id`, `orchestration.command_type`, or `git.operation`.

### “Why is the UI feeling slow?”

1. Sort spans by `durationMs`.
2. Look at top-level RPC request spans.
3. Check child spans for provider, git, terminal, or sqlite work.
4. Compare slow traces against metrics in your OTLP backend once metrics export is enabled.

### “Are git hooks causing latency?”

1. Filter spans with `git.operation`.
2. Inspect `git.hook.started` and `git.hook.finished` events.
3. Compare hook event timing to the enclosing git span duration.

### “Where should I add more instrumentation?”

Add spans or annotations at boundaries:

- queue handoff
- provider adapter calls
- external process calls
- persistence writes
- RPC methods that fan out into multiple subsystems

Avoid tracing every tiny helper. The useful unit is usually a boundary or a phase.

## Current Constraints

- logs outside spans are not persisted
- metrics are not snapshotted locally
- the old `serverLogPath` still exists in config for compatibility, but the trace file is the persisted observability artifact that matters
