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
| [`receiver/`](receiver) | **приёмник для вашего сайта** — OsEngine (хоть на чужом сервере) сам отправляет туда статистику: Astro / LightWebsiteUi, Next.js / Payload, Express, PHP (WordPress, Битрикс…), отдельный сервер |
| [`examples/docker-site/`](examples/docker-site) | готовый мини-сайт с приёмником: `docker compose up -d` → http://localhost:3000 |
| [`site/index.html`](site/index.html) | витрина (GitHub Pages) |

## Документация

- **[Приёмник для своего сайта](receiver/README.md)** — OsEngine (у вас или у знакомого на сервере) сам отправляет статистику на ваш сайт: Astro / LightWebsiteUi, Next.js / Payload, Express, PHP, отдельный сервер. Там же — что сделать владельцу сервера.
- Оформление виджета под сайт — комментарии в [`site/robot-stats-theme.css`](site/robot-stats-theme.css).
- Все атрибуты и API виджета — в начале [`site/robot-stats.js`](site/robot-stats.js) и в [`site/robot-stats.d.ts`](site/robot-stats.d.ts).

## Быстрый старт с тестером и Docker

```bash
cd examples/docker-site
docker compose up -d
```

В OsEngine: Тестер → «Добавить бота» → «Скрипт» → RobotStatistics → «Параметры» → «Выбрать роботов…». В поле «Отправлять на адрес (webhook)» укажите `http://localhost:3000/robot-stats/ingest` и запустите тест. Результат появится на http://localhost:3000.

---

Графики: Lightweight Charts™ by TradingView (Apache 2.0).
