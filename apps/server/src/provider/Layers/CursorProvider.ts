import type {
  CursorModelOptions,
  CursorSettings,
  ModelCapabilities,
  ServerProvider,
  ServerProviderAuth,
  ServerProviderModel,
  ServerProviderState,
  ServerSettingsError,
} from "@t3tools/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";
import { normalizeModelSlug, resolveContextWindow, resolveEffort } from "@t3tools/shared/model";
import { Effect, Equal, Layer, Option, Result, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  collectStreamAsString,
  isCommandMissingCause,
  providerModelsFromSettings,
  type CommandResult,
} from "../providerSnapshot";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import { CursorProvider } from "../Services/CursorProvider";
import { AcpSessionRuntime } from "../acp/AcpSessionRuntime";
import { ServerSettingsService } from "../../serverSettings";

const PROVIDER = "cursor" as const;
const EMPTY_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};
const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "default",
    name: "Auto",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "composer-2",
    name: "Composer 2",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "composer-1.5",
    name: "Composer 1.5",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "gpt-5.3-codex",
    name: "Codex 5.3",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium", isDefault: true },
        { value: "high", label: "High" },
        { value: "xhigh", label: "Extra High" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "gpt-5.3-codex-spark",
    name: "Codex 5.3 Spark",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium", isDefault: true },
        { value: "high", label: "High" },
        { value: "xhigh", label: "Extra High" },
      ],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "gpt-5.4",
    name: "GPT-5.4",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium", isDefault: true },
        { value: "high", label: "High" },
        { value: "xhigh", label: "Extra High" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [
        { value: "272k", label: "272k", isDefault: true },
        { value: "1m", label: "1M" },
      ],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "claude-opus-4-6",
    name: "Opus 4.6",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High", isDefault: true },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: true,
      contextWindowOptions: [
        { value: "200k", label: "200k", isDefault: true },
        { value: "1m", label: "1M" },
      ],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "claude-sonnet-4-6",
    name: "Sonnet 4.6",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium", isDefault: true },
        { value: "high", label: "High" },
      ],
      supportsFastMode: false,
      supportsThinkingToggle: true,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "grok-4-20",
    name: "Grok 4.20",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: true,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
];

const CURSOR_ACP_MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
export const CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES = {
  _meta: {
    parameterizedModelPicker: true,
  },
} satisfies NonNullable<EffectAcpSchema.InitializeRequest["clientCapabilities"]>;

interface CursorSessionSelectOption {
  readonly value: string;
  readonly name: string;
}

interface CursorAcpDiscoveredModel {
  readonly slug: string;
  readonly name: string;
  readonly capabilities: ModelCapabilities;
}

function flattenSessionConfigSelectOptions(
  configOption: EffectAcpSchema.SessionConfigOption | undefined,
): ReadonlyArray<CursorSessionSelectOption> {
  if (!configOption || configOption.type !== "select") {
    return [];
  }
  return configOption.options.flatMap((entry) =>
    "value" in entry
      ? [{ value: entry.value.trim(), name: entry.name.trim() } satisfies CursorSessionSelectOption]
      : entry.options.map(
          (option) =>
            ({
              value: option.value.trim(),
              name: option.name.trim(),
            }) satisfies CursorSessionSelectOption,
        ),
  );
}

function normalizeCursorAcpModelSlug(modelId: string): string {
  const trimmed = modelId.trim();
  const base = trimmed.includes("[") ? trimmed.slice(0, trimmed.indexOf("[")) : trimmed;
  return normalizeModelSlug(base, PROVIDER) ?? base;
}

function normalizeCursorThoughtLevelValue(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case "low":
    case "medium":
    case "high":
      return normalized;
    case "xhigh":
    case "extra-high":
    case "extra high":
      return "xhigh";
    default:
      return undefined;
  }
}

function findCursorModelConfigOption(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): EffectAcpSchema.SessionConfigOption | undefined {
  return configOptions.find((option) => option.category === "model");
}

function isCursorContextConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  const id = option.id.trim().toLowerCase();
  const name = option.name.trim().toLowerCase();
  return id === "context" || id === "context_size" || name.includes("context");
}

function isCursorFastConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  const id = option.id.trim().toLowerCase();
  const name = option.name.trim().toLowerCase();
  return id === "fast" || name === "fast" || name.includes("fast mode");
}

function isCursorThinkingConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  const id = option.id.trim().toLowerCase();
  const name = option.name.trim().toLowerCase();
  return id === "thinking" || name.includes("thinking");
}

function isBooleanLikeConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  if (option.type === "boolean") {
    return true;
  }
  if (option.type !== "select") {
    return false;
  }
  const values = new Set(
    flattenSessionConfigSelectOptions(option).map((entry) => entry.value.trim().toLowerCase()),
  );
  return values.has("true") && values.has("false");
}

export function buildCursorCapabilitiesFromConfigOptions(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
): ModelCapabilities {
  if (!configOptions || configOptions.length === 0) {
    return EMPTY_CAPABILITIES;
  }

  const reasoningConfig = configOptions.find((option) => option.category === "thought_level");
  const reasoningEffortLevels =
    reasoningConfig?.type === "select"
      ? flattenSessionConfigSelectOptions(reasoningConfig).flatMap((entry) => {
          const normalizedValue = normalizeCursorThoughtLevelValue(entry.value);
          if (!normalizedValue) {
            return [];
          }
          return [
            {
              value: normalizedValue,
              label: entry.name,
              ...(normalizeCursorThoughtLevelValue(reasoningConfig.currentValue) === normalizedValue
                ? { isDefault: true }
                : {}),
            },
          ];
        })
      : [];

  const contextOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorContextConfigOption(option),
  );
  const contextWindowOptions =
    contextOption?.type === "select"
      ? flattenSessionConfigSelectOptions(contextOption).map((entry) => {
          if (contextOption.currentValue === entry.value) {
            return {
              value: entry.value,
              label: entry.name,
              isDefault: true,
            };
          }
          return {
            value: entry.value,
            label: entry.name,
          };
        })
      : [];

  const fastOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorFastConfigOption(option),
  );
  const thinkingOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorThinkingConfigOption(option),
  );

  return {
    reasoningEffortLevels,
    supportsFastMode: fastOption ? isBooleanLikeConfigOption(fastOption) : false,
    supportsThinkingToggle: thinkingOption ? isBooleanLikeConfigOption(thinkingOption) : false,
    contextWindowOptions,
    promptInjectedEffortLevels: [],
  };
}

function buildCursorDiscoveredModels(
  discoveredModels: ReadonlyArray<CursorAcpDiscoveredModel>,
): ReadonlyArray<ServerProviderModel> {
  const seen = new Set<string>();
  return discoveredModels.flatMap((model) => {
    if (!model.slug || seen.has(model.slug)) {
      return [];
    }
    seen.add(model.slug);
    return [
      {
        slug: model.slug,
        name: model.name,
        isCustom: false,
        capabilities: model.capabilities,
      } satisfies ServerProviderModel,
    ];
  });
}

function normalizeCursorConfigOptionToken(value: string | null | undefined): string {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "-") ?? ""
  );
}

function findCursorSelectOptionValue(
  configOption: EffectAcpSchema.SessionConfigOption | undefined,
  matcher: (option: CursorSessionSelectOption) => boolean,
): string | undefined {
  return flattenSessionConfigSelectOptions(configOption).find(matcher)?.value;
}

function findCursorBooleanConfigValue(
  configOption: EffectAcpSchema.SessionConfigOption | undefined,
  requested: boolean,
): string | boolean | undefined {
  if (!configOption) {
    return undefined;
  }
  if (configOption.type === "boolean") {
    return requested;
  }
  return findCursorSelectOptionValue(
    configOption,
    (option) => normalizeCursorConfigOptionToken(option.value) === String(requested),
  );
}

export function resolveCursorAcpBaseModelId(model: string | null | undefined): string {
  const normalized = normalizeModelSlug(model, PROVIDER) ?? "default";
  return normalized.includes("[") ? normalized.slice(0, normalized.indexOf("[")) : normalized;
}

