import type {
  AppBootstrapResult,
  AppHealthResult,
  NativeApi,
  ProviderEvent,
  WsClientMessage,
  WsEventMessage,
  WsResponseMessage,
  OutputChunk,
  AgentExit,
} from "@acme/contracts";
import { WS_EVENT_CHANNELS, wsServerMessageSchema } from "@acme/contracts";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type SubscriptionSet<TValue> = Set<(value: TValue) => void>;
const REQUEST_TIMEOUT_MS = 30_000;
const textDecoder = new TextDecoder();

class WsNativeApiClient {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<WebSocket> | null = null;
  private nextRequestId = 1;
  private pending = new Map<string, PendingRequest>();
  private providerEventListeners: SubscriptionSet<ProviderEvent> = new Set();
  private agentOutputListeners: SubscriptionSet<OutputChunk> = new Set();
  private agentExitListeners: SubscriptionSet<AgentExit> = new Set();

  constructor(private readonly wsUrl: string) {}

  private connect() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.socket);
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(this.wsUrl);
      socket.binaryType = "arraybuffer";
      this.socket = socket;

      socket.addEventListener("open", () => {
        this.connectPromise = null;
        resolve(socket);
      });

      socket.addEventListener("error", () => {
        this.connectPromise = null;
        reject(new Error("Failed to connect to local t3 runtime."));
      });

      socket.addEventListener("message", (event) => {
        void this.handleMessage(event.data);
      });

      socket.addEventListener("close", () => {
        this.socket = null;
        for (const [id, pending] of this.pending.entries()) {
          clearTimeout(pending.timeout);
          pending.reject(new Error(`Request ${id} failed: websocket disconnected.`));
        }
        this.pending.clear();
      });
    });

    return this.connectPromise;
  }

  private async request(method: string, params?: unknown) {
    const socket = await this.connect();
    const id = String(this.nextRequestId);
    this.nextRequestId += 1;

    const requestMessage: WsClientMessage = {
      type: "request",
      id,
      method,
      params,
    };

    const requestPromise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out for method '${method}'.`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
    });

    try {
      socket.send(JSON.stringify(requestMessage));
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        pending.reject(
          new Error(
            `Failed to send runtime request '${method}': ${
              error instanceof Error ? error.message : "unknown websocket failure"
            }`,
          ),
        );
      }
    }

    return requestPromise;
  }

  private handleResponse(message: WsResponseMessage) {
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.ok) {
      pending.resolve(message.result);
      return;
    }

    pending.reject(new Error(message.error?.message ?? "Unknown runtime request failure."));
  }

  private handleEvent(message: WsEventMessage) {
    if (message.channel === WS_EVENT_CHANNELS.providerEvent) {
      for (const listener of this.providerEventListeners) {
        listener(message.payload as ProviderEvent);
      }
      return;
    }

    if (message.channel === WS_EVENT_CHANNELS.agentOutput) {
      for (const listener of this.agentOutputListeners) {
        listener(message.payload as OutputChunk);
      }
      return;
    }

    if (message.channel === WS_EVENT_CHANNELS.agentExit) {
      for (const listener of this.agentExitListeners) {
        listener(message.payload as AgentExit);
      }
    }
  }

  private async decodeIncomingMessage(raw: unknown): Promise<string | null> {
    if (typeof raw === "string") {
      return raw;
    }

    if (raw instanceof ArrayBuffer) {
      return textDecoder.decode(raw);
    }

    if (raw instanceof Blob) {
      return raw.text();
    }

    return null;
  }

  private async handleMessage(raw: unknown) {
    const decoded = await this.decodeIncomingMessage(raw);
    if (!decoded) {
      return;
    }

    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(decoded);
    } catch {
      return;
    }

    const parsed = wsServerMessageSchema.safeParse(parsedRaw);
    if (!parsed.success) {
      return;
    }

    if (parsed.data.type === "response") {
      this.handleResponse(parsed.data);
      return;
    }

    if (parsed.data.type === "event") {
      this.handleEvent(parsed.data);
    }
  }

  asNativeApi(): NativeApi {
    return {
      app: {
        bootstrap: async () =>
          this.request("app.bootstrap").then((value) => value as AppBootstrapResult),
        health: async () =>
          this.request("app.health").then((value) => value as AppHealthResult),
      },
      todos: {
        list: async () =>
          this.request("todos.list").then(
            (value) => value as Awaited<ReturnType<NativeApi["todos"]["list"]>>,
          ),
        add: async (input) =>
          this.request("todos.add", input).then(
            (value) => value as Awaited<ReturnType<NativeApi["todos"]["add"]>>,
          ),
        toggle: async (id) =>
          this.request("todos.toggle", id).then(
            (value) => value as Awaited<ReturnType<NativeApi["todos"]["toggle"]>>,
          ),
        remove: async (id) =>
          this.request("todos.remove", id).then(
            (value) => value as Awaited<ReturnType<NativeApi["todos"]["remove"]>>,
          ),
      },
      dialogs: {
        pickFolder: async () =>
          this.request("dialogs.pickFolder").then((value) => value as string | null),
      },
      terminal: {
        run: async (input) =>
          this.request("terminal.run", input).then(
            (value) => value as Awaited<ReturnType<NativeApi["terminal"]["run"]>>,
          ),
      },
      agent: {
        spawn: async (config) =>
          this.request("agent.spawn", config).then((value) => value as string),
        kill: async (sessionId) => {
          await this.request("agent.kill", sessionId);
        },
        write: async (sessionId, data) => {
          await this.request("agent.write", { sessionId, data });
        },
        onOutput: (callback) => {
          this.agentOutputListeners.add(callback);
          return () => {
            this.agentOutputListeners.delete(callback);
          };
        },
        onExit: (callback) => {
          this.agentExitListeners.add(callback);
          return () => {
            this.agentExitListeners.delete(callback);
          };
        },
      },
      providers: {
        startSession: async (input) =>
          this.request("providers.startSession", input).then(
            (value) => value as Awaited<ReturnType<NativeApi["providers"]["startSession"]>>,
          ),
        sendTurn: async (input) =>
          this.request("providers.sendTurn", input).then(
            (value) => value as Awaited<ReturnType<NativeApi["providers"]["sendTurn"]>>,
          ),
        interruptTurn: async (input) => {
          await this.request("providers.interruptTurn", input);
        },
        respondToRequest: async (input) => {
          await this.request("providers.respondToRequest", input);
        },
        stopSession: async (input) => {
          await this.request("providers.stopSession", input);
        },
        listSessions: async () =>
          this.request("providers.listSessions").then(
            (value) => value as Awaited<ReturnType<NativeApi["providers"]["listSessions"]>>,
          ),
        onEvent: (callback) => {
          this.providerEventListeners.add(callback);
          return () => {
            this.providerEventListeners.delete(callback);
          };
        },
      },
      shell: {
        openInEditor: async (cwd, editor) => {
          await this.request("shell.openInEditor", { cwd, editor });
        },
      },
    };
  }
}

function resolveWsUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("ws") ?? "ws://127.0.0.1:4317";
}

let cachedApi: NativeApi | undefined;

export function getOrCreateWsNativeApi() {
  if (cachedApi) {
    return cachedApi;
  }

  cachedApi = new WsNativeApiClient(resolveWsUrl()).asNativeApi();
  return cachedApi;
}
