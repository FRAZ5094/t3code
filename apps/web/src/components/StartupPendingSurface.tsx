import { APP_DISPLAY_NAME } from "../branding";

export function StartupPendingSurface(props?: {
  readonly title?: string;
  readonly detail?: string;
}) {
  const title = props?.title ?? "Connecting to T3 Server";
  const detail =
    props?.detail ??
    "Restoring your session and local environment. This should only take a moment.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground sm:px-8">
      <section className="w-full max-w-xl rounded-2xl border border-border/80 bg-card/95 p-6 shadow-2xl shadow-black/10 backdrop-blur-md sm:p-8">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
          {detail}
        </p>
      </section>
    </div>
  );
}
