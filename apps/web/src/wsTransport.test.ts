import { describe, expect, it } from "vitest";

import { appendTokenFromPageUrl, resolveWsUrl } from "./wsTransport";

describe("resolveWsUrl", () => {
  it("prefers explicit url when provided", () => {
    const resolved = resolveWsUrl({
      explicitUrl: "ws://explicit.example:3773/socket",
      bridgeUrl: "ws://bridge.example:3773",
      envUrl: "ws://env.example:3773",
      pageUrl: "http://device.local:3773/?token=abc",
      pageProtocol: "http:",
      pageHostname: "device.local",
      pagePort: "3773",
    });

    expect(resolved).toBe("ws://explicit.example:3773/socket");
  });

  it("prefers desktop bridge url over env url", () => {
    const resolved = resolveWsUrl({
      bridgeUrl: "ws://bridge.example:3773",
      envUrl: "ws://env.example:3773",
      pageUrl: "http://device.local:3773/",
      pageProtocol: "http:",
      pageHostname: "device.local",
      pagePort: "3773",
    });

    expect(resolved).toBe("ws://bridge.example:3773");
  });

  it("falls back to env url when bridge url is missing", () => {
    const resolved = resolveWsUrl({
      envUrl: "ws://env.example:3773/path",
      pageUrl: "http://device.local:3773/",
      pageProtocol: "http:",
      pageHostname: "device.local",
      pagePort: "3773",
    });

    expect(resolved).toBe("ws://env.example:3773/path");
  });

  it("derives wss url from https page when no explicit, bridge, or env url exists", () => {
    const resolved = resolveWsUrl({
      pageUrl: "https://tailnet-host.ts.net/",
      pageProtocol: "https:",
      pageHostname: "tailnet-host.ts.net",
      pagePort: "",
    });

    expect(resolved).toBe("wss://tailnet-host.ts.net");
  });

  it("adds token from page url when missing on websocket url", () => {
    const resolved = resolveWsUrl({
      envUrl: "ws://tailnet-host.ts.net:3773",
      pageUrl: "http://tailnet-host.ts.net:3773/?token=super-secret",
      pageProtocol: "http:",
      pageHostname: "tailnet-host.ts.net",
      pagePort: "3773",
    });

    expect(resolved).toBe("ws://tailnet-host.ts.net:3773/?token=super-secret");
  });

  it("does not overwrite existing websocket token", () => {
    const resolved = resolveWsUrl({
      envUrl: "ws://tailnet-host.ts.net:3773/?token=already-set",
      pageUrl: "http://tailnet-host.ts.net:3773/?token=super-secret",
      pageProtocol: "http:",
      pageHostname: "tailnet-host.ts.net",
      pagePort: "3773",
    });

    expect(resolved).toBe("ws://tailnet-host.ts.net:3773/?token=already-set");
  });
});

describe("appendTokenFromPageUrl", () => {
  it("returns original url for invalid page urls", () => {
    expect(appendTokenFromPageUrl("ws://localhost:3773", "not-a-url")).toBe("ws://localhost:3773");
  });
});
