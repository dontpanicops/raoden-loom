# R3b — панель запуска: закреплённая зона действия. План реализации

Пути от ~/dev/raoden-loom, ветка feat/r3a-run-panel-tabs (код не правился). Сокращения:
R = src/renderer/src/features/orchestration/RunPanel.tsx (2225 строк), M = runModel.ts (тот же каталог),
S = src/main/services/orchestration/orchestrationService.ts, I = src/renderer/src/lib/i18n.ts,
P = src/shared/orchestrationPause.ts, T = tests/orchestration-pause-texts.test.mjs, CSS = src/renderer/src/styles/app.css.
Макет = docs/ux-audit/2026-11-10/redesign/SPEC.md v3 §4 и preview/07-run-panel-*-sand.jpg (просмотрены 05, 06, 08, 15).

## 0. Главное

1. Закреплённая зона уже есть: `<section className="orch-summary">` R:1588–1746 (макс. высота 46vh, CSS:1168; 30vh для compact, 64vh при permission, CSS:1265–1269),
   но в ней смешаны заголовок, форма решения, строка кнопок `data-orch-actions` (R:1724–1737), блок «Ход работы» (`orch-board` R:1738+), где/как,
   «Забрать результат», «Новая цель». Это и есть «45% высоты». Зона действия R3b = только «что случилось, что делать, одна главная кнопка, формы решений».
   Справочное (`orch-board`, `orch-summary__who`, where, take) уезжает из зоны в вкладку «Итог» (см. §3).
2. Допуск main — замкнутая функция `apply()` внутри `createOrchestrationService` (S:2633), не экспортируется. Наборы RESUMABLE/STEP_ONLY/STOP_ONLY
   продублированы в M:24–27 и читаются тестом T регулярками по тексту S. Решение: вынести чистую функцию допуска в
   `src/shared/orchestrationAdmission.ts` (§2); apply() вызывает её первой строкой, renderer и тест импортируют её же.
3. Найдено при сверке (не в макете и не в spec-vs-code): (а) «Вернуться к контрольной точке» в режиме worktree UI предлагает, main отказывает
   (`inPlace` = project ИЛИ worktree, workspace.ts:67, S:2686; R:1713 прячет только для project) — разрешено только в «копии»;
   (б) у отказа `not_admitted` (S:263) нет текста orchError_not_admitted (ни ru, ни en) — человек увидит «Операция не выполнена (not_admitted)»;
   (в) 8 текстов `orchPause_*_do` называют вкладки до R3a («Действия», «Лог», «Обзор»), см. §3.7;
   (г) push_protected в рендерере вообще не распознаётся: это только строка `external_action` («push: blocked — push_protected: …», S:2013), своего
   `PauseCause` нет (P:7–23) — для варианта нужен разбор (часть A);
   (д) `step` main допускает на environment_error (она в RESUMABLE) — SPEC и spec-vs-code §1.3 п.17 пишут «step запрещён»; неверно, но зона и так
   предлагает только resume (подмножество допустимого — не ошибка).
4. Всего наборов в тесте 37: 27 причин PAUSED_REASONS_V2 + 5 производных (provider_limit, provider_limit_at, model_unsupported, prepare_failed, newer_version)
   + 5 вариантов (awaiting_checks_none, sandbox_unsupported, mcp_present, mcp_unchecked, push_protected). Плюс состояния без паузы: working/pausing/preparing,
   completed, failed, stopped, stopping, halted (макет 01, 17, 18; SPEC §4.6).

## 1. Таблица: 37 наборов

Допуск main (path:line в S): pause_after_turn 2638–2642 (только running→pausing, pausing→running); stop 2643–2646 (ACTIVE = preparing/running/pausing/paused, S:273);
resume/step 2647–2652 (paused; не STOP_ONLY; reason ∈ RESUMABLE S:268–269, step ещё ∈ STEP_ONLY S:270; STOP_ONLY S:271); answer 2653–2662;
clarify 2663–2671 (отказ 2665–2666); raise_limit 2672–2680; recover 2681–2700; checks.decide 2703–2713; check.amend 2714–2728; finish.confirm 2729–2746;
person.decide 2747→personDecide 2807 (disputed 2819, findings 2840, FINDING_PAUSES S:274); plan.decide 2749→planDecide 2852 (2855); permission 2751.

Обозначения. Главная — ровно одна, не опасная (кроме STOP_ONLY, Р9: заливка danger). «Стоп» — всегда в подвале (§3.4), в таблице не повторяется,
кроме STOP_ONLY, где он главная. (лок.) — локальная кнопка без команды main. Опасная = контурная `--danger-fg` + подтверждение. Уточнить: С = свёрнуто
кнопкой, Р = раскрыто сразу, — = скрыто. Тон: Ж «Ждёт вас» (свечение), Н «Пауза» (по PAUSES M:547–562).
Заголовок: ключ I; «новый» = ключ добавляется в ru и en.

