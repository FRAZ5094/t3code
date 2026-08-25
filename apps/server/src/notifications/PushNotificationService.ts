import type {
  EnvironmentId,
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
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { eventThreadId, shouldPublishAgentAwarenessEvent } from "../relay/AgentAwarenessRelay.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { forkParked } from "../serverActivation.ts";

const PUSH_REGISTRATIONS_SECRET = "push-notification-registrations";
const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";

const StoredPushRegistrations = Schema.Array(
  Schema.Struct({
    deviceId: Schema.String,
    platform: Schema.Literal("android"),
    expoPushToken: Schema.String,
    appIdentifier: Schema.optionalKey(Schema.String),
    appVersion: Schema.optionalKey(Schema.String),
    label: Schema.String,
    preferences: PushNotificationPreferences,
  }),
);
const StoredPushRegistrationsJson = Schema.fromJsonString(StoredPushRegistrations);

type StoredPushRegistration = (typeof StoredPushRegistrations.Type)[number];

const ExpoPushTicket = Schema.Struct({
  status: Schema.Literals(["ok", "error"]),
  message: Schema.optional(Schema.String),
});

const ExpoPushResponse = Schema.Struct({
  data: Schema.Union([ExpoPushTicket, Schema.Array(ExpoPushTicket)]),
});

const decodeExpoPushResponse = Schema.decodeUnknownEffect(ExpoPushResponse);
const decodeStoredPushRegistrations = Schema.decodeEffect(StoredPushRegistrationsJson);
const encodeStoredPushRegistrations = Schema.encodeEffect(StoredPushRegistrationsJson);

const notifiablePhase = (
  phase: AgentAwarenessState["phase"],
): "approval" | "completion" | "failure" | null => {
  switch (phase) {
    case "waiting_for_approval":
      return "approval";
    case "completed":
      return "completion";
    case "failed":
      return "failure";
    default:
      return null;
  }
};

function pushError(
  operation: "register" | "unregister" | "send",
  reason: string,
): PushNotificationError {
  return new PushNotificationError({
    operation,
    reason: reason.trim() || "Unknown error.",
  });
}

function pushStateIdentity(state: AgentAwarenessState | null): string {
  return state?.phase ?? "none";
}

function notificationTitle(phase: "approval" | "completion" | "failure"): string {
  switch (phase) {
    case "approval":
      return "Approval needed";
    case "completion":
      return "Agent finished";
    case "failure":
      return "Agent failed";
  }
}

function notificationBody(state: AgentAwarenessState): string {
  const threadTitle = state.threadTitle.trim();
  const projectTitle = state.projectTitle.trim();
  if (threadTitle && projectTitle) {
    return `${threadTitle} · ${projectTitle}`;
  }
  return threadTitle || projectTitle || "An agent needs your attention.";
}

function shouldDeliverToPreferences(
  preferences: PushNotificationPreferences,
  phase: "approval" | "completion" | "failure",
): boolean {
  if (!preferences.notificationsEnabled) {
    return false;
  }
  switch (phase) {
    case "approval":
      return preferences.notifyOnApproval;
    case "completion":
      return preferences.notifyOnCompletion;
    case "failure":
      return preferences.notifyOnFailure;
  }
}

function expoPushMessage(input: {
  readonly environmentId: EnvironmentId;
  readonly state: AgentAwarenessState;
  readonly phase: "approval" | "completion" | "failure";
  readonly expoPushToken: string;
}) {
  return {
    to: input.expoPushToken,
    title: notificationTitle(input.phase),
    body: notificationBody(input.state),
    priority: "high" as const,
    channelId: "agent-awareness",
    data: {
      type: "agent-awareness",
      environmentId: input.environmentId,
      threadId: input.state.threadId,
      phase: input.state.phase,
      deepLink: input.state.deepLink,
    },
  };
}

function makeExpoPushRequest(message: ReturnType<typeof expoPushMessage>) {
  return HttpClientRequest.post(EXPO_PUSH_API_URL).pipe(
    HttpClientRequest.bodyJsonUnsafe(message),
    HttpClientRequest.setHeader("accept", "application/json"),
  );
}

function sendExpoPushMessage(message: ReturnType<typeof expoPushMessage>) {
  return Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const response = yield* httpClient
      .execute(makeExpoPushRequest(message))
      .pipe(Effect.mapError(() => pushError("send", "Could not reach Expo Push Service.")));
    if (response.status < 200 || response.status >= 300) {
      return yield* pushError("send", `Expo Push Service returned HTTP ${response.status}.`);
    }
    const decoded = yield* response.json.pipe(
      Effect.flatMap(decodeExpoPushResponse),
      Effect.mapError(() => pushError("send", "Expo Push Service returned invalid JSON.")),
    );
    const tickets = Array.isArray(decoded.data) ? decoded.data : [decoded.data];
    const failedTicket = tickets.find((ticket) => ticket.status === "error");
    if (failedTicket) {
      return yield* pushError("send", failedTicket.message ?? "Expo rejected the push token.");
    }
  }).pipe(Effect.provide(FetchHttpClient.layer));
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
  }
