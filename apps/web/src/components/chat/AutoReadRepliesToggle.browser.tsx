import "../../index.css";

import { type ComponentProps } from "react";
import {
  type LocalApi,
  type ResolvedKeybindingsConfig,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { CLIENT_SETTINGS_STORAGE_KEY } from "../../clientPersistenceStorage";
import { __resetClientSettingsPersistenceForTests } from "../../hooks/useSettings";
import { ChatHeader } from "./ChatHeader";

const localApiMock = vi.hoisted(() => {
  const persistence: LocalApi["persistence"] = {
    getClientSettings: async () => {
      const rawValue = localStorage.getItem("t3code:client-settings:v1");
      return rawValue ? (JSON.parse(rawValue) as never) : null;
    },
    setClientSettings: async (settings) => {
      localStorage.setItem("t3code:client-settings:v1", JSON.stringify(settings));
    },
    getSavedEnvironmentRegistry: async () => [],
    setSavedEnvironmentRegistry: async () => undefined,
    getSavedEnvironmentSecret: async () => null,
    setSavedEnvironmentSecret: async () => false,
    removeSavedEnvironmentSecret: async () => undefined,
  };

  return {
    ensureLocalApi: () => ({ persistence }) as LocalApi,
    readLocalApi: () => ({ persistence }) as LocalApi,
  };
});

vi.mock("~/localApi", () => localApiMock);
vi.mock("../ui/sidebar", () => ({
  SidebarTrigger: (props: ComponentProps<"button">) => <button type="button" {...props} />,
}));

const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const THREAD_ID = ThreadId.make("thread-auto-read-replies");
const KEYBINDINGS: ResolvedKeybindingsConfig = [];
const speakSpy = vi.fn();
const originalSpeechSynthesisDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "speechSynthesis",
);

class MockSpeechSynthesisUtterance {
  readonly text: string;
  rate = 1;

  constructor(text: string) {
    this.text = text;
  }
}

function installSpeechSynthesisMocks() {
  speakSpy.mockClear();

  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      speak: speakSpy,
    },
  });
  vi.stubGlobal("SpeechSynthesisUtterance", MockSpeechSynthesisUtterance);
}

function restoreSpeechSynthesisMocks() {
  vi.unstubAllGlobals();

  if (originalSpeechSynthesisDescriptor) {
    Object.defineProperty(window, "speechSynthesis", originalSpeechSynthesisDescriptor);
  } else {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: undefined,
    });
  }
}

async function mountChatHeader() {
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <ChatHeader
      activeThreadEnvironmentId={LOCAL_ENVIRONMENT_ID}
      activeThreadId={THREAD_ID}
      activeThreadTitle="Auto read replies"
      activeProjectName={undefined}
      isGitRepo={false}
      openInCwd={null}
      activeProjectScripts={undefined}
      preferredScriptId={null}
      keybindings={KEYBINDINGS}
      availableEditors={[]}
      terminalAvailable={false}
      terminalOpen={false}
      terminalToggleShortcutLabel={null}
      diffToggleShortcutLabel={null}
      gitCwd={null}
      diffOpen={false}
      onRunProjectScript={vi.fn()}
      onAddProjectScript={vi.fn(async () => undefined)}
      onUpdateProjectScript={vi.fn(async () => undefined)}
      onDeleteProjectScript={vi.fn(async () => undefined)}
      onToggleTerminal={vi.fn()}
      onToggleDiff={vi.fn()}
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

function readPersistedAutoReadReplies(): boolean | null {
  const rawValue = localStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  const parsed = JSON.parse(rawValue) as { autoReadReplies?: boolean };
  return parsed.autoReadReplies ?? null;
}

describe("AutoReadRepliesToggle", () => {
  afterEach(async () => {
    restoreSpeechSynthesisMocks();
    localStorage.clear();
    document.body.innerHTML = "";
    await __resetClientSettingsPersistenceForTests();
  });

  it("updates persisted client settings when clicked", async () => {
    const mounted = await mountChatHeader();

    try {
      const toggle = page.getByLabelText("Auto-read replies");
      await expect.element(toggle).toHaveAttribute("aria-pressed", "false");

      await toggle.click();

      await vi.waitFor(() => {
        expect(readPersistedAutoReadReplies()).toBe(true);
      });
      await expect.element(toggle).toHaveAttribute("aria-pressed", "true");

      await toggle.click();

      await vi.waitFor(() => {
        expect(readPersistedAutoReadReplies()).toBe(false);
      });
      await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
    } finally {
      await mounted.cleanup();
    }
  });

  it("hydrates from the persisted client setting", async () => {
    localStorage.setItem(
      CLIENT_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        autoReadReplies: true,
      }),
    );

    const mounted = await mountChatHeader();

    try {
      await expect
        .element(page.getByLabelText("Auto-read replies"))
        .toHaveAttribute("aria-pressed", "true");
    } finally {
      await mounted.cleanup();
    }
  });

  it("speaks a test phrase from the header button", async () => {
    installSpeechSynthesisMocks();
    localStorage.setItem(
      CLIENT_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        speechPlaybackRate: "3x",
      }),
    );

    const mounted = await mountChatHeader();

    try {
      await page.getByLabelText("Speak test phrase").click();

      await vi.waitFor(() => {
        expect(speakSpy).toHaveBeenCalledTimes(1);
      });
      expect(speakSpy.mock.calls[0]?.[0]).toMatchObject({ text: "Speech test." });
      expect(speakSpy.mock.calls[0]?.[0]).toMatchObject({ rate: 3 });
    } finally {
      await mounted.cleanup();
    }
  });
});
