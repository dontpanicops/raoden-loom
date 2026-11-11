// What main admits, as one pure function: the status / pause reason part of every command's gate (orchestrationService.ts
// apply()). Main calls it first; the window's action zone and its tests call the same one, so a button the window offers
// is a command main accepts. Data-dependent checks (an open question, the proposal, the refused check, the tree) stay in apply().
export const RESUMABLE: readonly string[] = ["user_request", "step_done", "plan_review", "permission_denied", "loop_suspected", "environment_error", "recovered",
  "app_closed", "stage_done", "external_failure", "needs_user_action", "finish_unconfirmed", "tree_changed_during_review"];
export const STEP_ONLY: readonly string[] = ["invalid_report", "protocol_error"];
export const STOP_ONLY: readonly string[] = ["lead_modified_tree", "shared_git_tampered", "journal_corrupt", "sandbox_unavailable"];
// A4 (journal-v2-format.md §2.9): the pauses an open finding may be closed or made a wish on by the person — where the
// run waits for the person anyway; never a pause of another decision (checks, push/QA, a plan proposal, recovery)
export const FINDING_PAUSES: readonly string[] = [...RESUMABLE, ...STEP_ONLY, "limit_reached", "awaiting_answer", "awaiting_person_decision"];
export const ACTIVE: readonly string[] = ["preparing", "running", "pausing", "paused"];
// on the person's decisions of journal v2 only that decision and Stop (journal-v2-format.md §2.1)
export const CLARIFY_BLOCKED: readonly string[] = ["journal_corrupt", "awaiting_checks_decision", "awaiting_finish_confirmation", "check_needs_permissions",
  "awaiting_person_decision", "coverage_lost"];

// pause_after_turn is "on", keep_running is "off"; recover.reset is recover's reset_to_checkpoint (never written into the
// project); person.decide.* are the subjects of a person's decision
export type AdmissionKind = "pause_after_turn" | "keep_running" | "stop" | "resume" | "step" | "answer" | "clarify" | "raise_limit" | "recover" | "recover.reset"
  | "dismiss" | "checks.decide" | "check.amend" | "finish.confirm" | "person.decide" | "person.decide.disputed" | "person.decide.condition"
  | "person.decide.finding" | "plan.decide" | "permission";
export interface AdmissionContext {
  status: string;
  reason: string; // "" when none
  version: number; // the journal's format
  proposalWaits: boolean; // journal v2 and a plan proposal waits for the person
  inPlace: boolean; // the work is in the project folder or a worktree of it
}

// null: admitted; else the code main rejects with (always invalid_state: the command is not for this state)
export function admits(kind: AdmissionKind, c: AdmissionContext): "invalid_state" | null {
  const paused = c.status === "paused";
  const ok = (() => {
    switch (kind) {
      case "pause_after_turn": return c.status === "running";
      case "keep_running": return c.status === "pausing";
      case "stop": return ACTIVE.includes(c.status);
      case "resume": return paused && !STOP_ONLY.includes(c.reason) && RESUMABLE.includes(c.reason);
      case "step": return paused && !STOP_ONLY.includes(c.reason) && (RESUMABLE.includes(c.reason) || STEP_ONLY.includes(c.reason));
      case "answer": return paused && c.reason === "awaiting_answer";
      case "clarify": return ACTIVE.includes(c.status) && !CLARIFY_BLOCKED.includes(c.reason) && !c.proposalWaits;
      case "raise_limit": return paused && c.reason === "limit_reached" && !c.proposalWaits;
      case "recover": return paused && c.reason === "outcome_unknown";
      case "recover.reset": return !c.inPlace;
      case "dismiss": return ["stopped", "completed", "failed"].includes(c.status);
      case "checks.decide": return paused && c.reason === "awaiting_checks_decision";
      case "check.amend": return paused && c.reason === "check_needs_permissions";
      case "finish.confirm": return paused && c.reason === "awaiting_finish_confirmation";
      case "person.decide": return c.version === 2 && paused;
      case "person.decide.disputed": case "person.decide.condition": return c.reason === "awaiting_person_decision";
      case "person.decide.finding": return FINDING_PAUSES.includes(c.reason);
      case "plan.decide": return c.version === 2 && paused && c.reason === "coverage_lost";
      case "permission": return true; // decided by the request itself
    }
  })();
  return ok ? null : "invalid_state";
}
