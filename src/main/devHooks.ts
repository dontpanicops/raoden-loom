// Test hooks of the page (the toast driver of scripts/shots-r5.mjs) exist only in an unpackaged build: main passes
// the flag to the preload as a process argument, which page code cannot set.
export const DEV_HOOKS_ARGUMENT = "--canvastty-dev-hooks";
export function devHooksArguments(packaged: boolean): string[] {
  return packaged ? [] : [DEV_HOOKS_ARGUMENT];
}
