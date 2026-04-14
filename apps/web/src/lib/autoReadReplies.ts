import type { ChatMessage } from "../types";

export interface SpeakableChunk {
  text: string;
  endOffset: number;
}

export interface ExtractSpeakableChunksInput {
  text: string;
  startOffset: number;
  isComplete: boolean;
}

export interface ExtractSpeakableChunksResult {
  chunks: SpeakableChunk[];
  nextOffset: number;
}

const MAX_STREAMING_CHUNK_LENGTH = 260;
const FALLBACK_SPLIT_PEEK = 160;

export function findLatestAssistantMessage(
  messages: ReadonlyArray<ChatMessage>,
): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }

    if (message.role === "assistant") {
      return message;
    }
  }

  return null;
}

export function extractSpeakableChunks(
  input: ExtractSpeakableChunksInput,
): ExtractSpeakableChunksResult {
  const chunks: SpeakableChunk[] = [];
  const text = input.text;
  let cursor = clampOffset(input.startOffset, text.length);

  while (cursor < text.length) {
    const prefixSkipResult = skipUnspeakablePrefix(text, cursor, input.isComplete);
    cursor = prefixSkipResult.offset;
    if (prefixSkipResult.blocked) {
      break;
    }
    if (cursor >= text.length) {
      break;
    }

    if (input.isComplete) {
      const naturalEnd = findNaturalBoundaryEnd(text, cursor, text.length);

      if (naturalEnd != null) {
        cursor = emitChunk(chunks, text, cursor, consumeWhitespace(text, naturalEnd));
        continue;
      }

      cursor = emitChunk(chunks, text, cursor, text.length);
      break;
    }

    const windowEnd = Math.min(text.length, cursor + MAX_STREAMING_CHUNK_LENGTH);
    const naturalEnd = findNaturalBoundaryEnd(text, cursor, windowEnd);

    if (naturalEnd != null) {
      cursor = emitChunk(chunks, text, cursor, consumeWhitespace(text, naturalEnd));
      continue;
    }

    if (text.length - cursor < MAX_STREAMING_CHUNK_LENGTH) {
      break;
    }

    const fallbackEnd = findFallbackSplitEnd(text, cursor, windowEnd);

    if (fallbackEnd != null) {
      cursor = emitChunk(chunks, text, cursor, fallbackEnd);
      continue;
    }

    cursor = emitChunk(chunks, text, cursor, windowEnd);
  }

  return {
    chunks,
    nextOffset: cursor,
  };
}

function emitChunk(
  chunks: SpeakableChunk[],
  text: string,
  startOffset: number,
  endOffset: number,
): number {
  const trimmedText = sanitizeSpeakableText(text.slice(startOffset, endOffset));

  if (trimmedText.length > 0) {
    chunks.push({
      text: trimmedText,
      endOffset,
    });
  }

  return endOffset;
}

function sanitizeSpeakableText(text: string): string {
  return replaceMarkdownLinks(stripFencedCodeBlocks(text)).replaceAll("`", "").trim();
}

function replaceMarkdownLinks(text: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const char = text[cursor];

    if (char === "[" || (char === "!" && text[cursor + 1] === "[")) {
      const linkStart = char === "!" ? cursor + 1 : cursor;
      const parsedLink = parseMarkdownLink(text, linkStart);

      if (parsedLink) {
        result += parsedLink.label;
        cursor = parsedLink.endOffset;
        continue;
      }
    }

    result += char;
    cursor += 1;
  }

  return result;
}

function parseMarkdownLink(
  text: string,
  startBracketOffset: number,
): { label: string; endOffset: number } | null {
  if (text.charCodeAt(startBracketOffset) !== 91) {
    return null;
  }

  const labelEndOffset = findDelimitedSpanEnd(text, startBracketOffset, "[", "]");
  if (labelEndOffset === null || text.charCodeAt(labelEndOffset) !== 40) {
    return null;
  }

  const destinationStartOffset = labelEndOffset;
  const destinationEndOffset = findMarkdownLinkDestinationEnd(text, destinationStartOffset);
  if (destinationEndOffset === null) {
    return null;
  }

  return {
    label: text.slice(startBracketOffset + 1, labelEndOffset - 1),
    endOffset: destinationEndOffset,
  };
}

