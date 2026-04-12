import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = resolve(repoRoot, "apps/server/dist/bin.mjs");
const defaultPort = 7000;
const defaultPollIntervalMs = 50;
const defaultTimeoutMs = 30_000;
const reactShellPath = "/";

type ParsedArgs = {
  readonly port: number;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
  readonly skipBuild: boolean;
};

type StartupMeasurement = {
  readonly listeningLine: string;
  readonly listeningLoggedAt: Date | null;
  readonly listeningSeenAt: number;
  readonly firstSuccessAt: number;
  readonly firstSuccessStatus: number;
  readonly firstSuccessAttempt: number;
  readonly firstSuccessUrl: string;
};

function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  let port = defaultPort;
  let pollIntervalMs = defaultPollIntervalMs;
  let timeoutMs = defaultTimeoutMs;
  let skipBuild = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skip-build") {
      skipBuild = true;
      continue;
    }
    if (arg === "--port") {
      port = parsePositiveInteger(argv[index + 1], "--port");
      index += 1;
      continue;
    }
    if (arg === "--poll-interval-ms") {
      pollIntervalMs = parsePositiveInteger(argv[index + 1], "--poll-interval-ms");
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      timeoutMs = parsePositiveInteger(argv[index + 1], "--timeout-ms");
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    port,
    pollIntervalMs,
    timeoutMs,
    skipBuild,
  };
}

function parsePositiveInteger(raw: string | undefined, flagName: string): number {
  if (!raw) {
    throw new Error(`Missing value for ${flagName}.`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flagName}: ${raw}`);
  }
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function parseListeningLogTime(line: string): Date | null {
  const match = line.match(/\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]/);
  if (!match) {
    return null;
  }

  const hoursRaw = match[1];
  const minutesRaw = match[2];
  const secondsRaw = match[3];
  const millisecondsRaw = match[4];
  if (!hoursRaw || !minutesRaw || !secondsRaw || !millisecondsRaw) {
    return null;
  }
  const now = new Date();
  const parsed = new Date(now);
  parsed.setHours(
    Number.parseInt(hoursRaw, 10),
    Number.parseInt(minutesRaw, 10),
    Number.parseInt(secondsRaw, 10),
    Number.parseInt(millisecondsRaw, 10),
  );
  return parsed;
}

function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function formatDuration(durationMs: number): string {
  return `${durationMs.toFixed(1)}ms`;
}

async function runBuild(): Promise<void> {
  console.log("[startup-measure] running `bun run build`");
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("bun", ["run", "build"], {
      cwd: repoRoot,
      stdio: "inherit",
    });

    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `Build failed with ${code === null ? `signal ${signal ?? "unknown"}` : `exit code ${code}`}.`,
        ),
      );
    });
  });
}

async function waitForFirstReactShellFetch(
  baseUrl: string,
  pollIntervalMs: number,
  timeoutMs: number,
): Promise<{
  readonly at: number;
  readonly status: number;
  readonly attempt: number;
  readonly url: string;
}> {
  const startedAt = Date.now();
  let attempt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    try {
      const response = await fetch(baseUrl, {
        redirect: "manual",
      });
      const body = await response.text();
      if (
        response.ok &&
        body.includes('<div id="root"></div>') &&
        body.includes('<script type="module"')
      ) {
        return {
          at: Date.now(),
          status: response.status,
          attempt,
          url: baseUrl,
        };
      }
    } catch {
      // Keep polling until the server is reachable or the timeout expires.
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for the React shell at ${baseUrl}.`);
}

