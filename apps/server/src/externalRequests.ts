import * as Config from "effect/Config";

/**
 * `T3CODE_NO_EXTERNAL_REQUESTS=true` keeps T3 Code's own traffic on the
 * machine for networks that block or audit outbound connections. It turns
 * off telemetry, provider update checks and the usage pricing download, and
 * serves the web client under a policy that only lets it load from this
 * server. Provider CLIs still talk to their own services, and features the
 * user explicitly starts, such as installing a provider, still download.
 */
export const externalRequestsDisabled = Config.Boolean("T3CODE_NO_EXTERNAL_REQUESTS").pipe(
  Config.withDefault(false),
);

/**
 * Browser policy for the app shell when external requests are disabled. It
 * only restricts where the page may load from; inline and eval stay allowed
 * because the shell and its wasm runtimes depend on them.
 */
export const LOCAL_ONLY_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self' blob: data:",
  "form-action 'self'",
].join("; ");
