import type { ThreadId } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef } from "react";
import {
  extractSpeakableChunks,
  findLatestAssistantMessage,
  type SpeakableChunk,
} from "~/lib/autoReadReplies";
import type { ChatMessage } from "../../types";

interface AutoReadRepliesControllerProps {
  enabled: boolean;
  threadId: ThreadId | null;
  messages: ReadonlyArray<ChatMessage>;
}

function hasSpeechSynthesisSupport(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    typeof window.speechSynthesis?.speak === "function" &&
    typeof window.speechSynthesis?.cancel === "function" &&
    typeof SpeechSynthesisUtterance === "function"
  );
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

export function AutoReadRepliesController({
  enabled,
  threadId,
  messages,
}: AutoReadRepliesControllerProps) {
  const speechPrimedRef = useRef(false);
  const observedThreadIdRef = useRef<ThreadId | null>(null);
  const observedLatestMessageIdRef = useRef<ChatMessage["id"] | null>(null);
  const observedMessageCountRef = useRef(0);
  const activeThreadIdRef = useRef<ThreadId | null>(null);
  const activeMessageIdRef = useRef<ChatMessage["id"] | null>(null);
  const queuedOffsetRef = useRef(0);
  const spokenOffsetRef = useRef(0);
  const completionFlushedRef = useRef(false);
  const pendingChunksRef = useRef<SpeakableChunk[]>([]);
  const activeChunkRef = useRef<SpeakableChunk | null>(null);
  const speechGenerationRef = useRef(0);

  const clearTracking = useEffectEvent((cancelSpeech: boolean) => {
    if (cancelSpeech && hasSpeechSynthesisSupport()) {
      window.speechSynthesis.cancel();
    }

    speechGenerationRef.current += 1;
    activeThreadIdRef.current = null;
    activeMessageIdRef.current = null;
    queuedOffsetRef.current = 0;
    spokenOffsetRef.current = 0;
    completionFlushedRef.current = false;
    pendingChunksRef.current = [];
    activeChunkRef.current = null;
  });

  const maybeResetAfterQueueDrain = useEffectEvent(() => {
    if (!completionFlushedRef.current) {
      return;
    }
    if (activeChunkRef.current !== null || pendingChunksRef.current.length > 0) {
      return;
    }
    if (spokenOffsetRef.current < queuedOffsetRef.current) {
      return;
    }

    activeThreadIdRef.current = null;
    activeMessageIdRef.current = null;
    queuedOffsetRef.current = 0;
    spokenOffsetRef.current = 0;
    completionFlushedRef.current = false;
    pendingChunksRef.current = [];
    activeChunkRef.current = null;
  });

  const handleUtteranceSettled = useEffectEvent(
    (messageId: ChatMessage["id"], chunk: SpeakableChunk, speechGeneration: number) => {
      if (speechGenerationRef.current !== speechGeneration) {
        return;
      }
      if (activeMessageIdRef.current !== messageId) {
        return;
      }

      activeChunkRef.current = null;
      spokenOffsetRef.current = Math.max(spokenOffsetRef.current, chunk.endOffset);
      flushPendingChunks();
      maybeResetAfterQueueDrain();
    },
  );

  const flushPendingChunks = useEffectEvent(() => {
    if (!hasSpeechSynthesisSupport()) {
      return;
    }

    if (activeChunkRef.current !== null) {
      return;
    }

    const nextChunk = pendingChunksRef.current.shift();
    if (!nextChunk) {
      return;
    }

    const messageId = activeMessageIdRef.current;
    if (messageId === null) {
      pendingChunksRef.current = [];
      return;
    }

    activeChunkRef.current = nextChunk;
    const speechGeneration = speechGenerationRef.current;
    const utterance = new SpeechSynthesisUtterance(nextChunk.text);
    speechPrimedRef.current = true;
    const handleSettled = () => {
      handleUtteranceSettled(messageId, nextChunk, speechGeneration);
    };
    attachUtteranceSettledHandlers(utterance, handleSettled);
    window.speechSynthesis.speak(utterance);
  });

  const enqueueSpeakableChunks = useEffectEvent((message: ChatMessage) => {
    if (!hasSpeechSynthesisSupport()) {
      return;
    }

    const { chunks, nextOffset } = extractSpeakableChunks({
      text: message.text,
      startOffset: queuedOffsetRef.current,
      isComplete: !message.streaming,
    });

    if (chunks.length === 0) {
      if (!message.streaming) {
        completionFlushedRef.current = true;
        maybeResetAfterQueueDrain();
      }
      return;
    }

    queuedOffsetRef.current = nextOffset;
    if (!message.streaming) {
      completionFlushedRef.current = true;
    }

    pendingChunksRef.current.push(...chunks);
    flushPendingChunks();
  });

  useEffect(() => {
    if (!enabled || !threadId) {
      clearTracking(true);
      observedThreadIdRef.current = threadId;
      observedLatestMessageIdRef.current = null;
      observedMessageCountRef.current = messages.length;
      return;
    }

    if (!hasSpeechSynthesisSupport()) {
      clearTracking(false);
      return;
    }

    if (activeThreadIdRef.current !== null && activeThreadIdRef.current !== threadId) {
      clearTracking(true);
    }

    if (observedThreadIdRef.current !== threadId) {
      observedThreadIdRef.current = threadId;
      observedLatestMessageIdRef.current = null;
      observedMessageCountRef.current = 0;
    }

    const latestAssistantMessage = findLatestAssistantMessage(messages);
    if (!latestAssistantMessage) {
      observedLatestMessageIdRef.current = null;
      observedMessageCountRef.current = messages.length;
      if (activeMessageIdRef.current !== null) {
        clearTracking(true);
      }
      return;
    }

    const trackedMessageId = activeMessageIdRef.current;
    if (trackedMessageId === null) {
      const previouslyObservedLatestMessageId = observedLatestMessageIdRef.current;
      const previouslyObservedMessageCount = observedMessageCountRef.current;
      observedLatestMessageIdRef.current = latestAssistantMessage.id;
      observedMessageCountRef.current = messages.length;

      if (
        !latestAssistantMessage.streaming &&
        previouslyObservedLatestMessageId === null &&
        previouslyObservedMessageCount === 0
      ) {
        return;
      }

      activeThreadIdRef.current = threadId;
      activeMessageIdRef.current = latestAssistantMessage.id;
      queuedOffsetRef.current = 0;
      spokenOffsetRef.current = 0;
      completionFlushedRef.current = false;
      enqueueSpeakableChunks(latestAssistantMessage);
      return;
    }

    if (trackedMessageId !== latestAssistantMessage.id) {
      observedLatestMessageIdRef.current = latestAssistantMessage.id;
      observedMessageCountRef.current = messages.length;
      clearTracking(true);

      activeThreadIdRef.current = threadId;
      activeMessageIdRef.current = latestAssistantMessage.id;
      queuedOffsetRef.current = 0;
      spokenOffsetRef.current = 0;
      completionFlushedRef.current = false;
      enqueueSpeakableChunks(latestAssistantMessage);
      return;
    }

    observedLatestMessageIdRef.current = latestAssistantMessage.id;
    observedMessageCountRef.current = messages.length;
    activeThreadIdRef.current = threadId;
    enqueueSpeakableChunks(latestAssistantMessage);
  }, [enabled, messages, threadId]);

  useEffect(() => {
    if (!enabled || !hasSpeechSynthesisSupport() || speechPrimedRef.current) {
      return;
    }

    const primeSpeechSynthesis = () => {
      if (!hasSpeechSynthesisSupport() || speechPrimedRef.current) {
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
      if (hasSpeechSynthesisSupport()) {
        window.speechSynthesis.cancel();
      }
      speechGenerationRef.current += 1;
      activeThreadIdRef.current = null;
      activeMessageIdRef.current = null;
      observedThreadIdRef.current = null;
      observedLatestMessageIdRef.current = null;
      observedMessageCountRef.current = 0;
      speechPrimedRef.current = false;
      queuedOffsetRef.current = 0;
      spokenOffsetRef.current = 0;
      completionFlushedRef.current = false;
      pendingChunksRef.current = [];
      activeChunkRef.current = null;
    },
    [],
  );

  return null;
}
