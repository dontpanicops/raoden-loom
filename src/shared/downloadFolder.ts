// Settings → Browser → Downloads: folders too wide to receive the browser's files (the root, the home folder itself,
// the folder of all users, system folders). A folder inside the home folder is fine. `home` is main's; the window,
// which does not know it, passes none and the pattern of /Users/<name> and /home/<name> stands in.
const SYSTEM = ["/System", "/usr", "/bin", "/sbin", "/etc", "/var", "/private", "/Library", "/Applications", "/opt", "/dev", "/proc", "/sys", "/boot", "/lib"];

// "/Users/./x/..", "//Users", "/USERS" all name the same folder on a case-insensitive macOS volume: compare the
// normalized lower-case form. Main also resolves symlinks before it calls this (SettingsStore).
function normalize(folder: string): string {
  const parts: string[] = [];
  for (const part of folder.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`.toLowerCase();
}

export function isTooBroadDownloadFolder(folder: string, home?: string): boolean {
  const path = normalize(folder);
  home = home === undefined ? undefined : normalize(home);
  if (path === "/" || path === "/users" || path === "/home") return true;
  if (home && path === home) return true;
  if (/^\/(?:users|home)\/[^/]+$/.test(path)) return true;
  return SYSTEM.map((root) => root.toLowerCase()).some((root) => path === root || path.startsWith(`${root}/`)) && !path.startsWith("/private/tmp/") && !path.startsWith("/private/var/folders/");
}
