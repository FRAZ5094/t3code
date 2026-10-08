import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationV2ThreadShell, ResourceTelemetrySnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/http";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ResourceTelemetry from "../resourceTelemetry/ResourceTelemetry.ts";
import * as PrometheusRoute from "./PrometheusRoute.ts";

// Only the fields consumed by metrics are needed in these service fixtures.
const snapshot = {
  readAt: DateTime.makeUnsafe("2026-10-08T12:00:00Z"),
  health: { restartCount: 2 },
  power: { thermalState: "nominal" },
  processes: [{ category: "provider-root", cpuPercent: 150 }],
} as unknown as ResourceTelemetrySnapshot;

const layerDatabase = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE orchestration_v2_projection_provider_sessions (
      provider_session_id TEXT, driver TEXT, status TEXT)`;
    yield* sql`CREATE TABLE orchestration_v2_projection_threads (
      thread_id TEXT, archived_at TEXT, deleted_at TEXT)`;
    yield* sql`CREATE TABLE orchestration_v2_projection_provider_session_bindings (
      provider_session_id TEXT, thread_id TEXT)`;
    yield* sql`INSERT INTO orchestration_v2_projection_threads VALUES
      ('active', NULL, NULL), ('archived', '2026-10-08', NULL),
      ('deleted', NULL, '2026-10-08'), ('second', NULL, NULL)`;
    yield* sql`INSERT INTO orchestration_v2_projection_provider_sessions VALUES
      ('shared', 'codex', 'ready'), ('archived', 'codex', 'ready'),
      ('deleted', 'codex', 'ready'), ('stopped', 'codex', 'stopped')`;
    yield* sql`INSERT INTO orchestration_v2_projection_provider_session_bindings VALUES
      ('shared', 'active'), ('shared', 'second'), ('archived', 'archived'),
      ('deleted', 'deleted'), ('stopped', 'active')`;
  }),
).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })));

const layerDependencies = (enabled: boolean, readThreads: () => OrchestrationV2ThreadShell[]) =>
  Layer.mergeAll(
    layerDatabase,
    Layer.mock(ServerConfig.ServerConfig)({
      prometheusMetricsEnabled: enabled,
    } as ServerConfig.ServerConfig["Service"]),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getShellSnapshot: () =>
        Effect.sync(() => ({
          schemaVersion: 2,
          snapshotSequence: 0,
          archivedThreads: [],
          threads: readThreads(),
        })),
    }),
    Layer.mock(ProjectStore.ProjectStoreV2)({ listShells: () => Effect.succeed([]) }),
    Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
      listInstances: Effect.succeed([]),
    }),
    Layer.mock(ResourceTelemetry.ResourceTelemetry)({
      refresh: Effect.succeed(snapshot),
      latest: Effect.succeed(snapshot),
    }),
  );

const metric = (body: string, name: string, labels = "") => {
  const line = body.split("\n").find((line) => line.startsWith(`${name}${labels} `));
  expect(line, `missing ${name}${labels}`).toBeDefined();
  return Number(line!.split(" ").at(-1));
};

describe("Prometheus V2 runtime metrics", () => {
  it("counts shared sessions once, excludes inactive threads, and clears settled turn gauges", async () => {
    let active = true;
    const thread = {
      activeRunId: "run",
      providerInstanceId: "missing-instance",
      worktreePath: "/tmp/metrics-worktree",
      pendingRuntimeRequest: { kind: "command" },
    } as OrchestrationV2ThreadShell;
    const { handler, dispose } = HttpRouter.toWebHandler(
      PrometheusRoute.layer.pipe(
        Layer.provide(layerDependencies(true, () => (active ? [thread] : []))),
      ),
      { disableLogger: true },
    );
    try {
      const response = await handler(new Request("http://metrics.test/metrics"));
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(metric(body, "t3_provider_sessions_active", '{provider="codex",status="ready"}')).toBe(
        1,
      );
      expect(metric(body, "t3_agents_running")).toBe(1);
      expect(metric(body, "t3_worktrees_active")).toBe(1);
      expect(
        metric(body, "t3_provider_turns_waiting", '{provider="unknown",reason="approval"}'),
      ).toBe(1);
      expect(metric(body, "t3_process_cpu_cores", '{category="provider-root"}')).toBe(1.5);
      active = false;
      const settled = await (await handler(new Request("http://metrics.test/metrics"))).text();
      expect(metric(settled, "t3_agents_running")).toBe(0);
      expect(metric(settled, "t3_provider_turns_active", '{provider="unknown"}')).toBe(0);
      expect(
        metric(settled, "t3_provider_turns_waiting", '{provider="unknown",reason="approval"}'),
      ).toBe(0);
    } finally {
      await dispose();
    }
  });

  it("keeps the endpoint opt-in", async () => {
    const { handler, dispose } = HttpRouter.toWebHandler(
      PrometheusRoute.layer.pipe(Layer.provide(layerDependencies(false, () => []))),
      { disableLogger: true },
    );
    try {
      expect((await handler(new Request("http://metrics.test/metrics"))).status).toBe(404);
    } finally {
      await dispose();
    }
  });
});
