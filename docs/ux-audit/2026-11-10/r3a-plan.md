# R3a — панель запуска: три вкладки, только чтение. План реализации

Пути от ~/dev/raoden-loom. Ветка main-based `feat/r3a-run-panel-tabs`. Код не правился. R = `src/renderer/src/features/orchestration/RunPanel.tsx`, U = `useAgentCanvasUi.ts`, K = `scripts/orchestration-app-kit.mjs`.
Макет v3 = worktree wt-design `redesign/SPEC.md` §5, preview 13-run-panel-tabs, 07-run-panel-17-completed.

## 0. Главное

1. Всё содержимое 8 вкладок лежит в одном компоненте `CurrentRunPanel` (R:1398–1919), вкладки — условные блоки в `panel__body` (R:1762–1915). Перенос = перестановка блоков + новый ключ режима, не переписывание компонентов. `RunSummary` (R:813), `RunDocs` (R:1117), `ActivityList` (R:384), `ChangesTab` (R:450), `ReviewExport` (R:1004), `SessionEnvironment` (R:653), `Differences` (R:95) остаются как есть.
2. Закреплённая «шапка-зона» над вкладками (R:1588–1746, класс `orch-summary`) уже существует и содержит ВСЮ зону действия (кнопки, ответ, PermissionBlock, RaiseLimit, recover, TakeResult). Её не трогаем: это R3b. Исключение: три кнопки в ней, которые вызывают `onView({tab})` (R:1598, 1611, 1726, 1729).
3. Переключателя запусков в шапке панели сейчас нет вообще: панель всегда показывает `link.runIds.at(-1)` (OrchestrationDialogs.tsx:590), а выбор из до 4 живых запусков живёт только в кнопке чипа на холсте (`picked`, AgentScene.tsx:77, 278–285) и панель его игнорирует. Пункт 3 спеки R3a — новое поведение, а не перенос.
4. Н5 по факту уже наполовину решён кодом: у `completed` поле «цель принята» всегда «да» (`resultFacts.goalAccepted`, runModel.ts:735), «нет» там быть не может. Остаётся «Есть изменения: нет/неизвестно» рядом с шагом «откройте вкладку Изменения» и итоговая фраза.

## 1. Карта «старая вкладка/блок → новая вкладка/режим»

Новые ключи: `PanelTab = "summary" | "work" | "changes"`; в `PanelState` (U:16) новые поля `mode: "feed" | "journal" | "records"` (для work) и `section?: "plan" | "result" | "overview"` (якорь внутри Итога, нужен для открытий «План/Результат» с доски). Атрибуты DOM: `data-orch-tab="summary|work|changes"`, `data-orch-mode="feed|journal|records"`, `data-orch-panel-tab`, `data-orch-panel-mode`, `data-orch-section="..."`.

