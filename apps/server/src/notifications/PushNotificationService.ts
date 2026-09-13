import * as Clock from "effect/Clock";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import { FcmClient } from "@t3tools/shared/agentNotifications/FcmClient";
import * as DirectFcm from "./DirectFcm.ts";
import { directPushPayload } from "./DirectPushPayload.ts";
import type {
  MessageId,
  OrchestrationEvent,
  PushNotificationRegistrationInput,
  PushNotificationRegistrationResult,
  PushNotificationUnregistrationInput,
  ThreadId,
} from "@t3tools/contracts";
import { PushNotificationError, PushNotificationPreferences } from "@t3tools/contracts";
import type { AgentAwarenessState } from "@t3tools/shared/agentAwareness";
import { projectThreadAwareness } from "@t3tools/shared/agentAwareness";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { ProjectionThreadMessageRepository } from "../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionThreadMessageRepositoryLive } from "../persistence/Layers/ProjectionThreadMessages.ts";
import {
  agentAwarenessPublishIdentity,
  eventThreadId,
  shouldPublishAgentAwarenessEvent,
} from "../relay/AgentAwarenessRelay.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { forkParked } from "../serverActivation.ts";
import { type PushNotificationApprovalContext } from "./PushNotificationContent.ts";

const PUSH_REGISTRATIONS_SECRET = "direct-fcm-notification-registrations";

const StoredPushRegistrations = Schema.Array(
  Schema.Struct({
    deviceId: Schema.String,
    platform: Schema.Literal("android"),
    fcmToken: Schema.String,
    appIdentifier: Schema.optionalKey(Schema.String),
    appVersion: Schema.optionalKey(Schema.String),
    label: Schema.String,
    preferences: PushNotificationPreferences,
  }),
);
const StoredPushRegistrationsJson = Schema.fromJsonString(StoredPushRegistrations);
const decodeStoredPushRegistrations = Schema.decodeEffect(StoredPushRegistrationsJson);
const encodeStoredPushRegistrations = Schema.encodeEffect(StoredPushRegistrationsJson);

type StoredPushRegistration = (typeof StoredPushRegistrations.Type)[number];

function pushError(
  operation: "register" | "unregister" | "send",
  reason: string,
): PushNotificationError {
  return new PushNotificationError({ operation, reason });
}

function approvalContextFromEvent(
  event: OrchestrationEvent,
): PushNotificationApprovalContext | null {
  if (event.type !== "thread.activity-appended") {
    return null;
  }
  const activity = event.payload.activity;
  if (activity.kind !== "approval.requested") {
    return null;
  }
  const payload =
    typeof activity.payload === "object" && activity.payload !== null
      ? (activity.payload as Record<string, unknown>)
      : null;
  return {
    summary: activity.summary,
    ...(typeof payload?.detail === "string" ? { detail: payload.detail } : {}),
    ...(typeof payload?.appName === "string" ? { appName: payload.appName } : {}),
  };
}

