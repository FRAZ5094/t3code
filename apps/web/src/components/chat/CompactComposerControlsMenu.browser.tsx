import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";

async function mountMenu(supportsFastMode = true) {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <CompactComposerControlsMenu
      activePlan={false}
      interactionMode="default"
      planSidebarOpen={false}
      runtimeMode="approval-required"
      selectedEffort="high"
      selectedProvider="claudeAgent"
      supportsFastMode={supportsFastMode}
      selectedFastModeEnabled={false}
      reasoningOptions={["low", "medium", "high", "max", "ultrathink"]}
      onEffortSelect={vi.fn()}
      onFastModeChange={vi.fn()}
      onToggleInteractionMode={vi.fn()}
      onTogglePlanSidebar={vi.fn()}
      onToggleRuntimeMode={vi.fn()}
    />,
    { container: host },
  );

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("CompactComposerControlsMenu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows fast mode controls for claude", async () => {
    const mounted = await mountMenu();

    try {
      await page.getByLabelText("More composer controls").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Fast Mode");
        expect(text).toContain("off");
        expect(text).toContain("on");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("hides fast mode controls for non-opus claude models", async () => {
    const mounted = await mountMenu(false);

    try {
      await page.getByLabelText("More composer controls").click();

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").not.toContain("Fast Mode");
      });
    } finally {
      await mounted.cleanup();
    }
  });
});
