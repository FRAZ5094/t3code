import type { ServerConfig as ServerConfigPayload } from "@t3tools/contracts";
import { Effect } from "effect";

import { ServerConfig } from "./config";
import { Keybindings } from "./keybindings";
import { resolveAvailableEditors } from "./open";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry";
import { ServerSettingsService } from "./serverSettings";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment";
import { ServerAuth } from "./auth/Services/ServerAuth";

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
