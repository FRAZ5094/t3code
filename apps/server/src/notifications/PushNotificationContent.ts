export type PushNotificationPhase = "approval" | "completion" | "failure";

export interface PushNotificationApprovalContext {
  readonly summary: string;
  readonly detail?: string;
  readonly appName?: string;
}

// Expo/FCM limit the complete push payload to 4,096 bytes. Leave room for the
// title, routing data, token, and JSON framing so a long answer is not
// rejected before Android can display it.
export const PUSH_NOTIFICATION_MAX_BODY_BYTES = 2_800;

const PUSH_NOTIFICATION_MAX_TITLE_LENGTH = 96;
const textEncoder = new TextEncoder();

function normalizeNotificationText(value: string): string {
  return value
    .replace(/```[^\n]*\n?/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateNotificationText(value: string, maxLength: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxLength) {
    return value;
  }

  const prefixLength = Math.max(1, maxLength - 1);
  const prefix = characters.slice(0, prefixLength).join("").trimEnd();
  const lastSpace = prefix.lastIndexOf(" ");
  const wordBoundary = lastSpace >= Math.floor(prefixLength * 0.6) ? lastSpace : prefix.length;
  return `${prefix.slice(0, wordBoundary).trimEnd()}…`;
}

function truncateNotificationTextByBytes(value: string, maxBytes: number): string {
  if (textEncoder.encode(value).byteLength <= maxBytes) {
    return value;
  }

  const ellipsis = "…";
  const ellipsisBytes = textEncoder.encode(ellipsis).byteLength;
  const prefixCharacters: string[] = [];
  let prefixBytes = 0;
  for (const character of Array.from(value)) {
    const characterBytes = textEncoder.encode(character).byteLength;
    if (prefixBytes + characterBytes + ellipsisBytes > maxBytes) {
      break;
    }
    prefixCharacters.push(character);
    prefixBytes += characterBytes;
  }

  const prefix = prefixCharacters.join("").trimEnd();
  const lastSpace = prefix.lastIndexOf(" ");
  const wordBoundary = lastSpace >= Math.floor(prefix.length * 0.6) ? lastSpace : prefix.length;
  const truncated = prefix.slice(0, wordBoundary).trimEnd();
  return `${truncated || prefix}${ellipsis}`;
}

function phaseTitle(phase: Exclude<PushNotificationPhase, "completion">): string {
  switch (phase) {
    case "approval":
      return "Approval needed";
    case "failure":
      return "Agent failed";
  }
}

export function buildPushNotificationContent(input: {
  readonly phase: PushNotificationPhase;
  readonly threadTitle: string;
  readonly projectTitle: string;
  readonly detail?: string | undefined;
  readonly approvalContext?: PushNotificationApprovalContext | null | undefined;
  readonly assistantMessageText?: string | null | undefined;
}): { readonly title: string; readonly body: string } {
  const threadTitle = normalizeNotificationText(input.threadTitle);
  const projectTitle = normalizeNotificationText(input.projectTitle);
  const title = truncateNotificationText(
    input.phase === "completion"
      ? threadTitle || "T3 Code"
      : threadTitle
        ? `${phaseTitle(input.phase)} · ${threadTitle}`
        : phaseTitle(input.phase),
    PUSH_NOTIFICATION_MAX_TITLE_LENGTH,
  );

  const assistantMessage =
    input.phase === "completion" && input.assistantMessageText
      ? normalizeNotificationText(input.assistantMessageText)
      : "";
  if (assistantMessage) {
    return {
      title,
      body: truncateNotificationTextByBytes(assistantMessage, PUSH_NOTIFICATION_MAX_BODY_BYTES),
    };
  }

  const detail = input.detail ? normalizeNotificationText(input.detail) : "";
  if (detail) {
    return {
      title,
      body: truncateNotificationTextByBytes(detail, PUSH_NOTIFICATION_MAX_BODY_BYTES),
    };
  }

  switch (input.phase) {
    case "approval":
      if (input.approvalContext) {
        const summary = normalizeNotificationText(input.approvalContext.summary);
        const detail = normalizeNotificationText(input.approvalContext.detail ?? "");
        const appName = normalizeNotificationText(input.approvalContext.appName ?? "");
        const subject = [appName, detail].filter(Boolean).join(" — ");
        return {
          title,
          body: subject
            ? `${summary || "Approval needed"}: ${subject}. Tap to review.`
            : `${summary || "Approval needed"}. Tap to review.`,
        };
      }
      return { title, body: "Tap to review the approval request." };
    case "completion":
      return {
        title,
        body: projectTitle
          ? `Review the completed task in ${projectTitle}.`
          : "Review the completed task.",
      };
    case "failure":
      return { title, body: "The agent run failed." };
  }
}
