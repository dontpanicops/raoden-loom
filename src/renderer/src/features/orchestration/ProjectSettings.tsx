// Stage 13: the one-time setup of a project (docs/agent-orchestration/implementation/stage-13-autopilot.md §2). A few
// fields up front — where the agents work, the checks, automatic preparation, the agents' rights — and the rest under
// "Advanced". Filled from the repository by main; main validates and saves it. The "Environment" check asks the CLIs
// themselves what they loaded (no model turn) and shows only what they confirmed.
import { useEffect, useState } from "react";
import type { LocaleId } from "../../../../shared/contracts";
import type {
  OrchestrationEnvironmentReport,
  OrchestrationProfileInfo,
  OrchestrationProjectProfile
} from "../../../../shared/orchestration";
import { t, type TranslationKey } from "../../lib/i18n";
import { UiIcon } from "../../components/UiIcon";
import { envRows, goalLines, outcomeOf, probeText } from "./runModel";
import { clockText, GoalRows } from "./OrchestrationDialogs";
import { Termed } from "./RunPanel";
import { NO_MODELS, RoleModelsField } from "./RoleModels";
import { outcomeText } from "./useOrchestration";

const tr = (locale: LocaleId, key: string): string => t(locale, key as TranslationKey) ?? key;
const api = () => window.canvasTTY.orchestration;

const stepsText = (p: OrchestrationProjectProfile) => p.prepare.steps.map((s) => (s.unless ? `${s.command} | ${s.unless}` : s.command)).join("\n");
function parseSteps(text: string): OrchestrationProjectProfile["prepare"]["steps"] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const at = l.lastIndexOf(" | ");
    return at > 0 ? { command: l.slice(0, at).trim(), unless: l.slice(at + 3).trim() || null } : { command: l, unless: null };
  });
}