### 1.1 27 причин журнала

| Причина | Заголовок (ключ) | Главная → команда | Вторичные → команда | Опасные | Уточнить | Тон | Допуск |
|---|---|---|---|---|---|---|---|
| user_request | orchPause_user_request_what | Продолжить → resume | Один шаг → step | — | С | Н | 2647–2652, RESUMABLE |
| step_done | orchPause_step_done_what | Продолжить → resume | Один шаг → step | — | С | Н | то же |
| plan_review | orchPause_plan_review_what | Начать работу по плану → resume | Открыть план (лок., вкладка Итог/«План»); Один шаг → step | — | С («Уточнить задачу») | Ж | то же |
| awaiting_answer | orchPause_awaiting_answer_what | Ответить → answer (поле, непусто, ≤8000; questionId = текущий) | — | — | — по макету (main допускает, 2665 не отказывает; ответ и есть реплика) | Ж | 2653–2662 |
| recovered | orchPause_recovered_what | Продолжить → resume | Один шаг → step | — | С | Н | RESUMABLE |
| outcome_unknown | orchPause_outcome_unknown_what | Принять результат хода → recover accept | Повторить ход → recover retry_turn | Вернуться к контрольной точке → recover reset_to_checkpoint, confirm:true (чекбокс-подтверждение; только режим «копия», см. расхождение Д1) | С | Ж | 2681–2700 |
| invalid_report | orchPause_invalid_report_what | Повторить ход → step (resume запрещён) | Ход работы · Записи (лок.) | — | С | Ж | 2650: STEP_ONLY только для step |
| protocol_error | orchPause_protocol_error_what | Повторить ход → step | совет «обновите Claude Code / Codex» — текстом, не кнопкой | — | С | Ж | то же |
| limit_reached | orchPause_limit_reached_what | Поднять лимит и продолжить → raise_limit, затем resume (две команды, R:1531 `continueAfterRaise`) | — | — | С (disabled + подсказка при `proposalWaits`) | Ж | 2672–2680; затем user_request → resume |
| permission_denied | orchPause_permission_denied_what | Продолжить → resume | Настройки проекта (лок.) | — | С | Ж | RESUMABLE |
| loop_suspected | orchPause_loop_suspected_what | Дать ещё раунд → resume | Один шаг → step | — | Р | Ж | RESUMABLE |
| lead_modified_tree | orchPause_lead_modified_tree_what | Остановить запуск → stop (STOP_ONLY, заливка danger, Р9) | Посмотреть изменения (лок., вкладка Изменения) | сама главная | — (смысла нет; main допускает) | Ж | 2649 resume/step отказ; stop 2643 |
| environment_error | orchPause_environment_error_what | Продолжить → resume | — | — | С | Ж | RESUMABLE |
| shared_git_tampered | orchPause_shared_git_tampered_what | Остановить запуск → stop | Скопировать id (лок.) | сама главная | — | Ж | STOP_ONLY |
| journal_corrupt | orchPause_journal_corrupt_what | Остановить запуск → stop | Скопировать журнал, id (лок.) | сама главная | — (main отказывает, S:2665) | Ж | STOP_ONLY; clarify отказ |
| sandbox_unavailable | orchPause_sandbox_unavailable_what | Остановить запуск → stop | — | сама главная | — | Ж | STOP_ONLY |
| stage_done | orchPause_stage_done_what | Продолжить → resume | Один шаг → step; Посмотреть изменения (лок.) | — | С | Ж | RESUMABLE |
| external_failure | orchPause_external_failure_what | Продолжить → resume | — | — | С | Ж | RESUMABLE |
| needs_user_action | orchPause_needs_user_action_what | Готово, продолжить → resume | Ход работы · Лента (лок., «что именно нужно») | — | С | Ж | RESUMABLE |
| finish_unconfirmed | orchPause_finish_unconfirmed_what | Проверить результат → resume (только проверка) или «Повторить: {шаг}» → resume, если `finishPending.status==="failed"` (M:409/450) | — | — | С | Ж | RESUMABLE |
| app_closed | orchPause_app_closed_what | Продолжить → resume | Один шаг → step | — | С | Н | RESUMABLE |
| awaiting_checks_decision | orchHeadline_awaiting_checks (сейчас «Нужно решение о командах проверки»); макет «Лид предложил команды проверки» — новый orchPause_awaiting_checks_decision_what | Принять команды → checks.decide accept (`checks` не передавать, S:2711) | Изменить → редактор строк → checks.decide edit | — | — | Ж | 2703–2713 |
| awaiting_finish_confirmation | orchPause_awaiting_finish_confirmation_what | Решить про отправку → форма (push/QA: Выполнить / Пропустить по каждому, без умолчания) → «Отправить решения» → finish.confirm | — | выбор «Выполнить» push/QA в запуске без проверок — отмеченный пункт, не главная; подтверждение = сам явный выбор | — | Ж | 2729–2746 (tree/commit должны совпасть, иначе stale_revision 2742) |
| check_needs_permissions | orchPause_check_needs_permissions_what | Сохранить как свою команду → check.amend (checkId = view.refused.checkId, line непустая ≤1000 без \n) | — | — | — | Ж | 2714–2728 |
| tree_changed_during_review | orchPause_tree_changed_during_review_what | Проверить заново → resume | — | — | С | Ж | RESUMABLE |
| awaiting_person_decision | orchPause_awaiting_person_decision_what | Отправить решения → person.decide по каждому пункту (замечание Новый/Повтор, условие Выполнено/Не выполнено, находка Закрыть/В пожелания; умолчания нет) | — | — | — | Ж | personDecide 2807–2851 |
| coverage_lost | orchPause_coverage_lost_what | Вернуть лиду → plan.decide return (безопасно) | Принять снятие → plan.decide accept + выбор по каждой затронутой находке (перенести/закрыть/в пожелания) | Принять снятие (контурная danger + текст «критерии перестанут проверяться» уже есть: orchProposalAcceptWarn) | — | Ж | planDecide 2852–2855 |

