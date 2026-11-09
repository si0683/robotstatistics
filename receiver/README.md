# Приёмник RobotStatistics для вашего сайта

Приёмник — это адрес на вашем сайте, куда OsEngine **сам отправляет** статистику роботов (webhook). Робот может работать где угодно: на сервере знакомого, на VPS, на домашнем компьютере. Тот, у кого стоит OsEngine, ничего не открывает и не настраивает, кроме двух строк в RobotStatistics.

```
Сервер с OsEngine  ──POST (ключ)──►  https://ваш-сайт.ru/robot-stats/ingest  ──►  папка с данными
                                      https://ваш-сайт.ru/robot-stats/robots.json  ◄── виджет на страницах
```

## Выберите свой сайт

| Ваш сайт | Что взять | Где проверено |
|---|---|---|
| **Astro** (в т. ч. [LightWebsiteUi](https://github.com/si0683/LightWebsiteUi)) | `astro/[...path].ts` + `astro/RobotStats.astro` | ✅ LightWebsiteUi, Astro 7 + `@astrojs/node` |
| **Next.js**, **Payload CMS** (в LightWebsiteUi — папка `cms/`) | `nextjs/route.ts` | ✅ Next.js 16.3.3 (как в Payload LightWebsiteUi) |
| **Express**, Fastify, любой Node.js | `express/server.mjs` | ✅ `node:http` |
| **WordPress, 1С-Битрикс, MODX, Joomla, OpenCart, самописный PHP**, обычный хостинг | `php/robot-stats.php` | ✅ PHP 8.3 |
| **Статичный сайт / Tilda / GitHub Pages** (нет своего сервера) | отдельный приёмник: `node robot-stats-receiver.mjs` или Docker на любом VPS | ✅ Node 22, Docker |

Во всех вариантах одно и то же ядро — **`robot-stats-receiver.mjs`** (один файл, без зависимостей, стандартные `Request → Response`). PHP — его копия на PHP.

---

## Шаг 1. Придумайте ключ

Ключ защищает приёмник: без него принять данные мог бы кто угодно. Длинный случайный, например:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Ключ знаете вы и владелец OsEngine — больше никто.

## Шаг 2. Поставьте приёмник

### Astro (LightWebsiteUi)

1. Скопируйте:

   | Откуда | Куда в вашем проекте |
   |---|---|
   | `receiver/robot-stats-receiver.mjs`, `.d.mts` | `src/lib/` |
   | `receiver/astro/[...path].ts` | `src/pages/robot-stats/[...path].ts` |
   | `receiver/astro/RobotStats.astro` | `src/components/RobotStats.astro` |
   | `site/robot-stats.js`, `site/robot-stats-theme.css` | `public/robot-stats-widget/` |

2. Серверный адаптер (один раз): `npx astro add node`. Остальные страницы остаются статическими — серверным становится только `/robot-stats/…`.
3. В `.env` (и в переменных окружения сервера):
   ```
   ROBOT_STATS_KEY=ваш-ключ
   ROBOT_STATS_DIR=./robot-stats-data
   ```
4. Сборка и запуск: `npm run build` → `node dist/server/entry.mjs` (или pm2 / systemd / Docker).
5. На странице:
   ```astro
   ---
   import RobotStats from "@/components/RobotStats.astro"
   ---
   <RobotStats />                                         <!-- все роботы -->
   <RobotStats robot="moex-trend-1" parts="cards,equity" />
   Profit Factor: <RobotStats type="value" robot="moex-trend-1" field="pf" />
   ```
   Тема виджета сама подстраивается под светлую/тёмную тему LightWebsiteUi.

> [!NOTE]
> Если сайт LightWebsiteUi выкладывается на **GitHub Pages** (без сервера), Astro-маршрут там работать не будет — поставьте приёмник отдельно (вариант «Статичный сайт» ниже) или в Payload CMS.

### Next.js / Payload CMS

1. `receiver/robot-stats-receiver.mjs` + `.d.mts` → `src/lib/` (или `lib/`).
2. `receiver/nextjs/route.ts` → `src/app/(robot-stats)/robot-stats/[...path]/route.ts` (Payload, Next с `src/`) или `app/robot-stats/[...path]/route.ts`. Поправьте строку `import` — варианты пути написаны в начале файла.
3. `.env`: `ROBOT_STATS_KEY=ваш-ключ`.
4. Адрес для OsEngine — адрес этого Next/Payload: `https://cms.ваш-сайт.ru/robot-stats/ingest`. Виджет можно ставить на любой сайт: `data-src="https://cms.ваш-сайт.ru/robot-stats/robots.json"` (CORS открыт для чтения).

### Express / Node.js

```js
import { createReceiver, nodeHandler } from "./robot-stats-receiver.mjs"
app.use("/robot-stats", nodeHandler(createReceiver({ key: process.env.ROBOT_STATS_KEY })))   // до express.json()
```

### PHP (WordPress, Битрикс, MODX, обычный хостинг)

1. Создайте на сайте папку `robot-stats` (рядом с главным `index.php`) и положите в неё `receiver/php/robot-stats.php`.
2. Откройте файл и впишите ключ в строку `$ROBOT_STATS_KEY = …`.
3. Проверьте: `https://ваш-сайт.ru/robot-stats/robot-stats.php` → `"key_configured": true, "writable": true`.
4. Адрес для OsEngine: `https://ваш-сайт.ru/robot-stats/robot-stats.php`.
5. Виджет: `site/robot-stats.js` загрузите в ту же папку и вставьте на страницу:
   ```html
   <div id="robot-stats"></div>
   <script src="/robot-stats/robot-stats.js" data-src="/robot-stats/robots.json"></script>
   ```
   В WordPress — блок «Произвольный HTML».

> [!TIP]
> Если хостинг «съедает» заголовок с ключом (бывает на Apache + PHP-FPM), допишите ключ в адрес: `…/robot-stats.php?key=ваш-ключ`. Приёмник примет и так.

### Статичный сайт, Tilda, GitHub Pages

Своего сервера нет — нужен любой маленький VPS (или сервер, где уже есть другой ваш сайт):

```bash
ROBOT_STATS_KEY=ваш-ключ node robot-stats-receiver.mjs --port 3001 --dir ./robot-stats-data
```

Или Docker — готовый пример `examples/docker-site` (приём + страница). Снаружи — через HTTPS (Caddy: `stats.ваш-сайт.ru { reverse_proxy localhost:3001 }`). Виджет на Tilda: `data-src="https://stats.ваш-сайт.ru/robot-stats/robots.json"`.

## Шаг 3. Передайте владельцу OsEngine адрес и ключ

Ему нужно сделать на своём сервере (порты открывать и давать доступ к серверу **не нужно**):

1. Скачать [`osengine/RobotStatistics.cs`](../osengine/RobotStatistics.cs) и положить в `OsEngine\Custom\Robots\`.
2. Когда биржа закрыта — перезапустить OsEngine.
3. «Добавить бота» → фильтр «Скрипт» → **RobotStatistics** → «Принять».
4. «Параметры» → **«Выбрать роботов…»** → отметить, каких показывать. Вкладка «Приватность» — по желанию скрыть суммы, объёмы, открытые позиции.
5. Вкладка **«Куда»**: «Отправлять на адрес (webhook)» = ваш адрес, «Ключ для webhook» = ваш ключ.

RobotStatistics ничего не торгует и не меняет его роботов — только читает журналы и отправляет статистику выбранных роботов. Ключ API OsEngine и доступ к серверу ему передавать **не нужно**.

| Что | Пример |
|---|---|
| Адрес (webhook) | `https://ваш-сайт.ru/robot-stats/ingest` · PHP: `https://ваш-сайт.ru/robot-stats/robot-stats.php` |
| Ключ | ваш ключ |

## Шаг 4. Проверьте

- Через 30 секунд после того, как он вписал адрес, откройте `https://ваш-сайт.ru/robot-stats/robots.json` — там его роботы.
- Логи приёмника пишут каждую отправку: `[robot-stats] получено от OsEngine: terminal, файлов 11`.
- Тестер: после каждого прогона — `tester 2026-11-09_15-30-12, файлов 12`.

## Что умеет приёмник

| | |
|---|---|
| `POST` | принимает `{ files: {"путь": "текст"}, removed_runs: [...] }`, ключ — `Authorization: Bearer …` (в PHP ещё `?key=`) |
| `GET` / `HEAD` | отдаёт `robots.json`, `<робот>/stats.json`, `deals.json`, `deals.csv`, `stats.csv`, `deals.rss`, `tester/runs.json` |
| Защита | ключ сравнивается безопасно (timing-safe); пишутся только `.json/.csv/.rss` внутри своей папки (`../`, `.php` и прочее отбрасывается); тело до 50 МБ |
| Чтение с других сайтов | CORS `*` — виджет может стоять на любом домене |
| Прогоны тестера | старые удаляются вслед за OsEngine (`removed_runs`) |
| CSV | с BOM — Excel сразу понимает кириллицу |
| Хранение | обычные файлы в папке, база данных не нужна |

Настройки ядра: `createReceiver({ key, dataDir, prefix = "/robot-stats/", allowOrigin = "*" })`; переменные окружения `ROBOT_STATS_KEY`, `ROBOT_STATS_DIR`.
