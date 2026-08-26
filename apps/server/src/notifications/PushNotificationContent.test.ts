import { describe, expect, it } from "vite-plus/test";

import {
  buildPushNotificationContent,
  PUSH_NOTIFICATION_MAX_BODY_BYTES,
} from "./PushNotificationContent.ts";

describe("buildPushNotificationContent", () => {
  it("puts the thread context in the title and the final answer in the body", () => {
    expect(
      buildPushNotificationContent({
        phase: "completion",
        threadTitle: "Can we use the new auth callback?",
        projectTitle: "t3code",
        assistantMessageText:
          "Yes — the callback can be used here. It is validated against the configured allowlist before the session is resumed.",
      }),
    ).toEqual({
      title: "Can we use the new auth callback?",
      body:
        "Yes — the callback can be used here. It is validated against the configured allowlist before the session is resumed.",
    });
  });

  it("normalizes markdown noise and truncates long answers at a word boundary", () => {
    const body = buildPushNotificationContent({
      phase: "completion",
      threadTitle: "Explain the change",
      projectTitle: "t3code",
      assistantMessageText: `${"The answer is yes, and the implementation is safe. ".repeat(70)}[Read more](https://example.com)`,
    }).body;

    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(
      PUSH_NOTIFICATION_MAX_BODY_BYTES,
    );
    expect(body.endsWith("…")).toBe(true);
    expect(body).not.toContain("[Read more]");
    expect(body).not.toContain("\n");
  });

  it("caps UTF-8 bytes without splitting a Unicode character", () => {
    const body = buildPushNotificationContent({
      phase: "completion",
      threadTitle: "Explain the change",
      projectTitle: "t3code",
      assistantMessageText: `${"The answer is yes — safely handled. 🚀 ".repeat(200)}`,
    }).body;

    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(
      PUSH_NOTIFICATION_MAX_BODY_BYTES,
    );
    expect(body.endsWith("…")).toBe(true);
    expect([...body].every((character) => character !== "\uFFFD")).toBe(true);
  });

  it("includes approval detail and useful failure context", () => {
    expect(
      buildPushNotificationContent({
        phase: "approval",
        threadTitle: "Deploy the release",
        projectTitle: "t3code",
        approvalContext: {
          summary: "Command approval requested",
          detail: "pnpm run db:migrate",
        },
      }),
    ).toEqual({
      title: "Approval needed · Deploy the release",
      body: "Command approval requested: pnpm run db:migrate. Tap to review.",
    });

    expect(
      buildPushNotificationContent({
        phase: "failure",
        threadTitle: "Deploy the release",
        projectTitle: "t3code",
        detail: "The deploy command exited with status 1.",
      }),
    ).toEqual({
      title: "Agent failed · Deploy the release",
      body: "The deploy command exited with status 1.",
    });
  });
});