| Старая | Блок (path:line) | Куда |
|---|---|---|
| plan | `RunDocs kind="plan"` R:1763–1766, R:1117 (версии v1…vN, вопрос лида, декомпозиция, «На холст» — RunDocView R:1028) | Итог, секция «План» (якорь `plan`) |
| result | `RunDocs kind="result"` R:1763–1766 (+`useCreatedDocs` R:1073 с повтором, «На холст») | Итог, секция «Результат» (якорь `result`) |
| summary | баннер ошибки чтения журнала R:1768–1776; `RunSummary` R:813–1002 (цель, итог, `Conditions` R:710, `Findings` R:759 с решениями `onFinding` R:1779–1780, этапы, исполнитель, лид, проверки, замечания, где, завершение, дальше) | Итог, верх: сводка |
| overview: факты результата | R:1785–1817 (`factLines` runModel.ts:743, finish-шаги commit/push/QA с хэшем и `observed`, «где изменения», `ReviewExport` R:1816) | Итог, «Факты результата» |
| overview: участники | R:1818–1846 (роль, протокол, доступ, модель, фаза, «Наблюдать» R:1838) | Итог, «Участники»; кнопка «Наблюдать» ведёт в Ход работы / Лента + роль |
| overview: окружение, различия | `SessionEnvironment` R:1847, `Differences` R:1848 | Итог, «Время, лимиты, окружение» |
| overview: время и лимиты | R:1849–1857 | Итог, там же |
| overview: этапы плана, проверки | R:1858–1879 | Итог, «План» (этапы) и «Проверки»; дубль с `RunSummary` «этапы/проверки» (см. §3.3) |
| overview: «Уточнить» (clarify) | R:1880–1886, `has("clarify")` | Итог, внизу секции «Параметры» (R3a: остаётся как есть, переезд в зону действия — R3b) |
| activity | `ActivityList` R:1888–1892, `roleFilter` R:1562, `silenceFor` R:1553, `FEED_KINDS` R:294 | Ход работы, режим «Лента» |
| log | `ActivityList` R:1893–1896, `logFilter` R:1565, `LOG_KINDS` R:293 | Ход работы, режим «Журнал» |
| history | R:1898–1915 (`lines` R:1419, `lineText` R:181, `LineDetails` R:233) | Ход работы, режим «Записи» |
| переключатель ролей | R:1753–1761 (`data-orch-role`, показывается только на activity/log) | Ход работы, виден в режимах Лента/Журнал (в «Записях» не нужен: он не фильтрует) |
| changes | `ChangesTab` R:1897 (скрыта при `view.newer`) | Изменения, без правок |
| tabs список | R:1560 (`view.newer` убирает changes) | `["summary","work"]` при newer, иначе все три |
| wide | R:1568 (`summary/plan/result`) | `tab === "summary"` |
| «ended» баннер | R:1595–1600 (`panel.tab !== summary/result` → `onView({tab:"result"})`) и сброс R:1431 | `onView({tab:"summary"})`; показывать, когда tab !== summary |
| «Открыть план» | R:1610–1612 (`data-orch-open-plan`) | `onView({tab:"summary", section:"plan"})`; условие `tab !== summary || section не plan` |
| «Посмотреть изменения», TakeResult.onChanges | R:1726, R:1729 | без изменений: `{tab:"changes"}` |
| NewerRunPanel (не совместимая версия) | R:1263–1318: цель, цепочка, fallback (R:1286), «Отпустить связь», записи | остаётся одним экраном; текст fallback — «Показаны только цель и записи» (макет); без вкладок |

Список спеки «Итог» — всё покрыто: факты (commit/push/QA) ✓, план по версиям + декомпозиция ✓ (RunDocs plan), решения по находкам ✓ (RunSummary/Findings), участники/модели/доступ/«Наблюдать» ✓, время/лимиты/окружение ✓, выгрузка ревью ✓, документ «Результат» + созданные файлы + «На холст» ✓. Дополнительно сохранить: баннер ошибки журнала с «Повторить» (R:1768), поле «Уточнить», «Различия» (Differences), `data-orch-expand` (R:1573, ширина «во всё окно»), `PermissionBlock` и др. остаются в закреплённой зоне.

Рекомендованная вёрстка Итога: секции по порядку макета — сводка (RunSummary), «Факты результата», «План», «Решения по находкам» (уже внутри RunSummary/Findings, отдельно не выносить), «Участники», «Время, лимиты, окружение», «Результат». Секции «План» и «Результат» (тяжёлые: `RunDocs` грузит тексты и `useCreatedDocs`) монтировать лениво в `<details>`: закрыты по умолчанию, открыты якорем `section`. Иначе каждое открытие панели начнёт читать created docs и тексты планов, а smoke-activity проверяет, что открытие вкладок не запускает процессы CLI (smoke-activity-ui.mjs:208–219).

## 2. Все места openPanel({tab}) / вкладок

### 2.1 Код renderer (меняем)

