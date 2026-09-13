import type { PushNotificationRegistrationInput } from "@t3tools/contracts";
import type { AgentAwarenessState } from "@t3tools/shared/agentAwareness";
import { makeAggregateState } from "@t3tools/shared/agentNotifications/agentActivityAggregate";
import {
  attentionTransitionRows,
  terminalTransitionRows,
  alertForActivityRows,
} from "@t3tools/shared/agentNotifications/agentActivityAlerts";
import { androidActivityData, fitFcmData } from "@t3tools/shared/agentNotifications/fcmPayloads";
import {
  buildPushNotificationContent,
  type PushNotificationApprovalContext,
} from "./PushNotificationContent.ts";

export function directPushPayload(input: {
  environmentId: string;
  registration: PushNotificationRegistrationInput;
  previousStates: ReadonlyArray<AgentAwarenessState>;
  states: ReadonlyArray<AgentAwarenessState>;
  nowMs: number;
  replay?: boolean;
  content: ReadonlyMap<
    string,
    { assistantMessageText: string | null; approvalContext: PushNotificationApprovalContext | null }
  >;
}) {
  const aggregate = makeAggregateState({
    activeStates: input.states,
    terminalState: null,
    nowMs: input.nowMs,
  });
  const previousAggregate = makeAggregateState({
    activeStates: input.previousStates,
    terminalState: null,
    nowMs: input.nowMs,
  }) ?? {
    title: "T3 Code",
    subtitle: "",
    activeCount: 0,
    updatedAt: "1970-01-01T00:00:00.000Z",
    activities: [],
  };
  const transition = {
    previousAggregate,
    nextAggregate: aggregate!,
    preferences: input.registration.preferences,
    nowMs: input.nowMs,
    includeUnobserved: true,
  };
  const attention = aggregate ? attentionTransitionRows(transition) : [];
  const rows =
    input.replay || !input.registration.preferences.notificationsEnabled || !aggregate
      ? []
      : attention.length > 0
        ? attention
        : terminalTransitionRows(transition);
  const first = rows[0];
  const grouped = alertForActivityRows(rows);
  const state = first && input.states.find((state) => state.threadId === first.threadId);
  const phase =
    state?.phase === "completed"
      ? "completion"
      : state?.phase === "failed"
        ? "failure"
        : state?.phase === "waiting_for_input"
          ? "input"
          : "approval";
  const alert =
    rows.length === 1 && state
      ? buildPushNotificationContent({ ...state, phase, ...input.content.get(state.threadId) })
      : grouped;
  return fitFcmData({
    t3_kind: "agent_activity",
    environment_id: input.environmentId,
    device_id: input.registration.deviceId,
    user_id: `paired:${input.registration.deviceId}`,
    updated_at: String(input.nowMs),
    ...androidActivityData(input.registration.preferences.liveActivitiesEnabled ? aggregate : null),
    ...(alert && first
      ? {
          alert_id: JSON.stringify(
            rows.map((row) => [row.environmentId, row.threadId, row.phase, row.updatedAt]).sort(),
          ),
          alert_title: alert.title,
          alert_body: alert.body,
          alert_path: first.deepLink,
        }
      : {}),
  });
}
