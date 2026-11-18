import * as Speech from "expo-speech";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

import type { ThreadFeedEntry } from "../../lib/threadActivity";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import type { ThreadSpeechRate } from "@t3tools/contracts";
import {
  ThreadSpeechQueue,
  type ThreadSpeechEngine,
  resolveThreadSpeechRate,
} from "@t3tools/client-runtime/thread-speech";

function createAndroidSpeechEngine(): ThreadSpeechEngine {
  return {
    speak(text, options) {
      Speech.speak(text, {
        rate: options.rate,
        onDone: options.onDone,
        onError: options.onError,
        onStopped: options.onStopped,
      });
    },
    stop() {
      return Speech.stop();
    },
  };
}

export function useThreadSpeech(
  feed: ReadonlyArray<ThreadFeedEntry>,
  threadKey: string | null = null,
  sourceThreadKey: string | null = threadKey,
) {
  const isAndroid = Platform.OS === "android";
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const storedPreferences = AsyncResult.isSuccess(preferencesResult)
    ? preferencesResult.value
    : null;
  // A choice made on this screen wins over the stored value, which loads asynchronously.
  const [enabledChoice, setEnabledChoice] = useState<boolean | null>(null);
  const [rateChoice, setRateChoice] = useState<ThreadSpeechRate | null>(null);
  const enabled = enabledChoice ?? storedPreferences?.readAloudEnabled === true;
  const rate = rateChoice ?? resolveThreadSpeechRate(storedPreferences?.readAloudRate);

  const speechEngine = useMemo(() => (isAndroid ? createAndroidSpeechEngine() : null), [isAndroid]);
  const queueRef = useRef<ThreadSpeechQueue | null>(null);

  // Keep queue construction in an effect so React's development-only effect
  // replay gets a fresh queue after the first one is disposed.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Owns the native speech queue while the thread screen is mounted and stops speech on unmount.
  useEffect(() => {
    if (speechEngine === null) {
      return;
    }
    const queue = new ThreadSpeechQueue(speechEngine);
    queueRef.current = queue;
    return () => {
      if (queueRef.current === queue) {
        queueRef.current = null;
      }
      queue.dispose();
    };
  }, [speechEngine]);

  const assistantMessages = useMemo(
    () =>
      feed.flatMap((entry) =>
        entry.type === "message" && entry.message.role === "assistant"
          ? [
              {
                id: entry.message.id,
                text: entry.message.text,
                streaming: entry.message.streaming,
              },
            ]
          : [],
      ),
    [feed],
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Feeds the speech queue, which lives outside React, the thread's latest assistant text.
  useEffect(() => {
    queueRef.current?.update(assistantMessages, enabled, rate, { threadKey, sourceThreadKey });
  }, [assistantMessages, enabled, rate, sourceThreadKey, threadKey]);

  const toggle = useCallback(() => {
    if (!isAndroid) {
      return;
    }
    const next = !enabled;
    queueRef.current?.update(assistantMessages, next, rate, { threadKey, sourceThreadKey });
    setEnabledChoice(next);
    savePreferences({ readAloudEnabled: next });
  }, [assistantMessages, enabled, isAndroid, rate, savePreferences, sourceThreadKey, threadKey]);

  const setSpeechRate = useCallback(
    (next: ThreadSpeechRate) => {
      if (!isAndroid) {
        return;
      }
      setRateChoice(next);
      savePreferences({ readAloudRate: next });
    },
    [isAndroid, savePreferences],
  );

  const pauseUntilNextMessage = useCallback(() => {
    queueRef.current?.pauseUntilNextMessage();
  }, []);

  return {
    enabled: isAndroid && enabled,
    rate,
    toggle,
    setRate: setSpeechRate,
    pauseUntilNextMessage,
  } as const;
}
