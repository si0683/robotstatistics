/*
 * RobotStatistics — приёмник данных от OsEngine для любого сайта на Node.js.
 * https://github.com/si0683/robotstatistics
 *
 * Один файл, без зависимостей (только node:fs / node:path / node:crypto). Работает на стандартных
 * Request → Response, поэтому встраивается в Astro, Next.js (и Payload CMS), SvelteKit, Nuxt, Remix, Hono,
 * Express и обычный node:http — и запускается сам по себе как отдельный сервер.
 *
 * ЧТО ДЕЛАЕТ
 *   POST  <адрес>            ← RobotStatistics в OsEngine («Отправлять на адрес (webhook)» + «Ключ для webhook»).
 *                              Тело: { files: { "robots.json": "...", "<робот>/stats.json": "...", ... }, removed_runs: [...] }
 *   GET   <адрес>/<файл>     → файлы для виджета: robots.json, <робот>/stats.json, deals.csv, tester/runs.json …
 *
 * БЫСТРЫЙ СТАРТ (отдельный сервер)
 *   ROBOT_STATS_KEY=длинный-ключ node robot-stats-receiver.mjs --port 3001 --dir ./robot-stats-data
 *   → адрес для OsEngine:  http://<ваш-сервер>:3001/robot-stats/ingest   (снаружи — через https-прокси)
 *   → для виджета:          data-src="https://<ваш-сайт>/robot-stats/robots.json"
 *
 * ВСТРОИТЬ В СВОЙ САЙТ — см. receiver/README.md (Astro, Next.js, Payload, Express …)
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TYPES = {
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".rss": "application/rss+xml; charset=utf-8"
};

const MAX_BODY = 50 * 1024 * 1024; // 50 МБ: история за годы с тысячами сделок

/**
 * Создать приёмник.
 * @param {object} [options]
 * @param {string} [options.dataDir]  папка для данных (по умолчанию ROBOT_STATS_DIR или ./robot-stats-data)
 * @param {string} [options.key]      ключ (по умолчанию ROBOT_STATS_KEY). Пустой — принимать без ключа (только для локальной проверки!)
 * @param {string} [options.prefix]   часть адреса, после которой идёт имя файла (по умолчанию "/robot-stats/")
 * @param {string} [options.allowOrigin] CORS для чтения файлов (по умолчанию "*": виджет может стоять на другом домене)
 * @param {(msg: string) => void} [options.log]
 * @returns {{ handle(request: Request): Promise<Response>, dataDir: string }}
 */
