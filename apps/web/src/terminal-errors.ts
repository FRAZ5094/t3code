const BENIGN_TERMINAL_WRITE_ERROR_MARKERS = [
  "terminal is not running",
  "unknown terminal thread",
] as const;

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return null;
}

export function isIgnorableTerminalWriteError(error: unknown): boolean {
  const message = errorMessage(error)?.toLowerCase();
  if (!message) return false;
  return BENIGN_TERMINAL_WRITE_ERROR_MARKERS.some((marker) => message.includes(marker));
}
