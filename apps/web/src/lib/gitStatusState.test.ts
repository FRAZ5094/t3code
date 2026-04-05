import type { GitStatusResult } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getGitStatusSnapshot,
  refreshGitStatus,
  resetGitStatusStateForTests,
  watchGitStatus,
} from "./gitStatusState";

function registerListener<T>(listeners: Set<(event: T) => void>, listener: (event: T) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const gitStatusListeners = new Set<(event: GitStatusResult) => void>();

const BASE_STATUS: GitStatusResult = {
  isRepo: true,
  hasOriginRemote: true,
  isDefaultBranch: false,
  branch: "feature/push-status",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};

const gitClient = {
  onStatus: vi.fn((input: { cwd: string }, listener: (event: GitStatusResult) => void) =>
    registerListener(gitStatusListeners, listener),
  ),
};

function emitGitStatus(event: GitStatusResult) {
  for (const listener of gitStatusListeners) {
    listener(event);
  }
}

afterEach(() => {
  gitStatusListeners.clear();
  gitClient.onStatus.mockClear();
  resetGitStatusStateForTests();
});

describe("gitStatusState", () => {
  it("shares one live subscription per cwd and updates the per-cwd atom snapshot", () => {
    const releaseA = watchGitStatus("/repo", gitClient);
    const releaseB = watchGitStatus("/repo", gitClient);

    expect(gitClient.onStatus).toHaveBeenCalledOnce();
    expect(getGitStatusSnapshot("/repo")).toEqual({
      data: null,
      error: null,
      cause: null,
      isPending: true,
    });

    emitGitStatus(BASE_STATUS);

    expect(getGitStatusSnapshot("/repo")).toEqual({
      data: BASE_STATUS,
      error: null,
      cause: null,
      isPending: false,
    });

    releaseA();
    expect(gitStatusListeners.size).toBe(1);

    releaseB();
    expect(gitStatusListeners.size).toBe(0);
  });

  it("restarts the live stream when explicitly refreshed", () => {
    const release = watchGitStatus("/repo", gitClient);

    emitGitStatus(BASE_STATUS);
    refreshGitStatus("/repo");

    expect(gitClient.onStatus).toHaveBeenCalledTimes(2);
    expect(getGitStatusSnapshot("/repo")).toEqual({
      data: BASE_STATUS,
      error: null,
      cause: null,
      isPending: true,
    });

    release();
  });
});
