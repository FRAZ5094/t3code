import { assert, describe, it } from "@effect/vitest";
import { Effect, Metric } from "effect";

import { withMetrics } from "./Metrics.ts";

const hasMetricSnapshot = (
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
  id: string,
  attributes: Readonly<Record<string, string>>,
) =>
  snapshots.some(
    (snapshot) =>
      snapshot.id === id &&
      Object.entries(attributes).every(([key, value]) => snapshot.attributes?.[key] === value),
  );

describe("withMetrics", () => {
  it.effect("supports pipe-style usage", () =>
    Effect.gen(function* () {
      const counter = Metric.counter("with_metrics_pipe_total");
      const timer = Metric.timer("with_metrics_pipe_duration");

      const result = yield* Effect.succeed("ok").pipe(
        withMetrics({
          counter,
          timer,
          attributes: {
            operation: "pipe",
          },
        }),
      );

      assert.equal(result, "ok");

      const snapshots = yield* Metric.snapshot;
      assert.equal(
        hasMetricSnapshot(snapshots, "with_metrics_pipe_total", {
          operation: "pipe",
          outcome: "success",
        }),
        true,
      );
      assert.equal(
        hasMetricSnapshot(snapshots, "with_metrics_pipe_duration", {
          operation: "pipe",
        }),
        true,
      );
    }),
  );

  it.effect("supports direct invocation", () =>
    Effect.gen(function* () {
      const counter = Metric.counter("with_metrics_direct_total");

      yield* withMetrics(Effect.fail("boom"), {
        counter,
        attributes: {
          operation: "direct",
        },
      }).pipe(Effect.exit);

      const snapshots = yield* Metric.snapshot;
      assert.equal(
        hasMetricSnapshot(snapshots, "with_metrics_direct_total", {
          operation: "direct",
          outcome: "failure",
        }),
        true,
      );
    }),
  );
});
