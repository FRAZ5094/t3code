import { describe, expect, it, vi } from "@effect/vitest";

import {
  THREAD_SPEECH_RATES,
  ThreadSpeechQueue,
  resolveThreadSpeechRate,
  speechText,
  type ThreadSpeechEngine,
  type ThreadSpeechSpeakOptions,
} from "./threadSpeech";

interface SpeechCall {
  readonly text: string;
  readonly options: ThreadSpeechSpeakOptions;
}

function makeEngine() {
  const calls: SpeechCall[] = [];
  const engine: ThreadSpeechEngine = {
    speak: (text, options) => {
      calls.push({ text, options });
    },
    stop: vi.fn(),
  };
  return { calls, engine };
}

function finishLatest(calls: ReadonlyArray<SpeechCall>): void {
  calls.at(-1)?.options.onDone();
}

const streamingText =
  "The first assistant message is long enough to start speaking while the provider is still streaming more words.";

describe("ThreadSpeechQueue", () => {
  it("does not replay hydrated history", () => {
    const { calls, engine } = makeEngine();
    const queue = new ThreadSpeechQueue(engine);

    queue.update(
      [{ id: "history", text: "A previously completed message.", streaming: false }],
      true,
      1,
    );

    expect(calls).toHaveLength(0);
  });

  it("keeps later messages behind the currently streaming message", () => {
    const { calls, engine } = makeEngine();
    const queue = new ThreadSpeechQueue(engine);

    queue.update([], false, 1);
    queue.update([{ id: "first", text: streamingText, streaming: true }], true, 1);
    queue.update(
      [
        { id: "first", text: streamingText, streaming: true },
        { id: "second", text: "The second message must wait.", streaming: false },
      ],
      true,
      1,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("first assistant message");

    queue.update(
      [
        {
          id: "first",
          text: `${streamingText} This is the final part of the first response.`,
          streaming: false,
        },
        { id: "second", text: "The second message must wait.", streaming: false },
      ],
      true,
      1,
    );
    finishLatest(calls);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.text).toContain("final part");

    finishLatest(calls);
    expect(calls).toHaveLength(3);
    expect(calls[2]?.text).toBe("The second message must wait.");
  });

  it("does not interrupt the current utterance when disabled", () => {
    const { calls, engine } = makeEngine();
    const queue = new ThreadSpeechQueue(engine);

    queue.update([], false, 1);
    queue.update([{ id: "first", text: `${streamingText} done.`, streaming: false }], true, 1);
    queue.update(
      [
        { id: "first", text: `${streamingText} done.`, streaming: false },
        { id: "second", text: "This pending message should be discarded.", streaming: false },
      ],
      true,
      1,
    );
    queue.update([{ id: "first", text: `${streamingText} done.`, streaming: false }], false, 1);

    expect(engine.stop).not.toHaveBeenCalled();
    finishLatest(calls);
    expect(calls).toHaveLength(1);
  });

  it("uses the latest selected speed for the next queued utterance", () => {
    const { calls, engine } = makeEngine();
    const queue = new ThreadSpeechQueue(engine);

    queue.update([], false, 1);
    queue.update([{ id: "first", text: `${streamingText} done.`, streaming: false }], true, 1);
    queue.update(
      [
        { id: "first", text: `${streamingText} done.`, streaming: false },
        { id: "second", text: "This message uses the new speed.", streaming: false },
      ],
      true,
      2.5,
    );

    finishLatest(calls);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.options.rate).toBe(2.5);
  });
});

describe("thread speech helpers", () => {
  it("accepts only supported rates", () => {
    expect(THREAD_SPEECH_RATES).toEqual([1, 1.5, 2, 2.5, 3]);
    expect(resolveThreadSpeechRate(2.5)).toBe(2.5);
    expect(resolveThreadSpeechRate(4)).toBe(1);
  });

  it("removes common markdown noise without changing sentence text", () => {
    expect(speechText("## [Read this](https://example.com)\n\n`fast`")).toBe("Read this fast");
  });
});
