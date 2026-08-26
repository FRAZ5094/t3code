import * as Speech from "expo-speech";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

import type { ThreadFeedEntry } from "../../lib/threadActivity";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import {
  THREAD_SPEECH_RATES,
  ThreadSpeechQueue,
  type ThreadSpeechEngine,
  type ThreadSpeechRate,
  resolveThreadSpeechRate,
} from "./threadSpeech";

export { THREAD_SPEECH_RATES, type ThreadSpeechRate } from "./threadSpeech";

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
      void Speech.stop();
    },
  };
}

export function useThreadSpeech(feed: ReadonlyArray<ThreadFeedEntry>) {
  const isAndroid = Platform.OS === "android";
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const storedPreferences = AsyncResult.isSuccess(preferencesResult)
    ? preferencesResult.value
    : null;
  const [enabled, setEnabled] = useState(false);
  const [rate, setRate] = useState<ThreadSpeechRate>(1);
  const enabledRef = useRef(false);
  const preferenceInitializedRef = useRef(false);

  useEffect(() => {
    if (preferenceInitializedRef.current || !storedPreferences) {
      return;
    }
    preferenceInitializedRef.current = true;
    enabledRef.current = storedPreferences.readAloudEnabled === true;
    setEnabled(storedPreferences.readAloudEnabled === true);
    setRate(resolveThreadSpeechRate(storedPreferences.readAloudRate));
  }, [storedPreferences]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const speechEngine = useMemo(() => (isAndroid ? createAndroidSpeechEngine() : null), [isAndroid]);
  const queueRef = useRef<ThreadSpeechQueue | null>(null);

  // Keep queue construction in an effect so React's development-only effect
  // replay gets a fresh queue after the first one is disposed.
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

  useEffect(() => {
    queueRef.current?.update(assistantMessages, enabled, rate);
  }, [assistantMessages, enabled, rate]);

  const toggle = useCallback(() => {
    if (!isAndroid) {
      return;
    }
    preferenceInitializedRef.current = true;
    const next = !enabledRef.current;
    enabledRef.current = next;
    setEnabled(next);
    savePreferences({ readAloudEnabled: next });
  }, [isAndroid, savePreferences]);

  const setSpeechRate = useCallback(
    (next: ThreadSpeechRate) => {
      if (!isAndroid) {
        return;
      }
      preferenceInitializedRef.current = true;
      setRate(next);
      savePreferences({ readAloudRate: next });
    },
    [isAndroid, savePreferences],
  );

  return {
    enabled: isAndroid && enabled,
    rate,
    toggle,
    setRate: setSpeechRate,
  } as const;
}