export function resolveCursorAcpConfigUpdates(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
  modelOptions: CursorModelOptions | null | undefined,
): ReadonlyArray<{ readonly configId: string; readonly value: string | boolean }> {
  if (!configOptions || configOptions.length === 0) {
    return [];
  }

  const updates: Array<{ readonly configId: string; readonly value: string | boolean }> = [];

  const reasoningOption = configOptions.find((option) => option.category === "thought_level");
  const requestedReasoning = normalizeCursorThoughtLevelValue(modelOptions?.reasoning);
  if (reasoningOption && requestedReasoning) {
    const value = findCursorSelectOptionValue(reasoningOption, (option) => {
      const normalizedValue = normalizeCursorThoughtLevelValue(option.value);
      const normalizedName = normalizeCursorThoughtLevelValue(option.name);
      return normalizedValue === requestedReasoning || normalizedName === requestedReasoning;
    });
    if (value) {
      updates.push({ configId: reasoningOption.id, value });
    }
  }

  const contextOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorContextConfigOption(option),
  );
  if (contextOption && modelOptions?.contextWindow) {
    const value = findCursorSelectOptionValue(
      contextOption,
      (option) =>
        normalizeCursorConfigOptionToken(option.value) ===
          normalizeCursorConfigOptionToken(modelOptions.contextWindow) ||
        normalizeCursorConfigOptionToken(option.name) ===
          normalizeCursorConfigOptionToken(modelOptions.contextWindow),
    );
    if (value) {
      updates.push({ configId: contextOption.id, value });
    }
  }

  const fastOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorFastConfigOption(option),
  );
  if (fastOption && modelOptions?.fastMode === true) {
    const value = findCursorBooleanConfigValue(fastOption, true);
    if (value !== undefined) {
      updates.push({ configId: fastOption.id, value });
    }
  }

  const thinkingOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorThinkingConfigOption(option),
  );
  if (thinkingOption && typeof modelOptions?.thinking === "boolean") {
    const value = findCursorBooleanConfigValue(thinkingOption, modelOptions.thinking);
    if (value !== undefined) {
      updates.push({ configId: thinkingOption.id, value });
    }
  }

  return updates;
}

const discoverCursorModelsViaAcp = (cursorSettings: CursorSettings) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        spawn: {
          command: cursorSettings.binaryPath,
          args: [
            ...(cursorSettings.apiEndpoint ? (["-e", cursorSettings.apiEndpoint] as const) : []),
            "acp",
          ],
          cwd: process.cwd(),
        },
        cwd: process.cwd(),
        clientInfo: { name: "t3-code-provider-probe", version: "0.0.0" },
        authMethodId: "cursor_login",
        clientCapabilities: CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES,
      }).pipe(Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner))),
    );
    const acp = yield* Effect.service(AcpSessionRuntime).pipe(Effect.provide(acpContext));
    const started = yield* acp.start();
    const initialConfigOptions = started.sessionSetupResult.configOptions ?? [];
    const modelOption = findCursorModelConfigOption(initialConfigOptions);
    const modelChoices = flattenSessionConfigSelectOptions(modelOption);
    if (!modelOption || modelChoices.length === 0) {
      return [] as const;
    }

    const fallbackBySlug = new Map(BUILT_IN_MODELS.map((model) => [model.slug, model] as const));
    const currentModelValue =
      modelOption.type === "select" ? modelOption.currentValue?.trim() || undefined : undefined;

    const discoveredModels = yield* Effect.forEach(
      modelChoices,
      (modelChoice) =>
        Effect.gen(function* () {
          const slug = normalizeCursorAcpModelSlug(modelChoice.value);
          let configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> =
            initialConfigOptions;
          if (currentModelValue !== modelChoice.value) {
            configOptions = yield* acp.setConfigOption(modelOption.id, modelChoice.value).pipe(
              Effect.map((response) => response.configOptions ?? []),
              Effect.catch(() =>
                Effect.succeed<ReadonlyArray<EffectAcpSchema.SessionConfigOption>>([]),
              ),
            );
          }
          const fallbackCapabilities = fallbackBySlug.get(slug)?.capabilities ?? EMPTY_CAPABILITIES;
          return {
            slug,
            name: modelChoice.name,
            capabilities:
              configOptions.length > 0
                ? buildCursorCapabilitiesFromConfigOptions(configOptions)
                : fallbackCapabilities,
          } satisfies CursorAcpDiscoveredModel;
        }),
      { concurrency: 1 },
    );

    return buildCursorDiscoveredModels(discoveredModels);
  }).pipe(Effect.scoped);

export function getCursorModelCapabilities(model: string | null | undefined): ModelCapabilities {
  const slug = normalizeModelSlug(model, "cursor");
  return (
    BUILT_IN_MODELS.find((candidate) => candidate.slug === slug)?.capabilities ?? EMPTY_CAPABILITIES
  );
}

/**
 * Resolve the ACP model ID for a Cursor model to be sent to session/set_config_option
 */