export function EnvironmentCheck({ locale, linkId }: { locale: LocaleId; linkId: string }): React.JSX.Element {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "error"; text: string } | { kind: "done"; report: OrchestrationEnvironmentReport }>({ kind: "idle" });
  const run = async (mcpReady?: string): Promise<void> => {
    setState({ kind: "busy" });
    const { outcome, value } = await outcomeOf(() => api().probe(linkId, mcpReady ? { mcpReady } : undefined));
    if (outcome.kind === "accepted" && value) setState({ kind: "done", report: value });
    else setState({ kind: "error", text: outcomeText(locale, outcome) ?? t(locale, "orchError_generic") });
  };
  return (
    <fieldset className="orch-field orch-env-check" data-orch-env-check={state.kind}>
      <legend>{t(locale, "orchEnvTitle")}</legend>
      <p className="orch-hint">{t(locale, "orchEnvProbeHint")}</p>
      {/* F-c (D-041 p. 2, mock-up 15): what was checked and its result, a row each — the report's facts only */}
      {state.kind === "done" && (
        <ul className="orch-checklist" data-orch-checklist>
          {envRows(state.report).map((row) => (
            <li key={row.id} className={`orch-checklist__row orch-checklist__row--${row.level}`} data-env-row={row.id} data-env-level={row.level}>
              <span className="orch-checklist__mark" aria-hidden="true"><UiIcon name={row.level === "ok" ? "status-done" : "status-failed"} size="1.2em" /></span>
              <span className="orch-checklist__text">{tr(locale, row.key).replace(/\{(\w+)\}/g, (_, k: string) => String(row.params[k] ?? ""))}</span>
              {row.unchecked?.length ? <button type="button" disabled={state.kind !== "done"} data-env-check-mcp={row.unchecked[0]} onClick={() => void run(row.unchecked![0])}>{t(locale, "orchEnvRow_check")}</button> : null}
            </li>
          ))}
        </ul>
      )}
      <button type="button" disabled={state.kind === "busy"} onClick={() => void run()}>{t(locale, state.kind === "busy" ? "orchEnvProbing" : state.kind === "done" ? "orchEnvProbeAgain" : "orchEnvProbe")}</button>
      {state.kind === "done" && <small className="orch-hint" data-env-checked-at>{t(locale, "orchReadyCheckedAt").replace("{time}", clockText(locale, Date.parse(state.report.checkedAt) || Date.now()))}</small>}
      {state.kind === "error" && <p className="dialog-error" role="alert">{state.text}</p>}
      {state.kind === "done" && (
        <details className="orch-env-details" data-orch-env-details>
        <summary>{t(locale, "orchEnvDetails")}</summary>
        <div className="orch-env" data-orch-env-report>
          <p>{t(locale, "orchEnvShell")}: <code>{state.report.shell.shell ?? "?"}</code> · PATH {state.report.shell.pathEntries} · {tr(locale, `orchDirenv_${state.report.shell.direnv}`)}</p>
          {state.report.providers.map((p) => (
            <div key={p.provider} data-env-provider={p.provider} {...(p.limitMs ? { "data-env-limit": p.limitMs } : {})}>
              <strong>{p.provider === "codex" ? "Codex" : "Claude"}</strong>
              {!p.ok && <p className="dialog-error">{t(locale, "orchEnvFailed")}: {p.error}</p>}
              <ul>
                {p.items.map((i) => (
                  <li key={i.id} data-env-item={i.id} data-confirmed={i.confirmed ? "yes" : "no"}
                    {...(i.complete !== undefined ? { "data-env-complete": i.complete ? "yes" : "no" } : {})} {...(i.incomplete ? { "data-env-incomplete": i.incomplete } : {})}>
                    {tr(locale, `orchEnvItem_${i.id}`)}: {!i.confirmed ? <i>{t(locale, "orchEnvUnconfirmed")}</i> : i.servers?.length ? i.servers.map((m, k) => (
                      <span key={m.name} data-mcp-server={m.name} data-mcp-connection={m.connection ?? ""} data-mcp-auth={m.auth ?? ""} data-mcp-tools={m.tools.join(",")}>
                        {k ? ", " : ""}<b>{m.name}</b> ({m.connection ?? t(locale, "orchEnvMcpNotChecked")}{m.auth ? `; ${t(locale, "orchEnvMcpAuth")}: ${m.auth}` : ""}{m.tools.length ? `; ${t(locale, "orchEnvMcpTools")}: ${m.tools.length}` : ""})
                      </span>)) : <b>{probeText(locale, i.value)}</b>}
                    {i.note ? <small className="orch-hint"> — {probeText(locale, i.note)}</small> : null}
                  </li>
                ))}
              </ul>
              {p.timing?.length ? (
                <details className="orch-hint" data-env-timing>
                  <summary>{t(locale, "orchEnvTiming")}{p.limitMs ? ` (${Math.round(p.limitMs / 1000)} s)` : ""}</summary>
                  <ol>
                    {p.timing.map((x, k) => (
                      <li key={k} data-timing-method={x.method} data-timing-page={x.page ?? ""} data-timing-start={x.startMs} data-timing-duration={x.durationMs}
                        data-timing-allotted={x.allottedMs} data-timing-left={x.leftMs} data-timing-outcome={x.outcome}>
                        <code>{x.method}{x.page ? ` #${x.page}` : ""}</code>: {x.durationMs} ms / {x.allottedMs} ms — {tr(locale, `orchEnvOutcome_${x.outcome}`)}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </div>
          ))}
          <p className="orch-hint">{t(locale, "orchEnvParityNote")}</p>
        </div>
        </details>
      )}
    </fieldset>
  );
}

// R5f (mock-up 15): a section of the settings is a card with its title (a component of its own: a card made inside the form would remount its fields on every key)
function Card({ title, hint, children, ...rest }: { title: string; hint?: string; children: React.ReactNode } & Record<string, unknown>): React.JSX.Element {
  return (
    <section className="orch-card2" {...rest}>
      <h3>{title}</h3>
      {hint && <p className="orch-hint">{hint}</p>}
      {children}
    </section>
  );
}

export function ProjectSettings({ locale, linkId, info, onSaved, onCancel, check }: {
  locale: LocaleId; linkId: string; info: OrchestrationProfileInfo; onSaved(profile: OrchestrationProjectProfile): void; onCancel(): void;
  // «Проверить сейчас» on these settings as they are being edited (the commands, the work place, the rights)
  check?(draft: { checks: string[]; workMode: OrchestrationProjectProfile["workMode"]; access: OrchestrationProjectProfile["access"] }): React.ReactNode;
}): React.JSX.Element {
  const [p, setP] = useState<OrchestrationProjectProfile>(info.profile);
  const [checks, setChecks] = useState(info.profile.checks.join("\n"));
  const [steps, setSteps] = useState(stepsText(info.profile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "As in my terminal" newly chosen for a CLI: saved only with its warning confirmed (main checks it again)
  const [confirmTerminal, setConfirmTerminal] = useState(false);
  const toTerminal = (["claude", "codex"] as const).some((k) => p.access[k] === "terminal" && !(info.saved && info.profile.access[k] === "terminal"));
  // F-c: the network for the lead's checks, newly turned on: saved only with its risk confirmed (main checks it again)
  const [confirmOutside, setConfirmOutside] = useState(false);
  const toOutside = p.checksOutside === true && !(info.saved && info.profile.checksOutside === true);
  // F4 (T-8): the autopilot's push — turned on, or its remote or options changed: saved only confirmed (main checks it
  // again, the address included); the options and the protected branches one per line
  const [pushOptions, setPushOptions] = useState((info.profile.runPush?.options ?? []).join("\n"));
  const [pushProtected, setPushProtected] = useState((info.profile.runPush?.protected ?? []).join("\n"));
  const [confirmPush, setConfirmPush] = useState(false);
  const [protectedDraft, setProtectedDraft] = useState("");
  const addProtected = (): void => {
    const b = protectedDraft.trim().replace(/,$/, "");
    setProtectedDraft("");
    if (b && !pushProtected.split("\n").map((x) => x.trim()).includes(b)) setPushProtected((cur) => (cur.trim() ? `${cur.trim()}\n${b}` : b));
  };
  const lines = (text: string) => text.split("\n").map((x) => x.trim()).filter(Boolean);
  const reviewFormat = p.reviewExportFormat ?? "both";
  // a relative folder would put the files into the project's tree: refused here and by main
  const reviewDirBad = !!p.reviewExportDir?.trim() && !/^(~(\/|$)|\/)/.test(p.reviewExportDir.trim());
  const savedPush = info.saved ? info.profile.runPush : undefined;
  // the address main reads and saves (insteadOf, pushurl), not the raw remote.<name>.url; null: not read
  const pushUrl = p.runPush ? info.facts.remotes.find((r) => r.name === p.runPush!.remote)?.pushUrl ?? null : null;
  const pushAsks = !!p.runPush?.enabled && (!savedPush?.enabled || savedPush.remote !== p.runPush.remote || savedPush.remoteUrl !== pushUrl || savedPush.options.join("\n") !== lines(pushOptions).join("\n"));
  // The rights modes the installed CLIs offer: asked when the settings open (the CLIs start with --help, no model).
  const [caps, setCaps] = useState<OrchestrationProfileInfo["capabilities"] | null>(null);
  useEffect(() => {
    let live = true;
    void api().profile(linkId, true).then((r) => { if (live && r.ok) setCaps(r.value.capabilities); }).catch(() => {});
    return () => { live = false; };
  }, [linkId]);
  const set = (patch: Partial<OrchestrationProjectProfile>) => setP((cur) => ({ ...cur, ...patch }));
  const finish = (patch: Partial<OrchestrationProjectProfile["finish"]>) => setP((cur) => ({ ...cur, finish: { ...cur.finish, ...patch } }));
  const qa = p.finish.qa ?? { environment: "", command: "", verify: "", reportsVersion: false };
  const qaOn = !!(qa.environment || qa.command || qa.verify);
  // QA delivers this run's commit (main refuses QA without the commit action): filling it in turns the commit on
  const setQa = (patch: Partial<typeof qa>) => finish({ qa: { ...qa, ...patch }, ...(Object.values(patch).some((v) => typeof v === "string" && v.trim()) ? { commit: true } : {}) });

  // Checked here first so the person is told which field is wrong; main validates everything again.
  const invalid = (): string | null => {
    const parts = [qa.environment, qa.command, qa.verify].filter((v) => v.trim()).length;
    if (parts > 0 && parts < 3) return t(locale, "orchSettingsErrQa");
    if (p.finish.push && !p.finish.push.branch.trim()) return t(locale, "orchSettingsErrBranch");
    if ((parts > 0 || p.finish.push) && !p.finish.commit) return t(locale, "orchSettingsErrNeedsCommit");
    if (toTerminal && !confirmTerminal) return t(locale, "orchError_terminal_not_confirmed");
    if (toOutside && !confirmOutside) return t(locale, "orchError_checks_outside_not_confirmed");
    if (reviewDirBad) return t(locale, "projReviewDirRelative");
    if (pushAsks && pushUrl === null) return t(locale, "projRunPushUrlUnread");
    if (pushAsks && !confirmPush) return t(locale, "orchError_push_not_confirmed");
    return null;
  };
  const save = async (): Promise<void> => {
    const wrong = invalid();
    if (wrong) return setError(wrong);
    const profile: OrchestrationProjectProfile = {
      ...p,
      checks: checks.split("\n").map((c) => c.trim()).filter(Boolean),
      prepare: { ...p.prepare, steps: parseSteps(steps) },
      finish: { ...p.finish, qa: qaOn ? { environment: qa.environment.trim(), command: qa.command.trim(), verify: qa.verify.trim(), reportsVersion: !!qa.reportsVersion } : null },
      ...(p.runPush || lines(pushOptions).length || lines(pushProtected).length ? { runPush: { remote: info.facts.remotes[0]?.name ?? "origin", remoteUrl: null, enabled: false, confirmedAt: null, ...p.runPush, options: lines(pushOptions), protected: lines(pushProtected) } } : {})
    };
    setBusy(true);
    setError(null);
    const { outcome, value } = await outcomeOf(() => api().saveProfile(linkId, { ...profile, ...(toTerminal ? { confirmTerminal } : {}), ...(toOutside ? { confirmChecksOutside: confirmOutside } : {}), ...(pushAsks ? { confirmPush } : {}) }));
    setBusy(false);
    if (outcome.kind === "accepted" && value) onSaved(value);
    else setError(outcomeText(locale, outcome) ?? t(locale, "orchError_generic"));
  };

  // R5f (mock-up 15): the rights of a CLI are a segment of the modes it offers (the same state the select held)
  const accessSelect = (provider: "claude" | "codex") => {
    const options = (caps ?? info.capabilities)[provider];
    const current = p.access[provider];
    const all = options.some((o) => o.mode === current) ? options : [...options, { mode: current, mapping: "" }];
    return (
      <div className="orch-access" data-orch-access={provider}>
        <div className="orch-access__row">
          <span className="orch-access__name">{provider === "claude" ? "Claude" : "Codex"} · {t(locale, provider === "claude" ? "orchRoleExecutorShort" : "orchRoleLeadShort")}</span>
          {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons that keeps its own layout; a fieldset would bring its own box */}
          <div className="orch-seg2 orch-access__seg" role="group" aria-label={provider === "claude" ? "Claude" : "Codex"} data-orch-access-value={current}>
            {all.map((o) => (
              // R6-C (M6): one row of short labels; the full name and what the CLI is given are the tooltip, not a «Подробнее» paragraph
              <button key={o.mode} type="button" aria-pressed={current === o.mode} className={current === o.mode ? "orch-seg2__on" : undefined} data-orch-access-mode={o.mode}
                title={`${tr(locale, `orchAccess_${o.mode}`)}${o.mode === "terminal" ? "" : ` — ${t(locale, "orchAccessMaps")} ${o.mapping || t(locale, "orchAccessMapsNone")}`}`}
                onClick={() => set({ access: { ...p.access, [provider]: o.mode } })}>{tr(locale, `orchAccessShort_${o.mode}`)}</button>
            ))}
          </div>
        </div>
        {current === "terminal" && <small className="orch-hint orch-hint--warn" data-orch-terminal-warning>{t(locale, "orchAccessTerminalWarn")}</small>}
        {current === "full" && <small className="dialog-error" data-orch-full-warning>{t(locale, "orchAccessFullWarn")}</small>}
      </div>
    );
  };

  return (
    <form className="orch-form orch-settings" data-orch-settings onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="orch-form__body">
        <div className="orch-settings__grid" data-orch-advanced>
          {/* R12l (mock 15): two columns of their own, so that a short card does not wait for the tall one beside it */}
          <div className="orch-settings__stack">
          <Card title={t(locale, "orchSettingsAccess")}>
            {accessSelect("claude")}
            {accessSelect("codex")}
            <p className="orch-hint">{t(locale, "orchSettingsAccessHint")}</p>
            {toTerminal && (
              <label className="orch-check" data-orch-terminal-confirm>
                <input type="checkbox" checked={confirmTerminal} onChange={(e) => setConfirmTerminal(e.target.checked)} />
                <span>{t(locale, "orchAccessTerminalConfirm")}</span>
              </label>
            )}
          </Card>
          <Card title={t(locale, "projCardPrepare")} hint={t(locale, "projPrepareHint")}>
            <GoalRows text={steps} onText={setSteps} locale={locale} attr="data-orch-settings-steps" mono label={t(locale, "projCardPrepare")}
              placeholder={t(locale, "orchGoalCommandsPlaceholder")} addLabel={t(locale, "orchGoalAddCommand")} />
            <label className="orch-check">
              <input type="checkbox" checked={p.prepare.auto} data-orch-settings-prepare onChange={(e) => set({ prepare: { ...p.prepare, auto: e.target.checked } })} />
              <span>{t(locale, "orchSettingsPrepareAuto")}</span>
            </label>
            <label className="orch-check">
              <input type="checkbox" checked={p.env.direnv} onChange={(e) => set({ env: { direnv: e.target.checked } })} />
              <span><Termed locale={locale} text={t(locale, "orchSettingsDirenv")} /></span>
            </label>
            {/* R6-C (M6): what preparation would run — one line, the whole list in the tooltip */}
            <p className="orch-hint orch-hint--line" data-orch-needed title={info.facts.needed.join(" · ")}>{info.facts.needed.length ? `${t(locale, "projPrepareWill")} ${info.facts.needed.join(" · ")}` : t(locale, "orchSettingsNothingNeeded")}</p>
          </Card>
          {/* F3 (stage-f-external-projects.md §10): the board's tasks in a worktree — the branch name, the remote base; main
              refuses them in another mode (work_mode_not_worktree, remote_base_mode) and reads the remote's address.
              F4 (§10): «The autopilot pushes» — off by default; the confirmation shows the remote, its address and the options as they are */}
          <Card title={t(locale, "projCardPush")} data-orch-settings-branches>
            {/* mock 15: Remote, the branch template, the options, the protected branches, the autopilot — one column of rows */}
            <label className="orch-field orch-field--line">
              <span>{t(locale, "projPushRemote")}</span>
              <select value={p.runPush?.remote ?? info.facts.remotes[0]?.name ?? "origin"} data-orch-settings-run-push-remote
                onChange={(e) => set({ runPush: { remoteUrl: null, options: [], protected: [], confirmedAt: null, enabled: false, ...p.runPush, remote: e.target.value } })}>
                {[...new Set([p.runPush?.remote ?? info.facts.remotes[0]?.name ?? "origin", ...info.facts.remotes.map((r) => r.name)])].map((name) => <option key={name} value={name}>{info.facts.remotes.find((r) => r.name === name)?.url ? `${name} · ${info.facts.remotes.find((r) => r.name === name)!.url}` : name}</option>)}
              </select>
            </label>
            <label className="orch-field orch-field--line">
              <span>{t(locale, "projBranchTemplate")}</span>
              <input value={p.branchTemplate ?? ""} spellCheck={false} placeholder="{ref}" data-orch-settings-branch-template
                onChange={(e) => setP((cur) => { const { branchTemplate: _was, ...rest } = cur; return e.target.value ? { ...rest, branchTemplate: e.target.value } : rest; })} />
              <small className="orch-hint">{t(locale, "projBranchTemplateHint")}</small>
            </label>
            <label className="orch-field">
              <span>{t(locale, "projRunPushOptions")}</span>
              <textarea rows={3} value={pushOptions} spellCheck={false} data-orch-settings-run-push-options onChange={(e) => setPushOptions(e.target.value)} />
            </label>
            <div className="orch-field" data-orch-settings-run-push-protected>
              <span>{t(locale, "projRunPushProtected")}</span>
              <span className="orch-chips">
                {lines(pushProtected).map((b) => (
                  <span key={b} className="orch-chip"><code>{b}</code>
                    <button type="button" aria-label={`${t(locale, "orchGoalRowRemove")} ${b}`} onClick={() => setPushProtected(lines(pushProtected).filter((x) => x !== b).join("\n"))}>×</button></span>
                ))}
                <input value={protectedDraft} spellCheck={false} placeholder={t(locale, "projPushProtectedAdd")} data-orch-settings-run-push-protected-add
                  onChange={(e) => setProtectedDraft(e.target.value)} onBlur={addProtected}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addProtected(); } }} />
              </span>
            </div>
            {pushAsks && (
              <label className="orch-check" data-orch-push-confirm>
                <input type="checkbox" checked={confirmPush} disabled={pushUrl === null} onChange={(e) => setConfirmPush(e.target.checked)} />
                <span>{t(locale, "projRunPushConfirm").replace("{remote}", () => p.runPush!.remote).replace("{url}", () => pushUrl ?? t(locale, "projRunPushUrlUnread")).replace("{options}", () => lines(pushOptions).join(" ") || "—")}</span>
              </label>
            )}
            <div className="orch-field" data-orch-settings-run-push>
              <label className="orch-check orch-check--switch">
                <input type="checkbox" role="switch" aria-checked={!!p.runPush?.enabled} checked={!!p.runPush?.enabled} data-orch-settings-run-push-enabled
                  onChange={(e) => set({ runPush: { remote: info.facts.remotes[0]?.name ?? "origin", remoteUrl: null, options: [], protected: [], confirmedAt: null, ...p.runPush, enabled: e.target.checked } })} />
                <span>{t(locale, "projRunPush")}</span>
              </label>
              <small className="orch-hint">{t(locale, "projRunPushHint")}</small>
            </div>
            {/* F3 (§10): the remote base of a board task's run (worktree only; main reads the remote's address) */}
            <label className="orch-field">
              <span>{t(locale, "projRunBase")}</span>
              <span className="orch-field__row">
                <select value={p.runBase?.remote ?? ""} data-orch-settings-run-base-remote
                  onChange={(e) => setP((cur) => { const { runBase: _was, ...rest } = cur; return e.target.value ? { ...rest, runBase: { remote: e.target.value, branch: cur.runBase?.branch ?? "", remoteUrl: null } } : rest; })}>
                  <option value="">{t(locale, "projRunBaseNone")}</option>
                  {info.facts.remotes.map((r) => <option key={r.name} value={r.name}>{r.name} — {r.url}</option>)}
                </select>
                {p.runBase && (
                  <input value={p.runBase.branch} placeholder={t(locale, "projRunBaseBranch")} data-orch-settings-run-base-branch
                    onChange={(e) => set({ runBase: { ...p.runBase!, branch: e.target.value } })} />
                )}
              </span>
              {p.runBase?.remoteUrl && <small className="orch-hint" data-orch-settings-run-base-url>{t(locale, "projRunBaseUrl")}: <code>{p.runBase.remoteUrl}</code></small>}
            </label>
          </Card>
          </div>
          <div className="orch-settings__stack">
          {/* journal v2: a role's model is recorded in the goal only there */}
          {info.optionalChecks && (
            <Card title={t(locale, "projCardModels")}>
              <RoleModelsField bare locale={locale} linkId={linkId} value={p.models ?? NO_MODELS} hint={t(locale, "orchModelsSettingsHint")} onChange={(models) => set({ models })} />
            </Card>
          )}
          <Card title={t(locale, "projCardChecks")} hint={t(locale, "projChecksHint")}>
            <GoalRows text={checks} onText={setChecks} locale={locale} attr="data-orch-settings-checks" mono label={t(locale, "projCardChecks")}
              placeholder={t(locale, "orchGoalCommandsPlaceholder")} addLabel={t(locale, "orchGoalAddCommand")} />
            <small className="orch-hint">{t(locale, "orchGoalCommandsHint")}</small>
            {/* F-c (D-041 p. 3, mock-up 15): off by default; the risk is said beside the box, always (D-025) */}
            <label className="orch-check" data-orch-settings-checks-outside-row>
              <input type="checkbox" checked={p.checksOutside === true} data-orch-settings-checks-outside
                onChange={(e) => set({ checksOutside: e.target.checked ? true : undefined })} />
              <span>{t(locale, "projChecksOutside")}</span>
            </label>
            <small className={`orch-hint${p.checksOutside ? " orch-hint--warn" : ""}`} data-orch-checks-outside-risk>{t(locale, "projChecksOutsideRisk")}</small>
            {toOutside && (
              <label className="orch-check" data-orch-checks-outside-confirm>
                <input type="checkbox" checked={confirmOutside} onChange={(e) => setConfirmOutside(e.target.checked)} />
                <span>{t(locale, "projChecksOutsideConfirm")}</span>
              </label>
            )}
            {check?.({ checks: goalLines(checks), workMode: p.workMode, access: p.access })}
          </Card>
          {/* F4 (§10, T-9, T-14): the review export of a board task's run, and the runs without MCP */}
          <Card title={t(locale, "projCardReview")} data-orch-settings-f4>
            <label className="orch-check">
              <input type="checkbox" checked={p.reviewExport === true} data-orch-settings-review-export
                onChange={(e) => set({ reviewExport: e.target.checked ? true : undefined })} />
              <span>{t(locale, "projReviewExport")}</span>
            </label>
            <small className="orch-hint">{t(locale, "projReviewExportHint")}</small>
            {/* F-c (D-041 p. 1, mock-up 15): the folder and the format of the review; apply to new runs */}
            <label className="orch-field orch-field--line">
              <span>{t(locale, "projReviewDir")}</span>
              <input value={p.reviewExportDir ?? ""} spellCheck={false} placeholder={t(locale, "projReviewDirPlaceholder")} data-orch-settings-review-dir disabled={p.reviewExport !== true}
                onChange={(e) => setP((cur) => { const { reviewExportDir: _was, ...rest } = cur; return e.target.value ? { ...rest, reviewExportDir: e.target.value } : rest; })} />
            </label>
            {reviewDirBad && <small className="dialog-error" role="alert" data-orch-review-dir-error>{t(locale, "projReviewDirRelative")}</small>}
            <div className="orch-field orch-field--line">
              <span>{t(locale, "projReviewFormat")}</span>
              {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons that keeps its own layout; a fieldset would bring its own box */}
              <div className="orch-seg2" role="group" aria-label={t(locale, "projReviewFormat")} data-orch-settings-review-format={reviewFormat}>
                {(["markdown", "json", "both"] as const).map((f) => (
                  <button key={f} type="button" disabled={p.reviewExport !== true} aria-pressed={reviewFormat === f} className={reviewFormat === f ? "orch-seg2__on" : undefined} data-orch-settings-review-format-to={f}
                    onClick={() => set({ reviewExportFormat: f === "both" ? undefined : f })}>{t(locale, `projReviewFormat_${f}`)}</button>
                ))}
              </div>
            </div>
            <small className="orch-hint">{t(locale, "projReviewDirHint")}</small>
          </Card>
          <Card title={t(locale, "projCardMcp")}>
            <label className="orch-check orch-check--switch">
              <input type="checkbox" role="switch" aria-checked={p.runMcp === false} checked={p.runMcp === false} data-orch-settings-run-mcp
                onChange={(e) => set({ runMcp: e.target.checked ? false : undefined })} />
              <span>{t(locale, "projRunMcp")}</span>
            </label>
            <small className="orch-hint">{t(locale, "projRunMcpHint")}</small>
            <EnvironmentCheck locale={locale} linkId={linkId} />
          </Card>
          </div>
          <Card title={t(locale, "orchWorkMode")} data-orch-settings-workmode={p.workMode}>
            {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of buttons that keeps its own layout; a fieldset would bring its own box */}
            <div className="orch-seg2" role="group" aria-label={t(locale, "orchWorkMode")}>
              {(["copy", "worktree", "project"] as const).map((m) => (
                <button key={m} type="button" aria-pressed={p.workMode === m} className={p.workMode === m ? "orch-seg2__on" : undefined} data-orch-settings-workmode-to={m}
                  onClick={() => set({ workMode: m })}>{tr(locale, `orchWorkMode_${m}`)}</button>
              ))}
            </div>
            <p className="orch-hint"><Termed locale={locale} text={tr(locale, `orchWorkMode_${p.workMode}Hint`)} /></p>
          </Card>
          <Card title={t(locale, "orchSettingsFinish")} data-orch-settings-finish>
            <label className="orch-check">
              <input type="checkbox" checked={p.finish.commit} onChange={(e) => finish({ commit: e.target.checked, ...(e.target.checked ? {} : { push: null }) })} />
              <span>{t(locale, "orchSettingsCommitDefault")}</span>
            </label>
            <label className="orch-field">
              <span>{t(locale, "orchSettingsPush")}</span>
              <span className="orch-field__row">
                <select value={p.finish.push?.remote ?? ""} data-orch-settings-remote
                  onChange={(e) => finish(e.target.value ? { commit: true, push: { remote: e.target.value, branch: p.finish.push?.branch ?? "", remoteUrl: null } } : { push: null })}>
                  <option value="">{t(locale, "orchSettingsPushNone")}</option>
                  {info.facts.remotes.map((r) => <option key={r.name} value={r.name}>{r.name} — {r.url}</option>)}
                </select>
                {p.finish.push && (
                  <input value={p.finish.push.branch} placeholder={t(locale, "orchSettingsPushBranch")} data-orch-settings-branch
                    onChange={(e) => finish({ push: { ...p.finish.push!, branch: e.target.value } })} />
                )}
              </span>
            </label>
            <label className="orch-field"><span>{t(locale, "orchSettingsQa")}: {t(locale, "orchSettingsQaEnv")}</span>
              <input value={qa.environment} data-orch-settings-qa-env onChange={(e) => setQa({ environment: e.target.value })} /></label>
            <label className="orch-field"><span>{t(locale, "orchSettingsQaCommand")}</span>
              <input value={qa.command} spellCheck={false} data-orch-settings-qa-command onChange={(e) => setQa({ command: e.target.value })} /></label>
            <label className="orch-field"><span>{t(locale, "orchSettingsQaVerify")}</span>
              <input value={qa.verify} spellCheck={false} data-orch-settings-qa-verify onChange={(e) => setQa({ verify: e.target.value })} /></label>
            <label className="orch-check" data-orch-settings-qa-reports>
              <input type="checkbox" checked={!!qa.reportsVersion} onChange={(e) => setQa({ reportsVersion: e.target.checked })} />
              <span>{t(locale, "orchSettingsQaReportsVersion")}</span>
            </label>
            {qa.verify.trim() && !qa.reportsVersion && <small className="orch-hint" data-orch-qa-unverified>{t(locale, "orchSettingsQaUnverified")}</small>}
            <small className="orch-hint">{t(locale, "orchSettingsQaHint")} {t(locale, "orchSettingsQaNeedsCommit")}</small>
          </Card>
          <Card title={t(locale, "orchSettingsGrants")} data-orch-settings-grants>
            {p.grants.length === 0 ? <p className="orch-hint">{t(locale, "orchSettingsGrantsNone")}</p> : (
              <ul>{p.grants.map((g) => (
                <li key={g.id} data-grant={g.id}>
                  {g.provider === "codex" ? "Codex" : "Claude"} · {g.tool}: <code>{g.summary}</code>{" "}
                  <button type="button" onClick={() => set({ grants: p.grants.filter((x) => x.id !== g.id) })}>{t(locale, "orchSettingsGrantRemove")}</button>
                </li>
              ))}</ul>
            )}
          </Card>
        </div>
      </div>
      <div className="orch-form__actions">
        {error && <span className="dialog-error orch-form__why" role="alert">{error}</span>}
        <button type="button" className="orch-cancel" onClick={onCancel}>{t(locale, "orchCancel")}</button>
        <button type="submit" className="orch-primary" disabled={busy}>{busy ? t(locale, "orchSending") : t(locale, "orchSettingsSave")}</button>
      </div>
    </form>
  );
}
