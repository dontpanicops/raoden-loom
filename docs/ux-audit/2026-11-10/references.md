# Референсы для редизайна Raoden Loom (дата сбора 2026-11-10)

Метки: [прочитано] — страницу открыл и прочитал (agent-reach read или WebFetch); [сниппет] — видел только отрывок в выдаче поиска; [не проверено] — ссылки нет или не открывал.
Ограничение: agent-reach упёрся в RATE_LIMITED (около часа) после ~25 запросов, остальное добрано WebFetch. Скриншотов не смотрел, только текст.

## 1. Приложения-референсы (что взять)

1. Linear — [прочитано] https://linear.app/now/behind-the-latest-design-refresh (март 2026)
   Принцип «не соревнуйся за внимание, которое не заслужил»: боковая навигация приглушена на несколько тонов, чтобы рабочая область доминировала; единое место для действий в шапке. Взять: иерархия яркости вместо тяжёлых теней; плотность без шума. Ещё: https://karrisaarinen.com/posts/a-design-reset/ [сниппет].
2. Raycast v2 — [прочитано] https://www.raycast.com/blog/the-new-raycast (май 2026)
   Liquid Glass «в меру, чтобы усилить функциональность», при сохранении профессионального вида; под macOS Tahoe. Взять: стекло только на плавающих слоях (палитра команд, тулбар), не на контенте. Техразбор: https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast [сниппет].
3. Zed — [прочитано] https://zed.dev/blog/parallel-agents (апрель 2026)
   Threads Sidebar: все агентные треды сгруппированы по проектам, быстрые действия stop/archive/new; 120 fps как часть дизайна; per-thread выбор изоляции worktree. Взять: список запусков слева, сгруппированный по проекту, со стоп/архив в строке.
4. Claude Code desktop (редизайн) — [прочитано] https://claude.com/resources/articles/claude-code-desktop-redesign
   Сайдбар сессий с фильтрами по статусу/проекту, автоархив после merge PR; режимы детализации Verbose/Normal/Summary; перетаскиваемые панели (терминал, превью, дифф, чат); боковой чат, который читает контекст, но ничего не пишет назад; индикатор расхода контекста. Взять: переключатель детализации журнала шагов, side-chat. Документация: https://code.claude.com/docs/en/desktop [сниппет].
5. Cursor 2.0 — [прочитано] https://cursor.com/changelog/2-0
   Интерфейс вокруг агентов, а не файлов: сайдбар агентов и планов, до 8 параллельных, у каждого изолированная копия (worktree), единый просмотр правок по многим файлам. Взять: «план» как объект первого класса рядом с запуском.
6. OpenAI Codex app — [сниппет] https://openai.com/index/introducing-the-codex-app/ (WebFetch дал 403)
   Треды по проектам, worktrees, дифф-панель с инлайн-комментариями, stage/revert по hunk: https://developertoolkit.ai/en/codex/build/app-mastery/ [сниппет]. Взять: инлайн-комментарии к строкам диффа, возврат hunk.
