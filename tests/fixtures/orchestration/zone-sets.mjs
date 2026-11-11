// The 37 sets of words the action zone says a pause with (R3b): 27 reasons of the journal, 5 derived from the turn that ended
// in them (provider_limit, provider_limit_at, model_unsupported, prepare_failed, newer_version) and 5 variants inside a reason.
import { PAUSED_REASONS_V2 } from "../../../src/main/services/orchestration/journal.ts";

export const DERIVED = ["provider_limit", "provider_limit_at", "model_unsupported", "prepare_failed", "newer_version"];
export const VARIANTS = ["awaiting_checks_none", "sandbox_unsupported", "mcp_present", "mcp_unchecked", "push_protected"];
export const SETS37 = [...PAUSED_REASONS_V2, ...DERIVED, ...VARIANTS];

export const view = (status, reason, extra = {}) => ({ runId: "r", revision: 1, status, reason, stage: null, active: null, permission: null, halted: false,
  newer: null, workMode: "project", workDir: "/p", progress: null, proposal: null, refused: null, confirm: null, decisions: null, ...extra });

let id = 0;
const entry = (kind, text, extra = {}) => ({ id: ++id, ts: "2026-11-11T10:00:00.000Z", runId: "r", role: "run", provider: null, turnId: null, kind, text, ...extra });
const turn = (...errors) => [
  entry("turn_finished", "failed", { role: "lead", provider: "codex", turnId: "t1" }),
  ...errors.map((e) => entry("error", e.text, { role: "lead", provider: "codex", turnId: "t1", detail: e.detail })),
  entry("status", "paused", { detail: { status: "paused", reason: "environment_error" } })
];

// { view, entries, onMac } of a set
export function fixture(set) {
  const paused = (reason, extra, entries = [], onMac = true) => ({ view: view("paused", reason, extra), entries, onMac });
  switch (set) {
    case "provider_limit": return paused("environment_error", {}, turn({ text: "usage limit", detail: { limitProvider: "codex" } }));
    case "provider_limit_at": return paused("environment_error", {}, turn({ text: "usage limit", detail: { limitProvider: "codex", limitResetsAt: "2026-11-12T15:00:00.000Z" } }));
    case "model_unsupported": return paused("environment_error", {}, turn({ text: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account." }));
    case "prepare_failed": return paused("needs_user_action", { progress: { prepare: { status: "failed", command: "npm ci" }, finish: [] } });
    case "newer_version": return paused("user_request", { newer: { chain: [], goal: null, compatible: false, fallback: null } });
    case "awaiting_checks_none": return paused("awaiting_checks_decision", { proposal: { checks: [], none: "no tests" } });
    case "awaiting_checks_decision": return paused(set, { proposal: { checks: [{ id: "c1", command: "npm test", why: "tests", source: [] }], none: null } });
    case "sandbox_unsupported": return paused("sandbox_unavailable", {}, [], false);
    case "mcp_present": case "mcp_unchecked": {
      const es = [entry("turn_finished", "failed", { role: "lead", provider: "claude", turnId: "t1" }),
        entry("error", "mcp", { role: "lead", provider: "claude", turnId: "t1", detail: { mcp: set, cli: "claude", names: "files, git" } })];
      return paused("needs_user_action", {}, es);
    }
    case "push_protected": return paused("needs_user_action", {}, [
      entry("external_action", "push: blocked — push_protected: the branch main is protected; the push was not made", { detail: { step: "push", phase: "blocked" } }),
      entry("status", "paused: needs_user_action", { detail: { status: "paused", reason: "needs_user_action" } })]);
    case "outcome_unknown": return paused(set, { workMode: "copy" });
    default: return paused(set, {});
  }
}
