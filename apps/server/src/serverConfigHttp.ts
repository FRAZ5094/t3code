import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { respondToAuthError } from "./auth/http";
import { ServerAuth } from "./auth/Services/ServerAuth";
import { loadServerConfigSnapshot } from "./serverConfigSnapshot";

export const serverConfigRouteLayer = HttpRouter.add(
  "GET",
  "/api/server/config",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const serverAuth = yield* ServerAuth;
    yield* serverAuth.authenticateHttpRequest(request);
    const config = yield* loadServerConfigSnapshot;
    return HttpServerResponse.jsonUnsafe(config, { status: 200 });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);
