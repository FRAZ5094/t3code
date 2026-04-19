import { type SpeechPlaybackRate } from "@t3tools/contracts/settings";

const SPEECH_PLAYBACK_RATE_VALUES = {
  "1x": 1,
  "1.5x": 1.5,
  "2x": 2,
  "3x": 3,
} as const satisfies Record<SpeechPlaybackRate, number>;

export function hasSpeechSynthesisSupport(options?: { requireCancel?: boolean }): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if (
    typeof window.speechSynthesis?.speak !== "function" ||
    typeof SpeechSynthesisUtterance !== "function"
  ) {
    return false;
  }

  return !options?.requireCancel || typeof window.speechSynthesis?.cancel === "function";
}

export function applySpeechPlaybackRate(
  utterance: SpeechSynthesisUtterance,
  playbackRate: SpeechPlaybackRate,
): void {
  utterance.rate = SPEECH_PLAYBACK_RATE_VALUES[playbackRate];
}
