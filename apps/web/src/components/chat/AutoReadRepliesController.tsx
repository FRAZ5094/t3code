import { type ThreadId } from "@t3tools/contracts";
import { type SpeechPlaybackRate } from "@t3tools/contracts/settings";
import { useEffect, useEffectEvent, useRef } from "react";
import { extractSpeakableChunks, type SpeakableChunk } from "~/lib/autoReadReplies";
import { applySpeechPlaybackRate, hasSpeechSynthesisSupport } from "~/lib/speechSynthesis";
import type { ChatMessage } from "../../types";

interface AutoReadRepliesControllerProps {
  enabled: boolean;
  playbackRate?: SpeechPlaybackRate;
  threadId: ThreadId | null;
  messages: ReadonlyArray<ChatMessage>;
}

function attachUtteranceSettledHandlers(
  utterance: SpeechSynthesisUtterance,
  onSettled: () => void,
): void {
  if (typeof utterance.addEventListener === "function") {
    utterance.addEventListener("end", onSettled, { once: true });
    utterance.addEventListener("error", onSettled, { once: true });
    return;
  }

  utterance.onend = onSettled;
  utterance.onerror = onSettled;
}

function findLatestAssistantMessageIndex(messages: ReadonlyArray<ChatMessage>): number {
  return messages.findLastIndex((message) => message.role === "assistant");
}

