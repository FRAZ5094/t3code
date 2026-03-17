import "../../index.css";

import type { ProviderReasoningEffort } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ProviderTraitsPicker } from "./CodexTraitsPicker";

async function mountPicker(props: {
  effort: ProviderReasoningEffort;
  supportsFastMode: boolean;
  fastModeEnabled: boolean;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onEffortChange = vi.fn();
  const onFastModeChange = vi.fn();
  const screen = await render(
    <ProviderTraitsPicker
      provider="claudeAgent"
      effort={props.effort}
      supportsFastMode={props.supportsFastMode}
      fastModeEnabled={props.fastModeEnabled}
      options={["low", "medium", "high", "max", "ultrathink"]}
      onEffortChange={onEffortChange}
      onFastModeChange={onFastModeChange}
    />,
    { container: host },
  );

  return {
    onEffortChange,
    onFastModeChange,
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("ProviderTraitsPicker", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows fast mode controls for claude", async () => {
    const mounted = await mountPicker({
      effort: "high",
      supportsFastMode: true,
      fastModeEnabled: false,
    });

    try {
      await page.getByRole("button").click();

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

  it("shows Fast in the trigger label when claude fast mode is active", async () => {
    const mounted = await mountPicker({
      effort: "high",
      supportsFastMode: true,
      fastModeEnabled: true,
    });

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("High · Fast");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("hides fast mode controls for non-opus claude models", async () => {
    const mounted = await mountPicker({
      effort: "high",
      supportsFastMode: false,
      fastModeEnabled: false,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").not.toContain("Fast Mode");
      });
    } finally {
      await mounted.cleanup();
    }
  });
});
