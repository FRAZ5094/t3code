import { MessageId, ThreadId } from "@t3tools/contracts";
import { type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { AutoReadRepliesController } from "./AutoReadRepliesController";
import type { ChatMessage } from "../../types";

class MockSpeechSynthesisUtterance {
  readonly text: string;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

type ControllerProps = ComponentProps<typeof AutoReadRepliesController>;

const THREAD_ID = ThreadId.make("thread-auto-read-replies");
const NOW_ISO = "2026-04-13T00:00:00.000Z";

let spokenUtterances: MockSpeechSynthesisUtterance[] = [];
const speakSpy = vi.fn((utterance: MockSpeechSynthesisUtterance) => {
  spokenUtterances.push(utterance);
});
const cancelSpy = vi.fn();

const originalSpeechSynthesisDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "speechSynthesis",
);

function installSpeechSynthesisMocks() {
  spokenUtterances = [];
  speakSpy.mockClear();
  cancelSpy.mockClear();

  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      speak: speakSpy,
      cancel: cancelSpy,
    },
  });
  vi.stubGlobal("SpeechSynthesisUtterance", MockSpeechSynthesisUtterance);
}

function restoreSpeechSynthesisMocks() {
  vi.unstubAllGlobals();

  if (originalSpeechSynthesisDescriptor) {
    Object.defineProperty(window, "speechSynthesis", originalSpeechSynthesisDescriptor);
  } else {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: undefined,
    });
  }
}

function createAssistantMessage(input: {
  id: string;
  text: string;
  streaming: boolean;
  completedAt?: string;
}): ChatMessage {
  return {
    id: MessageId.make(input.id),
    role: "assistant",
    text: input.text,
    createdAt: NOW_ISO,
    streaming: input.streaming,
    ...(input.completedAt ? { completedAt: input.completedAt } : {}),
  };
}

