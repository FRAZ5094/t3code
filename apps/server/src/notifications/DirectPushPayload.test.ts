import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ThreadId,
  type PushNotificationRegistrationInput,
} from "@t3tools/contracts";
import type { AgentAwarenessState } from "@t3tools/shared/agentAwareness";
import { directPushPayload } from "./DirectPushPayload.ts";

const nowMs = Date.parse("2026-09-13T12:00:00Z");
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
const state = (phase: AgentAwarenessState["phase"], id = "one"): AgentAwarenessState => ({
  environmentId: EnvironmentId.make("env"),
  threadId: ThreadId.make(id),
  threadTitle: `Task ${id}`,
  projectTitle: "T3 Code",
  phase,
  headline: "",
  modelTitle: "Codex",
  updatedAt: "2026-09-13T12:00:00Z",
  deepLink: `/threads/env/${id}`,
});
const payload = (
  states: AgentAwarenessState[],
  overrides: Partial<Parameters<typeof directPushPayload>[0]> = {},
) =>
  directPushPayload({
    environmentId: "env",
    registration,
    previousStates: [state("running")],
    states,
    nowMs,
    content: new Map(),
    ...overrides,
  });

describe("paired-environment Android delivery", () => {
  it("sends a silent running card scoped to its environment and paired device", () => {
    const data = payload([state("running")]);
    expect(data).toMatchObject({
      environment_id: "env",
      user_id: "paired:phone",
      device_id: "phone",
      active: "true",
      activity_title: "1 active agent",
    });
    expect(data.alert_id).toBeUndefined();
  });
  it("preserves answer previews and the thread route on completion", () => {
    expect(
      payload([state("completed")], {
        content: new Map([
          [
            "one",
            {
              assistantMessageText: "Fixed the reconnect issue and verified recovery.",
              approvalContext: null,
            },
          ],
        ]),
      }),
    ).toMatchObject({
      alert_body: "Fixed the reconnect issue and verified recovery.",
      alert_path: "/threads/env/one",
      active: "false",
      activity_title: "Agent work completed",
      activity_expires_at: String(nowMs + 15 * 60_000),
    });
  });
  it("notifies on questions and retains approval detail", () => {
    expect(payload([state("waiting_for_input")]).alert_body).toContain("question");
    expect(
      payload([state("waiting_for_approval")], {
        content: new Map([
          [
            "one",
            {
              assistantMessageText: null,
              approvalContext: { summary: "Approve command", detail: "vp test run" },
            },
          ],
        ]),
      }).alert_body,
    ).toContain("vp test run");
  });
  it("groups concurrent completions and attention transitions", () => {
    expect(payload([state("completed"), state("failed", "two")]).alert_title).toBe(
      "2 agents finished",
    );
    expect(
      payload([state("waiting_for_input"), state("waiting_for_approval", "two")]).alert_title,
    ).toBe("2 agents need attention");
  });
  it("does not alert on replay, duplicate state, or an old completion", () => {
    expect(payload([state("completed")], { replay: true }).alert_id).toBeUndefined();
    expect(
      payload([state("completed")], { previousStates: [state("completed")] }).alert_id,
    ).toBeUndefined();
    expect(payload([state("completed")], { nowMs: nowMs + 180_000 }).alert_id).toBeUndefined();
  });
  it("keeps alerts and ongoing cards independently switchable", () => {
    const preferences = { ...registration.preferences, liveActivitiesEnabled: false };
    const alertOnly = payload([state("completed")], {
      registration: { ...registration, preferences },
    });
    expect(alertOnly.alert_id).toBeDefined();
    expect(alertOnly.activity_expires_at).toBe("0");
    const cardOnly = payload([state("waiting_for_input")], {
      registration: {
        ...registration,
        preferences: { ...registration.preferences, notificationsEnabled: false },
      },
    });
    expect(cardOnly.alert_id).toBeUndefined();
    expect(cardOnly.active).toBe("true");
    expect(
      payload([state("waiting_for_input")], {
        registration: {
          ...registration,
          preferences: { ...registration.preferences, notifyOnInput: false },
        },
      }).alert_id,
    ).toBeUndefined();
  });
  it("fits a long Unicode answer and five activity rows into a data push", () => {
    const states = [
      state("completed"),
      ...[2, 3, 4, 5].map((id) => ({
        ...state("running", String(id)),
        threadTitle: "Long task 🚀 ".repeat(40),
      })),
    ];
    const data = payload(states, {
      content: new Map([
        ["one", { assistantMessageText: "答案 🚀 ".repeat(1500), approvalContext: null }],
      ]),
    });
    expect(new TextEncoder().encode(JSON.stringify(data)).length).toBeLessThanOrEqual(3800);
    expect(data.alert_path).toBe("/threads/env/one");
    expect(data.activity_line_4).toBeDefined();
    expect(JSON.stringify(data)).not.toContain("�");
  });
  it("clears the card when the environment has no remaining work", () => {
    expect(payload([])).toMatchObject({ active: "false", activity_expires_at: "0" });
  });
});