| Где | Что сейчас | Новое |
|---|---|---|
| U:12 | `PanelTab` 8 ключей | 3 ключа + `PanelMode`; `PanelState.mode`, `section` |
| U:70 (`openPanel` по умолчанию) | `"overview"` | `summary` |
| U:70 | `openPanel(linkId,{tab,role})` | добавить `mode?`, `section?`; role по умолчанию как сейчас |
| U:79 (`openRun`) | summary для завершённого, overview для идущего | оба → `summary` (различие исчезает; для идущего — `summary`, а не work, чтобы действие/Итог были видны) |
| U:90 (`openRunById(runId, tab?)`) | то же | `tab?: PanelTab`; дефолт `summary` |
| U:93 | `setPanelView({tab,role})` | + `mode`, `section` |
| AgentScene.tsx:210 | `onSummary` → `{tab:"summary"}` / `openRunById(...,"summary")` | остаётся `summary` (ключ тот же) |
| AgentScene.tsx:211 | `onObserve` → `{tab:"activity",role}` / `openRunById(id,"activity")` | `{tab:"work",mode:"feed",role}`; для `openRunById` нужен расширенный аргумент (роль и режим) |
| AgentScene.tsx:290 | «Наблюдать» на связи, `{tab:"activity", role}` | `{tab:"work",mode:"feed",role}` |
| BoardCard.tsx:312, 313 | `openRunById(runId,"plan")`, `"result"`; подписи `orchTab_plan/result` | `openRunById(runId,{tab:"summary",section:"plan"|"result"})`; подписи кнопок оставить «План»/«Результат» (ключи `orchTab_plan/result` НЕ удалять из i18n, или завести `boardOpenPlan/Result`) |
| WorkspaceCanvas.tsx:259–266 `openRunInWorkspace(runId, tab?)` | пробрасывает `PanelTab` | тип расширить до «вид панели»; вызовы без tab (L:290, 315) не меняются |
| OrchestrationDialogs.tsx:391, 598 | `openPanel(link.linkId)`, `onView={ui.setPanelView}` | без правок |
| OrchestrationDialogs.tsx:590–598 | панель всегда latest run | + выбор живого запуска (см. п. 3.4) |
| R:90 (импорт), 1171 (`onView` тип), 1431, 1560, 1568, 1595–1598, 1610–1611, 1688 (нет), 1726, 1729, 1749–1750, 1753, 1762–1898, 1838 | перечень внутри панели | переписать по §1 |
| i18n.ts: ru 1110–1114, 1701, 1871–1872; en 3466–3470, 4057, 4227–4228 | `orchTab_*` 8 пар | новые `orchTab_summary` (уже есть: «Итог»), `orchTab_work` «Ход работы», `orchTab_changes` (есть), `orchMode_feed/journal/records` «Лента/Журнал/Записи»; старые `orchTab_overview/activity/log/history/plan/result` оставить, пока на них есть ссылки (BoardCard) |
| styles/app.css:1194–1196 (`.orch-tabs, .orch-roles`), 1219 (`data-orch-body="activity"/"log"` → overflow hidden), 1339 (`--wide`) | | `data-orch-body` теперь `summary/work:feed/...`; селектор 1219 переписать на `[data-orch-body="work"][data-orch-mode="feed|journal"]`; стили сегмента режимов по `.seg-wrap/.seg` из components-reference.css:35–37 |

### 2.2 Smoke и скрипты

Единая точка: `K:334` `openTab(app, tab)` кликает `[data-orch-tab=…]`. Решение: `openTab` принимает старые ключи и сам переводит (`LEGACY = {plan:["summary","plan"], result:["summary","result"], summary:["summary"], overview:["summary","overview"], activity:["work","feed"], log:["work","journal"], history:["work","records"], changes:["changes"]}`): клик по вкладке, затем по `[data-orch-mode]`, для якоря — раскрыть `[data-orch-section]`. Тогда вызовы ниже не правятся. Прямые селекторы правим руками.

