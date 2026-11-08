# RobotStatistics

Статистика роботов [OsEngine](https://github.com/AlexWan/OsEngine) на вашем сайте: прибыль, Profit Factor, просадка, график доходности, открытые и закрытые сделки. Работает и для реальной торговли, и для тестера.

**Демо:** https://si0683.github.io/robotstatistics/

```
1. RobotStatistics.cs  → OsEngine\Custom\Robots\   → «Выбрать роботов…» галочками
2. Данные → на сайт:  WinSCP (хостинг) · webhook (свой сервер / Docker) · HTTP (VPS)
3. <script src="robot-stats.js" data-src="/robot-stats/robots.json"></script>
```

- **Один файл в OsEngine.** Исходники движка не меняются. Робот ничего не торгует, только читает журналы.
- **Роботы выбираются галочками** в окне со списком; для каждого можно задать подпись на сайте.
- **Терминал и тестер.** Терминал обновляется каждые 30 с. Тестер публикует каждый прогон, прогоны можно сравнивать.
- **JSON, CSV, RSS** — для сайта, Excel и Google Таблиц, RSS-читалок и Telegram.
- **Цифры как в журнале** OsEngine: считает тот же код.
- **Приватность:** можно скрыть суммы, объёмы и открытые позиции; скрытого нет в самих файлах.
- **Виджет для любого сайта** (Tilda, WordPress, свой): готовый блок, отдельные блоки или API. График — [Lightweight Charts](https://tradingview.github.io/lightweight-charts/) от TradingView. Есть светлая и тёмная тема, нормально выглядит на телефоне.

## Файлы

| | |
|---|---|
| [`osengine/RobotStatistics.cs`](osengine/RobotStatistics.cs) | положить в `OsEngine\Custom\Robots\` |
| [`site/robot-stats.js`](site/robot-stats.js) | виджет для сайта |
| [`site/robot-stats-theme.css`](site/robot-stats-theme.css) | по желанию: цвета, шрифт и формы виджета под ваш сайт (`--rs-*`, `::part()`) |
| [`site/robot-stats.d.ts`](site/robot-stats.d.ts) | типы для TypeScript |
| [`examples/docker-site/`](examples/docker-site) | готовый мини-сайт с приёмником: `docker compose up -d` → http://localhost:3000 |
| [`site/index.html`](site/index.html) | витрина (GitHub Pages) |

## Документация

- **[Инструкция для новичков: куда что положить](TechnicalSpecification/Инструкция%20—%20Статистика%20робота%20на%20своём%20сайте.md)**
- [Техническое задание](TechnicalSpecification/ТЗ%20—%20Трансляция%20статистики%20робота.md)

Папку `TechnicalSpecification` можно открыть в Obsidian.

## Быстрый старт с тестером и Docker

```bash
cd examples/docker-site
docker compose up -d
```

В OsEngine: Тестер → «Добавить бота» → «Скрипт» → RobotStatistics → «Параметры» → «Выбрать роботов…». В поле «Отправлять на адрес (webhook)» укажите `http://localhost:3000/api/robot-stats/ingest` и запустите тест. Результат появится на http://localhost:3000.

---

Графики: Lightweight Charts™ by TradingView (Apache 2.0).
