/*
 * RobotStatistics — приёмник для сайта на Astro (в т. ч. LightWebsiteUi).
 *
 * Куда положить:
 *   src/pages/robot-stats/[...path].ts        ← этот файл
 *   src/lib/robot-stats-receiver.mjs          ← ядро из receiver/
 *   src/lib/robot-stats-receiver.d.mts        ← типы из receiver/
 *
 * Нужен серверный адаптер (один раз):  npx astro add node
 * Остальные страницы сайта остаются статическими — серверным становится только этот адрес.
 *
 * Ключ: в .env  ROBOT_STATS_KEY=длинный-случайный-ключ   (тот же — в OsEngine, «Ключ для webhook»)
 *
 * Адрес для OsEngine:  https://ваш-сайт.ru/robot-stats/ingest
 * Для виджета:         data-src="/robot-stats/robots.json"
 */
import type { APIRoute } from "astro"
import { createReceiver } from "../../lib/robot-stats-receiver.mjs"

export const prerender = false

const receiver = createReceiver({
  key: import.meta.env.ROBOT_STATS_KEY ?? process.env.ROBOT_STATS_KEY,
  dataDir: import.meta.env.ROBOT_STATS_DIR ?? process.env.ROBOT_STATS_DIR ?? "./robot-stats-data",
})

export const ALL: APIRoute = ({ request }) => receiver.handle(request)