| Файл:строка | Что | Как переводить |
|---|---|---|
| smoke-orchestration-ui.mjs:171,178,191,234,266,300 | `openTab(app,"history")` | через kit → work/records (ничего менять) |
| smoke-orchestration-ui.mjs:174,251 | `openTab(app,"overview")` | → summary; ассерты `.orch-checks li`, `.orch-plan li === 1` (L:168–170) должны выполняться внутри Итога: секция «План» с этапами не ленивая (см. §3.3) |
| smoke-orchestration-ui.mjs:187 | summary | как есть |
| smoke-orchestration-ui.mjs:207,230 | result | якорь result: `data-run-doc="result"` в DOM только в раскрытой секции |
| smoke-orchestration-ui.mjs:213 | plan | якорь plan |
| smoke-orchestration-ui.mjs:246–248 | `[data-orch-open-plan]` | селектор сохраняется, результат — Итог/план раскрыт |
| smoke-orchestration-ui.mjs:300+ (после reload) | history | kit |
| smoke-activity-ui.mjs:167 | `dataset.orchPanelTab === "overview"` | → `"summary"` |
| :168, :216 | `click [data-orch-tab="activity"]` | `openTab(app,"activity")` (через kit) |
| :173 | `orchPanelTab === "activity"` | → `"work"` и `orchPanelMode === "feed"` |
| :180 | `orchPanelTab === "result"` | → `"summary"` и раскрыта секция result (`data-orch-section="result"`) |
| :181, :275–276, :308–309, :320–321 | `[data-orch-tab=summary]` | не меняется |
| :213 | цикл `for tab of [overview, activity, log, history, changes, summary]` | через `openTab` kit (цикл по старым ключам остаётся валидным, проверяет «открытие всех не запускает CLI») |
| :217 | `[data-orch-role="lead"]` | не меняется (роль видна в feed) |
| :263 | `orchPanelTab === "summary"` | не меняется |
| smoke-board-ui.mjs:176 | `[data-orch-tab="result"][aria-selected="true"]` + `[data-run-doc="result"]` | → `[data-orch-tab="summary"][aria-selected="true"]` + `[data-orch-section="result"]` открыт |
| smoke-board-ui.mjs:180 | то же для plan | то же |
| smoke-board-e-ui.mjs:203,213 | `openTab(app,"plan")`; `[data-orch-body="plan"]` текст (L:204, 214) | `data-orch-body` = `summary`; искать текст в `[data-orch-section="plan"]` |
| smoke-board-f4-ui.mjs:222 | `click [data-orch-tab="overview"]` | → `summary` (или `openTab`); L:394–397 `data-orch-export` внутри панели — остаётся |
| smoke-board-f3-ui.mjs | вкладок не кликает | править не нужно, только прогнать |
| smoke-take-result-ui.mjs | вкладок не кликает; `data-orch-take-open`, `data-orch-view-changes`, `data-orch-taken` в закреплённой зоне | править не нужно; в R3a зону не трогаем, значит остаётся зелёным |
| smoke-v2-checks-ui.mjs:130,187,208,220,257,315,326,355,405 | `openTab(summary/overview)` | kit |
| smoke-autopilot-ui.mjs:213,279 + :253 (`[data-fact="changes"]`) | overview, activity; факт «да» | kit; факты остаются в Итоге |
| smoke-native-ui.mjs:174,180, :176–178 | activity, changes; `.orch-roles button` по индексу [1] = executor | kit; переключатель ролей НЕ расширять «Все» (индекс сдвинется) — см. §3 |
| e2e-orchestration.mjs:208,305; real-ui-series.mjs:309 | history | kit (e2e не запускаем в PR, но не ломаем) |
| ux-pause-gallery.mjs:98–100 | кликает по тексту «Действия» | заменить на `openTab(app,"activity")` |
| smoke-native-ui.mjs, smoke-orchestration-ui.mjs | скриншоты | добавить скриншот каждой вкладки и режима, режима newer |

