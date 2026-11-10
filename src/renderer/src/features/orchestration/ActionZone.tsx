// R3b: the run panel's action zone above the tabs — what happened, why, what to do and the buttons the zone model
// (runModel actionZone) names: exactly one main button, the secondary ones, the dangerous ones (outlined, each asks
// to confirm) and the clarify field. The forms of a decision (a question, commands, a limit, ...) are the body: they
// bring their own submit button, so the model's buttons for those actions are not drawn twice. The panel's footer
// (outside the scroll) holds Pause / Stop and the local copy buttons.
import { useState } from "react";
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
const LOCAL: Partial<Record<ZoneAction, string>> = { open_plan: "data-orch-open-plan", open_changes: "data-orch-view-changes", new_goal: "data-orch-new-goal", open_journal: "data-orch-open-journal" };
const ATTR: Partial<Record<ZoneAction, string>> = { recover_accept: "recover" };

// An outlined danger button that asks first: the question and "Do it" / "Cancel" take its place until answered.
export function DangerConfirm({ locale, label, text, disabled, onConfirm, attr }: {
  locale: LocaleId; label: string; text: string; disabled?: boolean; onConfirm(): void; attr?: Record<string, string | boolean>;
}): React.JSX.Element {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" className="orch-stop" disabled={disabled} data-orch-danger {...attr} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <div className="orch-confirm" role="alertdialog" aria-label={label} data-orch-confirm>
      <span>{text}</span>
      <span className="orch-confirm__row">
        <button type="button" className="orch-stop" disabled={disabled} data-orch-confirm-do onClick={() => { setAsking(false); onConfirm(); }}>{label}</button>
        <button type="button" onClick={() => setAsking(false)}>{t(locale, "orchCancel")}</button>
      </span>
    </div>
  );
}

export interface ZoneClarify { value: string; onChange(v: string): void; onSend(): void }
export interface ActionZoneProps {
  locale: LocaleId;
  zone: ZoneModel;
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
  who?: string | null; // a working run: who works now
  words(text: string): React.ReactNode; // the glossary marks the terms of a text (RunPanel Termed)
  children?: React.ReactNode; // the body: the forms
  notices?: React.ReactNode; // the refusal, the offline banner, the pending commands
}

export function ActionZone(p: ActionZoneProps): React.JSX.Element {
  const { locale, zone } = p;
  const [clarifyOpen, setClarifyOpen] = useState(zone.clarify === "open");
  const row = (b: ZoneButton, kind: "primary" | "secondary" | "dangerous"): React.JSX.Element | null => {
    if (FORM_ACTIONS.has(b.action)) return null;
    const off = p.sending || p.disabled(b);
    const attr: Record<string, string | boolean> = { "data-orch-zone-action": b.action };
    const hint = HINT[b.action];
    if (hint) attr.title = t(locale, hint);
    if (LOCAL[b.action]) attr[LOCAL[b.action]!] = true;
    if (b.action === "resume" && p.resumeNext !== undefined) attr["data-orch-resume"] = p.resumeNext;
    if (kind === "dangerous") {
      const text = p.confirmText(b);
      return text ? <DangerConfirm key={b.action} locale={locale} label={b.label} text={text} disabled={off} attr={attr} onConfirm={() => p.onButton(b)} />
        : <button key={b.action} type="button" className="orch-stop" disabled={off} {...attr} onClick={() => p.onButton(b)}>{b.label}</button>;
    }
    const cls = kind === "primary" ? (b.danger ? "orch-danger" : "orch-primary") : undefined;
    return <button key={b.action} type="button" className={cls} disabled={off} {...attr} data-orch-primary={kind === "primary" ? ATTR[b.action] ?? b.action : undefined}
      onClick={() => p.onButton(b)}>{b.label}</button>;
  };
  const rows = [zone.primary && row(zone.primary, "primary"), ...zone.secondary.map((b) => row(b, "secondary")), ...zone.dangerous.map((b) => row(b, "dangerous"))].filter(Boolean);
  const label = zone.tone === "neutral" ? null : zone.tone === "waiting" ? tr(locale, "orchPauseYou") : tr(locale, "orchPauseNotYou");
  return (
    <section ref={p.zoneRef} tabIndex={-1} role="status" aria-live="polite" data-orch-summary data-headline={p.headline} data-orch-zone={zone.variant} data-orch-tone={zone.tone}
      className={`orch-zone orch-zone--${zone.tone} orch-zone--${p.headline} orch-panel__status orch-panel__status--${p.status}${p.flash ? " orch-zone--flash" : ""}${p.compact ? " orch-zone--compact" : ""}`}>
      {p.task && <div className="orch-zone__task" data-orch-task={p.task.key} title={p.task.title}>{tr(locale, "boardTask")} {p.task.key} · {p.task.title}</div>}
      {label && <div className="orch-zone__label"><UiIcon name={zone.tone === "waiting" ? "bell" : "status-paused"} size={14} /><span data-orch-label>{label}</span></div>}
      <div className="orch-zone__headline">
        <strong data-orch-what>{p.words(zone.title)}</strong>
        {zone.why && <span data-orch-reason>{p.words(zone.why)}</span>}
      </div>
      {zone.todo && <p className="orch-zone__next" data-orch-next><b>{tr(locale, "orchNextStep")}:</b> {p.words(zone.todo)}</p>}
      {p.who && <p className="orch-zone__who" data-orch-working>{p.who}</p>}
      {p.children}
      {rows.length > 0 && <div className="orch-panel__actions orch-zone__actions" data-orch-actions>{rows}</div>}
      {zone.clarify !== "hidden" && (
        <div className="orch-zone__clarify" data-orch-clarify={zone.clarify}>
          {!clarifyOpen || zone.clarify === "disabled"
            ? <button type="button" disabled={zone.clarify === "disabled"} aria-expanded={false} data-orch-clarify-open onClick={() => setClarifyOpen(true)}>{tr(locale, "orchClarify")}</button>
            : <>
              <textarea rows={2} value={p.clarify.value} placeholder={tr(locale, "orchClarifyPlaceholder")} onChange={(e) => p.clarify.onChange(e.target.value)} />
              <span className="orch-confirm__row">
                <button type="button" disabled={p.sending || !p.clarify.value.trim()} data-orch-clarify-send onClick={p.clarify.onSend}>{tr(locale, "orchClarify")}</button>
                <button type="button" onClick={() => setClarifyOpen(false)}>{tr(locale, "orchCancel")}</button>
              </span>
            </>}
          {zone.clarify === "disabled" && <small className="orch-hint" data-orch-proposal-waits>{tr(locale, "orchProposalWaitsHint")}</small>}
        </div>
      )}
      {p.notices}
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
          <button key={b.action} type="button" className={stop ? "orch-stop" : pause ? "orch-primary" : undefined} disabled={(sending && !stop) || disabled(b)}
            data-orch-stop={stop ? "" : undefined} data-orch-foot-action={b.action} data-orch-primary={pause ? "pause" : undefined} onClick={() => onButton(b)}>{labelOf?.(b) ?? b.label}</button>
        );
      })}
    </div>
  );
}