export function resolveCursorAcpModelId(
  model: string | null | undefined,
  modelOptions: CursorModelOptions | null | undefined,
): string {
  const slug = normalizeModelSlug(model, "cursor") ?? "auto";
  if (slug.includes("[") && slug.endsWith("]")) {
    return slug;
  }
  const caps = getCursorModelCapabilities(slug);
  const isBuiltIn = BUILT_IN_MODELS.some((candidate) => candidate.slug === slug);
  if (!isBuiltIn) {
    return slug;
  }

  const traits: string[] = [];

  if (slug === "gpt-5.3-codex") {
    const reasoning = resolveEffort(caps, modelOptions?.reasoning) ?? "medium";
    traits.push(`reasoning=${reasoning}`);
    traits.push(`fast=${modelOptions?.fastMode === true}`);
    return `${slug}[${traits.join(",")}]`;
  }

  if (caps.supportsFastMode && modelOptions?.fastMode === true) {
    traits.push("fast=true");
  }

  if (modelOptions?.reasoning !== undefined) {
    const reasoning = resolveEffort(caps, modelOptions.reasoning);
    if (reasoning) {
      traits.push(`${slug.startsWith("claude-") ? "effort" : "reasoning"}=${reasoning}`);
    }
  }

  if (caps.supportsThinkingToggle && modelOptions?.thinking !== undefined) {
    traits.push(`thinking=${modelOptions.thinking}`);
  }

  if (modelOptions?.contextWindow !== undefined) {
    const contextWindow = resolveContextWindow(caps, modelOptions.contextWindow);
    if (contextWindow) {
      traits.push(`context=${contextWindow}`);
    }
  }

  return traits.length > 0 ? `${slug}[${traits.join(",")}]` : slug;
}

/**
 * Resolve the Agent CLI model ID for a Cursor model to be set as `--model` arg for the `agent` command.
 *
 * Yes... Cursor uses different IDs. No... I don't know why.
 */
export function resolveCursorAgentModel(
  model: string | null | undefined,
  modelOptions: CursorModelOptions | null | undefined,
): string {
  const normalized = normalizeModelSlug(model, "cursor") ?? "default";
  const slug = normalized.includes("[") ? normalized.slice(0, normalized.indexOf("[")) : normalized;
  const caps = getCursorModelCapabilities(slug);
  const reasoning = resolveEffort(caps, modelOptions?.reasoning);
  const thinking = caps.supportsThinkingToggle ? (modelOptions?.thinking ?? true) : undefined;
  const fastMode = modelOptions?.fastMode === true;

  switch (slug) {
    case "default":
      return "auto";
    case "composer-2":
      return fastMode ? "composer-2-fast" : "composer-2";
    case "composer-1.5":
      return "composer-1.5";
    case "gpt-5.3-codex": {
      const suffix = reasoning && reasoning !== "medium" ? `-${reasoning}` : "";
      return `gpt-5.3-codex${suffix}${fastMode ? "-fast" : ""}`;
    }
    case "gpt-5.3-codex-spark": {
      const suffix = reasoning && reasoning !== "medium" ? `-${reasoning}` : "";
      return `gpt-5.3-codex-spark-preview${suffix}`;
    }
    case "gpt-5.4":
      return `gpt-5.4-${reasoning ?? "medium"}${fastMode ? "-fast" : ""}`;
    case "claude-opus-4-6":
      return thinking ? "claude-4.6-opus-high-thinking" : "claude-4.6-opus-high";
    case "claude-sonnet-4-6":
      return thinking ? "claude-4.6-sonnet-medium-thinking" : "claude-4.6-sonnet-medium";
    case "gemini-3.1-pro":
      return "gemini-3.1-pro";
    case "grok-4-20":
      return thinking ? "grok-4-20-thinking" : "grok-4-20";
    default:
      return slug === "default" ? "auto" : slug;
  }
}

/** Timeout for `agent about` — it's slower than a simple `--version` probe. */
const ABOUT_TIMEOUT_MS = 8_000;

/** Strip ANSI escape sequences so we can parse plain key-value lines. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?\x07/g, "");
}

/**
 * Extract a value from `agent about` key-value output.
 * Lines look like: `CLI Version         2026.03.20-44cb435`
 */
function extractAboutField(plain: string, key: string): string | undefined {
  const regex = new RegExp(`^${key}\\s{2,}(.+)$`, "mi");
  const match = regex.exec(plain);
  return match?.[1]?.trim();
}

export interface CursorAboutResult {
  readonly version: string | null;
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: Pick<ServerProviderAuth, "status">;
  readonly message?: string;
}

/**
 * Parse the output of `agent about` to extract version and authentication
 * status in a single probe.
 *
 * Example output (logged in):
 * ```
 * About Cursor CLI
 *
 * CLI Version         2026.03.20-44cb435
 * User Email          user@example.com
 * ```
 *
 * Example output (logged out):
 * ```
 * About Cursor CLI
 *
 * CLI Version         2026.03.20-44cb435
 * User Email          Not logged in
 * ```
 */
