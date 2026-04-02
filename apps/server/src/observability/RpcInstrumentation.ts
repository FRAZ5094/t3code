import { Effect, Stream } from "effect";

import { rpcRequestDuration, rpcRequestsTotal, withMetrics } from "./Metrics.ts";

export const observeRpcEffect = <A, E, R>(
  method: string,
  effect: Effect.Effect<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan({
      "rpc.method": method,
      ...traceAttributes,
    });

    return yield* effect.pipe(
      withMetrics({
        counter: rpcRequestsTotal,
        timer: rpcRequestDuration,
        attributes: {
          method,
        },
      }),
    );
  });

export const observeRpcStream = <A, E, R>(
  method: string,
  stream: Stream.Stream<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
) => Stream.unwrap(observeRpcEffect(method, Effect.succeed(stream), traceAttributes));

export const observeRpcStreamEffect = <A, StreamError, StreamContext, EffectError, EffectContext>(
  method: string,
  effect: Effect.Effect<Stream.Stream<A, StreamError, StreamContext>, EffectError, EffectContext>,
  traceAttributes?: Readonly<Record<string, unknown>>,
) => Stream.unwrap(observeRpcEffect(method, effect, traceAttributes));
