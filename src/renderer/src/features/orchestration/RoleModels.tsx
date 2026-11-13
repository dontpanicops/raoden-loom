// The model of each role (journal v2): in the project settings, and over them for one goal. "As in the CLI" passes
// nothing — the CLI's own configuration decides. Codex offers what model/list says for this account (asked once per
// session of the application, «Обновить» asks again); Claude has no such list without a model turn: its aliases and any
// other name. The choice goes to one thread or one run of the CLI; config.toml and Claude's settings are never written.
import { useCallback, useEffect, useState } from "react";
import type { LocaleId } from "../../../../shared/contracts";
import type { OrchestrationCodexModels, OrchestrationRoleModels } from "../../../../shared/orchestration";
import { Term } from "../../components/Term";
import { t } from "../../lib/i18n";

export const ROLE_PROVIDER = { lead: "codex", executor: "claude", reviewer: "codex" } as const;
export const CLAUDE_MODELS = ["opus", "sonnet", "haiku"];
const ROLES = ["lead", "executor", "reviewer"] as const;
type Role = (typeof ROLES)[number];
const ROLE_KEY = { lead: "orchRoleLead", executor: "orchRoleExecutor", reviewer: "orchRoleReviewer" } as const;
export const NO_MODELS: OrchestrationRoleModels = { lead: null, executor: null, reviewer: null };

export function useCodexModels(linkId: string) {
  const [list, setList] = useState<OrchestrationCodexModels | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (refresh: boolean) => {
    setBusy(true);
    const r = await window.canvasTTY.orchestration.codexModels(linkId, refresh).catch(() => null);
    setBusy(false);
    setList(r?.ok ? r.value : { ok: false, error: r && !r.ok ? r.message : null, ids: [], shown: [], configModel: null, checkedAt: "" });
  }, [linkId]);
  useEffect(() => { void load(false); }, [load]);
  return { list, busy, refresh: () => void load(true) };
}

export const modelText = (locale: LocaleId, model: string | null): string => model ?? t(locale, "orchModelCli");

function RoleModel({ locale, role, value, codex, onChange }: {
  locale: LocaleId; role: Role; value: string | null; codex: OrchestrationCodexModels | null; onChange(m: string | null): void;
}): React.JSX.Element {
  const provider = ROLE_PROVIDER[role];
  const known = provider === "codex" ? codex?.shown ?? [] : CLAUDE_MODELS;
  // Claude: any other name by «Другая»; Codex: only what model/list offers (a saved one not in it stays shown)
  const [other, setOther] = useState(provider === "claude" && value !== null && !known.includes(value));
  const options = value !== null && !known.includes(value) && provider === "codex" ? [...known, value] : known;
  return (
    <label className="orch-field" data-orch-model={role}>
      <span><Term locale={locale} id={role}>{t(locale, ROLE_KEY[role])}</Term> ({provider === "codex" ? "Codex" : "Claude"})</span>
      <select value={other ? "\u0000other" : value ?? ""} onChange={(e) => {
        const v = e.target.value;
        if (v === "\u0000other") { setOther(true); return; }
        setOther(false);
        onChange(v === "" ? null : v);
      }}>
        <option value="">{t(locale, "orchModelCli")}{provider === "codex" && codex?.configModel ? ` (${codex.configModel})` : ""}</option>
        {options.map((m) => <option key={m} value={m}>{m}{provider === "codex" && codex?.ok && !codex.ids.includes(m) ? ` — ${t(locale, "orchModelUnavailable")}` : ""}</option>)}
        {provider === "claude" && <option value={"\u0000other"}>{t(locale, "orchModelOther")}</option>}
      </select>
      {other && <input value={value ?? ""} placeholder={t(locale, "orchModelOtherPlaceholder")} spellCheck={false} data-orch-model-other={role}
        onChange={(e) => onChange(e.target.value.trim() || null)} />}
    </label>
  );
}

// more (D-043, the project settings, mock 15): the lead and the executor in the card; the reviewer and «Обновить» under that
// summary (open while the reviewer has a model of its own). The goal dialog passes none: everything as before
export function RoleModelsField({ locale, linkId, value, onChange, hint, bare, more }: {
  locale: LocaleId; linkId: string; value: OrchestrationRoleModels; onChange(v: OrchestrationRoleModels): void; hint: string; bare?: boolean; more?: string;
}): React.JSX.Element {
  const codex = useCodexModels(linkId);
  const role = (r: Role) => <RoleModel key={r} locale={locale} role={r} value={value[r]} codex={codex.list} onChange={(m) => onChange({ ...value, [r]: m })} />;
  const failed = codex.list && !codex.list.ok ? `${t(locale, "orchModelsCodexFailed")}${codex.list.error ? `: ${codex.list.error}` : ""} ` : "";
  const refresh = <button type="button" disabled={codex.busy} data-orch-models-refresh onClick={codex.refresh}>{t(locale, "orchModelsRefresh")}</button>;
  const state = codex.list ? (codex.list.ok ? "ok" : "failed") : "loading";
  return (
    <fieldset className="orch-field orch-models" data-orch-models>
      {!bare && <legend>{t(locale, "orchModels")}</legend>}
      {(more ? ROLES.filter((r) => r !== "reviewer") : ROLES).map(role)}
      <p className="orch-hint">{hint}</p>
      {more ? <>
        {failed && <p className="orch-hint" data-orch-codex-models={state}>{failed}</p>}
        <details className="orch-more" data-orch-models-more open={value.reviewer !== null}>
          <summary>{more}</summary>
          {role("reviewer")}
          <p className="orch-hint" {...(failed ? {} : { "data-orch-codex-models": state })}>{refresh}</p>
        </details>
      </> : (
        <p className="orch-hint" data-orch-codex-models={state}>{failed}{refresh}</p>
      )}
    </fieldset>
  );
}