### 2.3 Тесты node:test (renderToStaticMarkup, `panel:{tab:...}`)

| Файл:строка | Значение tab | Действие |
|---|---|---|
| orchestration-pause-cause.test.mjs:52–59, 82–89 | overview, summary, activity, history | RunPanel на входе нормализует legacy-ключи (§4, часть A) — тест проходит без правок; assert на лейбл ленты `orchAct_status` остаётся валидным (activity→work/feed), history → work/records |
| orchestration-pause-texts.test.mjs:152 | activity | то же |
| orchestration-person-decisions.test.mjs:562 | activity, role reviewer | то же |
| orchestration-copy-deps.test.mjs:272 | overview | → summary |
| orchestration-summary-decisions.test.mjs:167–171 | overview (по умолчанию) | → summary |
| orchestration-activity-review-fixes.test.mjs:145 | summary | как есть |
| orchestration-prepare-nothing.test.mjs:227–231 | параметр `tab` | проверить значения при правке |
| clipboard-copy-result.test.mjs | RunPanel без tab-ключей (проверить) | прогнать |
| ДОБАВИТЬ `tests/orchestration-panel-tabs.test.mjs` | | §4, часть A |

Обязательное условие спеки: «тест: каждый ключ старого PanelTab открывает новую вкладку и режим» — чистая функция `legacyView(key) → {tab, mode?, section?}` в новом `panelTabs.ts` + тест на таблицу 8 ключей, плюс рендер RunPanel с каждым legacy-ключом: в разметке один выбранный `data-orch-tab`, нужные `data-orch-mode/section`, и присутствует маркер старого контента (`data-orch-facts` для overview, `data-run-doc-…`/секция plan для plan, `[data-orch-feed]` для activity, `.orch-history` для history).

## 3. Расхождения спеки R3a и макета v3, рекомендации

