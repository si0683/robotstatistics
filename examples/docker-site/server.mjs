/*
 * Мини-сайт RobotStatistics: принимает данные из OsEngine и показывает их.
 * Приём и отдачу данных делает общее ядро receiver/robot-stats-receiver.mjs — этот файл только добавляет страницу.
 *
 *   POST /robot-stats/ingest        ← RobotStatistics (параметр «Отправлять на адрес (webhook)»)
 *        /api/robot-stats/ingest    ← старый адрес, тоже работает
 *   GET  /robot-stats/...           → robots.json, tester/runs.json, <робот>/stats.json …
 *   GET  /lib/robot-stats.js        → виджет
 *   GET  /                          → страница (public/index.html)
 *
 * Переменные окружения: PORT (3000), INGEST_KEY или ROBOT_STATS_KEY, DATA_DIR (./data), LIB_DIR (./lib)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { createReceiver, nodeHandler } = await import(process.env.RECEIVER_PATH || "./robot-stats-receiver.mjs");

const PORT = parseInt(process.env.PORT || "3000", 10);
const PUBLIC_DIR = path.join(here, "public");
const LIB_DIR = path.resolve(process.env.LIB_DIR || path.join(here, "lib"));

const receiver = createReceiver({
  dataDir: process.env.DATA_DIR || path.join(here, "data"),
  key: process.env.INGEST_KEY || process.env.ROBOT_STATS_KEY || ""
});
const robotStats = nodeHandler(receiver);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    res.writeHead(err ? 404 : 200, { "Content-Type": err ? "text/plain" : TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(err ? "not found" : data);
  });
}

http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);

  if (p.startsWith("/robot-stats/") || p === "/api/robot-stats/ingest") return robotStats(req, res);
  if (p === "/lib/robot-stats.js" || p === "/lib/robot-stats-theme.css") return sendFile(res, path.join(LIB_DIR, path.basename(p)));

  const file = p === "/" ? "index.html" : p.slice(1);
  if (!/^[A-Za-z0-9_\-.]+$/.test(file)) return sendFile(res, "");
  sendFile(res, path.join(PUBLIC_DIR, file));
}).listen(PORT, () => {
  console.log("RobotStatistics сайт: http://localhost:" + PORT);
  console.log("Адрес для OsEngine (webhook): http://localhost:" + PORT + "/robot-stats/ingest");
  console.log("Файлы складываются в:", receiver.dataDir);
});
