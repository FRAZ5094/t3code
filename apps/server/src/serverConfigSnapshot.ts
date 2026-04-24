import type { ServerConfig as ServerConfigPayload } from "@t3tools/contracts";
import { Effect } from "effect";

import { ServerConfig } from "./config.ts";
import { Keybindings } from "./keybindings.ts";
import { resolveAvailableEditors } from "./open.ts";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "./serverSettings.ts";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";

export const loadServerConfigSnapshot = Effect.gen(function* () {
  const keybindings = yield* Keybindings;
  const providerRegistry = yield* ProviderRegistry;
  const serverSettings = yield* ServerSettingsService;
  const serverEnvironment = yield* ServerEnvironment;
  const serverAuth = yield* ServerAuth;
  const config = yield* ServerConfig;

  const keybindingsConfig = yield* keybindings.loadConfigState;
  const providers = yield* providerRegistry.getProviders;
  const settings = yield* serverSettings.getSettings;
  const environment = yield* serverEnvironment.getDescriptor;
  const auth = yield* serverAuth.getDescriptor();

  return {
    environment,
    auth,
    cwd: config.cwd,
    keybindingsConfigPath: config.keybindingsConfigPath,
    keybindings: keybindingsConfig.keybindings,
    issues: keybindingsConfig.issues,
    providers,
    availableEditors: resolveAvailableEditors(),
    observability: {
      logsDirectoryPath: config.logsDir,
      localTracingEnabled: true,
      ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
      otlpTracesEnabled: config.otlpTracesUrl !== undefined,
      ...(config.otlpMetricsUrl !== undefined ? { otlpMetricsUrl: config.otlpMetricsUrl } : {}),
      otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
    },
    settings,
  } satisfies ServerConfigPayload;
});