export function AutoReadRepliesController({
  enabled,
  playbackRate = "1x",
  threadId,
  messages,
}: AutoReadRepliesControllerProps) {
  const messagesRef = useRef(messages);
  const wasEnabledRef = useRef(enabled);
  const speechPrimedRef = useRef(false);
  const observedThreadIdRef = useRef<ThreadId | null>(null);
  const trackingStartIndexRef = useRef(0);
  const trackedMessagesRef = useRef(
    new Map<
      ChatMessage["id"],
      {
        queuedOffset: number;
        spokenOffset: number;
        completionFlushed: boolean;
      }
    >(),
  );
  const pendingChunksRef = useRef<Array<{ messageId: ChatMessage["id"]; chunk: SpeakableChunk }>>(
    [],
  );
  const activeChunkRef = useRef<{ messageId: ChatMessage["id"]; chunk: SpeakableChunk } | null>(
    null,
  );
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speakTimeoutIdRef = useRef<number | null>(null);
  const speechGenerationRef = useRef(0);
  messagesRef.current = messages;

  const clearPlayback = useEffectEvent((cancelSpeech: boolean) => {
    if (speakTimeoutIdRef.current !== null) {
      window.clearTimeout(speakTimeoutIdRef.current);
      speakTimeoutIdRef.current = null;
    }
    if (cancelSpeech && hasSpeechSynthesisSupport({ requireCancel: true })) {
      window.speechSynthesis.cancel();
    }

    speechGenerationRef.current += 1;
    pendingChunksRef.current = [];
    activeChunkRef.current = null;
    activeUtteranceRef.current = null;
  });

  const resetTrackingWindow = useEffectEvent((startIndex: number, cancelSpeech: boolean) => {
    clearPlayback(cancelSpeech);
    trackingStartIndexRef.current = startIndex;
    trackedMessagesRef.current.clear();
  });

  const maybeAdvanceTrackingWindow = useEffectEvent(() => {
    const currentMessages = messagesRef.current;

    while (trackingStartIndexRef.current < currentMessages.length) {
      const message = currentMessages[trackingStartIndexRef.current];
      if (!message) {
        return;
      }

      if (message.role !== "assistant") {
        trackingStartIndexRef.current += 1;
        continue;
      }

      const trackedState = trackedMessagesRef.current.get(message.id);
      if (
        !trackedState ||
        message.streaming ||
        !trackedState.completionFlushed ||
        trackedState.queuedOffset < message.text.length ||
        trackedState.spokenOffset < trackedState.queuedOffset
      ) {
        return;
      }

      if (
        activeChunkRef.current?.messageId === message.id ||
        pendingChunksRef.current.some((pendingChunk) => pendingChunk.messageId === message.id)
      ) {
        return;
      }

      trackedMessagesRef.current.delete(message.id);
      trackingStartIndexRef.current += 1;
    }
  });

  const handleUtteranceSettled = useEffectEvent(
    (messageId: ChatMessage["id"], chunk: SpeakableChunk, speechGeneration: number) => {
      if (speechGenerationRef.current !== speechGeneration) {
        return;
      }
      if (activeChunkRef.current?.messageId !== messageId) {
        return;
      }

      activeChunkRef.current = null;
      activeUtteranceRef.current = null;
      const trackedState = trackedMessagesRef.current.get(messageId);
      if (trackedState) {
        trackedState.spokenOffset = Math.max(trackedState.spokenOffset, chunk.endOffset);
      }
      flushPendingChunks();
      maybeAdvanceTrackingWindow();
    },
  );

  const flushPendingChunks = useEffectEvent(() => {
    if (!hasSpeechSynthesisSupport({ requireCancel: true })) {
      return;
    }

    if (activeChunkRef.current !== null) {
      return;
    }

    const nextChunk = pendingChunksRef.current.shift();
    if (!nextChunk) {
      return;
    }

    activeChunkRef.current = nextChunk;
    const speechGeneration = speechGenerationRef.current;
    const utterance = new SpeechSynthesisUtterance(nextChunk.chunk.text);
    applySpeechPlaybackRate(utterance, playbackRate);
    speechPrimedRef.current = true;
    activeUtteranceRef.current = utterance;
    const handleSettled = () => {
      handleUtteranceSettled(nextChunk.messageId, nextChunk.chunk, speechGeneration);
    };
    attachUtteranceSettledHandlers(utterance, handleSettled);
    speakTimeoutIdRef.current = window.setTimeout(() => {
      speakTimeoutIdRef.current = null;
      if (
        speechGenerationRef.current !== speechGeneration ||
        activeUtteranceRef.current !== utterance ||
        activeChunkRef.current !== nextChunk
      ) {
        return;
      }

      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(utterance);
      } catch {
        handleUtteranceSettled(nextChunk.messageId, nextChunk.chunk, speechGeneration);
      }
    }, 0);
  });

  const enqueueSpeakableChunks = useEffectEvent((message: ChatMessage) => {
    if (!hasSpeechSynthesisSupport({ requireCancel: true })) {
      return;
    }

    let trackedState = trackedMessagesRef.current.get(message.id);
    if (!trackedState) {
      trackedState = {
        queuedOffset: 0,
        spokenOffset: 0,
        completionFlushed: false,
      };
      trackedMessagesRef.current.set(message.id, trackedState);
    }

    const { chunks, nextOffset } = extractSpeakableChunks({
      text: message.text,
      startOffset: trackedState.queuedOffset,
      isComplete: !message.streaming,
    });

    trackedState.queuedOffset = nextOffset;
    if (!message.streaming) {
      trackedState.completionFlushed = true;
    }

    if (chunks.length > 0) {
      pendingChunksRef.current.push(
        ...chunks.map((chunk) => ({
          messageId: message.id,
          chunk,
        })),
      );
    }

    flushPendingChunks();
    maybeAdvanceTrackingWindow();
  });

  const processTrackedMessages = useEffectEvent((candidateMessages: ReadonlyArray<ChatMessage>) => {
    const sliceStartIndex = trackingStartIndexRef.current;
    const latestUserIndex = candidateMessages.findLastIndex(
      (message, index) => index >= sliceStartIndex && message.role === "user",
    );

    if (latestUserIndex >= sliceStartIndex) {
      resetTrackingWindow(latestUserIndex + 1, true);
    }

    for (let index = trackingStartIndexRef.current; index < candidateMessages.length; index += 1) {
      const message = candidateMessages[index];
      if (!message || message.role !== "assistant") {
        continue;
      }

      enqueueSpeakableChunks(message);
    }
  });

  useEffect(() => {
    const wasEnabled = wasEnabledRef.current;
    wasEnabledRef.current = enabled;

    if (!enabled || !threadId) {
      resetTrackingWindow(messages.length, true);
      observedThreadIdRef.current = threadId;
      return;
    }

    if (!hasSpeechSynthesisSupport({ requireCancel: true })) {
      resetTrackingWindow(messages.length, false);
      return;
    }

    if (observedThreadIdRef.current !== threadId) {
      const initialStreamingAssistantIndex = messages.findLastIndex(
        (message) => message.role === "assistant" && message.streaming,
      );

      resetTrackingWindow(
        initialStreamingAssistantIndex === -1 ? messages.length : initialStreamingAssistantIndex,
        observedThreadIdRef.current !== null,
      );
      observedThreadIdRef.current = threadId;
    } else if (!wasEnabled) {
      const latestAssistantIndex = findLatestAssistantMessageIndex(messages);
      resetTrackingWindow(
        latestAssistantIndex === -1 ? messages.length : latestAssistantIndex,
        false,
      );
    }

    processTrackedMessages(messages);
  }, [enabled, messages, playbackRate, threadId]);

  useEffect(() => {
    if (
      !enabled ||
      !hasSpeechSynthesisSupport({ requireCancel: true }) ||
      speechPrimedRef.current
    ) {
      return;
    }

    const primeSpeechSynthesis = () => {
      if (!hasSpeechSynthesisSupport({ requireCancel: true }) || speechPrimedRef.current) {
        return;
      }

      speechPrimedRef.current = true;
      const utterance = new SpeechSynthesisUtterance(".");
      utterance.volume = 0;
      utterance.rate = 10;
      window.speechSynthesis.speak(utterance);
      window.speechSynthesis.cancel();
    };

    const activationEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "mousedown",
      "touchstart",
      "keydown",
    ];

    for (const eventType of activationEvents) {
      window.addEventListener(eventType, primeSpeechSynthesis, { capture: true, once: true });
    }

    return () => {
      for (const eventType of activationEvents) {
        window.removeEventListener(eventType, primeSpeechSynthesis, { capture: true });
      }
    };
  }, [enabled]);

  useEffect(
    () => () => {
      if (hasSpeechSynthesisSupport({ requireCancel: true })) {
        window.speechSynthesis.cancel();
      }
      speechGenerationRef.current += 1;
      observedThreadIdRef.current = null;
      trackingStartIndexRef.current = 0;
      trackedMessagesRef.current.clear();
      speechPrimedRef.current = false;
      activeUtteranceRef.current = null;
      if (speakTimeoutIdRef.current !== null) {
        window.clearTimeout(speakTimeoutIdRef.current);
        speakTimeoutIdRef.current = null;
      }
      pendingChunksRef.current = [];
      activeChunkRef.current = null;
    },
    [],
  );

  return null;
}
