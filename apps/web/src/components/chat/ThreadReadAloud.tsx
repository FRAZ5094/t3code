import {
  ThreadSpeechQueue,
  type ThreadSpeechEngine,
  type ThreadSpeechMessage,
} from "@t3tools/client-runtime/thread-speech";
import { THREAD_SPEECH_RATES, ThreadSpeechRate } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import { ChevronDownIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import type { TimelineEntry } from "../../session-logic";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/menu";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const isThreadSpeechRate = Schema.is(ThreadSpeechRate);

function speechSynthesisAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function createBrowserSpeechEngine(): ThreadSpeechEngine {
  // Chromium can garbage-collect an utterance mid-sentence and never fire its
  // end event, which would stall the queue, so hold the one being spoken.
  const held: { utterance: SpeechSynthesisUtterance | null } = { utterance: null };
  return {
    speak(text, options) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = options.rate;
      utterance.onend = () => {
        held.utterance = null;
        options.onDone();
      };
      utterance.onerror = (event) => {
        held.utterance = null;
        if (event.error === "interrupted" || event.error === "canceled") options.onStopped();
        else options.onError();
      };
      held.utterance = utterance;
      window.speechSynthesis.speak(utterance);
    },
    stop() {
      held.utterance = null;
      window.speechSynthesis.cancel();
    },
  };
}

function assistantSpeechMessages(
  entries: ReadonlyArray<TimelineEntry>,
): ReadonlyArray<ThreadSpeechMessage> {
  const messages: ThreadSpeechMessage[] = [];
  for (const entry of entries) {
    if (entry.kind === "message" && entry.message.role === "assistant") {
      messages.push({
        id: entry.message.id,
        text: entry.message.text,
        streaming: entry.message.streaming,
      });
    }
  }
  return messages;
}

// speechSynthesis is one voice per window, so only the main thread view reads aloud.
let activeQueue: ThreadSpeechQueue | null = null;

/** Skips what has been said so far; reading resumes with the agent's next reply. */
export function pauseThreadReadAloudUntilNextMessage(): void {
  activeQueue?.pauseUntilNextMessage();
}

/** Reads the open thread's assistant replies aloud while read aloud is on. */
export function ThreadReadAloud(props: {
  readonly threadKey: string | null;
  readonly entries: ReadonlyArray<TimelineEntry>;
}) {
  const enabled = useClientSettings((settings) => settings.readAloudEnabled);
  const rate = useClientSettings((settings) => settings.readAloudRate);
  const queueRef = useRef<ThreadSpeechQueue | null>(null);

  // Built in an effect so development's effect replay gets a fresh queue after disposing the first.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Owns the window's speechSynthesis queue while the thread view is mounted and stops speech on unmount.
  useEffect(() => {
    if (!speechSynthesisAvailable()) return;
    const queue = new ThreadSpeechQueue(createBrowserSpeechEngine());
    queueRef.current = queue;
    activeQueue = queue;
    return () => {
      if (activeQueue === queue) activeQueue = null;
      if (queueRef.current === queue) queueRef.current = null;
      queue.dispose();
    };
  }, []);

  // Declared after the queue's effect so the first pass already has a queue to feed.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Feeds the speech queue, which lives outside React, the thread's latest assistant text.
  useEffect(() => {
    queueRef.current?.update(assistantSpeechMessages(props.entries), enabled, rate, {
      threadKey: props.threadKey,
    });
  }, [props.entries, props.threadKey, enabled, rate]);

  return null;
}

/** Header toggle for read aloud, plus its speed when on. */
export function ThreadReadAloudControls() {
  const gt = useGT();
  const enabled = useClientSettings((settings) => settings.readAloudEnabled);
  const rate = useClientSettings((settings) => settings.readAloudRate);
  if (!speechSynthesisAvailable()) return null;

  return (
    <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
      {enabled ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={<Button size="xs" variant="ghost" />}
                  aria-label={gt("Read aloud speed, {rate}x", { rate })}
                />
              }
            >
              <span className="tabular-nums">{`${rate}x`}</span>
              <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">{gt("Read aloud speed")}</TooltipPopup>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={rate}
              onValueChange={(value) => {
                if (isThreadSpeechRate(value)) void updateClientSettings({ readAloudRate: value });
              }}
            >
              {THREAD_SPEECH_RATES.map((option) => (
                <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                  <span className="tabular-nums">{`${option}x`}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <Tooltip>
        <TooltipTrigger render={<span className="flex shrink-0" />}>
          <Toggle
            className="shrink-0"
            pressed={enabled}
            onPressedChange={(pressed) => void updateClientSettings({ readAloudEnabled: pressed })}
            aria-label={enabled ? gt("Turn off read aloud") : gt("Turn on read aloud")}
            variant="ghost"
            size="sm"
          >
            {enabled ? <Volume2Icon className="size-4" /> : <VolumeXIcon className="size-4" />}
          </Toggle>
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {enabled ? gt("Turn off read aloud") : gt("Read replies aloud")}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
