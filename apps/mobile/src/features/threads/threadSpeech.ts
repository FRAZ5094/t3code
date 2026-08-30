export const THREAD_SPEECH_RATES = [1, 1.5, 2, 2.5, 3] as const;

export type ThreadSpeechRate = (typeof THREAD_SPEECH_RATES)[number];

const DEFAULT_THREAD_SPEECH_RATE: ThreadSpeechRate = 1;
const MIN_STREAM_CHUNK_LENGTH = 100;
const MAX_SPEECH_CHUNK_LENGTH = 220;

export interface ThreadSpeechMessage {
  readonly id: string;
  readonly text: string;
  readonly streaming: boolean;
}

export interface ThreadSpeechSpeakOptions {
  readonly rate: ThreadSpeechRate;
  readonly onDone: () => void;
  readonly onError: () => void;
  readonly onStopped: () => void;
}

export interface ThreadSpeechEngine {
  readonly speak: (text: string, options: ThreadSpeechSpeakOptions) => void;
  readonly stop: () => void | Promise<void>;
}

interface MessageProgress {
  text: string;
  queuedLength: number;
  streaming: boolean;
}

interface SpeechSegment {
  readonly messageId: string;
  readonly text: string;
}

interface CurrentSpeech {
  readonly segment: SpeechSegment;
  readonly token: number;
}

export interface ThreadSpeechUpdateOptions {
  readonly threadKey?: string | null;
}

export function resolveThreadSpeechRate(value: unknown): ThreadSpeechRate {
  return THREAD_SPEECH_RATES.includes(value as ThreadSpeechRate)
    ? (value as ThreadSpeechRate)
    : DEFAULT_THREAD_SPEECH_RATE;
}

/**
 * Keep the transcript readable when markdown syntax reaches Android's speech
 * engine. The source offsets remain based on the original text so streaming
 * deltas can be tracked without re-speaking content.
 */