async function mountController(props: ControllerProps) {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(<AutoReadRepliesController {...props} />, { container: host });

  return {
    rerender: async (nextProps: ControllerProps) => {
      await screen.rerender(<AutoReadRepliesController {...nextProps} />);
    },
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("AutoReadRepliesController", () => {
  afterEach(() => {
    restoreSpeechSynthesisMocks();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("does not speak old completed assistant history on mount", async () => {
    installSpeechSynthesisMocks();

    const mounted = await mountController({
      enabled: true,
      threadId: THREAD_ID,
      messages: [
        createAssistantMessage({
          id: "message-complete",
          text: "Finished reply.",
          streaming: false,
          completedAt: NOW_ISO,
        }),
      ],
    });

    try {
      expect(speakSpy).not.toHaveBeenCalled();
      expect(cancelSpy).not.toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("begins speaking once a live assistant reply reaches a natural boundary", async () => {
    installSpeechSynthesisMocks();

    const mounted = await mountController({
      enabled: true,
      threadId: THREAD_ID,
      messages: [
        createAssistantMessage({ id: "message-streaming", text: "Hello there", streaming: true }),
      ],
    });

    try {
      expect(speakSpy).not.toHaveBeenCalled();

      await mounted.rerender({
        enabled: true,
        threadId: THREAD_ID,
        messages: [
          createAssistantMessage({
            id: "message-streaming",
            text: "Hello there. Next",
            streaming: true,
          }),
        ],
      });

      await vi.waitFor(() => {
        expect(speakSpy).toHaveBeenCalledTimes(1);
      });
      expect(spokenUtterances[0]?.text).toBe("Hello there.");
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not enqueue on every tiny streaming delta", async () => {
    installSpeechSynthesisMocks();

    const mounted = await mountController({
      enabled: true,
      threadId: THREAD_ID,
      messages: [createAssistantMessage({ id: "message-delta", text: "H", streaming: true })],
    });

    try {
      expect(speakSpy).not.toHaveBeenCalled();

      await mounted.rerender({
        enabled: true,
        threadId: THREAD_ID,
        messages: [createAssistantMessage({ id: "message-delta", text: "He", streaming: true })],
      });
      expect(speakSpy).not.toHaveBeenCalled();

      await mounted.rerender({
        enabled: true,
        threadId: THREAD_ID,
        messages: [createAssistantMessage({ id: "message-delta", text: "Hello", streaming: true })],
      });
      expect(speakSpy).not.toHaveBeenCalled();

      await mounted.rerender({
        enabled: true,
        threadId: THREAD_ID,
        messages: [
          createAssistantMessage({ id: "message-delta", text: "Hello world.", streaming: true }),
        ],
      });

      await vi.waitFor(() => {
        expect(speakSpy).toHaveBeenCalledTimes(1);
      });
      expect(spokenUtterances[0]?.text).toBe("Hello world.");
    } finally {
      await mounted.cleanup();
    }
  });

  it("flushes the final unsaid remainder when streaming finishes", async () => {
    installSpeechSynthesisMocks();

    const mounted = await mountController({
      enabled: true,
      threadId: THREAD_ID,
      messages: [
        createAssistantMessage({
          id: "message-flush",
          text: "First sentence. trailing remainder",
          streaming: true,
        }),
      ],
    });

    try {
      await vi.waitFor(() => {
        expect(speakSpy).toHaveBeenCalledTimes(1);
      });
      expect(spokenUtterances[0]?.text).toBe("First sentence.");

      await mounted.rerender({
        enabled: true,
        threadId: THREAD_ID,
        messages: [
          createAssistantMessage({
            id: "message-flush",
            text: "First sentence. trailing remainder",
            streaming: false,
            completedAt: NOW_ISO,
          }),
        ],
      });

      await vi.waitFor(() => {
        expect(speakSpy).toHaveBeenCalledTimes(2);
      });
      expect(spokenUtterances[1]?.text).toBe("trailing remainder");

      spokenUtterances[0]?.onend?.();
      spokenUtterances[1]?.onend?.();
    } finally {
      await mounted.cleanup();
    }
  });

  it("cancels cleanly when disabled mid-reply", async () => {
    installSpeechSynthesisMocks();

    const mounted = await mountController({
      enabled: true,
      threadId: THREAD_ID,
      messages: [
        createAssistantMessage({
          id: "message-disable",
          text: "Spoken sentence.",
          streaming: true,
        }),
      ],
    });

    try {
      await vi.waitFor(() => {
        expect(speakSpy).toHaveBeenCalledTimes(1);
      });

      await mounted.rerender({
        enabled: false,
        threadId: THREAD_ID,
        messages: [
          createAssistantMessage({
            id: "message-disable",
            text: "Spoken sentence. More content",
            streaming: true,
          }),
        ],
      });

      await vi.waitFor(() => {
        expect(cancelSpy).toHaveBeenCalledTimes(1);
      });
      expect(speakSpy).toHaveBeenCalledTimes(1);
    } finally {
      await mounted.cleanup();
    }
  });

  it("cancels stale speech and switches when a newer assistant message begins", async () => {
    installSpeechSynthesisMocks();

    const mounted = await mountController({
      enabled: true,
      threadId: THREAD_ID,
      messages: [
        createAssistantMessage({ id: "message-old", text: "Older reply.", streaming: true }),
      ],
    });

    try {
      await vi.waitFor(() => {
        expect(speakSpy).toHaveBeenCalledTimes(1);
      });
      expect(spokenUtterances[0]?.text).toBe("Older reply.");

      await mounted.rerender({
        enabled: true,
        threadId: THREAD_ID,
        messages: [
          createAssistantMessage({
            id: "message-old",
            text: "Older reply.",
            streaming: false,
            completedAt: NOW_ISO,
          }),
          createAssistantMessage({
            id: "message-new",
            text: "Newer reply.",
            streaming: true,
          }),
        ],
      });

      await vi.waitFor(() => {
        expect(cancelSpy).toHaveBeenCalledTimes(1);
        expect(speakSpy).toHaveBeenCalledTimes(2);
      });
      expect(spokenUtterances[1]?.text).toBe("Newer reply.");
    } finally {
      await mounted.cleanup();
    }
  });
});
