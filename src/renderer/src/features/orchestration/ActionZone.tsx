// R3b: the run panel's action zone above the tabs — what happened, why, what to do and the buttons the zone model
// (runModel actionZone) names: exactly one main button, the secondary ones, the dangerous ones (outlined, each asks
// to confirm) and the clarify field. The forms of a decision (a question, commands, a limit, ...) are the body: they
// bring their own submit button, so the model's buttons for those actions are not drawn twice. The panel's footer
// (outside the scroll) holds Pause / Stop and the local copy buttons.
import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { LocaleId } from "../../../../shared/contracts";
import { UiIcon } from "../../components/UiIcon";
import { t, type TranslationKey } from "../../lib/i18n";
import type { ZoneAction, ZoneButton, ZoneModel } from "./runModel";

const tr = (locale: LocaleId, key: string): string => t(locale, key as TranslationKey) ?? key;

// Drawn by the body's form, not by the row: the form owns its fields and its submit button
export const FORM_ACTIONS: ReadonlySet<ZoneAction> = new Set<ZoneAction>(["answer", "raise_limit", "checks_accept", "checks_edit", "finish_confirm", "check_amend",
  "person_decide", "plan_return", "plan_accept"]);
// the attribute the smoke scripts and the real series click the main button by
// the words that tell One step from Resume apart, on the buttons themselves
const HINT: Partial<Record<ZoneAction, TranslationKey>> = { resume: "orchResumeHint", step: "orchStepHint" };
// the attribute the scripts reach a local button by
const LOCAL: Partial<Record<ZoneAction, string>> = { open_plan: "data-orch-open-plan", open_changes: "data-orch-view-changes", new_goal: "data-orch-new-goal", open_journal: "data-orch-open-journal", take: "data-orch-take-open" };
const ATTR: Partial<Record<ZoneAction, string>> = { recover_accept: "recover" };
// the words under a dangerous button (R5a, the mock-up's "with a confirmation; hidden in the in-project mode")
const DANGER_HINT: Partial<Record<ZoneAction, TranslationKey>> = { recover_reset: "orchZone_hint_recover_reset" };
// the buttons that are plain text in the mock-up (not a box): the plan and the clarify opener
const TEXTUAL: ReadonlySet<ZoneAction> = new Set<ZoneAction>(["open_plan"]);
// "почему" and "что делать" are one sentence run: the next step starts with a capital
const cap = (x: string): string => x.charAt(0).toLocaleUpperCase() + x.slice(1);

// An outlined danger button that asks first: the question and "Do it" / "Cancel" take its place until answered.
export function DangerConfirm({ locale, label, text, disabled, onConfirm, attr, textual }: {
  locale: LocaleId; label: string; text: string; disabled?: boolean; onConfirm(): void; attr?: Record<string, string | boolean>; textual?: boolean;
}): React.JSX.Element {
  const [asking, setAsking] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const textId = useId();
  const cancel = (): void => { setAsking(false); requestAnimationFrame(() => opener.current?.focus()); };
  // Esc cancels only the question: the capture listener keeps it from the panel's own Esc (which closes the panel)
  // biome-ignore lint/correctness/useExhaustiveDependencies: cancel only sets state and focuses the opener
  useEffect(() => {
    if (!asking) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); cancel(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [asking]);
  if (!asking) return <button ref={opener} type="button" className={textual ? "orch-textual" : "orch-stop"} disabled={disabled} data-orch-danger {...attr} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <div className="orch-confirm" role="alertdialog" aria-label={label} aria-describedby={textId} data-orch-confirm>
      <span id={textId}>{text}</span>
      <span className="orch-confirm__row">
        <button type="button" className="orch-stop" disabled={disabled} data-orch-confirm-do onClick={() => { setAsking(false); onConfirm(); }}>{label}</button>
        {/* biome-ignore lint/a11y/noAutofocus: the safe answer of a dangerous question takes focus */}
        <button type="button" autoFocus onClick={cancel}>{t(locale, "orchCancel")}</button>
      </span>
    </div>
  );
}

export interface ZoneClarify { value: string; onChange(v: string): void; onSend(): void }
export interface ActionZoneProps {
  locale: LocaleId;
  zone: ZoneModel;
  runKey: string; // resets what a dangerous button remembers (an open question) when another run shows
  headline: string; // the run's headline key, for the scripts' data-headline
  status: string;
  task: { key: string; title: string } | null;
  compact: boolean;
  flash: boolean;
  zoneRef: React.Ref<HTMLElement>;
  sending: boolean;
  disabled(b: ZoneButton): boolean;
  onButton(b: ZoneButton): void;
  confirmText(b: ZoneButton): string | null; // a dangerous button's question
  resumeNext?: string; // data-orch-resume of the Resume button: where the run goes on
  clarify: ZoneClarify;
  clarifyOff?: string | null; // the platform cannot take a clarification: the reason to show
  who?: string | null; // a working run (R5a: the headline says who works, it carries data-orch-working)
  stages?: readonly string[]; // R5a: the plan's stage titles, a numbered list in the body of the plan-review zone
  words(text: string): React.ReactNode; // the glossary marks the terms of a text (RunPanel Termed)
  children?: React.ReactNode; // the body: the forms
  rowStart?: React.ReactNode; // R6-A: a button the panel draws itself (Release link) first in the row of buttons
  notices?: React.ReactNode; // the refusal, the offline banner, the pending commands
}