export class PushNotificationService extends Context.Service<
  PushNotificationService,
  {
    readonly register: (
      input: PushNotificationRegistrationInput,
    ) => Effect.Effect<PushNotificationRegistrationResult, PushNotificationError>;
    readonly unregister: (
      input: PushNotificationUnregistrationInput,
    ) => Effect.Effect<void, PushNotificationError>;
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/notifications/PushNotificationService") {}

export const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const snapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const projectionThreadMessageRepository = yield* ProjectionThreadMessageRepository;
  const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
  const fcm = yield* FcmClient;
  const registrationLock = yield* Semaphore.make(1);
  const registrationsRef = yield* Ref.make(new Map<string, StoredPushRegistration>());

  const readStoredRegistrations = Effect.gen(function* () {
    const raw = yield* secrets.get(PUSH_REGISTRATIONS_SECRET);
    if (Option.isNone(raw) || raw.value.length === 0) {
      return [] as ReadonlyArray<StoredPushRegistration>;
    }
    return yield* decodeStoredPushRegistrations(new TextDecoder().decode(raw.value)).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Ignoring invalid push notification registrations", { cause }).pipe(
          Effect.as([] as ReadonlyArray<StoredPushRegistration>),
        ),
      ),
    );
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("Could not load push notification registrations", { cause }).pipe(
        Effect.as([] as ReadonlyArray<StoredPushRegistration>),
      ),
    ),
  );

  const initialRegistrations = yield* readStoredRegistrations;
  yield* Ref.set(
    registrationsRef,
    new Map(initialRegistrations.map((registration) => [registration.deviceId, registration])),
  );

  const persistRegistrations = (registrations: ReadonlyMap<string, StoredPushRegistration>) =>
    encodeStoredPushRegistrations([...registrations.values()]).pipe(
      Effect.map((encoded) => new TextEncoder().encode(encoded)),
      Effect.flatMap((encoded) => secrets.set(PUSH_REGISTRATIONS_SECRET, encoded)),
      Effect.mapError(() => pushError("register", "Could not persist the device registration.")),
    );

  const register: PushNotificationService["Service"]["register"] = (input) =>
    Effect.gen(function* () {
      // Validate sender configuration before claiming this environment can deliver.
      yield* fcm.checkConfiguration.pipe(
        Effect.mapError(() =>
          pushError(
            "register",
            "Set T3CODE_FCM_SERVICE_ACCOUNT_FILE on this environment to enable Android notifications.",
          ),
        ),
      );
      const current = yield* Ref.get(registrationsRef);
      const next = new Map(current);
      next.set(input.deviceId, input);
      yield* persistRegistrations(next);
      yield* Ref.set(registrationsRef, next);
      yield* deliveryWorker.enqueue({ replayDeviceId: input.deviceId });
      return { registered: true } as const;
    }).pipe(registrationLock.withPermit);

  const unregister: PushNotificationService["Service"]["unregister"] = (input) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(registrationsRef);
      if (!current.has(input.deviceId)) {
        return;
      }
      const next = new Map(current);
      next.delete(input.deviceId);
      yield* persistRegistrations(next).pipe(
        Effect.mapError(
          (error) => new PushNotificationError({ operation: "unregister", reason: error.reason }),
        ),
      );
      yield* Ref.set(registrationsRef, next);
    }).pipe(registrationLock.withPermit);

  const readThreadState = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const thread = yield* snapshotQuery.getThreadShellById(threadId);
      if (Option.isNone(thread) || thread.value.archivedAt !== null) {
        return null;
      }
      const project = yield* snapshotQuery.getProjectShellById(thread.value.projectId);
      if (Option.isNone(project)) {
        return null;
      }
      const state = projectThreadAwareness({
        environmentId: yield* serverEnvironment.getEnvironmentId,
        project: project.value,
        thread: thread.value,
      });
      return state === null
        ? null
        : {
            state,
            assistantMessageId: thread.value.latestTurn?.assistantMessageId ?? null,
          };
    });

  const readAssistantMessageText = (messageId: MessageId | null) =>
    messageId === null
      ? Effect.succeed(null)
      : projectionThreadMessageRepository.getByMessageId({ messageId }).pipe(
          Effect.map((message) =>
            Option.isSome(message) && message.value.role === "assistant"
              ? message.value.text
              : null,
          ),
          Effect.orElseSucceed(() => null),
        );

  const stateByThread = new Map<ThreadId, AgentAwarenessState>();
  const contentByThread = new Map<
    string,
    { assistantMessageText: string | null; approvalContext: PushNotificationApprovalContext | null }
  >();
  const deliveredByDevice = new Map<string, ReadonlyArray<AgentAwarenessState>>();

  const deliveryWorker = yield* makeDrainableWorker(
    Effect.fn("PushNotificationService.deliver")(function* (job: { replayDeviceId?: string }) {
      const registrations = yield* Ref.get(registrationsRef);
      const environmentId = yield* serverEnvironment.getEnvironmentId;
      const states = [...stateByThread.values()];
      for (const registration of registrations.values()) {
        if (job.replayDeviceId && registration.deviceId !== job.replayDeviceId) continue;
        const previous = deliveredByDevice.get(registration.deviceId) ?? states;
        const nowMs = yield* Clock.currentTimeMillis;
        const data = directPushPayload({
          environmentId,
          registration,
          states,
          previousStates: previous,
          nowMs,
          replay: job.replayDeviceId !== undefined,
          content: contentByThread,
        });
        const result = yield* fcm
          .send({
            token: registration.fcmToken,
            packageName: registration.appIdentifier ?? null,
            data,
            alert: data.alert_id !== undefined,
          })
          .pipe(
            Effect.retry({
              times: 2,
              schedule: Schedule.exponential("1 second"),
              while: (error) =>
                error.operation !== "configuration" &&
                (error.status === null ||
                  error.status === 401 ||
                  error.status === 429 ||
                  error.status >= 500),
            }),
            Effect.option,
          );
        if (Option.isNone(result)) {
          yield* Effect.logWarning("Android notification delivery failed", {
            deviceId: registration.deviceId,
          });
          continue;
        }
        if (result.value.unregistered) {
          yield* registrationLock.withPermit(
            Effect.gen(function* () {
              const current = yield* Ref.get(registrationsRef);
              if (current.get(registration.deviceId)?.fcmToken !== registration.fcmToken) return;
              const next = new Map(current);
              next.delete(registration.deviceId);
              yield* persistRegistrations(next).pipe(Effect.ignore);
              yield* Ref.set(registrationsRef, next);
            }),
          );
        } else {
          deliveredByDevice.set(registration.deviceId, states);
        }
      }
    }),
  );

  const processThread = Effect.fn("PushNotificationService.processThread")(function* (input: {
    readonly threadId: ThreadId;
    readonly approvalContext: PushNotificationApprovalContext | null;
  }) {
    const context = yield* readThreadState(input.threadId);
    const previous = stateByThread.get(input.threadId);
    if (context === null) {
      stateByThread.delete(input.threadId);
      contentByThread.delete(input.threadId);
    } else {
      if (
        agentAwarenessPublishIdentity(previous ?? null) ===
        agentAwarenessPublishIdentity(context.state)
      )
        return;
      stateByThread.set(input.threadId, context.state);
      contentByThread.set(input.threadId, {
        approvalContext: input.approvalContext,
        assistantMessageText:
          context.state.phase === "completed"
            ? yield* readAssistantMessageText(context.assistantMessageId)
            : null,
      });
    }
    if (!previous && !context) return;
    yield* deliveryWorker.enqueue({});
  });

  const seedState = Effect.gen(function* () {
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    const snapshot = yield* snapshotQuery.getShellSnapshot();
    const projects = new Map(snapshot.projects.map((project) => [project.id, project]));
    for (const thread of snapshot.threads) {
      const project = projects.get(thread.projectId);
      const state = project ? projectThreadAwareness({ environmentId, project, thread }) : null;
      if (state && thread.archivedAt === null) stateByThread.set(thread.id, state);
    }
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("Could not seed push notification awareness state", { cause }),
    ),
  );

  const worker = yield* makeDrainableWorker((input: Parameters<typeof processThread>[0]) =>
    processThread(input).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not project Android notification state", { cause }),
      ),
    ),
  );

  const start: PushNotificationService["Service"]["start"] = Effect.fn(
    "PushNotificationService.start",
  )(function* () {
    yield* seedState;
    for (const registration of (yield* Ref.get(registrationsRef)).values()) {
      deliveredByDevice.set(registration.deviceId, [...stateByThread.values()]);
      yield* deliveryWorker.enqueue({ replayDeviceId: registration.deviceId });
    }
    yield* forkParked(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event: OrchestrationEvent) => {
        const threadId = eventThreadId(event);
        if (threadId === null || !shouldPublishAgentAwarenessEvent(event)) {
          return Effect.void;
        }
        return worker.enqueue({ threadId, approvalContext: approvalContextFromEvent(event) });
      }),
    );
  });

  return PushNotificationService.of({
    register,
    unregister,
    start,
    drain: worker.drain.pipe(Effect.andThen(deliveryWorker.drain)),
  });
});

export const layer = Layer.effect(PushNotificationService, make).pipe(
  Layer.provideMerge(ProjectionThreadMessageRepositoryLive),
  Layer.provide(DirectFcm.layer),
);
