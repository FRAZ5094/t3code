import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Shared from "@t3tools/shared/agentNotifications/FcmClient";
import * as RelayConfiguration from "../Config.ts";
export { FcmClient, FcmClientError } from "@t3tools/shared/agentNotifications/FcmClient";
export const make = Effect.gen(function* () {
  const config = yield* RelayConfiguration.RelayConfiguration;
  return yield* Shared.make.pipe(
    Effect.provideService(Shared.FcmConfiguration, {
      fcmServiceAccount: config.fcmServiceAccount ?? null,
    }),
  );
});
export const layer = Layer.effect(Shared.FcmClient, make);
