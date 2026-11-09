/*
 * RobotStatistics — приёмник для Next.js (App Router, Next 15/16) и Payload CMS 3 (это тоже Next.js).
 *
 * Куда положить (выберите свой случай и поправьте строку import ниже):
 *
 *   Обычный Next.js:
 *     app/robot-stats/[...path]/route.ts        ← этот файл
 *     lib/robot-stats-receiver.mjs + .d.mts     ← ядро и типы из receiver/
 *     import: "../../../lib/robot-stats-receiver.mjs"
 *
 *   Next.js с папкой src/  или  Payload CMS (в LightWebsiteUi — папка cms/):
 *     src/app/(robot-stats)/robot-stats/[...path]/route.ts
 *     src/lib/robot-stats-receiver.mjs + .d.mts
 *     import: "../../../../lib/robot-stats-receiver.mjs"
 *
 * (Путь — относительный: сокращение "@/…" Next.js с расширением .mjs не находит.)
 *
 * Ключ: в .env  ROBOT_STATS_KEY=длинный-случайный-ключ   (тот же — в OsEngine, «Ключ для webhook»)
 *
 * Адрес для OsEngine:  https://ваш-сайт.ru/robot-stats/ingest   (для Payload — адрес CMS)
 * Для виджета:         data-src="https://ваш-сайт.ru/robot-stats/robots.json"
 */
import { createReceiver } from "../../../lib/robot-stats-receiver.mjs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const receiver = createReceiver({
  key: process.env.ROBOT_STATS_KEY,
  dataDir: process.env.ROBOT_STATS_DIR ?? "./robot-stats-data",
})

const handle = (request: Request) => receiver.handle(request)

export { handle as GET, handle as HEAD, handle as POST, handle as OPTIONS }
