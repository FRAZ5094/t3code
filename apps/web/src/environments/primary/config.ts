import type { ServerConfig } from "@t3tools/contracts";

import { resolvePrimaryEnvironmentHttpUrl } from "./target";

export async function fetchPrimaryServerConfig(): Promise<ServerConfig> {
  const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/server/config"), {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to load server config (${response.status}).`);
  }
  return (await response.json()) as ServerConfig;
}
