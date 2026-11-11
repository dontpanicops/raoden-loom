// A smoke run of the development build must not raise Electron on the desktop where the owner works: the quiet mode
// shows the window without activating the app. A packaged build always activates as before.
export function quietWindow(opts: { packaged: boolean; env: Record<string, string | undefined> }): boolean {
  // "0": a smoke that checks how an ordinary hidden window behaves (smoke-workspaces-background) opts out
  if (opts.packaged || opts.env.CANVASTTY_QUIET_WINDOW === "0") return false;
  return opts.env.CANVASTTY_SMOKE_HERMETIC === "1" || opts.env.CANVASTTY_QUIET_WINDOW === "1";
}
