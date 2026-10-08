import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ThreadId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  type PushNotificationRegistrationInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import type {
  OrchestrationV2DomainEvent,
  OrchestrationV2ThreadShell,
  Project,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { FcmClient, FcmClientError } from "@t3tools/shared/agentNotifications/FcmClient";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { make } from "./PushNotificationService.ts";

function shell(overrides: Partial<OrchestrationV2ThreadShell> = {}): OrchestrationV2ThreadShell {
  return {
    id: ThreadId.make("thread"),
    projectId: ProjectId.make("project"),
    title: "Thread",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
    runtimeMode: "full-access",
    interactionMode: "default",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: {
      rootThreadId: ThreadId.make("thread"),
      parentThreadId: null,
      relationshipToParent: null,
    },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    lastVisitedAt: null,
    deletedAt: null,
    branch: null,
    linkedPullRequest: null,
    status: "running",
    activityRunStatus: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    latestUserMessageAt: null,
    createdAt: DateTime.makeUnsafe("2026-10-08T12:00:00.000Z"),
    updatedAt: DateTime.makeUnsafe("2026-10-08T12:00:00.000Z"),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

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
    threads?: Partial<ThreadManagement.ThreadManagementService["Service"]>;
    projects?: Partial<ProjectService.ProjectService["Service"]>;
    events?: Stream.Stream<OrchestrationV2DomainEvent>;
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
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ProjectService.ProjectService)({
          snapshot: Effect.succeed({ projects: [], updatedAt: "2026-10-08T12:00:00.000Z" }),
          ...options.projects,
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getShellSnapshot: () =>
            Effect.succeed({
              schemaVersion: 2,
              snapshotSequence: 0,
              archivedThreads: [],
              threads: [],
            }),
          streamDomainEvents: options.events ?? Stream.never,
          getThreadRecords: () => Effect.succeed({ messages: [], turnItems: [] }) as never,
          ...options.threads,
        }),
      ),
    ),
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
        const project = { id: ProjectId.make("project"), title: "Notification tests" } as Project;
        const base = shell({ title: "Verify notification delivery", status: "running" });
        const completed = { ...base, status: "completed" as const, latestRunId: RunId.make("run") };
        const harness = setup({
          projects: {
            snapshot: Effect.succeed({
              projects: [project],
              updatedAt: "2026-10-08T12:00:00.000Z",
            }),
            getById: () => Effect.succeed(Option.some(project)),
          },
          threads: {
            getShellSnapshot: () =>
              Effect.succeed({
                schemaVersion: 2,
                snapshotSequence: 0,
                archivedThreads: [],
                threads: [base],
              }),
            getThreadShell: () => Effect.succeed(completed),
            getThreadRecords: () =>
              Effect.succeed({ messages: [{ text: "The task is complete." }] }) as never,
          },
          events: Stream.make({
            type: "run.updated",
            threadId: ThreadId.make("thread"),
          } as OrchestrationV2DomainEvent).pipe(
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
          alert_body: "The task is complete.",
          alert_path: "/threads/env/thread",
        });
      }).pipe(Effect.scoped),
  );
  it.effect("uses the pending V2 approval's context in the phone alert", () =>
    Effect.gen(function* () {
      const consumed = yield* Deferred.make<void>();
      const project = { id: ProjectId.make("project"), title: "Notification tests" } as Project;
      const base = shell();
      const pending = shell({
        pendingRuntimeRequest: {
          id: RuntimeRequestId.make("request"),
          kind: "command",
          createdAt: base.updatedAt,
        },
      });
      const harness = setup({
        projects: {
          snapshot: Effect.succeed({ projects: [project], updatedAt: "2026-10-08T12:00:00.000Z" }),
          getById: () => Effect.succeed(Option.some(project)),
        },
        threads: {
          getShellSnapshot: () =>
            Effect.succeed({
              schemaVersion: 2,
              snapshotSequence: 0,
              archivedThreads: [],
              threads: [base],
            }),
          getThreadShell: () => Effect.succeed(pending),
          getThreadRecords: () =>
            Effect.succeed({
              turnItems: [
                { type: "approval_request", requestId: "older", title: "Old approval" },
                {
                  type: "approval_request",
                  requestId: "request",
                  title: "Run deployment",
                  prompt: "Allow the staging command?",
                  appName: "Staging",
                },
              ],
            }) as never,
        },
        events: Stream.make({
          type: "runtime-request.updated",
          threadId: base.id,
        } as OrchestrationV2DomainEvent).pipe(
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
      expect(alerts[0]?.data.alert_body).toContain("Allow the staging command?");
      expect(alerts[0]?.data.alert_body).not.toContain("Old approval");
    }).pipe(Effect.scoped),
  );

  it.effect("does not replay archived threads or subagent threads into the phone activity", () =>
    Effect.gen(function* () {
      const project = { id: ProjectId.make("project"), title: "Notification tests" } as Project;
      const harness = setup({
        projects: {
          snapshot: Effect.succeed({ projects: [project], updatedAt: "2026-10-08T12:00:00.000Z" }),
        },
        threads: {
          getShellSnapshot: () =>
            Effect.succeed({
              schemaVersion: 2,
              snapshotSequence: 0,
              archivedThreads: [],
              threads: [
                shell({ archivedAt: DateTime.makeUnsafe("2026-10-08T12:00:00Z") }),
                shell({
                  lineage: {
                    rootThreadId: ThreadId.make("root"),
                    parentThreadId: ThreadId.make("root"),
                    relationshipToParent: "subagent",
                  },
                }),
              ],
            }),
        },
      });
      const service = yield* harness.service;
      yield* service.start();
      yield* service.register(registration);
      yield* service.drain;
      expect(harness.sent).toHaveLength(1);
      expect(harness.sent[0]).toMatchObject({ alert: false, data: { active: "false" } });
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