| # | Спека R3a (stage-r) | Макет v3 | Рекомендация |
|---|---|---|---|
| 3.1 | Ширина 400px × `--ui-scale`, «режим широко как сейчас» | 420, у Итога «широко» 520 (SPEC §5); код: 420 и 760 (app.css:1141, 1339), без ui-scale | R3a: `calc(400px*var(--ui-scale))` и широко `calc(520px*var(--ui-scale))` по спеке и макету; 760 станет 520 (документы уже переносят строки). Решение владельца: широкий режим 520 vs прежние 760. По умолчанию 520. Проверить, что `orch-panel--full` и `data-orch-expand` (smoke-activity:204 ожидает ширину > 1300) не ломаются |
| 3.2 | Фильтр ролей «Лид / Исполнитель / Проверки» | «Все / Лид / Исполнитель / Проверки» + «Записи» тоже под фильтром | В R3a оставить три роли (smoke-native `.orch-roles button[1]`, `PanelRole` `reviewer` в activity). «Все» — в R4 или отдельным PR: это новый фильтр (`roleFilter` R:1562 без «все») |
| 3.3 | Итог — «бывшие Итог, План, Обзор, Результат» | Итог — одна прокрутка секций, План и Результат блоками | Дублей много (этапы: RunSummary «этапы» R:889 и overview «План» R:1858; проверки: RunSummary и overview R:1867; факты finish: R:1805 и RunSummary R:985; «где»: R:1759 и R:975 и закреплённая зона R:1710). В R3a НЕ дедуплицировать: тесты и smoke опираются на `.orch-plan li`, `.orch-checks li`, `[data-finish-step]`, `[data-fact]`. Дедупликация — R3b/R4 после ревью макета. Минимум: в Итоге порядок секций как в макете |
| 3.4 | Выбор из нескольких живых запусков — в шапке панели | ряд переключателей с id и точкой статуса, до 4 | Входит в R3a (пункт 3 спеки). Реализация: в `OrchestrationDialogs.tsx:590` взять `liveRuns` (вынести из AgentScene.tsx:78 в `runModel.ts`), показывать ряд `runp` (components-reference.css:144–147) при ≥2 живых; клик → `ui.setPanelView({runId})` (добавить `runId` в `setPanelView`); `RunPanel key` уже зависит от `ui.panel.runId`. Единое состояние выбора (сейчас `picked` в AgentScene) — поднять в `useAgentCanvasUi` либо оставить две независимые (проще, но расхождение чипа и панели; рекомендую поднять, 10 строк) |
| 3.5 | Только чтение newer: «все вкладки кроме Изменений», fallback отдельной подписью, «Отпустить связь» | + «Скопировать id» | Подпись fallback, вкладки уже так (R:1560). «Скопировать id» — мелочь (clipboard API есть), включить в R3a только если ≤15 строк; иначе R3b |
| 3.6 | Н5: одна фраза «что доказано / что нет» | в шапке карточки состояния и «Итог» с тремя галочками (Этапы / Проверки / Финальное ревью) и строками Коммит/Push/QA | В R3a: одна строка-фраза в начале Итога (§5). Три галочки макета — после согласования с фактами (проверки «3 из 3», финальное ревью) — это R3b (часть шапки состояния) |
| 3.7 | «Изменения» — как сейчас | счётчик «Изменения · 3» на вкладке | Считать уже умеем (`changedFiles`, R:1438/1490). Включить: бейдж на вкладке из существующего значения; при `null` не показывать (честность данных) |
| 3.8 | Выбор тональных/«ждёт вас» свечения, зона действия над вкладками | макет 07-run-panel-01…18 состояния | R3b целиком |
| 3.9 | Поле «Уточнить» | переезжает в зону действия (свёрнуто) | R3b (§3 R3b п.2). В R3a остаётся в Итоге внизу |
| 3.10 | `Кратко — только смены состояния` (был в spec-vs-code §2.7) | в v3 SPEC убрано | Не делаем |
| 3.11 | 18 состояний зоны действия, 27 причин | артборды 07-… | R3b |

## 4. Нарезка на части (непересекающиеся файлы)

### Часть A — модель вкладок и маршрутизация (sonnet)
Файлы: новый `features/orchestration/panelTabs.ts` (типы `PanelTab/PanelMode/PanelSection`, `legacyView`, `normalizePanel`); `useAgentCanvasUi.ts`; `AgentScene.tsx` (:210, 211, 290); `BoardCard.tsx` (:312–313); `WorkspaceCanvas.tsx` (:38, 259–266); `OrchestrationDialogs.tsx` (только пропсы RunPanel, :590–599; живые запуски); `runModel.ts` (вынос `liveRuns`). НЕ трогает RunPanel.tsx кроме импорта типа и первой строки `CurrentRunPanel` (`const panel = normalizePanel(props.panel)`), чтобы не конфликтовать с частью B: на время работы A–B договориться, что A правит только `RunPanel` L:90 и L:1398–1399.
Тесты: новый `tests/orchestration-panel-tabs.test.mjs` (таблица legacy→новый, нормализация в RunPanel, «каждый ключ открывает вкладку и режим»); поправить `orchestration-copy-deps`, `orchestration-summary-decisions`.
Smoke: `K:334` `openTab` с таблицей LEGACY (общий файл — править только здесь, часть C его не трогает).
Риски: `openRunById` с аргументом-объектом ломает вызовы с `string` (BoardCard, WorkspaceCanvas) — сохранить перегрузку; `focus`-счётчик (скролл к закреплённой зоне, R:1473–1481) должен срабатывать и на повторное открытие того же вида.