7. Conductor — [прочитано, кратко] https://www.conductor.build/
   «Видно с первого взгляда, над чем работает каждый агент», затем ревью и merge; workspace = ветка + дерево + терминал + дифф + путь к PR (https://www.conductor.build/docs/guides/parallel-agents/run-multiple-claude-code-sessions [сниппет]). Прямой аналог панели запусков. Взять: карточка запуска с веткой/статусом/числом правок.
8. Warp — [сниппет] https://www.warp.dev/blog/block-model-behind-warps-agentic-development-environment
   Блоки: типизированные самодостаточные единицы вывода в вертикальном списке, блок можно приложить как контекст агенту (https://docs.warp.dev/agents/local-agents/agent-context/blocks-as-context/). Панель управления агентами: https://docs.warp.dev/platform/managing-cloud-agents/. Взять: журнал шагов как список типизированных блоков с действиями в углу.
9. Ghostty — [сниппет] https://ghostty.org/docs/about
   «Быстрый, богатый, нативный»: платформенный GUI вместо кастомной отрисовки. Взять: нативные рамки/тулбар окна для терминальных нод, без своих «стеклянных» рамок вокруг текста.
10. tldraw — [прочитано] https://tldraw.dev/sdk-features/performance
   Viewport culling через пространственный индекс (display:none вне вида), реактивные сигналы, перерисовывается только изменённая фигура; выбранные/редактируемые не вырезаются. Взять: инженерную основу холста с множеством нод (см. п. 4). Culling: https://tldraw.dev/sdk-features/culling [сниппет].
11. Heptabase — [сниппет] https://wiki.heptabase.com/fundamental-elements
   Карточки на бесконечной доске, «двухслойная» структура досок (родительская → тематические); спокойная бумажная палитра: https://oh-my-design.kr/design-systems/heptabase (сторонний разбор). Взять: иерархию досок/групп и спокойный фон холста.
12. Devin — [сниппет] https://docs.devin.ai/desktop/changelog-next ; обзор https://www.linkedin.com/pulse/in-depth-product-analysis-devin-hottest-ai-developer-paolo-perazzo-yuo0c
   Окно сессий: сайдбар сессий, вид сессии, Review, Wiki; рабочее пространство с 4 вкладками (shell, браузер, редактор, планировщик). Взять: рядом с чатом показывать, что агент «видит» (терминал/браузер).
13. Figma / FigJam, Things 3, Arc/Dia, Muse, Craft, Vercel v0, GitHub Copilot agents — [не проверено]: поиск заблокирован лимитом. Ориентиры из общих знаний без ссылок: Things 3 — аккуратные микро-анимации и воздух; Arc/Dia — боковая панель как главный навигатор; Figma UI3 — плавающие панели на холсте. Перед использованием найти первоисточники.

## 2. Тренды 2025–2026

- Liquid Glass (Apple) — [прочитано] https://developer.apple.com/documentation/technologyoverviews/liquid-glass.md : материал, сочетающий оптику стекла и текучесть; стандартные контролы подхватывают его сами; цель — иерархия, гармония, единообразие.
- WWDC25 AppKit — [прочитано] https://developer.apple.com/videos/play/wwdc2025/310/ : тулбар «парит» над контентом на стекле; кнопки группируются на одном стекле, сегмент-контролы/поиск — отдельным; стекло адаптивно и переключает светлый/тёмный по яркости контента под ним; неинтерактивные элементы (заголовки, индикаторы статуса) стекла не получают.
- Из исследования по HIG/WWDC (стороннее, со ссылками на первоисточники) — [сниппет] https://github.com/zodwick/skim-liquid-glass/blob/master/docs/liquid-glass-research.md : два слоя строго разделены — стекло это функциональный слой навигации/контролов над контентом.
- HIG Materials — https://developer.apple.com/design/human-interface-guidelines/materials [сниппет, страница при чтении пустая]; WWDC25 «Get to know the new design system» https://developer.apple.com/videos/play/wwdc2025/356/ [сниппет].
- Raycast, Linear (п. 1–2) — живые примеры 2026: стекло точечно, остальное спокойнее и тише.
- Скевоморфизм/«tactile» возвращается после Liquid Glass — [сниппет] https://tactileui.dev/blog/skeuomorphic-ui-in-2026 ; обзор glass vs neumorphism — [сниппет] https://712tools.com/blog/glassmorphism-neumorphism-and-2026-ui-trends/ ; нео-морфизм и проблема контраста — [сниппет] https://toolz.dev/blog/neumorphism-generator-guide .
- Рецепт «объёма» без стекла (вывод, не из источника): 2–3 уровня поверхностей (холст → нода → всплывающее), мягкая многослойная тень, светлая 1px кромка сверху (inner highlight), тёмная снизу, лёгкий градиент 2–4%; blur только на 1–2 плавающих панелях.
- Не найдено/не проверено: подборки Dribbble/Mobbin — отдельно не искал (лимит).

## 3. UX-паттерны агентских интерфейсов

- 16 паттернов по шести фазам делегирования — [прочитано] https://www.setproduct.com/blog/ai-agent-ui-design-patterns (сент. 2026): план — главный объект; «живой реестр шагов» с глифами pending (пустой круг) / running / done / failed; журнал — первоклассная поверхность (человеку нужно, что сделано, а не что сказано); оценка стоимости + пользовательский лимит «остановись и спроси»; примеры Cursor, Claude Code, Devin.
- Автономность — [прочитано] https://supik.digital/agent-ux-patterns : «ползунок автономии» — не один глобальный флаг, а уровень по классу действия (чтение — свободно, запись/отправка — с подтверждением). Подходит для уровней доверия профиля запуска.
- Подтверждения — [сниппет] https://www.affectui.com/guides/human-in-the-loop-ui : карточка подтверждения одного действия, запрос разрешения, настройка автономии. Чекпоинты: необратимое, деньги, затрагивает других, высокая неопределённость — https://theuxshop.com/guides/human-ai-collaboration-agentic-ux/ [сниппет].
- Предпросмотр намерения перед действием — [сниппет] https://www.eleken.co/blog-posts/agentic-ux-examples .
- Цикл «план → одобрение записи → действие → читаемый журнал → undo рядом» — [сниппет] https://www.vizio.ai/resources/blog/ai-agent-ux-design ; состояния proposed/… с неизменяемой версией действия — [сниппет] https://makeyouragent.ai/blog/agent-ux-patterns-visible-reversible-workflows .
- Научная классификация: Mandate Formation, Autonomy Boundary, Execution Visibility, Evidence Grounding, Human Intervention Gate, Agency Withdrawal — [сниппет] https://dl.acm.org/doi/10.1145/3776591.3832499 ; набор компонентов Activity/Tool Log/Source Trace — [сниппет] https://jackiecurry.github.io/rad/ .
- Применимо к Loom (мои выводы): статусы идёт/пауза/ошибка/готово — цвет + форма глифа + подпись (не один цвет); «нужно действие человека» — единственный элемент с акцентом и мягким свечением, всё остальное тише; режимы детализации журнала как в Claude (Verbose/Normal/Summary); дифф с инлайн-комментариями и возвратом hunk как в Codex; уровень доверия отображать на карточке запуска.

## 4. Анти-паттерны

- Прозрачность = плохая читаемость — [прочитано] https://www.nngroup.com/articles/liquid-glass/ (NN/G, окт. 2025): всё, что лежит поверх другого, хуже видно; мелкие цели, потеря предсказуемости и обнаружимости.
- Контраст — [прочитано] https://thecrit.co/resources/liquid-glass-accessibility-audit (март 2026): контраст местами 1.5:1 при требовании WCAG AA 4.5:1; один и тот же элемент проходит или нет в зависимости от обоев. Вывод: заливка под текстом должна давать 4.5:1 на худшем фоне; под текст — непрозрачная/почти непрозрачная плашка.
- Критика отрасли — [сниппет] https://www.wired.com/story/designers-react-to-apple-liquid-glass/ ; https://accessadvisors.nz/blog/liquid-glass ; https://axesslab.com/glassmorphism-meets-accessibility-can-frosted-glass-be-inclusive/ (размытие может вызывать дискомфорт; нужна опция «уменьшить прозрачность/движение»).
- Производительность blur — [прочитано] https://graphon.co/blog/backdrop-filter-cost (июль 2026): на карте сервисов сотни нод с backdrop-filter и анимированные рёбра — GPU пересчитывает размытие каждый кадр для каждой карточки; подвисает даже хром браузера. Ещё: https://dimensa.dev/en/backdrop-filter-performance [сниппет]; кейс 16 из 221 элементов с blur → 20 fps: https://blog.jaeyonging.com/en/blog/80 [сниппет].
- Для Loom (вывод): ноды холста — непрозрачные поверхности с тенью и кромкой, без backdrop-filter; blur только у тулбара/палитры/модалок; отключать эффекты при зуме/перетаскивании и при большом числе нод; culling вне вида как в tldraw; уважать «Уменьшить прозрачность» и «Уменьшить движение»; не ставить анимацию под стекло.
- Анти-паттерны агентских UI — [прочитано, заголовки] setproduct выше: одинокий спиннер без шагов, стопка модалок с подтверждениями, зелёная галочка при провалившихся тестах, чат утоплен под деталями.
- Не перегружать: Linear (п. 1) — «не соревнуйся за внимание»; единый акцент для «нужно действие».