export function createReceiver(options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  const dataDir = path.resolve(options.dataDir || env.ROBOT_STATS_DIR || "./robot-stats-data");
  const key = options.key !== undefined ? String(options.key) : String(env.ROBOT_STATS_KEY || "");
  const prefix = options.prefix || "/robot-stats/";
  const allowOrigin = options.allowOrigin || "*";
  const log = options.log || ((m) => console.log("[robot-stats] " + m));

  let warnedNoKey = false;

  const cors = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "X-Content-Type-Options": "nosniff"
  };

  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

  // Имя файла из адреса: всё после prefix (учитывает base у Astro, /api/… у Next и т. п.)
  function relativeFromUrl(url) {
    const pathname = decodeURIComponent(new URL(url).pathname);
    const i = pathname.lastIndexOf(prefix);
    return i >= 0 ? pathname.slice(i + prefix.length) : pathname.replace(/^\/+/, "");
  }

  // Разрешаем только «нормальные» пути: латиница, цифры, - _ . /, расширения json/csv/rss, без «..»
  function safeRelative(rel) {
    if (typeof rel !== "string" || !/^[A-Za-z0-9_\-./]+$/.test(rel)) return null;
    const norm = path.posix.normalize(rel);
    if (norm.startsWith("..") || norm.startsWith("/") || norm.includes("/../")) return null;
    if (!/\.(json|csv|rss)$/.test(norm)) return null;
    return norm;
  }

  function keyOk(request) {
    if (!key) {
      if (!warnedNoKey) log("ВНИМАНИЕ: ключ не задан (ROBOT_STATS_KEY) — данные примет любой. Для сайта в интернете задайте ключ.");
      warnedNoKey = true;
      return true;
    }
    const header = request.headers.get("authorization") || "";
    const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
    const wanted = Buffer.from(key);
    return given.length === wanted.length && timingSafeEqual(given, wanted);
  }

  async function ingest(request) {
    if (!keyOk(request)) return json(401, { error: "wrong key" });

    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_BODY) return json(413, { error: "too large" });

    let payload;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY) return json(413, { error: "too large" });
      payload = JSON.parse(text);
    } catch {
      return json(400, { error: "bad json" });
    }

    const files = payload && payload.files;
    if (!files || typeof files !== "object") return json(400, { error: "no files" });

    let written = 0;
    for (const [rel, text] of Object.entries(files)) {
      const safe = safeRelative(rel);
      if (!safe || typeof text !== "string") continue;
      const target = path.join(dataDir, safe);
      await fs.mkdir(path.dirname(target), { recursive: true });
      // CSV — с BOM, чтобы Excel сразу понял кириллицу
      const body = safe.endsWith(".csv") ? "﻿" + text : text;
      const tmp = target + "." + process.pid + ".tmp";
      await fs.writeFile(tmp, body, "utf8");
      await fs.rename(tmp, target);
      written++;
    }

    // прогоны тестера, которые OsEngine уже удалил у себя
    let removed = 0;
    for (const id of Array.isArray(payload.removed_runs) ? payload.removed_runs : []) {
      if (typeof id !== "string" || !/^[0-9_-]+$/.test(id)) continue;
      const dir = path.join(dataDir, "tester", "runs", id);
      try {
        await fs.rm(dir, { recursive: true, force: true });
        removed++;
      } catch {
        /* уже нет */
      }
    }

    log("получено от OsEngine: " + (payload.source || "?") + (payload.run ? " " + payload.run : "") + ", файлов " + written + (removed ? ", удалено прогонов " + removed : ""));
    return json(200, { ok: true, written, removed });
  }

  async function serve(request) {
    const safe = safeRelative(relativeFromUrl(request.url) || "robots.json");
    if (!safe) return json(404, { error: "not found" });

    let body;
    try {
      body = await fs.readFile(path.join(dataDir, safe));
    } catch {
      return json(404, { error: "not found" });
    }

    const etag = '"' + createHash("sha1").update(body).digest("hex").slice(0, 16) + '"';
    const headers = { ...cors, "Content-Type": TYPES[path.extname(safe)] || "application/octet-stream", "Cache-Control": "public, max-age=10", ETag: etag };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
  }

  return {
    dataDir,
    async handle(request) {
      try {
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
        if (request.method === "POST") return await ingest(request);
        if (request.method === "GET" || request.method === "HEAD") return await serve(request);
        return json(405, { error: "method not allowed" });
      } catch (error) {
        log("ошибка: " + (error && error.message));
        return json(500, { error: "internal error" });
      }
    }
  };
}

/**
 * Обёртка для node:http, Express, Connect, Fastify (middie) и т. п.
 *   app.use("/robot-stats", nodeHandler(createReceiver({ key: "…" })))
 * Отвечает на всё, что пришло в этот обработчик.
 */
const HOP_BY_HOP = new Set(["host", "connection", "keep-alive", "transfer-encoding", "content-length", "upgrade", "expect", "te", "trailer"]);

export function nodeHandler(receiver) {
  return async function robotStats(req, res) {
    const proto = req.headers["x-forwarded-proto"] || (req.socket && req.socket.encrypted ? "https" : "http");
    const url = proto + "://" + (req.headers.host || "localhost") + (req.originalUrl || req.url);
    const chunks = [];
    if (req.method === "POST") {
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) break;
        chunks.push(chunk);
      }
    }
    const request = new Request(url, {
      method: req.method,
      headers: Object.entries(req.headers).filter(([k, v]) => typeof v === "string" && !HOP_BY_HOP.has(k)),
      body: req.method === "POST" ? Buffer.concat(chunks) : undefined
    });
    const response = await receiver.handle(request);
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}

// ---------------- запуск как отдельный сервер: node robot-stats-receiver.mjs --port 3001 --dir ./data ----------------

const isMain = typeof process !== "undefined" && !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const arg = (name, def) => {
    const i = process.argv.indexOf("--" + name);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
  };
  const port = parseInt(arg("port", process.env.PORT || "3001"), 10);
  const receiver = createReceiver({ dataDir: arg("dir", undefined), key: arg("key", undefined) });
  const { createServer } = await import("node:http");
  createServer(nodeHandler(receiver)).listen(port, () => {
    console.log("[robot-stats] приёмник: http://localhost:" + port + "/robot-stats/ingest  (данные: " + receiver.dataDir + ")");
    console.log("[robot-stats] для виджета: data-src=\"http://localhost:" + port + "/robot-stats/robots.json\"");
  });
}
