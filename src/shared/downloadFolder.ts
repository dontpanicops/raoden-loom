// Settings → Browser → Downloads: folders too wide to receive the browser's files (the root, the home folder itself,
// the folder of all users, system folders). A folder inside the home folder is fine. `home` is main's; the window,
// which does not know it, passes none and the pattern of /Users/<name> and /home/<name> stands in.
const SYSTEM = ["/System", "/usr", "/bin", "/sbin", "/etc", "/var", "/private", "/Library", "/Applications", "/opt", "/dev", "/proc", "/sys", "/boot", "/lib"];

export function isTooBroadDownloadFolder(folder: string, home?: string): boolean {
  const path = folder.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/Users" || path === "/home") return true;
  if (home && path === home.replace(/\/+$/, "")) return true;
  if (/^\/(?:Users|home)\/[^/]+$/.test(path)) return true;
  return SYSTEM.some((root) => path === root || path.startsWith(`${root}/`)) && !path.startsWith("/private/tmp/") && !path.startsWith("/private/var/folders/");
}