function findDelimitedSpanEnd(
  text: string,
  startOffset: number,
  openingDelimiter: string,
  closingDelimiter: string,
): number | null {
  let depth = 0;

  for (let index = startOffset; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === openingDelimiter) {
      depth += 1;
      continue;
    }
    if (char !== closingDelimiter) {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return index + 1;
    }
  }

  return null;
}

function findMarkdownLinkDestinationEnd(text: string, startOffset: number): number | null {
  if (text.charCodeAt(startOffset) !== 40) {
    return null;
  }

  const firstDestinationChar = text[startOffset + 1];
  if (firstDestinationChar === "<") {
    const angleCloseOffset = text.indexOf(">", startOffset + 2);
    if (angleCloseOffset === -1 || text.charCodeAt(angleCloseOffset + 1) !== 41) {
      return null;
    }

    return angleCloseOffset + 2;
  }

  let depth = 0;

  for (let index = startOffset; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char !== ")") {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return index + 1;
    }
  }

  return null;
}

function stripFencedCodeBlocks(text: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const fenceStart = text.indexOf("```", cursor);
    if (fenceStart === -1) {
      result += text.slice(cursor);
      break;
    }

    result += text.slice(cursor, fenceStart);
    const fenceEnd = findFencedCodeBlockEnd(text, fenceStart, true);
    if (fenceEnd === null) {
      result += text.slice(fenceStart, fenceStart + 3);
      cursor = fenceStart + 3;
      continue;
    }
    if (fenceEnd === "blocked") {
      break;
    }
    cursor = fenceEnd;
  }

  return result;
}

function skipUnspeakablePrefix(
  text: string,
  startOffset: number,
  isComplete: boolean,
): { offset: number; blocked: boolean } {
  let cursor = startOffset;

  while (cursor < text.length) {
    cursor = skipWhitespace(text, cursor);
    if (cursor >= text.length) {
      return { offset: cursor, blocked: false };
    }

    const fencedCodeBlockEnd = findFencedCodeBlockEnd(text, cursor, isComplete);
    if (fencedCodeBlockEnd === null) {
      return { offset: cursor, blocked: false };
    }
    if (fencedCodeBlockEnd === "blocked") {
      return { offset: cursor, blocked: true };
    }

    cursor = fencedCodeBlockEnd;
  }

  return { offset: cursor, blocked: false };
}

