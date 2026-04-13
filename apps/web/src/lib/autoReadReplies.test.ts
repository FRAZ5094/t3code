import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { extractSpeakableChunks, findLatestAssistantMessage } from "./autoReadReplies";

const ISO = "2026-04-13T00:00:00.000Z";

function createMessage(input: {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  streaming?: boolean;
}) {
  return {
    id: MessageId.make(input.id),
    role: input.role,
    text: input.text,
    createdAt: ISO,
    streaming: input.streaming ?? false,
  };
}

describe("findLatestAssistantMessage", () => {
  it("returns only the latest assistant message", () => {
    const messages = [
      createMessage({ id: "user-1", role: "user", text: "hello" }),
      createMessage({ id: "assistant-1", role: "assistant", text: "first reply" }),
      createMessage({ id: "system-1", role: "system", text: "noise" }),
      createMessage({ id: "assistant-2", role: "assistant", text: "latest reply" }),
    ];

    expect(findLatestAssistantMessage(messages)).toEqual(messages[3]);
  });

  it("ignores user and system messages", () => {
    const messages = [
      createMessage({ id: "assistant-1", role: "assistant", text: "first reply" }),
      createMessage({ id: "user-1", role: "user", text: "new user prompt" }),
      createMessage({ id: "system-1", role: "system", text: "system note" }),
    ];

    expect(findLatestAssistantMessage(messages)).toEqual(messages[0]);
  });

  it("returns null when there is no assistant message", () => {
    const messages = [
      createMessage({ id: "user-1", role: "user", text: "hello" }),
      createMessage({ id: "system-1", role: "system", text: "noise" }),
    ];

    expect(findLatestAssistantMessage(messages)).toBeNull();
  });
});

describe("extractSpeakableChunks", () => {
  it("emits nothing for partial streaming text without a boundary", () => {
    expect(
      extractSpeakableChunks({
        text: "still streaming without punctuation",
        startOffset: 0,
        isComplete: false,
      }),
    ).toEqual({
      chunks: [],
      nextOffset: 0,
    });
  });

  it("emits sentence chunks once punctuation plus whitespace or end is available", () => {
    const text = 'She said, "Hello." Next';

    expect(
      extractSpeakableChunks({
        text,
        startOffset: 0,
        isComplete: false,
      }),
    ).toEqual({
      chunks: [
        {
          text: 'She said, "Hello."',
          endOffset: text.indexOf("Next"),
        },
      ],
      nextOffset: text.indexOf("Next"),
    });
  });

  it("keeps ordered-list markers attached to their item content", () => {
    const text = "1. Penguins are birds.\n2. ";

    expect(
      extractSpeakableChunks({
        text,
        startOffset: 0,
        isComplete: false,
      }),
    ).toEqual({
      chunks: [
        {
          text: "1. Penguins are birds.",
          endOffset: text.indexOf("2."),
        },
      ],
      nextOffset: text.indexOf("2."),
    });
  });

  it("emits paragraph chunks on blank-line boundaries", () => {
    const text = "Alpha. Beta.\n\nGamma.";

    expect(
      extractSpeakableChunks({
        text,
        startOffset: 0,
        isComplete: false,
      }),
    ).toEqual({
      chunks: [
        {
          text: "Alpha. Beta.",
          endOffset: text.indexOf("Gamma."),
        },
        {
          text: "Gamma.",
          endOffset: text.length,
        },
      ],
      nextOffset: text.length,
    });
  });

  it("uses the long-text fallback when no sentence boundary arrives", () => {
    const text = `${"a".repeat(170)},${"b".repeat(120)}`;

    expect(
      extractSpeakableChunks({
        text,
        startOffset: 0,
        isComplete: false,
      }),
    ).toEqual({
      chunks: [
        {
          text: `${"a".repeat(170)},`,
          endOffset: 171,
        },
      ],
      nextOffset: 171,
    });
  });

  it("flushes the trailing remainder on completion", () => {
    const text = "First sentence. unfinished reply without punctuation";
    const startOffset = "First sentence. ".length;

    expect(
      extractSpeakableChunks({
        text,
        startOffset,
        isComplete: true,
      }),
    ).toEqual({
      chunks: [
        {
          text: "unfinished reply without punctuation",
          endOffset: text.length,
        },
      ],
      nextOffset: text.length,
    });
  });
});