### 1.2 5 производных

| Ключ | Заголовок | Главная → команда | Вторичные | Опасные | Уточнить | Тон | Допуск |
|---|---|---|---|---|---|---|---|
| provider_limit (environment_error + лимит в ленте, P:46–55) | сейчас orchHeadline_provider_limit «Исчерпан лимит провайдера» (M:575 `pauseWhat`) — делаю с именем: новый orchPause_provider_limit_what «Исчерпан лимит {provider}» | Продолжить → resume | — (автопродолжения по времени нет) | — | С | Ж | RESUMABLE (environment_error) |
| provider_limit_at | сейчас тот же orchHeadline_provider_limit → НЕ уникален (Н3). Новый orchPause_provider_limit_at_what «Лимит {provider} исчерпан до {at}» | Продолжить → resume | — | — | С | Ж | то же |
| model_unsupported | сейчас orchHeadline_model_unsupported без модели; новый orchPause_model_unsupported_what «{provider} не поддерживает модель {model}» (todo orchNext_model_unsupported уже есть, M:588) | Продолжить → resume | — | — | С | Ж | то же |
| prepare_failed (needs_user_action/external_failure + `progress.prepare.failed`, P:79) | orchPause_prepare_failed_what уже есть (I:2150) | Продолжить → resume (повторит подготовку). Подпись главной: сейчас берётся из набора причины («Готово, продолжить» у needs_user_action) — вынести новый orchPause_prepare_failed_button; рекомендую «Повторить подготовку» (в SPEC «Продолжить»; на решение владельца) | Остановить и изменить в настройках проекта: stop + (лок.) «Настройки проекта» (правки действуют только с новой цели, orchNext_prepare_failed) | — | С | Ж | RESUMABLE |
| newer_version (`view.newer`) | новый orchPause_newer_version_what «Запуск создан более новой версией» (есть orchReadOnly «Только просмотр» I:993 — не заголовок) | команд нет | Отпустить связь (releaseNewer, `ReleaseNewerLink` R:1269), Скопировать id (лок.) | подтверждение уже есть (orchReleaseDo) | — | Н | runActions M:73 `[]`; main нет |

### 1.3 5 вариантов внутри причин