### Часть B — разметка панели (sonnet, один исполнитель на R + css + i18n)
Файлы: `RunPanel.tsx` (L:1398–1919 разметка вкладок, роли, сегмент режимов, ленивые секции plan/result, ширина, бейдж «Изменения · N», подпись fallback R:1285, `NewerRunPanel`); `styles/app.css` (1141, 1194–1196, 1219, 1339 + новые `.orch-seg`, `.orch-runs` для переключателя); `lib/i18n.ts` (ru+en: `orchTab_work`, `orchMode_*`, `orchSection_*`, fallback); `docs/UI_CONTRACT.md` + `UI_CONTRACT.ru.md` (строка про панель: «три вкладки… зона действия над вкладками» — по §6 stage-r, R3a).
Ряд переключателя запусков (3.4): компонент в RunPanel (шапка) + `app.css`.
Тесты: добавить в рендер-тесты проверки: нет `data-orch-tab` кроме 3, при newer — 2, секции Итога присутствуют, режимы work, `data-orch-body`; обновить ожидания `tests/orchestration-*.test.mjs`, что используют старые вкладки (см. §2.3), не меняя смысла ассертов.
Smoke: прогон `smoke:orchestration-ui` и скриншоты вкладок.
Риски: (1) порядок хуков в `CurrentRunPanel` — условные блоки без хуков; ленивая секция через `<details>` + `key` не должна менять число хуков; (2) `data-orch-body` используется в CSS и smoke-board-e; (3) прокрутка: `panel__body` overflow для feed/journal (app.css:1219) — теперь зависит от mode; (4) якорь `section` + `focus`: раскрыть и `scrollIntoView` один раз.
Часть A должна слиться первой (типы), B стартует после A или с интерфейсом из панельного модуля.

### Часть C — smoke, скрипты, документация этапа (sonnet)
Файлы: `scripts/smoke-activity-ui.mjs`, `smoke-board-ui.mjs`, `smoke-board-e-ui.mjs`, `smoke-board-f4-ui.mjs` (:222), `smoke-native-ui.mjs`, `smoke-orchestration-ui.mjs` (скриншоты всех вкладок, режимов и newer), `ux-pause-gallery.mjs`, `docs/ux-audit/2026-11-10/r3a/` (кадры), раздел «Как сделано» R3a в `stage-r-redesign.md` §10, `docs/ROADMAP.md`/`CURRENT.md`.
Не трогает `K` (в части A) и не трогает исходники renderer.
Smoke-кадры: сделать скрипт `scripts/shots-r3a.mjs` по образцу `shots-r2.mjs`; не писать в docs без `--out` (см. память smoke-link-gesture).
Новый кадр «newer»: нужен fixture run newer версии: в `tests/fixtures`/`orchestration-app-kit` искать готовый (smoke-orchestration-ui или `scripts` с newer; если нет — собрать journal с `minReaderVersion` выше, как в `tests/orchestration-a0-bridge.test.mjs:125–144`).
Прогон перед PR: `npm test`, `npm run typecheck`, `npm run build`, `npm run lint:ci` (≤267), `node scripts/contrast-check.mjs`, smoke: `smoke:orchestration-ui`, `smoke:take-result-ui`, `smoke:activity-ui`, `smoke-board-f3-ui`, `smoke-board-f4-ui` (+ `smoke-board-ui`, `smoke-board-e-ui`, `smoke-v2-checks-ui`, `smoke-autopilot-ui`, `smoke-native-ui` — они кликают вкладки). Ревью диффа агентом, до 3 кругов.

Общий порядок: A → B (допустимо параллельно, если A отдаёт `panelTabs.ts` первым коммитом) → C. Не более 3 исполнителей одновременно.

## 5. Н5 «Итог без противоречий»