export function speechText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " link ")
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/[\\`*_~>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isSpeechBoundary(character: string): boolean {
  return /\s|[.!?,;:)}\]]/.test(character);
}

function findChunkEnd(text: string, start: number, streaming: boolean): number | null {
  const remaining = text.length - start;
  if (remaining <= 0) {
    return null;
  }

  if (streaming && remaining < MIN_STREAM_CHUNK_LENGTH) {
    return null;
  }

  const maxEnd = Math.min(text.length, start + MAX_SPEECH_CHUNK_LENGTH);
  if (!streaming && remaining <= MAX_SPEECH_CHUNK_LENGTH) {
    return text.length;
  }

  const minimumEnd = Math.min(text.length, start + MIN_STREAM_CHUNK_LENGTH);
  for (let index = maxEnd - 1; index >= minimumEnd; index -= 1) {
    if (isSpeechBoundary(text[index] ?? "")) {
      return index + 1;
    }
  }

  return maxEnd;
}

/**
 * Serializes Android speech for one thread. Only one utterance is handed to
 * the native engine at a time; later stream chunks stay in this queue until
 * the engine reports that the current utterance is complete.
 */
export class ThreadSpeechQueue {
  private readonly progressByMessageId = new Map<string, MessageProgress>();
  private readonly pending: SpeechSegment[] = [];
  private current: CurrentSpeech | null = null;
  private enabled = false;
  private rate: ThreadSpeechRate = DEFAULT_THREAD_SPEECH_RATE;
  private hydrated = false;
  private hasContextMessages = false;
  private threadKey: string | null | undefined;
  private waitingForNextMessage = false;
  private readonly messagesPresentWhenPaused = new Set<string>();
  private nextSpeechToken = 0;
  private stopPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly engine: ThreadSpeechEngine) {}

  update(
    messages: ReadonlyArray<ThreadSpeechMessage>,
    enabled: boolean,
    rate: ThreadSpeechRate,
    options: ThreadSpeechUpdateOptions = {},
  ): void {
    if (this.disposed) {
      return;
    }

    this.rate = rate;

    if (options.threadKey !== undefined && options.threadKey !== this.threadKey) {
      this.hydrated = true;
      this.threadKey = options.threadKey;
      this.resetForContext();
      this.enabled = enabled;
      this.syncMessages(messages, enabled);
      if (enabled) {
        this.pump();
      }
      return;
    }

    if (!this.hydrated) {
      this.hydrated = true;
      this.enabled = enabled;
      this.syncMessages(messages, enabled);
      if (enabled) {
        this.pump();
      }
      return;
    }

    if (!enabled) {
      this.waitingForNextMessage = false;
      this.messagesPresentWhenPaused.clear();
      if (this.enabled) {
        this.enabled = false;
        this.syncMessages(messages, false);
        this.stopCurrentSpeech();
      } else {
        this.syncMessages(messages, false);
      }
      return;
    }

    if (!this.enabled) {
      this.enabled = true;
      this.startFromLatest(messages);
      this.pump();
      return;
    }

    this.syncMessages(messages, true);

    if (this.waitingForNextMessage) {
      const hasNextMessage = messages.some(
        (message) => !this.messagesPresentWhenPaused.has(message.id),
      );
      for (const messageId of this.messagesPresentWhenPaused) {
        const progress = this.progressByMessageId.get(messageId);
        if (progress) {
          progress.queuedLength = progress.text.length;
        }
      }
      if (!hasNextMessage) {
        return;
      }
      this.waitingForNextMessage = false;
      this.messagesPresentWhenPaused.clear();
    }

    // A later message cannot enter the queue while an earlier assistant
    // message is still streaming. This makes the queue order stable even if
    // the server sends the next message before the previous stream's final
    // event reaches the client.
    let blockedByStreamingMessage = false;
    for (const message of messages) {
      const progress = this.progressByMessageId.get(message.id);
      if (!progress || blockedByStreamingMessage) {
        continue;
      }

      this.queueAvailableText(progress, message.id);
      if (message.streaming) {
        blockedByStreamingMessage = true;
      }
    }

    this.pump();
  }

  pauseUntilNextMessage(): void {
    if (this.disposed || !this.enabled) {
      return;
    }

    this.waitingForNextMessage = true;
    this.messagesPresentWhenPaused.clear();
    for (const [messageId, progress] of this.progressByMessageId) {
      progress.queuedLength = progress.text.length;
      this.messagesPresentWhenPaused.add(messageId);
    }
    this.stopCurrentSpeech();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopCurrentSpeech();
  }

  private resetForContext(): void {
    this.progressByMessageId.clear();
    this.pending.length = 0;
    this.hasContextMessages = false;
    this.waitingForNextMessage = false;
    this.messagesPresentWhenPaused.clear();
    this.stopCurrentSpeech();
  }

  private syncMessages(
    messages: ReadonlyArray<ThreadSpeechMessage>,
    queueNewMessages: boolean,
  ): void {
    if (!this.hasContextMessages && messages.length > 0) {
      this.startFromLatest(messages, queueNewMessages);
      return;
    }

    for (const message of messages) {
      const previous = this.progressByMessageId.get(message.id);
      if (!previous) {
        this.progressByMessageId.set(message.id, {
          text: message.text,
          queuedLength: queueNewMessages ? 0 : message.text.length,
          streaming: message.streaming,
        });
        continue;
      }

      previous.text = message.text;
      previous.streaming = message.streaming;
      previous.queuedLength = Math.min(previous.queuedLength, message.text.length);
    }

    this.hasContextMessages = messages.length > 0;
  }

  private startFromLatest(messages: ReadonlyArray<ThreadSpeechMessage>, queueLatest = true): void {
    this.progressByMessageId.clear();
    this.pending.length = 0;
    const latestMessageId = messages.at(-1)?.id;

    for (const message of messages) {
      this.progressByMessageId.set(message.id, {
        text: message.text,
        queuedLength: message.id === latestMessageId && queueLatest ? 0 : message.text.length,
        streaming: message.streaming,
      });
    }

    this.hasContextMessages = messages.length > 0;

    if (queueLatest && latestMessageId !== undefined) {
      const latestProgress = this.progressByMessageId.get(latestMessageId);
      if (latestProgress) {
        this.queueAvailableText(latestProgress, latestMessageId);
      }
    }
  }

  private stopCurrentSpeech(): void {
    this.pending.length = 0;
    if (this.current === null) {
      return;
    }

    this.current = null;
    this.nextSpeechToken += 1;

    let stopResult: void | Promise<void>;
    try {
      stopResult = this.engine.stop();
    } catch {
      return;
    }

    if (stopResult === undefined) {
      return;
    }

    const stopPromise = Promise.resolve(stopResult).catch(() => undefined);
    this.stopPromise = stopPromise;
    void stopPromise.then(() => {
      if (this.stopPromise !== stopPromise) {
        return;
      }
      this.stopPromise = null;
      this.pump();
    });
  }

  private queueAvailableText(progress: MessageProgress, messageId: string): void {
    while (progress.queuedLength < progress.text.length) {
      const end = findChunkEnd(progress.text, progress.queuedLength, progress.streaming);
      if (end === null) {
        return;
      }

      const rawChunk = progress.text.slice(progress.queuedLength, end);
      progress.queuedLength = end;
      const text = speechText(rawChunk);
      if (text.length > 0) {
        this.pending.push({ messageId, text });
      }
    }
  }

  private pump(): void {
    if (this.disposed || !this.enabled || this.current !== null || this.stopPromise !== null) {
      return;
    }

    const next = this.pending.shift();
    if (!next) {
      return;
    }

    const current: CurrentSpeech = {
      segment: next,
      token: this.nextSpeechToken + 1,
    };
    this.nextSpeechToken = current.token;
    this.current = current;
    let finished = false;
    const finish = () => {
      if (finished || this.current !== current) {
        return;
      }
      finished = true;
      this.current = null;
      this.pump();
    };

    try {
      this.engine.speak(current.segment.text, {
        rate: this.rate,
        onDone: finish,
        onError: finish,
        onStopped: finish,
      });
    } catch {
      finish();
    }
  }
}
