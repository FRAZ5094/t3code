import { describe, expect, it } from "vitest";

import { isIgnorableTerminalWriteError } from "./terminal-errors";

describe("isIgnorableTerminalWriteError", () => {
  it("treats not-running terminal errors as ignorable", () => {
    expect(
      isIgnorableTerminalWriteError(
        new Error("Terminal is not running for thread: thread-1, terminal: default"),
      ),
    ).toBe(true);
  });

  it("treats unknown terminal thread errors as ignorable", () => {
    expect(
      isIgnorableTerminalWriteError(
        `TerminalError: Failed to write to terminal
├─ cause: Error: Unknown terminal thread: thread-1, terminal: default`,
      ),
    ).toBe(true);
  });

  it("does not ignore unrelated terminal write failures", () => {
    expect(isIgnorableTerminalWriteError(new Error("Request timed out: terminal.write"))).toBe(
      false,
    );
    expect(isIgnorableTerminalWriteError(null)).toBe(false);
  });
});
