import { scopedThreadKey } from "@t3tools/client-runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";

let suppressedThreadKey: string | null = null;

export function suppressMobileComposerFocusForThread(threadRef: ScopedThreadRef): void {
  suppressedThreadKey = scopedThreadKey(threadRef);
}

export function consumeMobileComposerFocusSuppression(threadRef: ScopedThreadRef): boolean {
  const threadKey = scopedThreadKey(threadRef);
  if (suppressedThreadKey !== threadKey) {
    return false;
  }

  suppressedThreadKey = null;
  return true;
}

export function resetMobileComposerFocusSuppressionForTests(): void {
  suppressedThreadKey = null;
}