Где поля сейчас:
- Значения и подписи: `factLines` runModel.ts:743–752; `resultFacts` runModel.ts:719–742 (`goalAccepted` для completed всегда true, runModel.ts:735; `changes` «no» превращается в «unknown» только при `lead_modified_tree`, runModel.ts:731).
- i18n: `orchFactAccepted` ru:1035 / en:3391 («Цель принята финальным ревью»), `orchFactChanges` ru:1036 / en:3392 («Есть изменения в рабочей копии»), значения `orchFactChanges_yes/no/unknown` ru:1170–1172 / en:3526–3528, `orchFactNotLoaded` ru:1927, `orchFactNotYet` ru:791.
- Рендер: список «Итог»/`orchResult` в Обзоре R:1785–1797 (`data-fact="changes"`, `data-fact="accepted"`, `data-orch-result` для v1) — после переноса остаётся в Итоге.
- Рядом противоречащие тексты: `orchNext_take_result` ru:1086 и `orchNext_review_in_place` ru:1087 («откройте вкладку Изменения… если изменения есть — закоммитьте») при `changes: нет` (тест уже защищает: tests/orchestration-summary-decisions.test.mjs:57–59 — фраза «если изменения есть»), плюс `orchSumOutcome_completed_unconfirmed` (runStatus.ts:479 — «Завершён», но финальное ревью не подтвердило) и `completed_no_checks`.
- Инварианты: tests/orchestration-summary-decisions.test.mjs:36–62 («Завершён» не рядом с «Цель принята: нет»; «Есть изменения: нет» не при lead_modified_tree).

Предложение (минимум, без новых данных):
1. Новая чистая функция `proofLine(locale, view, facts, outcome)` в `runModel.ts`, по таблице: `completed` + checks passed → «Лид принял цель, все проверки пройдены»; `completed_no_checks` → «Цель принята ревью, команды проверки не запускались — результат ничем не подтверждён»; `completed_unconfirmed` → «Запуск завершён, но финальное ревью цель не подтвердило»; `paused/stopped/failed` → «Цель не достигнута» + одна причина; `active` → «Итог предварительный». Ключи i18n ru+en `orchProof_*`, переиспользуя `orchSumOutcome_*` где совпадает.
2. Строка «Есть изменения: нет» при `status === "completed"` выводится с поясняющей фразой: `changes=no` → «изменений в рабочей копии нет (запуск ничего не менял); коммитить нечего»; `unknown` → «изменения ещё не посчитаны»; поле «Цель принята» при `completed` вообще не показывать (оно всегда «да» и повторяет заголовок), показывать только при нетерминальных статусах и `completed_unconfirmed`.
3. Фразу `proofLine` ставить первой строкой секции «Факты результата» в Итоге (`data-orch-proof`), `RunSummary` секцию «Итог» (R:861) не дублировать: там уже `orchSumOutcome_*`; либо заменить её на `proofLine`, оставив `data-sum-outcome` (его читает smoke-activity-ui.mjs:263).
4. Тест: расширить `orchestration-summary-decisions.test.mjs`: для каждого состояния из `STATES` (completed, no_checks, unconfirmed, nothing changed, stopped, paused, running) — `proofLine` присутствует, не противоречит `headlineText`, при completed+changes=no есть пояснение, нет голого «нет» без фразы (ru и en).
Три галочки макета (Этапы / Проверки / Финальное ревью) — R3b (шапка состояния).

## 6. Итоговые решения/вопросы владельцу

1. Ширина: 400 и 520 по спеке/макету вместо 420 и 760 (§3.1). Если «нет» — оставить 420/760 и просто добавить `* var(--ui-scale)`.
2. Переключатель живых запусков в шапке (§3.4): новое поведение, входит в R3a.
3. «Все» в фильтре ролей и три галочки Итога — вне R3a.
4. Дедупликацию этапов/проверок/finish в Итоге не делать в R3a.

**Решено (2026-11-11, по поручению владельца решать самому):** ширина по утверждённой спеке — обычная
`calc(400px * var(--ui-scale))`, «широко» как сейчас — 760px, тоже умноженные на `--ui-scale`. 520 из макета не берём:
спека утверждена, а smoke-activity опирается на широкий режим. Пункты 2–4 — по рекомендации плана.
