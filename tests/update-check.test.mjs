// «Check for updates»: version comparison, the page to open, a failed request; nothing but one GET of the releases feed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { RELEASES_API, checkForUpdate } from "../src/main/services/updateCheck.ts";

const feed = (tag, html = `https://github.com/dontpanicops/raoden-loom/releases/tag/${tag}`) => async () => ({ tag_name: tag, html_url: html });

test("a newer release is offered with its page, the same or an older one is the latest", async () => {
  assert.deepEqual(await checkForUpdate("1.5.20", feed("v1.6.0")), { status: "available", version: "1.6.0", url: "https://github.com/dontpanicops/raoden-loom/releases/tag/v1.6.0" });
  assert.deepEqual(await checkForUpdate("1.5.20", feed("v1.5.20")), { status: "latest" });
  assert.deepEqual(await checkForUpdate("1.6.0", feed("v1.5.20")), { status: "latest" });
  assert.equal((await checkForUpdate("1.5.9", feed("v1.5.10"))).status, "available"); // numbers, not text
});

test("a page outside the project's releases is replaced by the releases page", async () => {
  const r = await checkForUpdate("1.0.0", feed("v2.0.0", "https://evil.example/x"));
  assert.equal(r.url, "https://github.com/dontpanicops/raoden-loom/releases");
});

test("a failed request or an unreadable answer is «failed», never a throw", async () => {
  assert.deepEqual(await checkForUpdate("1.0.0", async () => { throw new Error("offline"); }), { status: "failed" });
  assert.deepEqual(await checkForUpdate("1.0.0", async () => ({ tag_name: "nightly" })), { status: "failed" });
  assert.deepEqual(await checkForUpdate("1.0.0", async () => null), { status: "failed" });
});

test("it asks the public feed of this project and nothing else", async () => {
  const urls = [];
  await checkForUpdate("1.0.0", async (url) => { urls.push(url); return {}; });
  assert.deepEqual(urls, [RELEASES_API]);
  assert.match(RELEASES_API, /^https:\/\/api\.github\.com\/repos\/dontpanicops\/raoden-loom\/releases\/latest$/);
});

test("the automatic check is due once a day: never, a day ago, a clock gone back", async () => {
  const { updateCheckDue, UPDATE_INTERVAL_MS } = await import("../src/renderer/src/lib/updateStatus.ts");
  const now = 1_000_000_000_000;
  assert.equal(updateCheckDue(null, now), true);
  assert.equal(updateCheckDue(now - UPDATE_INTERVAL_MS, now), true);
  assert.equal(updateCheckDue(now - UPDATE_INTERVAL_MS + 1000, now), false);
  assert.equal(updateCheckDue(now + 5000, now), true);
  assert.equal(updateCheckDue(Number.NaN, now), true);
});