export function ActionZone(p: ActionZoneProps): React.JSX.Element {
  const { locale, zone } = p;
  const [clarifyOpen, setClarifyOpen] = useState(zone.clarify === "open");
  const [seenVariant, setSeenVariant] = useState(zone.variant);
  if (seenVariant !== zone.variant) { setSeenVariant(zone.variant); setClarifyOpen(zone.clarify === "open"); }
  const clarifyOff = zone.clarify === "disabled" || !!p.clarifyOff;
  const reasonId = useId();
  const row = (b: ZoneButton, kind: "primary" | "secondary" | "dangerous", text = false): React.JSX.Element | null => {
    if (FORM_ACTIONS.has(b.action)) return null;
    const off = p.sending || p.disabled(b);
    const attr: Record<string, string | boolean> = { "data-orch-zone-action": b.action };
    const hint = HINT[b.action];
    if (hint) attr.title = t(locale, hint);
    if (LOCAL[b.action]) attr[LOCAL[b.action]!] = true;
    if (b.action === "stop") attr["data-orch-stop"] = "";
    if (b.action === "resume" && p.resumeNext !== undefined) attr["data-orch-resume"] = p.resumeNext;
    if (kind === "dangerous") {
      const text = p.confirmText(b);
      return text ? <DangerConfirm key={`${p.runKey}:${b.action}`} locale={locale} label={b.label} text={text} disabled={off} attr={attr} onConfirm={() => p.onButton(b)} />
        : <button key={b.action} type="button" className="orch-stop" disabled={off} {...attr} onClick={() => p.onButton(b)}>{b.label}</button>;
    }
    // the journal opener of a failed or halted run is the mock's outlined button, not the filled main one
    const cls = kind === "primary" ? (b.danger ? "orch-danger" : b.action === "open_journal" ? undefined : "orch-primary") : text || TEXTUAL.has(b.action) ? "orch-textual" : undefined;
    return <button key={b.action} type="button" className={cls} disabled={off} {...attr} data-orch-primary={kind === "primary" ? ATTR[b.action] ?? b.action : undefined}
      onClick={() => p.onButton(b)}>{b.label}</button>;
  };
  const clarifyOpenNow = zone.clarify !== "hidden" && clarifyOpen && !clarifyOff;
  // the clarify field open: the row is "send the clarification" + the main button; the other secondary buttons are text
  const textual = zone.secondary.filter((b) => TEXTUAL.has(b.action) || clarifyOpenNow);
  const rows = [zone.primary && row(zone.primary, "primary"), ...zone.secondary.filter((b) => !textual.includes(b)).map((b) => row(b, "secondary"))].filter(Boolean);
  const dangerRows = zone.dangerous.map((b) => row(b, "dangerous")).filter(Boolean);
  const hint = zone.dangerous.map((b) => DANGER_HINT[b.action]).find(Boolean);
  const label = zone.tone === "neutral" ? zone.eyebrow || null : zone.tone === "waiting" ? tr(locale, "orchPauseYou") : tr(locale, "orchPauseNotYou");
  // the words of mock-up 13 ("goes to the agents with the next turn"); the plan under review and the loop keep their own (mock-ups 04, 09)
  const asked = zone.variant === "plan_review" || zone.variant === "loop_suspected";
  const clarifyShown = zone.clarify !== "hidden" && clarifyOpen && !clarifyOff;
  // the clarify field open: it stands above the row, the main button is the last of the row (the mock-up's loop-suspected)
  const sendClarify = clarifyShown && (
    <button type="button" key="clarify-send" disabled={p.sending || clarifyOff || !p.clarify.value.trim()} data-orch-clarify-send onClick={p.clarify.onSend}>{tr(locale, asked ? "orchZone_clarifySend" : "orchZone_clarifySendShort")}</button>
  );
  // no other button in the row (a run at work, mock-up 13): "Send" stands beside the field
  const inlineSend = clarifyShown && rows.length === 0;
  const clarifyBox = zone.clarify === "hidden" ? null : (
    <div className={`orch-zone__clarify${inlineSend ? " orch-zone__clarify--inline" : ""}`} data-orch-clarify={zone.clarify}>
      {!clarifyShown
        ? <button type="button" className="orch-textual" disabled={clarifyOff} title={p.clarifyOff ?? undefined} aria-describedby={clarifyOff ? reasonId : undefined} aria-expanded={false} data-orch-clarify-open onClick={() => setClarifyOpen(true)}>{tr(locale, zone.variant === "plan_review" ? "orchZone_clarifyTask" : "orchClarify")}</button>
        : <label className="orch-zone__clarify-label"><span>{tr(locale, asked ? "orchZone_clarifyLabel" : "orchZone_clarifyLabelNext")}</span>
          <textarea rows={3} value={p.clarify.value} placeholder={tr(locale, "orchClarifyPlaceholder")} onChange={(e) => p.clarify.onChange(e.target.value)} />
        </label>}
      {inlineSend && sendClarify}
      {zone.clarify === "disabled" && <small className="orch-hint" id={reasonId} data-orch-proposal-waits>{tr(locale, "orchProposalWaitsHint")}</small>}
      {zone.clarify !== "disabled" && p.clarifyOff && <small className="orch-hint" id={reasonId} data-orch-platform-hint>{p.clarifyOff}</small>}
    </div>
  );
  const rowButtons = p.rowStart ? [<Fragment key="row-start">{p.rowStart}</Fragment>, ...(inlineSend ? [] : clarifyShown ? [sendClarify, ...rows] : rows)] : inlineSend ? [] : clarifyShown && zone.primary && !FORM_ACTIONS.has(zone.primary.action) ? [sendClarify, ...rows.slice(1), rows[0]] : clarifyShown ? [sendClarify, ...rows] : rows;
  return (
    <section ref={p.zoneRef} tabIndex={-1} role="status" aria-live="polite" data-orch-summary data-headline={p.headline} data-orch-zone={zone.variant} data-orch-tone={zone.tone}
      className={`orch-zone orch-zone--${zone.tone} orch-zone--${p.headline} orch-panel__status orch-panel__status--${p.status}${p.flash ? " orch-zone--flash" : ""}${p.compact ? " orch-zone--compact" : ""}`}>
      {p.task && <div className="orch-zone__task" data-orch-task={p.task.key} title={p.task.title}>{tr(locale, "boardTask")} {p.task.key} · {p.task.title}</div>}
      {label && <div className="orch-zone__label">{zone.tone !== "neutral" && <UiIcon name={zone.tone === "waiting" ? "bell" : "status-paused"} size={14} />}<span data-orch-label>{label}</span></div>}
      <div className="orch-zone__headline">
        <strong data-orch-what data-orch-working={p.who ? "" : undefined}>{cap(zone.title)}</strong>
        {(zone.why || zone.todo) && (
          <p className="orch-zone__why">
            {zone.why && <span data-orch-reason>{p.words(zone.why)}</span>}
            {zone.why && zone.todo && " "}
            {zone.todo && <span data-orch-next>{p.words(cap(zone.todo))}</span>}
          </p>
        )}
      </div>
      {zone.detail && <pre className="orch-zone__error" data-orch-error>{zone.detail}</pre>}
      {zone.mono && <pre className="orch-zone__mono" data-orch-mono>{zone.mono}</pre>}
      {p.stages && p.stages.length > 0 && zone.variant === "plan_review" && <ol className="orch-zone__stages" data-orch-stages>{p.stages.map((x) => <li key={x}>{x}</li>)}</ol>}
      {p.children}
      {p.notices}
      {clarifyShown && clarifyBox}
      {rowButtons.length > 0 && <div className="orch-panel__actions orch-zone__actions" data-orch-actions>{rowButtons}</div>}
      {dangerRows.length > 0 && <div className="orch-zone__danger" data-orch-danger-row><span className="orch-zone__danger-row">{dangerRows}</span>{hint && <small>{t(locale, hint)}</small>}</div>}
      {(textual.length > 0 || (!clarifyShown && clarifyBox)) && (
        <div className="orch-zone__text">{textual.map((b) => row(b, "secondary", true))}{!clarifyShown && clarifyBox}</div>
      )}
      {clarifyShown && zone.clarify !== "open" && <button type="button" className="orch-textual" onClick={() => setClarifyOpen(false)}>{tr(locale, "orchCancel")}</button>}
    </section>
  );
}

// The panel's footer under the tabs, outside the scroll: pause after the turn and Stop, or the local copy buttons.
export function PanelFoot({ buttons, sending, disabled, onButton, labelOf }: {
  buttons: readonly ZoneButton[]; sending: boolean; disabled(b: ZoneButton): boolean; onButton(b: ZoneButton): void; labelOf?(b: ZoneButton): string;
}): React.JSX.Element | null {
  if (!buttons.length) return null;
  return (
    <div className="orch-panel__foot" data-orch-foot>
      {buttons.map((b) => {
        const stop = b.action === "stop";
        const pause = b.action === "pause";
        return (
          <button key={b.action} type="button" className={stop ? "orch-stop" : pause || b.action.startsWith("copy_") || b.action === "export_review" ? "orch-textual" : undefined} disabled={(sending && !stop) || disabled(b)}
            data-orch-stop={stop ? "" : undefined} data-orch-foot-action={b.action} data-orch-primary={pause ? "pause" : undefined} onClick={() => onButton(b)}>{labelOf?.(b) ?? b.label}</button>
        );
      })}
    </div>
  );
}