>()("t3/notifications/PushNotificationService") {}

export const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const snapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
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
      const current = yield* Ref.get(registrationsRef);
      const next = new Map(current);
      next.set(input.deviceId, input);
      yield* persistRegistrations(next);
      yield* Ref.set(registrationsRef, next);
      return { registered: true } as const;
    });

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
    });

  const readThreadState = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const thread = yield* snapshotQuery.getThreadShellById(threadId);
      if (Option.isNone(thread)) {
        return null;
      }
      const project = yield* snapshotQuery.getProjectShellById(thread.value.projectId);
      if (Option.isNone(project)) {
        return null;
      }
      return projectThreadAwareness({
        environmentId: yield* serverEnvironment.getEnvironmentId,
        project: project.value,
        thread: thread.value,
      });
    });

  const sendForState = (state: AgentAwarenessState) =>
    Effect.gen(function* () {
      const phase = notifiablePhase(state.phase);
      if (phase === null) {
        return;
      }
      const environmentId = yield* serverEnvironment.getEnvironmentId;
      const registrations = yield* Ref.get(registrationsRef);
      yield* Effect.forEach(
        [...registrations.values()].filter((registration) =>
          shouldDeliverToPreferences(registration.preferences, phase),
        ),
        (registration) =>
          sendExpoPushMessage(
            expoPushMessage({
              environmentId,
              state,
              phase,
              expoPushToken: registration.expoPushToken,
            }),
          ).pipe(
            Effect.tapError((error) =>
              Effect.logWarning("Agent push notification delivery failed", {
                deviceId: registration.deviceId,
                phase,
                reason: error.reason,
              }),
            ),
            Effect.ignore,
          ),
        { concurrency: 4, discard: true },
      );
    });

  const stateByThread = new Map<ThreadId, string>();
  const processThread = Effect.fn("PushNotificationService.processThread")(function* (
    threadId: ThreadId,
  ) {
    const state = yield* readThreadState(threadId);
    const previousIdentity = stateByThread.get(threadId);
    const identity = pushStateIdentity(state);
    stateByThread.set(threadId, identity);
    if (previousIdentity === undefined || previousIdentity === identity || state === null) {
      return;
    }
    if (notifiablePhase(state.phase) === null) {
      return;
    }
    yield* sendForState(state);
  });

  const seedState = Effect.gen(function* () {
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    const snapshot = yield* snapshotQuery.getShellSnapshot();
    const projects = new Map(snapshot.projects.map((project) => [project.id, project]));
    for (const thread of snapshot.threads) {
      const project = projects.get(thread.projectId);
      const state = project ? projectThreadAwareness({ environmentId, project, thread }) : null;
      stateByThread.set(thread.id, pushStateIdentity(state));
    }
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("Could not seed push notification awareness state", { cause }),
    ),
  );

  const worker = yield* makeDrainableWorker(processThread);

  const start: PushNotificationService["Service"]["start"] = Effect.fn(
    "PushNotificationService.start",
  )(function* () {
    yield* seedState;
    yield* forkParked(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event: OrchestrationEvent) => {
        const threadId = eventThreadId(event);
        if (threadId === null || !shouldPublishAgentAwarenessEvent(event)) {
          return Effect.void;
        }
        return worker.enqueue(threadId);
      }),
    );
  });

  return PushNotificationService.of({ register, unregister, start });
});

export const layer = Layer.effect(PushNotificationService, make);
