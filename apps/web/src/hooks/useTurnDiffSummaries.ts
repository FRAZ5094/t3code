import { useMemo } from "react";
import { deriveTurnDiffSummaries, inferCheckpointTurnCountByTurnId } from "../session-logic";
import type { Thread, TurnDiffSummary } from "../types";

export function useTurnDiffSummaries(activeThread: Thread | undefined) {
  const turnDiffSummaries = useMemo(
    () =>
      activeThread?.turnDiffSummaries.length
        ? activeThread.turnDiffSummaries
        : deriveTurnDiffSummaries(activeThread?.events ?? []),
    [activeThread?.events, activeThread?.turnDiffSummaries],
  );

  const inferredCheckpointTurnCountByTurnId = useMemo(
    () => inferCheckpointTurnCountByTurnId(turnDiffSummaries),
    [turnDiffSummaries],
  );

  return { turnDiffSummaries, inferredCheckpointTurnCountByTurnId };
}
