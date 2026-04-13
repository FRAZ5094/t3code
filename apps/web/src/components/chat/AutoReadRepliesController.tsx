import type { ThreadId } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef } from "react";
import { extractSpeakableChunks, findLatestAssistantMessage } from "~/lib/autoReadReplies";
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

  const clearTracking = useEffectEvent((cancelSpeech: boolean) => {
    if (cancelSpeech && hasSpeechSynthesisSupport()) {
      window.speechSynthesis.cancel();
    }

    activeThreadIdRef.current = null;
    activeMessageIdRef.current = null;
    queuedOffsetRef.current = 0;
    spokenOffsetRef.current = 0;
    completionFlushedRef.current = false;
  });

  const maybeResetAfterQueueDrain = useEffectEvent(() => {
    if (!completionFlushedRef.current) {
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
  });

  const handleUtteranceSettled = useEffectEvent(
    (messageId: ChatMessage["id"], endOffset: number) => {
      if (activeMessageIdRef.current !== messageId) {
        return;
      }

      spokenOffsetRef.current = Math.max(spokenOffsetRef.current, endOffset);
      maybeResetAfterQueueDrain();
    },
  );

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

    for (const chunk of chunks) {
      const utterance = new SpeechSynthesisUtterance(chunk.text);
      utterance.onend = () => {
        handleUtteranceSettled(message.id, chunk.endOffset);
      };
      utterance.onerror = () => {
        handleUtteranceSettled(message.id, chunk.endOffset);
      };
      window.speechSynthesis.speak(utterance);
    }
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
  }, [clearTracking, enabled, enqueueSpeakableChunks, messages, threadId]);

  useEffect(() => () => clearTracking(true), [clearTracking]);

  return null;
}
