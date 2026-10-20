#!/usr/bin/env node
/**
 * Assembles a copyable folder that runs the T3 Code web app with only Node
 * installed: the built server and web client, the launcher, and a production
 * install of the native packages the bundle keeps external, fetched for the
 * target platform. Nothing in the folder needs pnpm, vp, npm, or a network
 * connection on the machine that runs it.
 *
 *   vp run --filter t3 build
 *   node scripts/local-only-web/build-portable.ts --platform win --arch x64
 *
 * Layout (mirrors the checkout so the launcher works in both places):
 *
 *   start-t3-web.cmd | start-t3-web.command
 *   apps/server/dist/    server bundle and web client, without sourcemaps
 *   node_modules/        runtime externals (node-pty, keyring, fff, ...)
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import { Command, Flag } from "effect/cli";

import serverPackageJson from "../../apps/server/package.json" with { type: "json" };
import {
  CliArchiveInputMissingError,
  cliArchivePlatformKey,
  stageRuntimeExternals,
} from "../build-cli-archive.ts";

const RepoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("../..", import.meta.url))),
);

const buildPortable = Effect.fn("buildPortable")(function* (input: {
  readonly platform: "mac" | "linux" | "win";
  readonly arch: "arm64" | "x64";
  readonly outputDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* RepoRoot;
  const serverDist = path.join(repoRoot, "apps/server/dist");
  for (const required of ["bin.mjs", "client/index.html"]) {
    if (!(yield* fs.exists(path.join(serverDist, required)))) {
      return yield* new CliArchiveInputMissingError({
        inputPath: path.join(serverDist, required),
        hint: "Run `vp run --filter t3 build` first.",
      });
    }
  }

  const stageDir = path.resolve(
    input.outputDir,
    `t3-web-${cliArchivePlatformKey(input.platform, input.arch)}`,
  );
  yield* fs.remove(stageDir, { recursive: true, force: true });
  yield* fs.makeDirectory(stageDir, { recursive: true });

  yield* Effect.log(`[portable] Staging ${stageDir}...`);
  yield* stageRuntimeExternals({
    repoRoot,
    stageDir,
    platform: input.platform,
    arch: input.arch,
    version: serverPackageJson.version,
  });

  const distTarget = path.join(stageDir, "apps/server/dist");
  yield* fs.copy(serverDist, distTarget);
  const maps = (yield* fs.readDirectory(distTarget, { recursive: true })).filter((entry) =>
    entry.endsWith(".map"),
  );
  for (const entry of maps) {
    yield* fs.remove(path.join(distTarget, entry), { force: true });
  }

  const launcher = input.platform === "win" ? "start-t3-web.cmd" : "start-t3-web.command";
  const launcherSource = yield* fs.readFileString(
    path.join(repoRoot, "scripts/local-only-web", launcher),
  );
  // cmd.exe misparses labels in LF batch files, and a checkout made on macOS
  // or Linux has LF unless git rewrote the file.
  yield* fs.writeFileString(
    path.join(stageDir, launcher),
    input.platform === "win" ? launcherSource.replace(/\r?\n/g, "\r\n") : launcherSource,
  );
  if (input.platform !== "win") {
    yield* fs.chmod(path.join(stageDir, launcher), 0o755);
  }

  yield* Effect.log(`[portable] Wrote ${stageDir}. Copy the folder and run ${launcher}.`);
});

const command = Command.make(
  "build-portable",
  {
    platform: Flag.Literals("platform", ["mac", "linux", "win"]).pipe(Flag.withDefault("win")),
    arch: Flag.Literals("arch", ["arm64", "x64"]).pipe(Flag.withDefault("x64")),
    outputDir: Flag.String("output-dir").pipe(Flag.withDefault("release-local-web")),
  },
  (input) => buildPortable(input).pipe(Effect.scoped),
).pipe(Command.withDescription("Assemble a copyable local-only T3 Code web folder."));

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer)),
    NodeRuntime.runMain,
  );
}
