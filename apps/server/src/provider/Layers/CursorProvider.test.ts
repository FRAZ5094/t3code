import { describe, expect, it } from "vitest";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  buildCursorCapabilitiesFromConfigOptions,
  getCursorModelCapabilities,
  resolveCursorAcpBaseModelId,
  resolveCursorAcpConfigUpdates,
  resolveCursorAgentModel,
  resolveCursorAcpModelId,
} from "./CursorProvider.ts";

const parameterizedGpt54ConfigOptions = [
  {
    type: "select",
    currentValue: "gpt-5.4",
    options: [{ name: "GPT-5.4", value: "gpt-5.4" }],
    category: "model",
    id: "model",
    name: "Model",
  },
  {
    type: "select",
    currentValue: "medium",
    options: [
      { name: "None", value: "none" },
      { name: "Low", value: "low" },
      { name: "Medium", value: "medium" },
      { name: "High", value: "high" },
      { name: "Extra High", value: "extra-high" },
    ],
    category: "thought_level",
    id: "reasoning",
    name: "Reasoning",
  },
  {
    type: "select",
    currentValue: "272k",
    options: [
      { name: "272K", value: "272k" },
      { name: "1M", value: "1m" },
    ],
    category: "model_config",
    id: "context",
    name: "Context",
  },
  {
    type: "select",
    currentValue: "false",
    options: [
      { name: "Off", value: "false" },
      { name: "Fast", value: "true" },
    ],
    category: "model_config",
    id: "fast",
    name: "Fast",
  },
] satisfies ReadonlyArray<EffectAcpSchema.SessionConfigOption>;

const parameterizedClaudeConfigOptions = [
  {
    type: "select",
    currentValue: "claude-opus-4-6",
    options: [{ name: "Opus 4.6", value: "claude-opus-4-6" }],
    category: "model",
    id: "model",
    name: "Model",
  },
  {
    type: "select",
    currentValue: "high",
    options: [
      { name: "Low", value: "low" },
      { name: "Medium", value: "medium" },
      { name: "High", value: "high" },
    ],
    category: "thought_level",
    id: "reasoning",
    name: "Reasoning",
  },
  {
    type: "boolean",
    currentValue: true,
    category: "model_config",
    id: "thinking",
    name: "Thinking",
  },
] satisfies ReadonlyArray<EffectAcpSchema.SessionConfigOption>;

describe("resolveCursorAcpModelId", () => {
  it("emits ACP model ids that match explicit Cursor ACP config values", () => {
    expect(resolveCursorAcpModelId("composer-2", { fastMode: true })).toBe("composer-2[fast=true]");
    expect(resolveCursorAcpModelId("gpt-5.4", undefined)).toBe("gpt-5.4");
    expect(
      resolveCursorAcpModelId("claude-opus-4-6", {
        reasoning: "high",
        thinking: true,
        contextWindow: "1m",
      }),
    ).toBe("claude-opus-4-6[effort=high,thinking=true,context=1m]");
    expect(resolveCursorAcpModelId("gpt-5.3-codex", undefined)).toBe(
      "gpt-5.3-codex[reasoning=medium,fast=false]",
    );
  });

  it("preserves unrecognized ACP model slugs instead of forcing bracket notation", () => {
    expect(resolveCursorAcpModelId("gpt-5.4-1m", undefined)).toBe("gpt-5.4-1m");
    expect(resolveCursorAcpModelId("auto", undefined)).toBe("auto");
    expect(resolveCursorAcpModelId("claude-4.6-opus", undefined)).toBe("claude-4.6-opus");
  });

  it("passes custom models through unchanged", () => {
    expect(resolveCursorAcpModelId("custom/internal-model", undefined)).toBe(
      "custom/internal-model",
    );
  });
});

describe("getCursorModelCapabilities", () => {
  it("resolves capabilities from canonical cursor base slugs", () => {
    expect(getCursorModelCapabilities("gpt-5.4").contextWindowOptions).toEqual([
      { value: "272k", label: "272k", isDefault: true },
      { value: "1m", label: "1M" },
    ]);
    expect(getCursorModelCapabilities("claude-opus-4-6").supportsThinkingToggle).toBe(true);
  });
});

describe("buildCursorCapabilitiesFromConfigOptions", () => {
  it("derives model capabilities from parameterized Cursor ACP config options", () => {
    expect(buildCursorCapabilitiesFromConfigOptions(parameterizedGpt54ConfigOptions)).toEqual({
      reasoningEffortLevels: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium", isDefault: true },
        { value: "high", label: "High" },
        { value: "xhigh", label: "Extra High" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [
        { value: "272k", label: "272K", isDefault: true },
        { value: "1m", label: "1M" },
      ],
      promptInjectedEffortLevels: [],
    });
  });

  it("detects boolean thinking toggles from model_config options", () => {
    expect(buildCursorCapabilitiesFromConfigOptions(parameterizedClaudeConfigOptions)).toEqual({
      reasoningEffortLevels: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High", isDefault: true },
      ],
      supportsFastMode: false,
      supportsThinkingToggle: true,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    });
  });
});

describe("resolveCursorAcpBaseModelId", () => {
  it("drops parameterized ACP traits and preserves base model ids", () => {
    expect(resolveCursorAcpBaseModelId("gpt-5.4[reasoning=medium,context=272k]")).toBe("gpt-5.4");
    expect(resolveCursorAcpBaseModelId("composer-2")).toBe("composer-2");
    expect(resolveCursorAcpBaseModelId("auto")).toBe("auto");
  });
});

describe("resolveCursorAcpConfigUpdates", () => {
  it("maps Cursor model options onto separate ACP config option updates", () => {
    expect(
      resolveCursorAcpConfigUpdates(parameterizedGpt54ConfigOptions, {
        reasoning: "xhigh",
        fastMode: true,
        contextWindow: "1m",
      }),
    ).toEqual([
      { configId: "reasoning", value: "extra-high" },
      { configId: "context", value: "1m" },
      { configId: "fast", value: "true" },
    ]);
  });

  it("maps boolean thinking toggles when the model exposes them separately", () => {
    expect(
      resolveCursorAcpConfigUpdates(parameterizedClaudeConfigOptions, {
        thinking: false,
      }),
    ).toEqual([{ configId: "thinking", value: false }]);
  });
});

describe("resolveCursorAgentModel", () => {
  it("maps canonical base slugs onto agent CLI model ids", () => {
    expect(resolveCursorAgentModel("composer-2", { fastMode: true })).toBe("composer-2-fast");
    expect(resolveCursorAgentModel("gpt-5.3-codex", { reasoning: "xhigh" })).toBe(
      "gpt-5.3-codex-xhigh",
    );
    expect(
      resolveCursorAgentModel("gpt-5.4", {
        reasoning: "medium",
        fastMode: true,
        contextWindow: "272k",
      }),
    ).toBe("gpt-5.4-medium-fast");
    expect(resolveCursorAgentModel("claude-opus-4-6", { thinking: true })).toBe(
      "claude-4.6-opus-high-thinking",
    );
    expect(resolveCursorAgentModel("auto", undefined)).toBe("auto");
  });

  it("passes custom agent model ids through unchanged", () => {
    expect(resolveCursorAgentModel("gpt-5.4-mini-medium", undefined)).toBe("gpt-5.4-mini-medium");
    expect(resolveCursorAgentModel("custom/internal-model", undefined)).toBe(
      "custom/internal-model",
    );
  });
});
