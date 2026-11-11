// R3b part A: the action zone's model is checked against main's own gate, and its words against the interface's vocabulary.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { STOP_ONLY, actionZone, admits } from "../src/renderer/src/features/orchestration/runModel.ts";
import { t } from "../src/renderer/src/lib/i18n.ts";
import { SETS37, fixture, view } from "./fixtures/orchestration/zone-sets.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const I18N = fs.readFileSync(path.join(HERE, "..", "src/renderer/src/lib/i18n.ts"), "utf8");
const keys = (prefixes) => [...new Set([...I18N.matchAll(/^ {2}([A-Za-z0-9_]+): /gm)].map((m) => m[1]).filter((k) => prefixes.some((p) => k.startsWith(p))))];

test("every command the zone sends is a command main admits on that pause (37 sets)", () => {
  for (const set of SETS37) {
    const f = fixture(set);
    const z = actionZone("ru", f.view, f.entries, f.onMac);
    // the run's own pause; the work mode decides whether main would restore a checkpoint
    const ctx = { status: f.view.status, reason: f.view.reason ?? "", version: 2, proposalWaits: false, inPlace: f.view.workMode !== "copy" };
    if (set === "newer_version") { assert.deepEqual(z.commands, [], "a newer version's run sends nothing"); continue; }
    assert.ok(z.commands.length > 0, set);
    for (const kind of z.commands) assert.equal(admits(kind, ctx), null, `${set}: main admits ${kind} on paused(${ctx.reason})`);
    for (const b of [z.primary, ...z.secondary, ...z.dangerous, ...z.footer]) {
      if (b?.after) assert.equal(admits(b.after, { ...ctx, reason: "user_request" }), null, `${set}: ${b.after} follows ${b.action}`);
    }
    // the converse for the stop-only pauses: the zone never offers the command main refuses
    if (STOP_ONLY.includes(ctx.reason)) for (const kind of ["resume", "step"]) assert.notEqual(admits(kind, ctx), null, `${set}: ${kind} is refused`);
  }
});

test("the commands of a run that works, pauses after the turn, or ends are admitted too", () => {
  const ctx = (status) => ({ status, reason: "", version: 2, proposalWaits: false, inPlace: true });
  for (const status of ["preparing", "running", "pausing", "stopping", "completed", "failed", "stopped"]) {
    const z = actionZone("ru", view(status, null), [], true);
    for (const kind of z.commands) assert.equal(admits(kind, ctx(status)), null, `${status}: ${kind}`);
  }
  assert.deepEqual(actionZone("ru", view("running", null), [], true).commands, ["pause_after_turn", "stop"]);
});

test("no text of a pause names a tab the panel no longer has", () => {
  const zone = keys(["orchPause_", "orchNext_", "orchZone_"]);
  assert.ok(zone.length > 150);
  for (const locale of ["ru", "en"]) for (const key of zone) {
    const text = t(locale, key);
    if (typeof text !== "string") continue;
    assert.doesNotMatch(text, /[«“](Лог|Действия|Обзор|История|Log|Activity|Overview|History)[»”]/, `${locale}: ${key}: ${text}`);
    assert.doesNotMatch(text, /\b(Лог|Логе|Логу|Log)\b/, `${locale}: ${key}: ${text}`);
  }
});

test("the words of the zone use the interface's vocabulary: no checkpoint, turn, stage, worktree or run in Russian", () => {
  const zone = keys(["orchPause_", "orchZone_", "orchRecover"]).concat(["orchNext_push_protected", "orchError_push_protected", "orchError_not_admitted", "orchError_mcp_present", "orchError_mcp_unchecked"]);
  for (const key of zone) {
    const text = t("ru", key);
    assert.doesNotMatch(text.replace(/\{[a-z]+\}/g, ""), /\b(checkpoint|turn|stage|worktree|run)\b/i, `${key}: ${text}`);
  }
});

test("every code apply() answers with has its words, in both languages", () => {
  const src = fs.readFileSync(path.join(HERE, "..", "src/main/services/orchestration/orchestrationService.ts"), "utf8");
  const apply = src.slice(src.indexOf("async function apply("), src.indexOf("async function personDecide("));
  const rest = src.slice(src.indexOf("async function personDecide("), src.indexOf("async function personDecide(") + 12_000);
  const codes = new Set([...(apply + rest).matchAll(/reject\("([a-z_]+)"\)/g)].map((m) => m[1]));
  for (const extra of ["store_failed", "command_failed", "not_admitted", "command_id_reused"]) codes.add(extra);
  assert.ok(codes.has("stale_revision") && codes.has("invalid_state") && codes.has("invalid_command") && codes.size >= 11, [...codes].join());
  for (const locale of ["ru", "en"]) for (const code of codes) {
    const text = t(locale, `orchError_${code}`);
    assert.ok(typeof text === "string" && text.trim().length > 3 && !text.includes(code), `${locale}: orchError_${code}: ${text}`);
  }
});