| Вариант | Заголовок | Главная → команда | Вторичные | Опасные | Уточнить | Тон | Допуск |
|---|---|---|---|---|---|---|---|
| awaiting_checks_none (`view.proposal.checks.length===0`, M:67/`pauseSet`) | orchPause_awaiting_checks_none_what «Лид не нашёл команд проверки» (есть, I:2130) | Сохранить команды → checks.decide edit (строки 1–16, без повторов; кнопка выключена при 0 строк: edit с пустым списком main пропускает и это то же, что accept) | Продолжить без проверок → checks.decide accept (текстовая кнопка третьего ранга + подтверждение; по правилу Р «принять без проверок» опасная) | Продолжить без проверок | — | Ж | 2703–2713: accept при `cmd.checks===undefined` (2711); proposed=[] ⇒ запуск без проверок (decideChecks S:1546–1553). Макет подтверждён |
| sandbox_unsupported (не macOS: `pauseSet`, M:~600) | orchPause_sandbox_unsupported_what «Здесь нет песочницы для проверок» (есть, I:2098) | Остановить запуск → stop (STOP_ONLY) | — | сама главная | — | Ж | STOP_ONLY |
| mcp_present (needs_user_action, `PauseCause.mcp`, P:62) | новый orchPause_mcp_present_what «У {cli} включены MCP-серверы» (сейчас what общий с needs_user_action → не уникален); why = orchError_mcp_present | Продолжить → resume | — | — | С | Ж | RESUMABLE |
| mcp_unchecked | новый orchPause_mcp_unchecked_what «Не удалось проверить MCP-серверы {cli}» | Продолжить → resume | — | — | С | Ж | RESUMABLE |
| push_protected (needs_user_action на шаге push; нужен новый разбор, §0 п.3г) | новый orchPause_push_protected_what «Push в защищённую ветку не выполнен» + ветка в why (orchError_push_protected {name}) | Остановить запуск → stop (решение макета: «Продолжить» не поможет; main допускает resume, но он вернёт ту же паузу) | Настройки проекта (лок.) | сама главная (заливка danger — исключение Р9 расширить: «главная = stop» и для push_protected; зафиксировать в спеке) | — | Ж | stop 2643; resume допустим, но не предлагается |

Состояния без паузы (SPEC §4.6): working/preparing — главная «Пауза после хода» живёт в подвале (pause_after_turn 2638), в зоне: «Работает: {кто}»; pausing — «Продолжить работу» (keep_running); stopping — «Останавливается», кнопок нет;
completed — «Забрать результат»/«Новая цель» (`take`, `onNewGoal` — как сейчас, R:1779–1785) и строка «итога» (Н5, уже в R3a); failed/stopped/halted — причина словами + «Открыть журнал» (лок., Ход работы · Журнал);
permission во время хода (view.permission) — `PermissionBlock` без изменений внутри зоны (кнопки уже sticky, CSS:1268), для kind=plan Уточнить скрыто.

### 1.4 Расхождения макета (v3) с apply() и кодом

Д1. «Вернуться к контрольной точке: скрыто в режиме «в папке проекта»» — main отказывает и в worktree (`inPlace`, workspace.ts:67; S:2686). UI сейчас прячет только project (R:1713).
    Правка: показывать только при `workMode==="copy"`; в модели допуска это `ctx.inPlace`.
Д2. SPEC/spec-vs-code §1.3 п.17: «environment_error: step запрещён» — неверно, step допускается (RESUMABLE). Подмножество кнопок ок.
Д3. SPEC §4.5: Уточнить скрыто «при запросе плана (permission kind=plan)» — main это не отказывает (отказы S:2665–2666: журнал не ACTIVE, 6 причин, `planProposalWaits`).
    Это решение дизайна (подмножество), не допуск. Фактически отказ при ожидающем предложении плана (`proposalWaits`) сейчас — «выключено с подсказкой» (M:80 `proposalBlocks`), макет говорит «скрыто». Оставляю «выключено с подсказкой» только для limit_reached/раскрытого поля; для coverage_lost скрыто.
Д4. SPEC §4.5: для awaiting_answer Уточнить не показано, main допускает; для STOP_ONLY и push_protected макет молчит — скрываю как бессмысленное (подмножество).
Д5. limit_reached: main отклоняет `runMs`, если `goal.createdAt + value <= clock()` (S:2678) как `invalid_command` («Команда заполнена некорректно») — в SPEC этого нет; поле не проверяет. Правка: клиентская проверка «больше уже прошедшего времени» и слово в подсказке.
Д6. awaiting_person_decision: «Повтор» допустим только если у пункта есть кандидат-находка (`item.candidates`) и она закрыта, с изменёнными файлами (S:2821–2831) — макет «Новый дефект / Повтор» без этого условия. Остаётся как в `PersonDecide` (R:2120+), зона его не меняет.
Д7. awaiting_checks_none: макет рисует «Продолжить без проверок» обычной текстовой кнопкой; по правилу R3b п.1 это опасная (принимает результат без проверок) → контурная danger с подтверждением. Допуск подтверждён (см. таблицу).
Д8. push_protected: макет «Главная Остановить запуск» при том, что main допускает resume; это выбор UI. Исключение Р9 в спеке сформулировано для STOP_ONLY — добавить к нему push_protected либо считать главной «Настройки проекта» (лок.)? Рекомендую stop (Р9, §5).
Д9. spec-vs-code §1.3 п.19 тон: stage_done Ж по PAUSES, у макета Н не было — в SPEC v3 уже Ж (совпадает). newer_version тона в PAUSES нет — в тесте задать Н явно.
Д10. «push_not_confirmed», «push_option_field» (SPEC §4.4) — не паузы, зоне не принадлежат (R4).
Д11. outcome_unknown: SPEC указывает «скрыто в режиме в папке проекта», а подпись кнопки в I:517 «Вернуть к последнему checkpoint» и подтверждение «recovery-снимок» — англицизмы (Н11).