export function parseCursorAboutOutput(result: CommandResult): CursorAboutResult {
  const combined = `${result.stdout}\n${result.stderr}`;
  const lowerOutput = combined.toLowerCase();

  // If the command itself isn't recognised, we're on an old CLI version.
  if (
    lowerOutput.includes("unknown command") ||
    lowerOutput.includes("unrecognized command") ||
    lowerOutput.includes("unexpected argument")
  ) {
    return {
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "The `agent about` command is unavailable in this version of the Cursor Agent CLI.",
    };
  }

  const plain = stripAnsi(combined);
  const version = extractAboutField(plain, "CLI Version") ?? null;
  const userEmail = extractAboutField(plain, "User Email");

  // Determine auth from the User Email field.
  if (userEmail === undefined) {
    // Field missing entirely — can't determine auth.
    if (result.code === 0) {
      return { version, status: "ready", auth: { status: "unknown" } };
    }
    return {
      version,
      status: "warning",
      auth: { status: "unknown" },
      message: "Could not verify Cursor Agent authentication status.",
    };
  }

  const lowerEmail = userEmail.toLowerCase();
  if (
    lowerEmail === "not logged in" ||
    lowerEmail.includes("login required") ||
    lowerEmail.includes("authentication required")
  ) {
    return {
      version,
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Cursor Agent is not authenticated. Run `agent login` and try again.",
    };
  }

  // Any non-empty email value means authenticated.
  return { version, status: "ready", auth: { status: "authenticated" } };
}

const runCursorCommand = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const cursorSettings = yield* Effect.service(ServerSettingsService).pipe(
      Effect.flatMap((service) => service.getSettings),
      Effect.map((settings) => settings.providers.cursor),
    );
    const command = ChildProcess.make(cursorSettings.binaryPath, [...args], {
      shell: process.platform === "win32",
    });

    const child = yield* spawner.spawn(command);
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );

    return { stdout, stderr, code: exitCode } satisfies CommandResult;
  }).pipe(Effect.scoped);

export const checkCursorProviderStatus = Effect.fn("checkCursorProviderStatus")(
  function* (): Effect.fn.Return<
    ServerProvider,
    ServerSettingsError,
    ChildProcessSpawner.ChildProcessSpawner | ServerSettingsService
  > {
    const cursorSettings = yield* Effect.service(ServerSettingsService).pipe(
      Effect.flatMap((service) => service.getSettings),
      Effect.map((settings) => settings.providers.cursor),
    );
    const checkedAt = new Date().toISOString();
    const fallbackModels = providerModelsFromSettings(
      BUILT_IN_MODELS,
      PROVIDER,
      cursorSettings.customModels,
    );

    if (!cursorSettings.enabled) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: false,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Cursor is disabled in T3 Code settings.",
        },
      });
    }

    // Single `agent about` probe: returns version + auth status in one call.
    const aboutProbe = yield* runCursorCommand(["about"]).pipe(
      Effect.timeoutOption(ABOUT_TIMEOUT_MS),
      Effect.result,
    );

    if (Result.isFailure(aboutProbe)) {
      const error = aboutProbe.failure;
      return buildServerProvider({
        provider: PROVIDER,
        enabled: cursorSettings.enabled,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: !isCommandMissingCause(error),
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: isCommandMissingCause(error)
            ? "Cursor Agent CLI (`agent`) is not installed or not on PATH."
            : `Failed to execute Cursor Agent CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
        },
      });
    }

    if (Option.isNone(aboutProbe.success)) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: cursorSettings.enabled,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: "Cursor Agent CLI is installed but timed out while running `agent about`.",
        },
      });
    }

    const parsed = parseCursorAboutOutput(aboutProbe.success.value);
    let discoveredModels = Option.none<ReadonlyArray<ServerProviderModel>>();
    if (parsed.auth.status !== "unauthenticated") {
      discoveredModels = yield* discoverCursorModelsViaAcp(cursorSettings).pipe(
        Effect.timeoutOption(CURSOR_ACP_MODEL_DISCOVERY_TIMEOUT_MS),
        Effect.catch(() => Effect.succeed(Option.none<ReadonlyArray<ServerProviderModel>>())),
      );
    }
    const models = providerModelsFromSettings(
      Option.getOrElse(
        Option.filter(discoveredModels, (models) => models.length > 0),
        () => BUILT_IN_MODELS,
      ),
      PROVIDER,
      cursorSettings.customModels,
    );
    return buildServerProvider({
      provider: PROVIDER,
      enabled: cursorSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsed.version,
        status: parsed.status,
        auth: parsed.auth,
        ...(parsed.message ? { message: parsed.message } : {}),
      },
    });
  },
);

export const CursorProviderLive = Layer.effect(
  CursorProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const checkProvider = checkCursorProviderStatus().pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return yield* makeManagedServerProvider<CursorSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.cursor),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.cursor),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    });
  }),
);
