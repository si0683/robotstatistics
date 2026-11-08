/*
 * Мини-сайт RobotStatistics: принимает данные из OsEngine и показывает их.
 * Без зависимостей — только Node.js.
 *
 *   POST /api/robot-stats/ingest   ← сюда шлёт RobotStatistics (параметр «Отправлять на адрес (webhook)»)
 *   GET  /                         → страница со статистикой (public/index.html)
 *   GET  /robot-stats/...          → полученные файлы (robots.json, tester/runs.json, <робот>/stats.json …)
 *   GET  /lib/robot-stats.js       → виджет
 *
 * Настройки (переменные окружения):
 *   PORT        порт сайта, по умолчанию 3000
 *   INGEST_KEY  ключ; если задан, OsEngine должен прислать тот же в «Ключ для webhook»
 *   DATA_DIR    куда складывать файлы, по умолчанию ./data
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "3000", 10);
const INGEST_KEY = process.env.INGEST_KEY || "";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const PUBLIC_DIR = path.join(__dirname, "public");
const LIB_DIR = path.resolve(process.env.LIB_DIR || path.join(__dirname, "lib"));
const MAX_BODY = 50 * 1024 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".rss": "application/rss+xml; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

fs.mkdirSync(DATA_DIR, { recursive: true });

// Разрешаем только «нормальные» относительные пути: латиница, цифры, - _ . /
function safeRelative(p) {
  if (typeof p !== "string" || !/^[A-Za-z0-9_\-./]+$/.test(p)) return null;
  const norm = path.posix.normalize(p);
  if (norm.startsWith("..") || norm.startsWith("/") || norm.includes("/../")) return null;
  if (!/\.(json|csv|rss)$/.test(norm)) return null;
  return norm;
}

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type || "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, '{"error":"not found"}');
    send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
  });
}

function ingest(req, res) {
  if (INGEST_KEY && req.headers.authorization !== "Bearer " + INGEST_KEY) {
    return send(res, 401, '{"error":"wrong key"}');
  }

  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (e) {
      return send(res, 400, '{"error":"bad json"}');
    }

    const files = payload && payload.files;
    if (!files || typeof files !== "object") return send(res, 400, '{"error":"no files"}');

    let written = 0;
    for (const [rel, text] of Object.entries(files)) {
      const safe = safeRelative(rel);
      if (!safe || typeof text !== "string") continue;
      const target = path.join(DATA_DIR, safe);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // CSV — с BOM, чтобы Excel сразу понял кириллицу
      const body = safe.endsWith(".csv") ? "﻿" + text : text;
      fs.writeFileSync(target + ".tmp", body, "utf8");
      fs.renameSync(target + ".tmp", target);
      written++;
    }

    // старые прогоны тестера, которые OsEngine уже удалил у себя
    let removed = 0;
    (Array.isArray(payload.removed_runs) ? payload.removed_runs : []).forEach((id) => {
      if (typeof id !== "string" || !/^[0-9_-]+$/.test(id)) return;
      const dir = path.join(DATA_DIR, "tester", "runs", id);
      if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); removed++; }
    });

    console.log(new Date().toISOString(), "получено от OsEngine:", payload.source, payload.run || "", "файлов:", written, removed ? "удалено прогонов: " + removed : "");
    send(res, 200, JSON.stringify({ ok: true, written }));
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = decodeURIComponent(url.pathname);

  if (req.method === "OPTIONS") return send(res, 204, "");
  if (req.method === "POST" && p === "/api/robot-stats/ingest") return ingest(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, '{"error":"method"}');

  if (p.startsWith("/robot-stats/")) {
    const safe = safeRelative(p.slice("/robot-stats/".length));
    return safe ? serveFile(res, path.join(DATA_DIR, safe)) : send(res, 404, '{"error":"not found"}');
  }
  if (p === "/lib/robot-stats.js") return serveFile(res, path.join(LIB_DIR, "robot-stats.js"));

  const file = p === "/" ? "index.html" : p.slice(1);
  if (!/^[A-Za-z0-9_\-.]+$/.test(file)) return send(res, 404, '{"error":"not found"}');
  serveFile(res, path.join(PUBLIC_DIR, file));
}).listen(PORT, () => {
  console.log("RobotStatistics сайт: http://localhost:" + PORT);
  console.log("Адрес для OsEngine (webhook): http://localhost:" + PORT + "/api/robot-stats/ingest");
  console.log("Файлы складываются в:", DATA_DIR);
});