## 2. Допуск main как чистая функция (для теста «каждая команда зоны допускается main»)

Сейчас: `apply` замкнута в `createOrchestrationService` (S:741+), зависит от `state()`, `ws`, `goal`, журнала; из теста её вызвать без полного сервиса нельзя (существующие тесты
orchestration-service*.mjs поднимают сервис с фейковыми CLI — тяжело гонять 37 фикстур). Тест T читает наборы регулярками из исходника S (T:62–67) — хрупко.

Решение (ponytail: одна функция, один файл):

1. Новый `src/shared/orchestrationAdmission.ts` (shared — потому что его импортируют и main, и renderer, как уже P):
   - экспорт `RESUMABLE`, `STEP_ONLY`, `STOP_ONLY`, `ACTIVE`, `CLARIFY_BLOCKED` (6 причин из S:2665), `FINDING_PAUSES`;
   - `export function admits(kind: RunCommand["kind"] | "recover.reset" | ..., c: { status: string; reason: string; version: 1 | 2; proposalWaits: boolean; inPlace: boolean }): string | null`
     — null = допускается, иначе код отказа (`invalid_state`). Только то, что решают status/reason/version/proposalWaits/inPlace — ровно проверки S:2638–2700 + 2703/2714/2729 (status/reason часть).
     Данные-зависимые условия остаются в apply (есть ли открытый вопрос, предложение команд, отказанная проверка, неразрешённые ходы, tree/commit): их в зоне гарантирует
     само наличие полей view (`view.question`/`proposal`/`refused`/`confirm`/`decisions`), а фикстуры теста их заполняют.
   - apply: `const gate = admits(cmd.kind, ctx); if (gate) return reject(gate)` — до каждого case, inline-проверки status/reason из case удаляются (поведение то же; цель — единственный источник).
2. M:24–27 удаляет копии наборов и импортирует из shared; `runActions` (M:76–103) остаётся, но строится на тех же константах.
3. Тест `tests/orchestration-action-zone.test.mjs` (новый): для каждого из 37 наборов строит фикстуру view (расширить `view()` из T:21: proposal для checks, refused, confirm, decisions, question, `workMode`), берёт `actionZone(view, entries, onMac).commands`
   (список kind всех кнопок, включая вторичные и подвал) и проверяет `admits(kind, ctx) === null`; отдельно raise_limit→resume второй шаг на `user_request`.
   Команда permission проверяется иначе: кнопка ⇔ опция в `view.permission.options` (S:2754).
4. Страховка от рассинхрона apply/admits: 3–4 существующих сервис-теста (orchestration-service.test.mjs, -journal-v2, -person-decisions, -service-races) гоняются целиком — не изменить поведение; плюс один интеграционный тест «apply отказывает ровно там, где admits» на 3 паузах
   (user_request, lead_modified_tree, journal_corrupt) через существующий harness (искать в orchestration-service.test.mjs хелпер паузы).
5. Остаётся регулярочный тест T «главная принимается main» — заменяется вызовом `admits`; регулярки на `gate[...]` для answer/recover/…/plan_decide убираются, их место — fixtures.

Риск: apply на 3000-строчном сервисе, поведение 14 команд; смягчение — рефактор только status/reason-часть, мгновенный `npm test` (2190 тестов).

## 3. Что заменяем и как

### 3.1 Текущая разметка (R:1588–1746)

Одна `<section ref={summary} className="orch-summary orch-summary--{headline} orch-panel__status--{status}">` (прокручивается сама, CSS:1168):
`orch-summary__task` → `orch-summary__headline` (what + why из `pauseText`, M:620) → `orch-ended` → `view.newer` блок → `orch-summary__next` («Что делать:» = `pause.todo`) →
«Открыть план» → PermissionBlock → вопрос/ответ → ChecksDecision / CheckRefused / FinishConfirm / PersonDecide / PlanProposal / RaiseLimit → блок recover → строка кнопок `data-orch-actions`
→ `orch-summary__who` → `orch-board` (14 строк справочного: режим, этап, проверки, доступ, модели, лимиты) → доступ-предупреждение → `where` → take → «Новая цель» → `orchSending` → pending-повторы → `notice`.
Clarify — внизу вкладки Итог (R:1957–1965, в секции «Параметры»).

### 3.2 Что заменить (в R/ActionZone)

