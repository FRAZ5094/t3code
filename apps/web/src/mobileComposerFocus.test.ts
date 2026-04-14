import { afterEach, describe, expect, it } from "vitest";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";

import {
  consumeMobileComposerFocusSuppression,
  resetMobileComposerFocusSuppressionForTests,
  suppressMobileComposerFocusForThread,
} from "./mobileComposerFocus";

const environmentId = EnvironmentId.make("environment-local");

describe("mobileComposerFocus", () => {
  afterEach(() => {
    resetMobileComposerFocusSuppressionForTests();
  });

  it("consumes a pending suppression exactly once for the targeted thread", () => {
    const threadRef = scopeThreadRef(environmentId, ThreadId.make("thread-1"));

    suppressMobileComposerFocusForThread(threadRef);

    expect(consumeMobileComposerFocusSuppression(threadRef)).toBe(true);
    expect(consumeMobileComposerFocusSuppression(threadRef)).toBe(false);
  });

  it("does not consume suppression for a different thread", () => {
    const suppressedThreadRef = scopeThreadRef(environmentId, ThreadId.make("thread-1"));
    const otherThreadRef = scopeThreadRef(environmentId, ThreadId.make("thread-2"));

    suppressMobileComposerFocusForThread(suppressedThreadRef);

    expect(consumeMobileComposerFocusSuppression(otherThreadRef)).toBe(false);
    expect(consumeMobileComposerFocusSuppression(suppressedThreadRef)).toBe(true);
  });

  it("can be reset between tests", () => {
    const threadRef = scopeThreadRef(environmentId, ThreadId.make("thread-1"));

    suppressMobileComposerFocusForThread(threadRef);
    resetMobileComposerFocusSuppressionForTests();

    expect(consumeMobileComposerFocusSuppression(threadRef)).toBe(false);
  });
});