function startServer(port: number): {
  readonly child: ChildProcess;
  readonly listeningPromise: Promise<{
    readonly line: string;
    readonly loggedAt: Date | null;
    readonly seenAt: number;
  }>;
} {
  console.log(
    `[startup-measure] starting server: node apps/server/dist/bin.mjs --port ${port} --no-browser`,
  );

  const child = spawn(process.execPath, [serverEntry, "--port", String(port), "--no-browser"], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let listeningResolved = false;
  let resolveListening:
    | ((value: {
        readonly line: string;
        readonly loggedAt: Date | null;
        readonly seenAt: number;
      }) => void)
    | null = null;
  let rejectListening: ((reason?: unknown) => void) | null = null;

  const listeningPromise = new Promise<{
    readonly line: string;
    readonly loggedAt: Date | null;
    readonly seenAt: number;
  }>((resolvePromise, rejectPromise) => {
    resolveListening = resolvePromise;
    rejectListening = rejectPromise;
  });

  const onLine = (line: string) => {
    const now = Date.now();
    if (!listeningResolved && line.includes("Listening on http://")) {
      listeningResolved = true;
      resolveListening?.({
        line,
        loggedAt: parseListeningLogTime(line),
        seenAt: now,
      });
    }
  };

  const flushBuffer = (buffer: string, chunk: string, prefix: string): string => {
    const combined = `${buffer}${chunk.replace(/\r/g, "")}`;
    const lines = combined.split("\n");
    const nextBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length === 0) {
        continue;
      }
      console.log(`${prefix}${line}`);
      if (prefix === "[server] ") {
        onLine(line);
      }
    }
    return nextBuffer;
  };

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdoutBuffer = flushBuffer(stdoutBuffer, chunk, "[server] ");
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderrBuffer = flushBuffer(stderrBuffer, chunk, "[server:stderr] ");
  });

  child.once("error", (error) => {
    rejectListening?.(error);
  });

  child.once("exit", (code, signal) => {
    if (!listeningResolved) {
      rejectListening?.(
        new Error(
          `Server exited before logging readiness (${code === null ? `signal ${signal ?? "unknown"}` : `exit code ${code}`}).`,
        ),
      );
    }
  });

  return { child, listeningPromise };
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolvePromise) => {
    let settled = false;

    const settle = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolvePromise();
    };

    child.once("exit", settle);
    child.kill("SIGTERM");

    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      settle();
    }, 2_000).unref();
  });
}

function printSummary(measurement: StartupMeasurement): void {
  const observedDeltaMs = measurement.firstSuccessAt - measurement.listeningSeenAt;
  const loggedDeltaMs =
    measurement.listeningLoggedAt === null
      ? null
      : measurement.firstSuccessAt - measurement.listeningLoggedAt.getTime();

  console.log("");
  console.log("[startup-measure] summary");
  console.log(`  listening log: ${measurement.listeningLine}`);
  console.log(`  listening observed at: ${formatTimestamp(measurement.listeningSeenAt)}`);
  if (measurement.listeningLoggedAt) {
    console.log(`  listening log timestamp: ${measurement.listeningLoggedAt.toISOString()}`);
  }
  console.log(`  first successful fetch: ${measurement.firstSuccessUrl}`);
  console.log(`  first successful fetch at: ${formatTimestamp(measurement.firstSuccessAt)}`);
  console.log(`  first successful fetch status: ${measurement.firstSuccessStatus}`);
  console.log(`  fetch attempts until success: ${measurement.firstSuccessAttempt}`);
  console.log(`  observed delta (listening line -> success): ${formatDuration(observedDeltaMs)}`);
  if (loggedDeltaMs !== null) {
    console.log(
      `  parsed-log delta (listening timestamp -> success): ${formatDuration(loggedDeltaMs)}`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.skipBuild) {
    await runBuild();
  } else {
    console.log("[startup-measure] skipping build");
  }

  if (!existsSync(serverEntry)) {
    throw new Error(
      `Server build output not found at ${serverEntry}. Run \`bun run build\` first.`,
    );
  }

  const baseUrl = new URL(reactShellPath, `http://127.0.0.1:${args.port}`).toString();
  const { child, listeningPromise } = startServer(args.port);

  try {
    const listening = await listeningPromise;
    const firstSuccess = await waitForFirstReactShellFetch(
      baseUrl,
      args.pollIntervalMs,
      args.timeoutMs,
    );

    printSummary({
      listeningLine: listening.line,
      listeningLoggedAt: listening.loggedAt,
      listeningSeenAt: listening.seenAt,
      firstSuccessAt: firstSuccess.at,
      firstSuccessStatus: firstSuccess.status,
      firstSuccessAttempt: firstSuccess.attempt,
      firstSuccessUrl: firstSuccess.url,
    });
  } finally {
    await stopServer(child);
  }
}

await main().catch((error) => {
  console.error("[startup-measure] failed", error);
  process.exitCode = 1;
});