Новый компонент `ActionZone` (новый файл `ActionZone.tsx` рядом, импорт в R; чтобы не раздувать R) принимает `ZoneModel` (чистая функция `actionZone(view, entries, onMac)` в M, §4 часть A) и рендерит:
  [ярлык тона «Ждёт вас»/«Пауза» (колокольчик по SPEC §1) · заголовок (один раз, `data-orch-what`) · why · «Что делать» (`data-orch-next`)] → тело (формы: те же ChecksDecision, CheckRefused, FinishConfirm, PersonDecide, PlanProposal, RaiseLimit, вопрос — переносятся без смены логики)
  → ряд главной + вторичных (одна `orch-primary`, `data-orch-primary`) → свёрнутое «Уточнить» (кнопка → поле + «Отправить»; `data-orch-clarify`) → уведомление.
Подвал панели `.orch-panel__foot` (вне прокрутки, под вкладками): «Пауза после хода» (running), «Остановить запуск» контурная (Н2), локальные «Скопировать id/журнал».
Справочное (`orch-board`, `who`, `where`, access-warn, `take`, personDecisionsLine) переезжает в «Итог» (секция «Параметры»/«Факты результата»); `take` и «Новая цель» у завершённого остаются в зоне.
Высота: зона — `max-height: min(46vh, …)`, прокручивается тело формы, а ряд кнопок sticky внизу зоны (как уже сделано для permission, CSS:1268); цель — не более ~30% высоты узкой панели при паузе без формы.
Класс тона: `orch-zone--waiting` (свечение `--status-waiting`) и `orch-zone--calm`; цвет/статус тройкой глиф+цвет+подпись (SPEC §1).
Вкладка Итог больше не содержит Уточнить.

### 3.3 Отказ main и сбой связи (SPEC §4.6, spec R3b п.4)

Сейчас (R:1548–1560 `deliver`): transport → `notice = orchTransportError` (текст «Нет связи с приложением…»), reject/refused → `outcomeText` (useOrchestration.ts:44) → тот же `dialog-error role="alert"`; оба выглядят одинаково.
Правка: два разных блока в зоне.
- Отказ main (`outcome.kind` rejected/refused): `dialog-error` + слова `orchError_<code>` (`outcomeText` уже подставляет; stale_revision → refreshRun + orchStaleRefreshed, как сейчас). Добавить недостающее: `orchError_not_admitted` (ru/en; Refused из S:263 приходит как rejected code `not_admitted`).
  Проверить покрытие всех кодов, которые apply возвращает (S:2633–2760 + personDecide/planDecide): stale_revision, invalid_state, invalid_command, unknown_question, confirm_required, unknown_request, invalid_form, profile_failed, store_failed, command_failed, not_admitted → тест на наличие ключей.
- Сбой связи (`transport`): нейтральный баннер `data-orch-offline` «Нет связи с процессом запуска» + «Повторить» (`deliver(pending)`, тот же commandId, `orch.commands`) — без красного, пока main не ответил. До ответа — «Отправляю…» (`orchSending`, есть). Существующий список `unknown` (R:1771) объединить с баннером.

### 3.4 Поле лимита (Н7) и «Остановить запуск» (Н2)

- Лимит: в `RaiseLimit` (R:1384–1415) таблица «использовано/сейчас» уже есть; в зоне добавить у поля `<input>` подпись «сейчас {N} {единица}» (`nowOf(kind)`) и валидацию «больше {N}» (есть, `data-orch-limit-invalid`); для runMs дополнительно «больше уже прошедшего» (Д5); предложение значения ×1,5 оставить.
- «Остановить запуск»: класс `orch-stop` (контурная `--danger-fg`, CSS:1084 уже есть) переезжает в подвал; в зоне `orch-danger` (заливка) остаётся только у STOP_ONLY/push_protected. Подпись «Остановить запуск» (orchStop сейчас «Стоп», I:509 — тест T:97–105 ждёт «Стоп»: поправить).

### 3.5 Тексты sandbox (Н4)

`orchPause_sandbox_unavailable_*` (mac, самопроверка не прошла) и `_unsupported` (не mac) — в I:2094–2101 уже по коду и без «запустите на macOS». Остаётся: убрать «вкладке «Лог»» (→ «Ход работы · Журнал»), проверить на жаргон («самопроверка» → «проверка запуска песочницы»), тест T:176–184 остаётся.

### 3.6 Словарь (Н11) — таблица, идёт в «Как сделано R3b»

