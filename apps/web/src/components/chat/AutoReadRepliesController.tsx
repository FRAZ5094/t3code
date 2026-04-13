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

export function AutoReadRepliesController({
  enabled,
  threadId,
  messages,
}: AutoReadRepliesControllerProps) {
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
    const handleSettled = () => {
      handleUtteranceSettled(messageId, nextChunk, speechGeneration);
    };
    utterance.addEventListener("end", handleSettled, { once: true });
    utterance.addEventListener("error", handleSettled, { once: true });
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
      return;
    }

    if (!hasSpeechSynthesisSupport()) {
      clearTracking(false);
      return;
    }

    if (activeThreadIdRef.current !== null && activeThreadIdRef.current !== threadId) {
      clearTracking(true);
    }

    const latestAssistantMessage = findLatestAssistantMessage(messages);
    if (!latestAssistantMessage) {
      if (activeMessageIdRef.current !== null) {
        clearTracking(true);
      }
      return;
    }

    const trackedMessageId = activeMessageIdRef.current;
    if (trackedMessageId === null) {
      if (!latestAssistantMessage.streaming) {
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
      clearTracking(true);
      if (!latestAssistantMessage.streaming) {
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

    activeThreadIdRef.current = threadId;
    enqueueSpeakableChunks(latestAssistantMessage);
  }, [enabled, messages, threadId]);

  useEffect(
    () => () => {
      if (hasSpeechSynthesisSupport()) {
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
    },
    [],
  );

  return null;
}
