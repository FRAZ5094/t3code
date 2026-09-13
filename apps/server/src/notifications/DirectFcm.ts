import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import {
  FcmConfiguration,
  layer as clientLayer,
} from "@t3tools/shared/agentNotifications/FcmClient";
import { layer as signerLayer } from "@t3tools/shared/agentNotifications/FcmAssertionSigner";
import { WebCrypto } from "@t3tools/shared/agentNotifications/WebCrypto";

const configuration = Layer.effect(
  FcmConfiguration,
  Effect.gen(function* () {
    const path = yield* Config.option(Config.string("T3CODE_FCM_SERVICE_ACCOUNT_FILE"));
    if (Option.isNone(path)) return { fcmServiceAccount: null };
    const fs = yield* FileSystem.FileSystem;
    const json = yield* fs
      .readFileString(path.value)
      .pipe(
        Effect.catch(() =>
          Effect.logWarning(
            "Could not read T3CODE_FCM_SERVICE_ACCOUNT_FILE; Android push is unavailable.",
          ).pipe(Effect.as(null)),
        ),
      );
    return { fcmServiceAccount: json === null ? null : Redacted.make(json) };
  }),
);

export const layer = clientLayer.pipe(
  Layer.provide([
    configuration,
    FetchHttpClient.layer,
    signerLayer.pipe(Layer.provide(Layer.succeed(WebCrypto, { subtle: globalThis.crypto.subtle }))),
  ]),
);