рабочая копия (не worktree/clone/copy; «отдельная копия» только для режима copy) · ход (не turn) · этап (не stage, не раунд) · проверки / команды проверки (не checks, не CI) · контрольная точка (не checkpoint) · снимок восстановления (не recovery-снимок) ·
запуск (не run) · связь · песочница · лид / исполнитель / проверяющий · «Ход работы» (вкладка) / «Журнал» (режим). Английские вставки к переводу: «Вернуть к последнему checkpoint», «recovery-снимок» (I:517–518), push и QA — оставить как термины интерфейса (так в SPEC), MCP/CLI/Claude Code/Codex — имена.
Тест: сканер по ru-ключам зоны (`orchPause_*`, `orchError_*` подмножества, новые) на `\b(checkpoint|turn|stage|worktree|run)\b` без списка исключений.

### 3.7 Устаревшие названия вкладок в текстах пауз (после R3a)

I:2040 step_done («вкладке «Действия»») → «Ход работы · Лента»; I:2056 outcome_unknown OK («Изменения»); I:2060 invalid_report («вкладку «Лог»»), I:2064 protocol_error («Лог»), I:2076 loop_suspected («поле «Уточнить» внизу вкладки «Обзор»» → «поле «Уточнить» ниже»), I:2084 environment_error («Лог»), I:2096 sandbox_unavailable («Лог»), I:2112 needs_user_action («Действия») — ru и en. Тест: ни один ключ зоны не содержит «Лог|Действия|Обзор|История» как вкладку.

## 4. Нарезка на 3 части (файлы не пересекаются)

### Часть A — модель зоны и допуск (чистая логика, без разметки)
Файлы: новый src/shared/orchestrationAdmission.ts; S (только status/reason-гейты apply и импорты наборов, S:268–274, 2638–2745); P (+ разбор push_protected из `external_action` ленты, ~15 строк, и `PauseCause.kind === "push"`);
M (удалить копии наборов M:24–27, новая `actionZone(view, entries, onMac)` → `ZoneModel { tone, title, why, todo, primary:{action,label,danger}, secondary[], dangerous[], clarify:"hidden"|"collapsed"|"open"|"disabled", footer[], variant }`, поправить `pauseWhat`/`pauseText` для новых заголовков провайдер/MCP/push/newer);
I (все ключи: новые what для provider_limit(_at), model_unsupported, mcp_present/unchecked, push_protected, newer_version, awaiting_checks_decision, orchPause_prepare_failed_button, orchError_not_admitted; правка текстов §3.6/§3.7; ru и en); useOrchestration.ts не трогаю.
Тесты: tests/orchestration-pause-texts.test.mjs (расширить: уникальность заголовков по 37 наборам в ru и en — сейчас SETS = 27+2, T:15; ровно одна главная и она не danger, кроме STOP_ONLY и push_protected; тон по PAUSES; клик-набор для 11 спорных причин равен spec-vs-code §1.3 п.1–5,7,8,11,12,14–16) и новый tests/orchestration-action-zone.test.mjs (допуск 37 фикстур, §2; отсутствие вкладок-старых названий; словарь; ключи orchError_ для всех кодов apply). Старые тесты, которые поломает смена подписи «Стоп»/«Остановить запуск», — правки в той же части.
Прогон: `npm test` (orchestration-*), typecheck, lint:ci.
Риски: apply-рефактор (§2); смена `pauseWhat` ломает тесты, читающие тексты (T:90–150; tests/orchestration-renderer-model.test.mjs); `provider_limit_at` с `{at}` — слова CLI, не форматированное время, склеивать осторожно (M:550–563 `resetTime`).
Выход для B: `ZoneModel` + ключи i18n. Порядок: A первой.

