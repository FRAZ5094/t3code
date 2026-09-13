import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, type PushNotificationRegistrationInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import type {
  OrchestrationEvent,
  OrchestrationThreadShell,
  OrchestrationProjectShell,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { FcmClient, FcmClientError } from "@t3tools/shared/agentNotifications/FcmClient";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionThreadMessageRepository } from "../persistence/Services/ProjectionThreadMessages.ts";
import { make } from "./PushNotificationService.ts";

const registration: PushNotificationRegistrationInput = {
  deviceId: "phone",
  platform: "android",
  fcmToken: "native-token",
  label: "Pixel",
  preferences: {
    notificationsEnabled: true,
    liveActivitiesEnabled: true,
    notifyOnApproval: true,
    notifyOnInput: true,
    notifyOnCompletion: true,
    notifyOnFailure: true,
  },
};
const setup = (
  options: {
    configured?: boolean;
    unregistered?: boolean;
    snapshot?: ProjectionSnapshotQuery["Service"];
    events?: Stream.Stream<OrchestrationEvent>;
  } = {},
) => {
  const secrets = new Map<string, Uint8Array>();
  const sent: Array<Parameters<FcmClient["Service"]["send"]>[0]> = [];
  const service = make.pipe(
    Effect.provideService(ServerSecretStore, {
      get: (key: string) => Effect.sync(() => Option.fromNullishOr(secrets.get(key))),
      set: (key: string, value: Uint8Array) =>
        Effect.sync(() => {
          secrets.set(key, value);
        }),
    } as unknown as ServerSecretStore["Service"]),
    Effect.provideService(ServerEnvironment, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("env")),
    } as ServerEnvironment["Service"]),
    Effect.provideService(
      ProjectionSnapshotQuery,
      options.snapshot ??
        ({
          getShellSnapshot: () => Effect.succeed({ projects: [], threads: [] }),
        } as unknown as ProjectionSnapshotQuery["Service"]),
    ),
    Effect.provideService(
      ProjectionThreadMessageRepository,
      {} as ProjectionThreadMessageRepository["Service"],
    ),
    Effect.provideService(OrchestrationEngineService, {
      streamDomainEvents: options.events ?? Stream.never,
    } as unknown as OrchestrationEngineService["Service"]),
    Effect.provideService(FcmClient, {
      checkConfiguration:
        options.configured === false
          ? Effect.fail(new FcmClientError({ operation: "configuration", status: null }))
          : Effect.void,
      send: (input) =>
        Effect.sync(() => {
          sent.push(input);
          return { unregistered: options.unregistered ?? false };
        }),
    }),
  );
  const stored = () =>
    [...secrets.values()].flatMap(
      (value) => JSON.parse(new TextDecoder().decode(value)) as PushNotificationRegistrationInput[],
    );
  return { service, sent, stored };
};

describe("direct push registration", () => {
  it.effect("rejects registration when Firebase credentials are missing", () =>
    Effect.gen(function* () {
      const harness = setup({ configured: false });
      const service = yield* harness.service;
      const error = yield* Effect.flip(service.register(registration));
      expect(error.reason).toContain("T3CODE_FCM_SERVICE_ACCOUNT_FILE");
      expect(harness.stored()).toEqual([]);
    }).pipe(Effect.scoped),
  );
  it.effect("persists concurrent registrations and silently replays via native FCM", () =>
    Effect.gen(function* () {
      const harness = setup();
      const service = yield* harness.service;
      yield* Effect.all(
        [
          service.register(registration),
          service.register({ ...registration, deviceId: "second", fcmToken: "second-token" }),
        ],
        { concurrency: "unbounded" },
      );
      yield* service.drain;
      expect(
        harness
          .stored()
          .map((row) => row.deviceId)
          .sort(),
      ).toEqual(["phone", "second"]);
      expect(harness.sent).toHaveLength(2);
      expect(harness.sent[0]).toMatchObject({
        token: "native-token",
        alert: false,
        data: { environment_id: "env", device_id: "phone", t3_kind: "agent_activity" },
      });
      yield* service.unregister({ deviceId: "phone" });
      expect(harness.stored().map((row) => row.deviceId)).toEqual(["second"]);
    }).pipe(Effect.scoped),
  );
  it.effect(
    "delivers completion after a projected running turn without replaying an alert on registration",
    () =>
      Effect.gen(function* () {
        const consumed = yield* Deferred.make<void>();
        const now = DateTime.formatIso(yield* DateTime.now);
        const project = { id: "project", title: "Notification tests" } as OrchestrationProjectShell;
        const base = {
          id: "thread",
          projectId: "project",
          title: "Verify notification delivery",
          archivedAt: null,
          updatedAt: now,
          modelSelection: { instanceId: "codex", model: "gpt-5.4" },
          hasPendingApprovals: false,
          hasPendingUserInput: false,
          session: { status: "running", updatedAt: now },
          latestTurn: null,
        } as unknown as OrchestrationThreadShell;
        const completed = {
          ...base,
          session: null,
          latestTurn: {
            turnId: "turn",
            state: "completed",
            requestedAt: now,
            startedAt: now,
            completedAt: now,
            assistantMessageId: null,
          },
        } as OrchestrationThreadShell;
        const harness = setup({
          snapshot: {
            getShellSnapshot: () => Effect.succeed({ projects: [project], threads: [base] }),
            getThreadShellById: () => Effect.succeed(Option.some(completed)),
            getProjectShellById: () => Effect.succeed(Option.some(project)),
          } as unknown as ProjectionSnapshotQuery["Service"],
          events: Stream.make({
            type: "thread.session-set",
            aggregateKind: "thread",
            aggregateId: "thread",
            payload: { threadId: "thread" },
            metadata: {},
          } as OrchestrationEvent).pipe(
            Stream.concat(
              Stream.fromEffect(Deferred.succeed(consumed, undefined)).pipe(Stream.drain),
            ),
          ),
        });
        const service = yield* harness.service;
        yield* service.register(registration);
        yield* service.drain;
        yield* service.start();
        yield* Deferred.await(consumed);
        yield* service.drain;
        const alerts = harness.sent.filter((message) => message.alert);
        expect(alerts).toHaveLength(1);
        expect(alerts[0]?.data).toMatchObject({
          alert_title: "Verify notification delivery",
          active: "false",
          alert_path: "/threads/env/thread",
        });
      }).pipe(Effect.scoped),
  );
  it.effect("removes Firebase's unregistered token from persistent registrations", () =>
    Effect.gen(function* () {
      const harness = setup({ unregistered: true });
      const service = yield* harness.service;
      yield* service.register(registration);
      yield* service.drain;
      expect(harness.stored()).toEqual([]);
    }).pipe(Effect.scoped),
  );
});
