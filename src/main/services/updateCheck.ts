// «Check for updates» (Settings → General / About): one anonymous GET of the public releases feed, compared with the
// installed version. Nothing about the person or the machine is sent (no id, no version, a fixed User-Agent); nothing is
// downloaded or installed: the answer is a version and the page to open.
import type { UpdateCheckResult } from "../../shared/contracts.ts";
import { compareSemver, isValidSemver } from "../../shared/hostVersion.ts";

export const RELEASES_API = "https://api.github.com/repos/dontpanicops/raoden-loom/releases/latest";
const RELEASES_PAGE = "https://github.com/dontpanicops/raoden-loom/releases";

export async function checkForUpdate(
  installed: string,
  fetchJson: (url: string) => Promise<unknown> = defaultFetch
): Promise<UpdateCheckResult> {
  let release: unknown;
  try {
    release = await fetchJson(RELEASES_API);
  } catch {
    return { status: "failed" };
  }
  const feed = release as { tag_name?: unknown; html_url?: unknown } | null;
  const tag = typeof feed?.tag_name === "string" ? feed.tag_name : "";
  const version = tag.replace(/^v/, "");
  if (!isValidSemver(version)) return { status: "failed" };
  if (compareSemver(version, installed) <= 0) return { status: "latest" };
  const page = feed?.html_url;
  return { status: "available", version, url: typeof page === "string" && page.startsWith(`${RELEASES_PAGE}/`) ? page : RELEASES_PAGE };
}

async function defaultFetch(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/vnd.github+json", "user-agent": "raoden-loom-update-check" },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`releases ${response.status}`);
  return response.json();
}