### Часть B — разметка, CSS, поведение (после A)
Файлы: R (вынести зону, подвал, перенести блоки из R:1588–1746 и Уточнить R:1957–1965), новый ActionZone.tsx, CSS (`.orch-summary*` → `.orch-zone*`, `.orch-panel__foot`, тон, sticky ряд, высота; в 4 темах, токены `--status-waiting`, `--danger-fg`), useAgentCanvasUi.ts не трогаю.
Тесты: render-тесты в T/orchestration-panel-tabs.test.mjs (`renderToStaticMarkup`, тот же `panelOf`): для каждого набора — один заголовок, один `data-orch-primary`, Стоп в подвале и вне зоны, Уточнить скрыто/свёрнуто по модели, offline-баннер ≠ error; поле лимита с «сейчас N»; контраст `contrast-check` (757/0 сейчас) на новых цветах зоны; typecheck.
Smoke (обновить селекторы, не писать новые): smoke-v2-checks-ui (4 обращения к `data-orch-actions/primary`), smoke-orchestration-ui, smoke-native-ui, smoke-a0-newer-ui, smoke-board-ui, smoke-take-result-ui, smoke-activity-ui; e2e-orchestration.mjs, real-a-gate-series.mjs, real-ui-series.mjs, orchestration-app-kit.mjs (селекторы `data-orch-*` — найти grep'ом `data-orch-actions|data-orch-primary|orch-summary|data-orch-next|data-orch-what`).
Риски: самые большие — (1) высота и прокрутка зоны с большими формами (PersonDecide, PlanProposal): sticky-ряд внутри прокручиваемого тела, проверить при `--ui-scale` 1.25 и ширине 400px; (2) фокус: сейчас на открытии фокусируется `summary`/`answerBox` (R:1503–1510, 1520–1526) — перенести на зону и сохранить; (3) `data-orch-*` атрибуты используют smoke и реальные серии — сохранить имена, чтобы не править десятки селекторов; (4) вырезание `orch-board` из зоны — вкладочный тест R3a (orchestration-panel-tabs) проверяет его в сводке: сверить.

### Часть C — кадры, smoke-прогон, документы (после B)
Файлы: новый scripts/shots-r3b.mjs (по образцу scripts/shots-r3a.mjs, `--out` обязателен — память «smoke пишет в docs»), docs/ux-audit/2026-11-10/r3b/*.jpg, docs/ux-audit/2026-11-10/stage-r-redesign.md §10 «Как сделано R3b» (словарь §3.6, расхождения §1.4, отложенное §5), docs/ROADMAP.md, docs/CURRENT.md, docs/DECISIONS.md (Р9 + push_protected; допуск вынесен в shared).
Кадры: 18 состояний макета 07 × sand и bay. Достижимые моками CLI (JOURNAL_V2): working, plan_review, awaiting_answer, awaiting_checks_decision (+none), limit_reached (малые лимиты), completed, user_request (pause_after_turn), failed; остальные 8–9 (outcome_unknown, check_needs_permissions, finish_confirmation, person_decision, coverage_lost, lead_modified_tree, needs_user_action mcp, finish_unconfirmed) — через `fixture view` без модели:
собрать RunPanel esbuild-бандлом как в T (bundle()) → `renderToStaticMarkup` → static HTML + app.css + токены → снимок CDP из kit (`launch()` + `Page.captureScreenshot` на data:/file:). Это отдельный риск (стили без живого стора) — если не выйдет, снимать сидированием журнала на диске (как `JOURNAL_V2` kit).
Прогон: все smoke из R3a (orchestration-ui, take-result-ui, activity-ui, board-f3-ui, board-f4-ui) + v2-checks-ui, native-ui, a0-newer-ui; `npm test`, typecheck, lint:ci, contrast-check, build. Electron запускать только в этой части.
Риски: кадры требуют живой Electron и моки; не оставлять процессов (`launch` закрывать); скрипт писать только в --out.

## 5. Что отложить в R4

- Тосты («ждёт вас» до действия, до 3, SPEC §9) — зона не заменяет тост; в R3b тостов нет.
- Баннеры отказов старта push_not_confirmed, push_option_field (SPEC §4.4) — доска/настройки автопилота.
- «Открыть терминал в папке» у needs_user_action, «Проверить обновления» у newer_version — нет команды в main / приложении (spec-vs-code §1.3 п.19, 25).
- Светлые темы (Бумага, Иней) для цвета зоны/тона: в R3b только токены, проверка контраста на sand/bay; светлые — вместе с темами в R4.
- Внутренний редизайн форм PersonDecide/PlanProposal/FinishConfirm (макет рисует только их шапку и главную): в R3b переносятся как есть с новыми классами.
- «Отправляю…» с прогрессом и конфигурируемый таймаут команды — только уже существующий `orchSending`.
- Переключатель живых запусков над зоной — сделан в R3a.

## 6. Открытые вопросы владельцу (по умолчанию беру рекомендацию)

1. Главная у prepare_failed: «Повторить подготовку» (рекомендую) или «Продолжить» (SPEC).
2. push_protected: главная «Остановить запуск» с заливкой danger (рекомендую, продолжает Р9) — нужно расширить текст исключения в спеке §3 R3b п.1.
3. «Продолжить без проверок» (awaiting_checks_none): контурная danger с подтверждением вместо текстовой кнопки макета.

**Решено (2026-11-11, по поручению владельца решать самому), §6:**
1. Главная у prepare_failed — «Повторить подготовку» (команда resume).
2. push_protected — по правилу Р9: main принимает только stop, главная — «Остановить запуск» (тот же вид, что у STOP_ONLY).
   Текст исключения в спеке §3 R3b п.1 расширяется на push_protected.
3. «Продолжить без проверок» (awaiting_checks_none, checks.decide accept) — опасная: контурная `--danger-fg` с
   подтверждением; «Сохранить команды» выключена при пустом списке.
