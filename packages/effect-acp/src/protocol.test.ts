import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";

import { it, assert } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";

import * as AcpProtocol from "./protocol";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const UnknownJson = Schema.UnknownFromJsonString;

const encodeJson = Schema.encodeSync(UnknownJson);
const decodeJson = Schema.decodeUnknownSync(UnknownJson);

function makeInMemoryStdio() {
  return Effect.gen(function* () {
    const input = yield* Queue.unbounded<Uint8Array>();
    const output = yield* Queue.unbounded<string>();

    return {
      stdio: Stdio.make({
        args: Effect.succeed([]),
        stdin: Stream.fromQueue(input),
        stdout: () =>
          Sink.forEach((chunk: string | Uint8Array) =>
            Queue.offer(output, typeof chunk === "string" ? chunk : decoder.decode(chunk)),
          ),
        stderr: () => Sink.drain,
      }),
      input,
      output,
    };
  });
}

it.layer(NodeServices.layer)("effect-acp protocol", (it) => {
  it.effect(
    "emits exact JSON-RPC notifications and decodes inbound session/update and elicitation completion",
    () =>
      Effect.gen(function* () {
        const { stdio, input, output } = yield* makeInMemoryStdio();
        const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
          stdio,
          serverRequestMethods: new Set(),
        });

        const notifications =
          yield* Deferred.make<ReadonlyArray<AcpProtocol.AcpIncomingNotification>>();
        yield* transport.notifications.incoming.pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.flatMap((notificationChunk) => Deferred.succeed(notifications, notificationChunk)),
          Effect.forkScoped,
        );

        yield* transport.notifications.sendSessionCancel({ sessionId: "session-1" });
        const outbound = yield* Queue.take(output);
        assert.deepEqual(decodeJson(outbound), {
          jsonrpc: "2.0",
          method: "session/cancel",
          params: {
            sessionId: "session-1",
          },
        });

        yield* Queue.offer(
          input,
          encoder.encode(
            `${encodeJson({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: "session-1",
                update: {
                  sessionUpdate: "plan",
                  entries: [
                    {
                      content: "Inspect repository",
                      priority: "high",
                      status: "in_progress",
                    },
                  ],
                },
              },
            })}\n`,
          ),
        );

        yield* Queue.offer(
          input,
          encoder.encode(
            `${encodeJson({
              jsonrpc: "2.0",
              method: "session/elicitation/complete",
              params: {
                elicitationId: "elicitation-1",
              },
            })}\n`,
          ),
        );

        const [update, completion] = yield* Deferred.await(notifications);
        assert.equal(update?._tag, "SessionUpdate");
        assert.equal(completion?._tag, "ElicitationComplete");
      }),
  );

  it.effect("logs outgoing notifications when logOutgoing is enabled", () =>
    Effect.gen(function* () {
      const { stdio } = yield* makeInMemoryStdio();
      const events: Array<AcpProtocol.AcpProtocolLogEvent> = [];
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(),
        logOutgoing: true,
        logger: (event) =>
          Effect.sync(() => {
            events.push(event);
          }),
      });

      yield* transport.notifications.sendSessionCancel({ sessionId: "session-1" });

      assert.deepEqual(events, [
        {
          direction: "outgoing",
          stage: "decoded",
          payload: {
            jsonrpc: "2.0",
            method: "session/cancel",
            params: {
              sessionId: "session-1",
            },
          },
        },
        {
          direction: "outgoing",
          stage: "raw",
          payload:
            '{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"session-1"}}\n',
        },
      ]);
    }),
  );

  it.effect("supports generic extension requests over the patched transport", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
        stdio,
        serverRequestMethods: new Set(),
      });

      const response = yield* transport
        .sendRequest("x/test", { hello: "world" })
        .pipe(Effect.forkScoped);
      const outbound = yield* Queue.take(output);
      assert.deepEqual(decodeJson(outbound), {
        jsonrpc: "2.0",
        id: 1,
        method: "x/test",
        params: {
          hello: "world",
        },
        headers: [],
      });

      yield* Queue.offer(
        input,
        encoder.encode(
          `${encodeJson({
            jsonrpc: "2.0",
            id: 1,
            result: {
              ok: true,
            },
          })}\n`,
        ),
      );

      const resolved = yield* Fiber.join(response);
      assert.deepEqual(resolved, { ok: true });
    }),
  );
});
