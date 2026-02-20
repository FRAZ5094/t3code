import { afterEach, describe, expect, it, vi } from "vitest";

const LOCAL_APP_SETTINGS_STORAGE_KEY = "t3code:app-settings:local:v1";

type StorageMap = Map<string, string>;

function installWindowMock(initialStorage?: StorageMap): StorageMap {
  const storage = initialStorage ?? new Map<string, string>();

  const localStorageMock = {
    length: 0,
    clear: () => {
      storage.clear();
      localStorageMock.length = 0;
    },
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    removeItem: (key: string) => {
      storage.delete(key);
      localStorageMock.length = storage.size;
    },
    setItem: (key: string, value: string) => {
      storage.set(key, value);
      localStorageMock.length = storage.size;
    },
  };

  localStorageMock.length = storage.size;

  const windowMock = {
    localStorage: localStorageMock as Storage,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowMock,
  });

  return storage;
}

describe("appSettings", () => {
  afterEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("returns a stable snapshot reference when settings have not changed", async () => {
    installWindowMock();
    const module = await import("./appSettings");

    const first = module.getAppSettingsSnapshot();
    const second = module.getAppSettingsSnapshot();

    expect(second).toBe(first);
  });

  it("returns a new snapshot reference when local settings change", async () => {
    const storage = installWindowMock();
    const module = await import("./appSettings");

    const first = module.getAppSettingsSnapshot();
    storage.set(LOCAL_APP_SETTINGS_STORAGE_KEY, JSON.stringify({ confirmThreadDelete: false }));
    const second = module.getAppSettingsSnapshot();

    expect(second).not.toBe(first);
    expect(second.confirmThreadDelete).toBe(false);
  });
});
