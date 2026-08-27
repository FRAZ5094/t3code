import type { HostPowerThermalState, ResourceTelemetryProcessCategory } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { PrometheusMetrics } from "effect/unstable/observability";

import * as ServerConfig from "../config.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ResourceTelemetry from "../resourceTelemetry/ResourceTelemetry.ts";
import {
  agentsRunning,
  hostThermalState,
  metricAttributes,
  processCpuCores,
  processes,
  projects,
  providerSessionsActive,
  providerTurnsActive,
  providerTurnsWaiting,
  resourceMonitorRestarts,
  resourceMonitorUp,
  resourceSampleAgeSeconds,
  threads,
  worktreesActive,
} from "./Metrics.ts";

const PROCESS_CATEGORIES: ReadonlyArray<ResourceTelemetryProcessCategory> = [
  "server",
  "server-child",
  "provider-root",
  "terminal-root",
  "electron-main",
  "electron-renderer",
  "electron-gpu",
  "electron-utility",
  "resource-monitor",
  "unknown-t3",
];

const THERMAL_STATES: ReadonlyArray<HostPowerThermalState> = [
  "unknown",
  "nominal",
  "fair",
  "serious",
  "critical",
];

const setGauge = (
  gauge: Metric.Metric<number, unknown>,
  value: number,
  attributes: Readonly<Record<string, unknown>> = {},
) => Metric.update(Metric.withAttributes(gauge, metricAttributes(attributes)), value);

const seriesKey = (...parts: ReadonlyArray<string>) => parts.join("\u0000");

const updateRuntimeMetrics = Effect.fn("PrometheusRoute.updateRuntimeMetrics")(function* (
  observedProviderSeries: Ref.Ref<ReadonlySet<string>>,
) {
  const projection = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const telemetry = yield* ResourceTelemetry.ResourceTelemetry;
  const shell = yield* projection.getShellSnapshot();

  yield* Effect.all(
    [
      setGauge(projects, shell.projects.length),
      setGauge(threads, shell.threads.length),
      setGauge(
        worktreesActive,
        new Set(
          shell.threads.flatMap((thread) =>
            thread.worktreePath === null ? [] : [thread.worktreePath],
          ),
        ).size,
      ),
    ],
    { discard: true },
  );

  const sessions = new Map<string, number>();
  const activeTurns = new Map<string, number>();
  const waitingTurns = new Map<string, number>();
  for (const thread of shell.threads) {
    if (thread.session === null) continue;
    const provider = thread.session.providerName ?? "unknown";
    const sessionKey = seriesKey(provider, thread.session.status);
    sessions.set(sessionKey, (sessions.get(sessionKey) ?? 0) + 1);
    if (thread.session.activeTurnId !== null) {
      activeTurns.set(provider, (activeTurns.get(provider) ?? 0) + 1);
      if (thread.hasPendingApprovals) {
        const key = seriesKey(provider, "approval");
        waitingTurns.set(key, (waitingTurns.get(key) ?? 0) + 1);
      }
      if (thread.hasPendingUserInput) {
        const key = seriesKey(provider, "user-input");
        waitingTurns.set(key, (waitingTurns.get(key) ?? 0) + 1);
      }
    }
  }

  yield* setGauge(
    agentsRunning,
    [...activeTurns.values()].reduce((total, count) => total + count, 0),
  );

  const currentProviderSeries = new Set([
    ...sessions.keys(),
    ...activeTurns.keys(),
    ...waitingTurns.keys(),
  ]);
  const allProviderSeries = yield* Ref.modify(observedProviderSeries, (previous) => {
    const all = new Set([...previous, ...currentProviderSeries]);
    return [all, all] as const;
  });
  yield* Effect.forEach(
    allProviderSeries,
    (key) => {
      const [provider, qualifier] = key.split("\u0000");
      if (qualifier === undefined) {
        return setGauge(providerTurnsActive, activeTurns.get(key) ?? 0, { provider });
      }
      if (qualifier === "approval" || qualifier === "user-input") {
        return setGauge(providerTurnsWaiting, waitingTurns.get(key) ?? 0, {
          provider,
          reason: qualifier,
        });
      }
      return setGauge(providerSessionsActive, sessions.get(key) ?? 0, {
        provider,
        status: qualifier,
      });
    },
    { discard: true },
  );

  const telemetryResult = yield* Effect.result(telemetry.refresh);
  const snapshot = Result.isSuccess(telemetryResult)
    ? telemetryResult.success
    : yield* telemetry.latest;
  const now = yield* Clock.currentTimeMillis;

  yield* Effect.all(
    [
      setGauge(resourceMonitorUp, Result.isSuccess(telemetryResult) ? 1 : 0),
      setGauge(
        resourceSampleAgeSeconds,
        Math.max(0, now - DateTime.toEpochMillis(snapshot.readAt)) / 1_000,
      ),
      setGauge(resourceMonitorRestarts, snapshot.health.restartCount),
      ...THERMAL_STATES.map((state) =>
        setGauge(hostThermalState, snapshot.power.thermalState === state ? 1 : 0, { state }),
      ),
    ],
    { discard: true },
  );

  if (Result.isFailure(telemetryResult)) return;

  const processCountByCategory = new Map<ResourceTelemetryProcessCategory, number>();
  const cpuCoresByCategory = new Map<ResourceTelemetryProcessCategory, number>();
  for (const process of snapshot.processes) {
    processCountByCategory.set(
      process.category,
      (processCountByCategory.get(process.category) ?? 0) + 1,
    );
    cpuCoresByCategory.set(
      process.category,
      (cpuCoresByCategory.get(process.category) ?? 0) + process.cpuPercent / 100,
    );
  }
  yield* Effect.forEach(
    PROCESS_CATEGORIES,
    (category) =>
      Effect.all(
        [
          setGauge(processes, processCountByCategory.get(category) ?? 0, { category }),
          setGauge(processCpuCores, cpuCoresByCategory.get(category) ?? 0, { category }),
        ],
        { discard: true },
      ),
    { discard: true },
  );
});

export const prometheusMetricsRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    if (!config.prometheusMetricsEnabled) return Layer.empty;

    const observedProviderSeries = yield* Ref.make<ReadonlySet<string>>(new Set());
    return HttpRouter.add(
      "GET",
      "/metrics",
      updateRuntimeMetrics(observedProviderSeries).pipe(
        Effect.andThen(PrometheusMetrics.format()),
        Effect.map((body) =>
          HttpServerResponse.text(body, {
            contentType: "text/plain; version=0.0.4; charset=utf-8",
          }),
        ),
      ),
    );
  }),
);
