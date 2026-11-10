import type { SessionStatus } from "../../../shared/contracts";
import type { UiIconName } from "../components/UiIcon";
import type { AgentState } from "../features/orchestration/runModel";

// Card status (stage R2): one of six kinds, always shown as glyph + colour + label (the label carries the meaning).
export type CardStatusKind = "idle" | "working" | "waiting" | "paused" | "failed" | "done";

export const CARD_STATUS_ICON: Record<CardStatusKind, UiIconName> = {
  idle: "status-idle", working: "working", waiting: "bell", paused: "status-paused", failed: "status-failed", done: "status-done"
};

const SESSION_KIND: Record<SessionStatus, CardStatusKind> = {
  idle: "idle", working: "working", needs_approval: "waiting", unavailable: "failed", done: "done", failed: "failed"
};

const AGENT_KIND: Record<AgentState, CardStatusKind> = {
  idle: "idle", starting: "working", working: "working", waiting: "idle", needs_you: "waiting", paused: "paused", stopping: "paused",
  completed: "done", completed_no_checks: "waiting", stopped: "paused", failed: "failed", read_only: "idle"
};

export const sessionCardStatus = (status: SessionStatus): CardStatusKind => SESSION_KIND[status];
export const agentCardStatus = (state: AgentState): CardStatusKind => AGENT_KIND[state];