function findFencedCodeBlockEnd(
  text: string,
  startOffset: number,
  isComplete: boolean,
): number | "blocked" | null {
  if (!text.startsWith("```", startOffset)) {
    return null;
  }

  const openingFenceLineEnd = text.indexOf("\n", startOffset + 3);
  if (openingFenceLineEnd === -1) {
    return isComplete ? text.length : "blocked";
  }

  const closingFenceMatch = text.slice(openingFenceLineEnd + 1).match(/(^|\n)```[^\S\n]*(\n|$)/);

  if (!closingFenceMatch || closingFenceMatch.index == null) {
    return isComplete ? text.length : "blocked";
  }

  return openingFenceLineEnd + 1 + closingFenceMatch.index + closingFenceMatch[0].length;
}

function findNaturalBoundaryEnd(
  text: string,
  startOffset: number,
  endOffset: number,
): number | null {
  return (
    findLastParagraphBoundaryEnd(text, startOffset, endOffset) ??
    findLastSentenceBoundaryEnd(text, startOffset, endOffset) ??
    findLastSingleNewlineBoundaryEnd(text, startOffset, endOffset)
  );
}

function findLastParagraphBoundaryEnd(
  text: string,
  startOffset: number,
  endOffset: number,
): number | null {
  let lastBoundaryEnd: number | null = null;

  for (let index = startOffset; index < endOffset; index += 1) {
    if (text.charCodeAt(index) !== 10) {
      continue;
    }

    let runEnd = index + 1;

    while (runEnd < endOffset && text.charCodeAt(runEnd) === 10) {
      runEnd += 1;
    }

    if (runEnd - index >= 2) {
      lastBoundaryEnd = runEnd;
      index = runEnd - 1;
    }
  }

  return lastBoundaryEnd;
}

function findLastSentenceBoundaryEnd(
  text: string,
  startOffset: number,
  endOffset: number,
): number | null {
  let lastBoundaryEnd: number | null = null;
  const slice = text.slice(startOffset, endOffset);
  const sentenceBoundaryPattern = /[.!?…][)"'\]}›»”’]*/g;

  for (const match of slice.matchAll(sentenceBoundaryPattern)) {
    const matchIndex = match.index ?? 0;
    const punctuationOffset = startOffset + matchIndex;
    const boundaryEndOffset = punctuationOffset + match[0].length;

    if (
      !isOrderedListMarkerBoundary(text, punctuationOffset) &&
      (boundaryEndOffset >= text.length || isWhitespace(text.charCodeAt(boundaryEndOffset)))
    ) {
      lastBoundaryEnd = boundaryEndOffset;
    }
  }

  return lastBoundaryEnd;
}

function isOrderedListMarkerBoundary(text: string, punctuationOffset: number): boolean {
  if (text.charCodeAt(punctuationOffset) !== 46) {
    return false;
  }

  let lineStart = punctuationOffset;
  while (lineStart > 0 && text.charCodeAt(lineStart - 1) !== 10) {
    lineStart -= 1;
  }

  let markerStart = lineStart;
  while (
    markerStart < punctuationOffset &&
    (text.charCodeAt(markerStart) === 9 || text.charCodeAt(markerStart) === 32)
  ) {
    markerStart += 1;
  }

  if (markerStart === punctuationOffset) {
    return false;
  }

  for (let index = markerStart; index < punctuationOffset; index += 1) {
    const charCode = text.charCodeAt(index);
    if (charCode < 48 || charCode > 57) {
      return false;
    }
  }

  return (
    punctuationOffset + 1 >= text.length || isWhitespace(text.charCodeAt(punctuationOffset + 1))
  );
}

function findLastSingleNewlineBoundaryEnd(
  text: string,
  startOffset: number,
  endOffset: number,
): number | null {
  let lastBoundaryEnd: number | null = null;

  for (let index = startOffset; index < endOffset; index += 1) {
    if (text.charCodeAt(index) !== 10) {
      continue;
    }

    const previousIsNewline = index > 0 && text.charCodeAt(index - 1) === 10;
    const nextIsNewline = index + 1 < text.length && text.charCodeAt(index + 1) === 10;

    if (!previousIsNewline && !nextIsNewline) {
      lastBoundaryEnd = index + 1;
    }
  }

  return lastBoundaryEnd;
}

function findFallbackSplitEnd(text: string, startOffset: number, endOffset: number): number | null {
  const searchStart = Math.min(endOffset, startOffset + FALLBACK_SPLIT_PEEK);

  for (let index = endOffset - 1; index >= searchStart; index -= 1) {
    const charCode = text.charCodeAt(index);

    if (isWhitespace(charCode) || charCode === 44 || charCode === 59 || charCode === 58) {
      return index + 1;
    }
  }

  return null;
}

function clampOffset(offset: number, textLength: number): number {
  if (offset <= 0) {
    return 0;
  }

  return offset > textLength ? textLength : offset;
}

function skipWhitespace(text: string, startOffset: number): number {
  let index = startOffset;

  while (index < text.length && isWhitespace(text.charCodeAt(index))) {
    index += 1;
  }

  return index;
}

function consumeWhitespace(text: string, startOffset: number): number {
  let index = startOffset;

  while (index < text.length && isWhitespace(text.charCodeAt(index))) {
    index += 1;
  }

  return index;
}

function isWhitespace(charCode: number): boolean {
  return (
    charCode === 9 ||
    charCode === 10 ||
    charCode === 11 ||
    charCode === 12 ||
    charCode === 13 ||
    charCode === 32 ||
    charCode === 160
  );
}
