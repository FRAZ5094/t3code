import "../index.css";

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ComposerPromptEditor } from "./ComposerPromptEditor";

async function waitForComposerEditor(): Promise<HTMLElement> {
  let element: HTMLElement | null = null;
  await vi.waitFor(() => {
    element = document.querySelector<HTMLElement>('[data-testid="composer-editor"]');
    expect(element).toBeTruthy();
  });
  return element!;
}

function setCollapsedTextSelection(root: HTMLElement, offset: number): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let traversed = 0;
  let textNode = walker.nextNode();

  while (textNode) {
    const textLength = textNode.textContent?.length ?? 0;
    if (offset <= traversed + textLength) {
      const range = document.createRange();
      range.setStart(textNode, offset - traversed);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    traversed += textLength;
    textNode = walker.nextNode();
  }

  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function ControlledComposer(props: { onPromptChange: (prompt: string) => void }) {
  const [value, setValue] = useState("before after");
  const [cursor, setCursor] = useState("before ".length);

  return (
    <ComposerPromptEditor
      value={value}
      cursor={cursor}
      terminalContexts={[]}
      skills={[]}
      disabled={false}
      placeholder="Ask anything"
      onRemoveTerminalContext={() => undefined}
      onPaste={() => undefined}
      onChange={(nextValue, nextCursor) => {
        setValue(nextValue);
        setCursor(nextCursor);
        props.onPromptChange(nextValue);
      }}
    />
  );
}

describe("ComposerPromptEditor", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("accepts Android keyboard clipboard insertFromPaste input events", async () => {
    let currentPrompt = "before after";
    const screen = await render(
      <ControlledComposer
        onPromptChange={(nextPrompt) => {
          currentPrompt = nextPrompt;
        }}
      />,
    );

    try {
      const composerEditor = await waitForComposerEditor();
      await vi.waitFor(() => {
        expect(composerEditor.textContent).toBe("before after");
      });

      composerEditor.focus();
      setCollapsedTextSelection(composerEditor, "before ".length);

      const clipboardText = "older clipboard item\nwith another line";
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", clipboardText);
      const pasteInputEvent = new InputEvent("beforeinput", {
        inputType: "insertFromPaste",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(pasteInputEvent, "dataTransfer", {
        value: dataTransfer,
      });

      composerEditor.dispatchEvent(pasteInputEvent);

      expect(pasteInputEvent.defaultPrevented).toBe(true);
      await vi.waitFor(() => {
        expect(currentPrompt).toBe(`before ${clipboardText}after`);
      });
    } finally {
      await screen.unmount();
    }
  });
});
