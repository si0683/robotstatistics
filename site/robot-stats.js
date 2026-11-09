/*
 * RobotStatistics — статистика роботов OsEngine на любом сайте.
 * https://github.com/si0683/robotstatistics
 *
 * УРОВЕНЬ 1 — готовый виджет:
 *   <div id="robot-stats"></div>
 *   <script src="robot-stats.js" data-src="/robot-stats/robots.json"></script>
 *
 * УРОВЕНЬ 2 — отдельные блоки где угодно на странице:
 *   <script src="robot-stats.js" data-src="/robot-stats/robots.json"></script>
 *   <div data-rs="equity" data-robot="candlemonster-1" data-height="420"></div>
 *   <div data-rs="cards"  data-robot="candlemonster-1" data-items="profit,pf,drawdown"></div>
 *   Profit Factor: <span data-rs="value" data-robot="candlemonster-1" data-field="pf"></span>
 *
 * УРОВЕНЬ 3 — свой код:
 *   const data = await RobotStats.load("/robot-stats/candlemonster-1/stats.json");
 *   RobotStats.equityChart(document.querySelector("#chart"), data, { height: 500, unit: "percent" });
 *
 * Полное описание атрибутов — в README репозитория и в «Инструкции для чайников».
 */
(function () {
  "use strict";

  var currentScript = document.currentScript;

  if (window.RobotStats && window.RobotStats.__ready) {
    window.RobotStats.__boot(currentScript);
    return;
  }

  var VERSION = "2.6.1";
  var LWC_URL = "https://cdn.jsdelivr.net/npm/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js";

  // =====================================================================
  // Утилиты
  // =====================================================================

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function isNum(v) { return v !== null && v !== "" && v !== undefined && !isNaN(v); }

  function num(v, digits) {
    if (!isNum(v)) return "—";
    return Number(v).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: digits == null ? 2 : digits });
  }

  function signed(v, digits, suffix) {
    if (!isNum(v)) return "—";
    return (v > 0 ? "+" : v < 0 ? "−" : "") + num(Math.abs(v), digits) + (suffix || "");
  }

  function cls(v) { return v > 0 ? "up" : v < 0 ? "down" : ""; }

  // Время в файлах — как в журнале OsEngine, без пояса. Считаем его «UTC», чтобы показывать как есть.
  function ts(s) {
    var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/.exec(s || "");
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000;
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function fmtTs(t, withTime) {
    var d = new Date(t * 1000);
    var s = pad2(d.getUTCDate()) + "." + pad2(d.getUTCMonth() + 1) + "." + String(d.getUTCFullYear()).slice(2);
    return withTime === false ? s : s + " " + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
  }

  function time(s) {
    if (!s) return "—";
    if (/[+-]\d\d:\d\d$|Z$/.test(s)) {
      var d = new Date(s);
      if (!isNaN(d)) return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
    var t = ts(s);
    return t == null ? esc(s) : fmtTs(t);
  }

  // OsEngine отдаёт среднее время как "H 14 M 20 S 0"
  function duration(v) {
    var m = /H\s*(-?\d+)\s*M\s*(\d+)/.exec(v || "");
    if (!m) return v || "—";
    var h = parseInt(m[1], 10), min = parseInt(m[2], 10);
    if (h >= 24) return Math.floor(h / 24) + " д " + (h % 24) + " ч";
    if (h > 0) return h + " ч " + min + " мин";
    return min + " мин";
  }

  function resolveUrl(base, rel) {
    try { return new URL(rel, new URL(base, location.href)).href; } catch (e) { return rel; }
  }

  function getPath(obj, path) {
    var parts = String(path).split(".");
    for (var i = 0; i < parts.length && obj != null; i++) obj = obj[parts[i]];
    return obj;
  }

  function attr(el, name, def) {
    var v = el && el.getAttribute ? el.getAttribute(name) : null;
    return v == null || v === "" ? def : v;
  }

  // =====================================================================
  // Загрузка данных: общий кэш + опрос, один запрос на адрес для всех блоков
  // =====================================================================

  var store = {};

  function fetchJson(url) {
    var sep = url.indexOf("?") >= 0 ? "&" : "?";
    return fetch(url + sep + "t=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " — " + url);
      return r.json();
    });
  }

  function entry(url) {
    if (!store[url]) store[url] = { url: url, data: null, error: null, subs: [], timer: null, refresh: 0, promise: null };
    return store[url];
  }

  function load(url) {
    url = resolveUrl(location.href, url);
    var e = entry(url);
    if (e.data) return Promise.resolve(e.data);
    if (!e.promise) {
      e.promise = fetchJson(url).then(function (d) { e.data = d; e.error = null; return d; })
        .catch(function (err) { e.error = err; e.promise = null; throw err; });
    }
    return e.promise;
  }

  function poll(e) {
    fetchJson(e.url).then(function (d) {
      var changed = !e.data || JSON.stringify(d) !== JSON.stringify(e.data);
      e.data = d;
      e.error = null;
      if (changed) e.subs.forEach(function (cb) { cb(d, null); });
    }).catch(function (err) {
      e.error = err;
      e.subs.forEach(function (cb) { cb(e.data, err); });
    });
  }

  function subscribe(url, refreshSec, cb) {
    var e = entry(url);
    e.subs.push(cb);
    load(url).then(function (d) { cb(d, null); }, function (err) { cb(null, err); });

    if (refreshSec > 0 && (!e.refresh || refreshSec < e.refresh)) {
      if (e.timer) clearInterval(e.timer);
      e.refresh = refreshSec;
      e.timer = setInterval(function () { poll(e); }, refreshSec * 1000);
    }

    return function () {
      e.subs = e.subs.filter(function (x) { return x !== cb; });
      if (!e.subs.length && e.timer) { clearInterval(e.timer); e.timer = null; e.refresh = 0; }
    };
  }

  // Источник может быть runs.json (прогоны тестера) → robots.json (список роботов) → stats.json (робот)
  function resolveStats(src, robot, run) {
    var abs = resolveUrl(location.href, src);

    if (/runs\.json(\?|$)/i.test(abs)) {
      return load(abs).then(function (doc) {
        var runs = doc.runs || [];
        if (!runs.length) throw new Error("прогонов тестера пока нет");
        var chosen = run ? runs.filter(function (r) { return r.id === run; })[0] : runs[0];
        if (!chosen) throw new Error("прогон «" + run + "» не найден");
        return resolveStats(resolveUrl(abs, chosen.robots), robot).then(function (res) {
          res.runsUrl = abs; res.runs = runs; res.run = chosen.id; return res;
        });
      });
    }

    if (/robots\.json(\?|$)/i.test(abs)) {
      return load(abs).then(function (doc) {
        var list = (doc.robots || []).filter(function (r) { return r.files && r.files.stats_json; });
        if (!list.length) throw new Error("нет опубликованных роботов (проверьте галочку stats.json в RobotStatistics)");
        var chosen = robot ? list.filter(function (r) { return r.slug === robot; })[0] : list[0];
        if (!chosen) throw new Error("робот «" + robot + "» не найден в robots.json");
        return { statsUrl: resolveUrl(abs, chosen.files.stats_json), robotsUrl: abs, robots: list, robot: chosen.slug };
      });
    }

    return Promise.resolve({ statsUrl: abs });
  }

  // =====================================================================
  // Стили (внутри Shadow DOM; цвета можно переопределить переменными --rs-* на сайте)
  // =====================================================================

  var CHEVRON = '<svg class="chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var CSS = [
    // contain:inline-size — ширину блока задаёт страница, а не содержимое: широкая таблица или график
    // не распирают вёрстку сайта; вид таблиц переключается по ширине самого блока (container queries)
    ":host{all:initial;display:block;min-width:0;max-width:100%;contain:inline-size}",
    // число в тексте наследует шрифт и цвет страницы, свой цвет — только у плюса/минуса
    ":host([data-rs=value]){display:inline;contain:none;font:inherit;color:inherit}",
    ".rs.v{font:inherit;color:inherit}.rs.v.up{color:var(--up)}.rs.v.down{color:var(--down)}",
    ".rs{--bg:var(--rs-bg,#fff);--card:var(--rs-card,#f5f6f8);--line:var(--rs-line,#e3e6ea);--text:var(--rs-text,#1b1f24);",
    "--muted:var(--rs-muted,#6b7380);--up:var(--rs-up,#12805c);--down:var(--rs-down,#c43b3b);--accent:var(--rs-accent,#2f6fde);",
    "--shadow:var(--rs-shadow,0 12px 32px rgba(15,23,42,.14),0 2px 6px rgba(15,23,42,.08));",
    "font:var(--rs-font-size,14px)/1.45 var(--rs-font,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif);color:var(--text);min-width:0;-webkit-text-size-adjust:100%}",
    ".rs:not(.v){container-type:inline-size;container-name:rs}",
    ".rs.dark{--bg:var(--rs-dark-bg,#14171c);--card:var(--rs-dark-card,#1d2128);--line:var(--rs-dark-line,#2c323b);--text:var(--rs-dark-text,#e8ebef);",
    "--muted:var(--rs-dark-muted,#98a1ad);--up:var(--rs-dark-up,#3cc58f);--down:var(--rs-dark-down,#ff6b6b);--accent:var(--rs-dark-accent,#6aa0ff);",
    "--shadow:var(--rs-dark-shadow,0 14px 36px rgba(0,0,0,.5),0 2px 6px rgba(0,0,0,.35))}",
    ".rs.painted{background:var(--bg);border-radius:var(--rs-radius,12px);padding:var(--rs-padding,12px)}",
    ".rs.framed{background:var(--bg);border:var(--rs-border-width,1px) solid var(--line);border-radius:var(--rs-radius,14px);padding:var(--rs-padding,18px);box-shadow:var(--rs-frame-shadow,none)}",
    ".rs *{box-sizing:border-box}",
    "button{font:inherit;color:inherit}",

    // шапка
    ".head{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px}",
    ".title{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 220px}",
    ".name{font-size:var(--rs-title-size,18px);font-weight:var(--rs-title-weight,650);margin:0;line-height:1.25;overflow-wrap:anywhere}",
    ".status{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}",
    ".dot{width:8px;height:8px;border-radius:50%;background:var(--up);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--up) 22%,transparent)}",
    ".dot.off{background:var(--down);box-shadow:0 0 0 3px color-mix(in srgb,var(--down) 22%,transparent)}",
    ".dot.test{background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}",
    ".pick{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;flex:0 1 auto;min-width:0}",
    ".pick .dd{min-width:180px;max-width:300px}",

    // выпадающий список
    ".dd{position:relative;min-width:0}",
    ".dd-btn{display:flex;align-items:center;gap:8px;width:100%;min-height:38px;padding:6px 10px 6px 12px;background:var(--card);border:1px solid var(--line);",
    "border-radius:var(--rs-control-radius,10px);cursor:pointer;text-align:left;transition:border-color .15s,background .15s}",
    ".dd-btn:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--line))}",
    ".dd.open .dd-btn{border-color:var(--accent)}",
    ".dd-btn:focus-visible,.dd-opt:focus-visible,.seg button:focus-visible,.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}",
    ".dd-btn .lbl{font-size:13px;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}",
    ".dd-btn .hint{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}",
    ".chev{flex:none;color:var(--muted);transition:transform .15s}",
    ".dd.open .chev{transform:rotate(180deg)}",
    ".dd-list{position:absolute;right:0;top:calc(100% + 6px);z-index:30;margin:0;padding:4px;list-style:none;background:var(--bg);",
    "border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);min-width:100%;width:max-content;max-width:min(380px,100cqw);",
    "max-height:320px;overflow-y:auto;overscroll-behavior:contain}",
    ".dd-list[hidden]{display:none}",
    ".dd-opt{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 16px;align-items:center;padding:8px 10px;border-radius:8px;cursor:pointer;outline:none}",
    ".dd-opt:hover,.dd-opt.act{background:var(--card)}",
    ".dd-opt[aria-selected=true] .lbl{color:var(--accent)}",
    ".dd-opt .lbl{font-size:13px;font-weight:550;overflow-wrap:anywhere}",
    ".dd-opt .sub{grid-column:1;font-size:11.5px;color:var(--muted)}",
    ".dd-opt .hint{grid-column:2;grid-row:1/span 2;font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}",

    // карточки
    // карточки: все в ряд на широком блоке, пополам (4+3) на среднем, по 2 на узком — без «сирот» в последней строке
    ".cards{display:grid;grid-template-columns:repeat(var(--n,4),minmax(0,1fr));gap:var(--rs-gap,8px)}",
    "@container rs (max-width: 819px){.cards{grid-template-columns:repeat(var(--n2,2),minmax(0,1fr))}}",
    ".card{background:var(--card);border-radius:var(--rs-card-radius,12px);padding:10px 12px;min-width:0;border:var(--rs-card-border,0)}",
    ".card .l{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".card .v{font-size:var(--rs-value-size,20px);font-weight:var(--rs-value-weight,650);margin-top:2px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em}",
    ".up{color:var(--up)}.down{color:var(--down)}",

    // секции и заголовки
    ".sec{margin-top:22px}.sec:first-child{margin-top:0}.sec:empty{display:none}",
    "h3{font-size:var(--rs-heading-size,14px);font-weight:650;margin:0 0 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;line-height:1.3}",
    ".tools{margin-left:auto;display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}",
    ".h-title{min-width:0}",
    ".tgl{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--muted);background:var(--card);border:1px solid var(--line);",
    "border-radius:9px;padding:4px 10px 4px 8px;cursor:pointer;line-height:1.2;transition:color .15s,border-color .15s}",
    ".tgl:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--line))}",
    ".tgl.on{color:var(--text)}",
    ".tgl:focus-visible{outline:2px solid var(--accent);outline-offset:2px}",
    ".dots{display:inline-flex;gap:2px}.dots i{width:7px;height:7px;border-radius:50%;background:var(--muted);opacity:.45;transition:opacity .15s,background .15s}",
    ".tgl.on .dots i:first-child{background:var(--up);opacity:1}.tgl.on .dots i:last-child{background:var(--down);opacity:1}",
    ".scroll{max-height:min(var(--mh,520px),70vh);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--line) transparent;border-radius:8px}",
    ".scroll th:last-child,.scroll td:last-child{padding-right:12px}",
    ".scroll:focus-visible{outline:2px solid var(--accent);outline-offset:2px}",
    ".scroll::-webkit-scrollbar{width:8px}.scroll::-webkit-scrollbar-thumb{background:var(--line);border-radius:8px}",
    ".deals thead th{position:sticky;top:0;z-index:1;background:var(--rs-sticky-bg,var(--bg))}",
    ".more .note{margin-right:auto;align-self:center}",
    ".seg{display:inline-flex;padding:2px;gap:2px;background:var(--card);border:1px solid var(--line);border-radius:var(--rs-control-radius,9px)}",
    ".seg button{font-size:12px;font-weight:600;background:none;border:0;color:var(--muted);padding:3px 11px;border-radius:7px;cursor:pointer;min-width:34px}",
    ".seg button.on{background:var(--bg);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.12)}",

    // график
    ".chart{position:relative;width:100%;min-width:0;overflow:hidden;contain:inline-size}",
    ".legend{position:absolute;left:8px;top:6px;z-index:3;font-size:12px;line-height:1.35;color:var(--text);background:color-mix(in srgb,var(--bg) 88%,transparent);",
    "border-radius:6px;padding:2px 6px;pointer-events:none;font-variant-numeric:tabular-nums;max-width:calc(100% - 96px)}",
    ".chart svg{display:block;width:100%;height:auto}",
    ".chev{display:block;width:14px;height:14px}",

    // таблицы
    // страховка: если что-то всё же не влезет — прокрутка внутри блока, а не всей страницы сайта
    ".tw{min-width:0;max-width:100%;overflow-x:auto}",
    "table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:13px}",
    "th,td{padding:8px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}",
    "th:first-child,td:first-child{text-align:left;padding-left:0}th:last-child,td:last-child{padding-right:0}",
    "th{color:var(--muted);font-weight:500;font-size:12px}",
    "tbody tr:last-child td{border-bottom:0}",
    ".stats td:first-child{white-space:normal;color:var(--muted);hyphens:auto;-webkit-hyphens:auto}",
    ".c-mob{display:none}.c-mob span{white-space:nowrap}",
    ".sec-name{font-weight:600}",
    ".side{display:inline-block;margin-left:6px;padding:0 6px;border-radius:5px;font-size:11px;font-weight:600;line-height:18px;vertical-align:1px}",
    ".side.long{color:var(--up);background:color-mix(in srgb,var(--up) 14%,transparent)}",
    ".side.short{color:var(--down);background:color-mix(in srgb,var(--down) 14%,transparent)}",
    ".exit{display:inline-block;margin-left:4px;padding:0 6px;border-radius:5px;font-size:11px;font-weight:600;line-height:18px;vertical-align:1px;color:var(--muted);border:1px solid var(--line)}",
    ".exit.stop{color:var(--down);border-color:color-mix(in srgb,var(--down) 45%,transparent)}",
    ".exit.take{color:var(--up);border-color:color-mix(in srgb,var(--up) 45%,transparent)}",
    ".c-st{color:var(--muted)}",
    ".note{font-size:12px;font-weight:500;color:var(--muted)}",

    ".more{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}",
    ".btn{font-size:13px;color:var(--accent);background:none;border:1px solid var(--line);border-radius:var(--rs-control-radius,9px);padding:6px 12px;cursor:pointer;text-decoration:none;line-height:1.3}",
    ".btn:hover{border-color:var(--accent)}",
    ".msg{color:var(--muted);padding:10px 0}",
    ".foot{margin-top:16px;font-size:11px;color:var(--muted)}.foot a{color:inherit}",

    // ---------- узкий блок: сделки становятся карточками ----------
    "@container rs (max-width: 860px){",
    ".deals thead,.open thead{display:none}",
    ".deals tr,.open tr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:3px 12px;padding:10px 0;border-bottom:1px solid var(--line)}",
    ".deals tbody tr:last-child,.open tbody tr:last-child{border-bottom:0}",
    ".deals td,.open td{border:0;padding:0;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".deals tr,.open tr{grid-template-columns:minmax(0,1fr) auto}",
    ".c-tin,.c-tout,.c-pin,.c-pout,.c-st,.c-sl,.c-tp{display:none!important}",
    ".c-sec{grid-column:1;grid-row:1}",
    ".c-pct{grid-column:2;grid-row:1;text-align:right!important;font-weight:650}",
    ".c-mob{display:flex!important;flex-direction:column;gap:1px;grid-column:1;grid-row:2;font-size:12px;color:var(--muted);white-space:normal!important}",
    ".c-abs{grid-column:2;grid-row:2;text-align:right!important;font-size:12px;align-self:start}",
    "}",
    "@container rs (max-width: 520px){",
    ".rs.framed{padding:calc(var(--rs-padding,18px) - 4px)}",
    ".pick{flex:1 1 100%;justify-content:stretch}",
    ".pick .dd{flex:1 1 150px;min-width:0;max-width:none}",
    ".dd-list{left:0;right:auto;width:100%;min-width:0;max-width:none}",
    ".name{font-size:calc(var(--rs-title-size,18px) - 1px)}",
    ".cards{grid-template-columns:repeat(2,minmax(0,1fr))}",
    ".cards.odd .card:last-child{grid-column:1/-1}",
    ".card .v{font-size:calc(var(--rs-value-size,20px) - 2px)}",
    "table{font-size:12.5px}",
    ".stats{table-layout:fixed}.stats th:first-child{width:38%}",
    ".stats th,.stats td{padding:7px 3px;white-space:normal;overflow-wrap:break-word;line-height:1.3}",
    ".legend{position:static;display:block;max-width:none;background:none;padding:0 0 6px;font-size:11.5px}",
    ".more .btn{flex:1 1 0;text-align:center}",
    ".more .note{flex:1 1 100%;margin:0 0 2px}",
    "}"
  ].join("");

  // =====================================================================
  // Описания показателей (для cards и value)
  // =====================================================================

  var METRICS = {
    profit:         { label: function (o) { return "Прибыль, " + o.currency; }, get: function (d) { return getPath(d, "summary.net_profit"); }, fmt: "money" },
    profit_percent: { label: "Прибыль, %", get: function (d) { return getPath(d, "summary.net_profit_percent"); }, fmt: "percent", hideZero: true },
    deals:          { label: "Сделок", get: function (d) { return getPath(d, "summary.deals_count"); }, fmt: "int" },
    open:           { label: "Открыто", get: function (d) { return getPath(d, "summary.open_count"); }, fmt: "int" },
    winrate:        { label: "Прибыльных", get: function (d) { return getPath(d, "statistics.all.profitable_percent"); }, fmt: "plainpercent" },
    pf:             { label: "Profit Factor", get: function (d) { return getPath(d, "statistics.all.profit_factor"); }, fmt: "number" },
    drawdown:       { label: "Макс. просадка", get: function (d) { return getPath(d, "statistics.all.max_drawdown_percent"); }, fmt: "drawdown" },
    sharpe:         { label: "Sharpe", get: function (d) { return getPath(d, "statistics.all.sharpe"); }, fmt: "number" },
    recovery:       { label: "Восстановление", get: function (d) { return getPath(d, "statistics.all.recovery"); }, fmt: "number" },
    payoff:         { label: "Payoff", get: function (d) { return getPath(d, "statistics.all.payoff_ratio"); }, fmt: "number" },
    commission:     { label: function (o) { return "Комиссия, " + o.currency; }, get: function (d) { return getPath(d, "statistics.all.commission"); }, fmt: "plainmoney" },
    holding:        { label: "Время в сделке", get: function (d) { return getPath(d, "statistics.all.average_holding_time"); }, fmt: "duration" },
    by_stop:        { label: "Закрыто по стопу", get: function (d) { return getPath(d, "summary.closed_by_stop"); }, fmt: "int" },
    by_take:        { label: "Закрыто по тейку", get: function (d) { return getPath(d, "summary.closed_by_take"); }, fmt: "int" }
  };

  var DEFAULT_CARDS = "profit,profit_percent,deals,winrate,pf,drawdown,sharpe";

  function formatValue(v, fmt) {
    switch (fmt) {
      case "money": return signed(v, 2);
      case "plainmoney": return num(v, 2);
      case "percent": return signed(v, 2, " %");
      case "plainpercent": return num(v, 1) + " %";
      case "drawdown": return num(v, 2) + " %";
      case "int": return num(v, 0);
      case "duration": return duration(v);
      case "text": return v == null ? "—" : String(v);
      default: return num(v, 2);
    }
  }

  function valueClass(v, fmt) {
    if (fmt === "money" || fmt === "percent") return cls(v);
    if (fmt === "drawdown") return v < 0 ? "down" : "";
    return "";
  }

  // =====================================================================
  // График доходности: Lightweight Charts (TradingView), запасной вариант — SVG
  // =====================================================================

  var lwcPromise = null;

  function loadLwc(src) {
    if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
    if (!lwcPromise) {
      lwcPromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = src || LWC_URL;
        s.async = true;
        s.onload = function () { window.LightweightCharts ? resolve(window.LightweightCharts) : reject(new Error("LightweightCharts не найден")); };
        s.onerror = function () { lwcPromise = null; reject(new Error("не удалось загрузить Lightweight Charts")); };
        document.head.appendChild(s);
      });
    }
    return lwcPromise;
  }

  // Точки по возрастанию времени, одинаковое время склеиваем (берём последнее значение) — так требует Lightweight Charts
  function series(points, key) {
    var out = [];
    (points || []).map(function (p, i) { return { t: ts(p.time), v: Number(p[key] || 0), i: i }; })
      .filter(function (p) { return p.t != null; })
      .sort(function (a, b) { return a.t - b.t || a.i - b.i; })
      .forEach(function (p) {
        if (out.length && out[out.length - 1].time === p.t) out[out.length - 1].value = p.v;
        else out.push({ time: p.t, value: p.v });
      });
    return out;
  }

  function cssVar(el, name) {
    return getComputedStyle(el).getPropertyValue(name).trim() || null;
  }

  function hexAlpha(color, alpha) {
    var m = /^#([0-9a-f]{6})$/i.exec(color || "");
    if (!m) return color;
    var n = parseInt(m[1], 16);
    return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
  }

  /**
   * Рисует график доходности (+ просадка + отметки сделок) в элемент.
   * opts: { height, unit: "abs"|"percent", currency, drawdown: true, markers: "auto"|"on"|"off", deals: [...], engine: "lwc"|"svg", theme, colorsFrom }
   * Возвращает { update(data, opts), destroy() }.
   */
  function EquityChart(el, opts) {
    this.el = el;
    this.opts = opts || {};
    this.chart = null;
    this.mode = null;
    this.data = null;
  }

  EquityChart.prototype.update = function (data, opts) {
    var self = this;
    if (opts) for (var k in opts) self.opts[k] = opts[k];
    self.data = data;

    if (self.opts.engine === "svg") return self.drawSvg();

    return loadLwc(self.opts.lwcSrc).then(function (LWC) { self.drawLwc(LWC); })
      .catch(function () { self.drawSvg(); });
  };

  EquityChart.prototype.colors = function () {
    var from = this.opts.colorsFrom || this.el;
    return {
      bg: cssVar(from, "--bg") || "#ffffff",
      text: cssVar(from, "--muted") || "#6b7380",
      line: cssVar(from, "--line") || "#e3e6ea",
      up: cssVar(from, "--up") || "#12805c",
      down: cssVar(from, "--down") || "#c43b3b",
      fg: cssVar(from, "--text") || "#1b1f24"
    };
  };

  EquityChart.prototype.unitInfo = function () {
    var d = this.data || {};
    var eq = d.equity || [];
    var hasAbs = d.money_shown !== false && eq.length && eq[0].abs != null;
    var hasPct = eq.some(function (p) { return p.percent; });
    var unit = this.opts.unit;
    if (unit !== "abs" && unit !== "percent") unit = hasAbs ? "abs" : "percent";
    if (unit === "abs" && !hasAbs) unit = "percent";
    return { unit: unit, hasAbs: !!hasAbs, hasPct: !!hasPct, suffix: unit === "percent" ? " %" : " " + (this.opts.currency || "₽") };
  };

  var MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

  // Подписи оси времени: год / месяц / «16 апр»; время суток не показываем — точки графика это сделки, а не свечи
  function tickMark(t, type) {
    var d = new Date(t * 1000);
    if (type === 0) return String(d.getUTCFullYear());
    if (type === 1) return MONTHS[d.getUTCMonth()];
    return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()];
  }

  // На узком экране график ниже, чтобы не занимать весь телефон
  EquityChart.prototype.fitHeight = function () {
    var h = parseInt(this.opts.height || 320, 10);
    var w = this.el.clientWidth || 0;
    if (w && w < 420) return Math.max(220, Math.round(h * 0.7));
    if (w && w < 640) return Math.max(240, Math.round(h * 0.85));
    return h;
  };

  EquityChart.prototype.drawLwc = function (LWC) {
    var self = this, d = self.data || {}, u = self.unitInfo(), c = self.colors();
    var height = self.fitHeight();
    var showDd = self.opts.drawdown !== false && (d.drawdown || []).length > 0;

    if (self.mode !== "lwc") {
      self.el.innerHTML = '<div class="legend"></div><div class="host"></div>';
      self.legend = self.el.querySelector(".legend");
      self.host = self.el.querySelector(".host");
      self.chart = LWC.createChart(self.host, {
        autoSize: true,
        height: height,
        layout: { background: { type: "solid", color: "transparent" }, textColor: c.text, fontSize: 11, fontFamily: "inherit", attributionLogo: true },
        grid: { vertLines: { visible: false }, horzLines: { color: hexAlpha(c.line, 0.6) || c.line } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true, tickMarkFormatter: tickMark },
        crosshair: { horzLine: { labelBackgroundColor: c.fg }, vertLine: { labelBackgroundColor: c.fg } },
        localization: { locale: "ru-RU", timeFormatter: function (t) { return fmtTs(t); } },
        // колесо мыши прокручивает страницу, а не масштабирует график; масштаб — щипком или перетаскиванием оси
        handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true }
      });
      self.host.style.height = height + "px";
      if (window.ResizeObserver) {
        self.ro = new ResizeObserver(function () {
          var h = self.fitHeight();
          if (self.host && self.host.style.height !== h + "px") self.host.style.height = h + "px";
        });
        self.ro.observe(self.el);
      }
      self.eq = self.chart.addSeries(LWC.BaselineSeries, {
        baseValue: { type: "price", price: 0 }, lineWidth: 2, priceLineVisible: false, lastValueVisible: true
      });
      if (showDd) {
        self.dd = self.chart.addSeries(LWC.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 1);
        var panes = self.chart.panes();
        if (panes[0]) panes[0].setStretchFactor(3);
        if (panes[1]) panes[1].setStretchFactor(1);
      }
      self.chart.subscribeCrosshairMove(function (p) { self.onCrosshair(p); });
      self.mode = "lwc";
      self.markersApi = null;
    }

    self.chart.applyOptions({
      layout: { textColor: c.text },
      grid: { horzLines: { color: hexAlpha(c.line, 0.6) || c.line } }
    });
    self.eq.applyOptions({
      topLineColor: c.up, topFillColor1: hexAlpha(c.up, 0.28), topFillColor2: hexAlpha(c.up, 0.03),
      bottomLineColor: c.down, bottomFillColor1: hexAlpha(c.down, 0.03), bottomFillColor2: hexAlpha(c.down, 0.28),
      priceFormat: { type: "custom", minMove: 0.01, formatter: function (v) { return num(v, 2) + u.suffix; } }
    });

    var eqData = series(d.equity, u.unit);
    self.eq.setData(eqData);

    if (self.dd) {
      var ddData = series(d.drawdown, u.unit).map(function (p) { return { time: p.time, value: p.value, color: hexAlpha(c.down, 0.55) }; });
      self.dd.setData(ddData);
      self.dd.applyOptions({ priceFormat: { type: "custom", minMove: 0.01, formatter: function (v) { return num(v, 2) + u.suffix; } } });
    }

    // Отметки сделок
    var deals = self.opts.deals || d.last_deals || [];
    var times = {};
    eqData.forEach(function (p) { times[p.time] = true; });
    self.dealsByTime = {};
    var markers = [];
    deals.forEach(function (x) {
      var t = ts(x.close_time);
      if (t == null || !times[t]) return;
      self.dealsByTime[t] = x;
      markers.push({ time: t, position: "inBar", shape: "circle", size: 0.6, color: Number(x.profit_percent) >= 0 ? c.up : c.down });
    });
    markers.sort(function (a, b) { return a.time - b.time; });
    var mode = self.opts.markers || "auto";
    var showMarkers = mode === "on" || (mode === "auto" && markers.length <= 300);
    if (LWC.createSeriesMarkers) {
      if (!self.markersApi) self.markersApi = LWC.createSeriesMarkers(self.eq, []);
      self.markersApi.setMarkers(showMarkers ? markers : []);
    }

    self.unit = u;
    self.lastPoint = eqData[eqData.length - 1];
    self.showLegend(null);
    if (!self.fitted) { self.chart.timeScale().fitContent(); self.fitted = true; }
  };

  EquityChart.prototype.onCrosshair = function (p) {
    if (!p || !p.time || !p.seriesData) return this.showLegend(null);
    var v = p.seriesData.get(this.eq);
    this.showLegend(v ? { time: p.time, value: v.value } : null);
  };

  EquityChart.prototype.showLegend = function (pt) {
    if (!this.legend) return;
    pt = pt || this.lastPoint;
    if (!pt) { this.legend.textContent = ""; return; }
    var u = this.unit;
    var html = fmtTs(pt.time) + ' · <b class="' + cls(pt.value) + '">' + signed(pt.value, 2, u.suffix) + "</b>";
    var deal = this.dealsByTime && this.dealsByTime[pt.time];
    if (deal) html += " · " + esc(deal.security) + " " + esc(deal.direction) + ' <span class="' + cls(deal.profit_percent) + '">' + signed(deal.profit_percent, 2, " %") + "</span>";
    this.legend.innerHTML = html;
  };

  EquityChart.prototype.drawSvg = function () {
    var d = this.data || {}, u = this.unitInfo();
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    if (this.chart) { this.chart.remove(); this.chart = null; }
    this.mode = "svg";
    var values = series(d.equity, u.unit).map(function (p) { return p.value; });
    var dd = series(d.drawdown, u.unit === "abs" ? "abs" : "percent").map(function (p) { return p.value; });
    this.el.innerHTML = values.length > 1 ? svgChart(values, this.opts.drawdown === false ? null : dd, parseInt(this.opts.height || 320, 10)) : '<div class="msg">Пока мало сделок для графика</div>';
  };

  EquityChart.prototype.destroy = function () {
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    if (this.chart) this.chart.remove();
    this.chart = null;
    this.el.innerHTML = "";
  };

  function svgChart(values, drawdown, height) {
    var W = 640, H = Math.max(120, Math.round(height * 0.78)), DH = Math.max(30, Math.round(height * 0.18)), pad = 4;
    var min = Math.min.apply(null, values.concat([0])), max = Math.max.apply(null, values.concat([0]));
    if (max === min) max = min + 1;
    var n = values.length;
    var x = function (i) { return pad + (W - 2 * pad) * i / (n - 1); };
    var y = function (v) { return pad + (H - 2 * pad) * (1 - (v - min) / (max - min)); };
    var line = values.map(function (v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join("");
    var area = line + "L" + x(n - 1).toFixed(1) + " " + y(0).toFixed(1) + "L" + x(0).toFixed(1) + " " + y(0).toFixed(1) + "Z";
    var color = values[n - 1] >= 0 ? "var(--up)" : "var(--down)";
    var label = ' font-size="12" fill="var(--muted)" stroke="var(--bg)" stroke-width="4" paint-order="stroke"';
    var svg = '<svg viewBox="0 0 ' + W + " " + (H + (drawdown ? DH + 8 : 0)) + '" role="img" aria-label="График доходности">';
    svg += '<line x1="0" x2="' + W + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" stroke="var(--line)" stroke-dasharray="4 4"/>';
    svg += '<path d="' + area + '" fill="' + color + '" opacity=".12"/><path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2" vector-effect="non-scaling-stroke"/>';
    svg += '<text x="' + (pad + 2) + '" y="16"' + label + ">макс. " + num(max, 2) + "</text>";
    if (min < 0) svg += '<text x="' + (pad + 2) + '" y="' + (H - 6) + '"' + label + ">мин. " + num(min, 2) + "</text>";
    if (drawdown && drawdown.length === n) {
      var dmin = Math.min.apply(null, drawdown.concat([-0.0001])), top = H + 8;
      var dline = drawdown.map(function (v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + (top + DH * (v / dmin)).toFixed(1); }).join("");
      svg += '<path d="' + dline + "L" + x(n - 1).toFixed(1) + " " + top + "L" + x(0).toFixed(1) + " " + top + 'Z" fill="var(--down)" opacity=".25"/>';
    }
    return svg + "</svg>";
  }

  // =====================================================================
  // Блоки
  // =====================================================================

  var STAT_ROWS = [
    ["net_profit", "Чистая прибыль", 2, true],
    ["net_profit_percent", "Чистая прибыль, %", 2],
    ["deals_count", "Сделок", 0],
    ["profitable_deals", "Прибыльных", 0],
    ["losing_deals", "Убыточных", 0],
    ["profitable_percent", "Прибыльных, %", 1],
    ["profit_factor", "Profit Factor", 2],
    ["payoff_ratio", "Payoff Ratio", 2],
    ["recovery", "Фактор восстановления", 2],
    ["sharpe", "Коэффициент Шарпа", 2],
    ["max_drawdown_percent", "Макс. просадка, %", 2],
    ["average_holding_time", "Среднее время в сделке"],
    ["commission", "Комиссия", 2, true]
  ];

  var TYPES = ["widget", "status", "cards", "equity", "stats", "open", "deals", "value"];

  // Темы как в OsEngine (Themes/Theme*.xaml): фон StandardBackGroundColor, панели StandardBackGroundColorLight,
  // текст ControlForegroundWhite, второстепенный TextSecondaryBrush, акцент LabelForegroundBrush.
  // Зелёный/красный в темах OsEngine не заданы — подобраны под светлую или тёмную основу.
  var THEMES = {
    smartlab:  { name: "SmartLab",       dark: true,  colors: { bg: "#111217", card: "#151A1E", text: "#EEEFFF", muted: "#A7A8AA", accent: "#FF7212" } },
    midnight:  { name: "Midnight",       dark: true,  colors: { bg: "#0E1420", card: "#141C2A", text: "#F0F4FA", muted: "#8A93A6", accent: "#4A7BC8" } },
    tiffany:   { name: "Tiffany",        dark: false, colors: { bg: "#FDFEFE", card: "#D7EFEC", text: "#0C2421", muted: "#4E6E69", accent: "#0B8F8A" } },
    bloomberg: { name: "BloombergLight", dark: false, colors: { bg: "#E0E6EE", card: "#D4DCE7", text: "#0C0E11", muted: "#59616B", accent: "#2F6DB3" } }
  };
  // id тем в самом OsEngine → палитры выше (для data-theme="osengine", если цвета в данных не пришли)
  var OSENGINE_IDS = { DarkOrange: "smartlab", Midnight: "midnight", Tiffany: "tiffany", Gray: "bloomberg" };
  var VAR_NAMES = ["--bg", "--card", "--line", "--text", "--muted", "--up", "--down", "--accent", "--shadow"];

  var BLOCKS = [];

  function Block(host, type, opts) {
    this.host = host;
    this.type = type;
    this.opts = opts;
    this.res = null;
    this.data = null;
    this.dealsAll = null;
    this.unsub = null;
    this.chart = null;

    host.setAttribute("data-rs-init", "1");
    if (!host.getAttribute("data-rs")) host.setAttribute("data-rs", type);
    this.root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    var style = document.createElement("style");
    style.textContent = CSS;
    this.box = document.createElement(type === "value" ? "span" : "div");
    this.box.className = "rs" + (type === "widget" && opts.frame !== "off" ? " framed" : "");
    this.box.setAttribute("lang", "ru"); // переносы слов по правилам русского языка
    this.box.setAttribute("part", "root");
    this.root.appendChild(style);
    this.root.appendChild(this.box);
    this.applyTheme();

    var self = this;
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", function () {
        var before = self.themeKey;
        self.applyTheme();
        if (self.themeKey !== before) self.repaint();
      });
    }
    BLOCKS.push(this);
    watchPageTheme();
  }

  // Тема блока: auto | light | dark | smartlab | midnight | tiffany | bloomberg | osengine (как сейчас в OsEngine у владельца)
  Block.prototype.applyTheme = function () {
    var t = String(this.opts.theme || "auto").toLowerCase();
    var palette = null;

    if (t === "osengine") {
      var th = this.data && this.data.theme;
      if (th && th.colors) palette = { dark: !!th.dark, colors: th.colors };
      else if (th && OSENGINE_IDS[th.id]) palette = THEMES[OSENGINE_IDS[th.id]];
    } else if (THEMES[t]) {
      palette = THEMES[t];
    }

    var style = this.box.style;
    VAR_NAMES.forEach(function (v) { style.removeProperty(v); });
    this.box.classList.remove("painted");

    if (!palette) {
      var dark = t === "dark" || ((t === "auto" || t === "osengine") && pageIsDark(this.host));
      this.box.classList.toggle("dark", !!dark);
      // в ключ — фактические цвета: сайт поменял --rs-* на лету → блок и график перерисуются
      var cs = getComputedStyle(this.box);
      this.themeKey = t + ":" + !!dark + ":" + ["--bg", "--card", "--line", "--text", "--muted", "--up", "--down", "--accent"]
        .map(function (v) { return cs.getPropertyValue(v).trim(); }).join(",");
      return;
    }

    var c = palette.colors;
    this.box.classList.toggle("dark", !!palette.dark);
    // блок без рамки в выбранной теме получает её фон — текст читается на любой странице
    this.box.classList.toggle("painted", this.type !== "value" && !this.box.classList.contains("framed"));
    style.setProperty("--bg", c.bg);
    // тёмные темы: карточка чуть светлее фона; светлые: карточка ближе к фону — подписи и цифры читаются (≥ 4,5)
    style.setProperty("--card", palette.dark ? mixHex(c.text, c.card || c.bg, 0.05) : mixHex(c.card || c.bg, c.bg, 0.5));
    style.setProperty("--line", mixHex(c.text, c.bg, 0.14));
    style.setProperty("--text", c.text);
    style.setProperty("--muted", c.muted || c.text);
    style.setProperty("--accent", c.accent || (palette.dark ? "#6aa0ff" : "#2f6fde"));
    // на цветных светлых карточках (Tiffany, Bloomberg) нужен более тёмный зелёный/красный — контраст ≥ 4,5
    style.setProperty("--up", palette.dark ? "#3cc58f" : "#0e6b47");
    style.setProperty("--down", palette.dark ? "#ff6b6b" : "#b02a2a");
    this.themeKey = t + ":" + JSON.stringify(c);
  };

  // auto: светлая или тёмная — по фактическому фону страницы под блоком, а не по настройке системы.
  // Иначе на светлом сайте у посетителя с тёмной Windows белый текст оказался бы на белом фоне.
  // Любой цвет CSS (rgb, hex, hsl, oklch у Tailwind 4 / shadcn, lab, color-mix…) → {r,g,b,a}: рисуем точку на canvas
  var colorCanvas = null;
  function parseRgb(c) {
    if (!c || c === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    var m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(c);
    if (m) {
      var alpha = m[4] == null ? 1 : (m[4].indexOf("%") > 0 ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return { r: +m[1], g: +m[2], b: +m[3], a: alpha };
    }
    try {
      if (!colorCanvas) { colorCanvas = document.createElement("canvas"); colorCanvas.width = colorCanvas.height = 1; }
      var ctx = colorCanvas.getContext("2d", { willReadFrequently: true });
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      var px = ctx.getImageData(0, 0, 1, 1).data;
      return { r: px[0], g: px[1], b: px[2], a: px[3] / 255 };
    } catch (e) {
      return null;
    }
  }

  function pageIsDark(el) {
    var node = el;
    while (node) {
      if (node.nodeType === 1) {
        var c = parseRgb(getComputedStyle(node).backgroundColor);
        if (c && c.a > 0.5) return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255 < 0.5;
      }
      node = node.parentNode || (node.host || null); // через границу чужого Shadow DOM
    }
    // фон нигде не задан: страница белая по умолчанию браузера, если у неё нет color-scheme: dark
    var scheme = getComputedStyle(document.documentElement).colorScheme || "";
    return /^dark/.test(scheme.trim());
  }

  // Сайт сменил свою тему (класс, атрибут, стиль на html/body) — блоки в auto подстраиваются
  var themeWatchStarted = false;
  function watchPageTheme() {
    if (themeWatchStarted || !window.MutationObserver) return;
    themeWatchStarted = true;
    var timer = null;
    var recheck = function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        BLOCKS.forEach(function (b) {
          var before = b.themeKey;
          b.applyTheme();
          if (b.themeKey !== before) b.repaint();
        });
      }, 30);
    };
    var mo = new MutationObserver(recheck);
    var opts = { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-bs-theme", "data-mode"] };
    mo.observe(document.documentElement, opts);
    if (document.body) mo.observe(document.body, opts);
  }

  // Смешать два цвета #RRGGBB: t — доля первого (canvas графика не понимает CSS color-mix)
  function mixHex(a, b, t) {
    var pa = /^#?([0-9a-f]{6})$/i.exec(a || ""), pb = /^#?([0-9a-f]{6})$/i.exec(b || "");
    if (!pa || !pb) return b || a;
    var x = parseInt(pa[1], 16), y = parseInt(pb[1], 16), out = "#";
    [16, 8, 0].forEach(function (sh) {
      var v = Math.round(((x >> sh) & 255) * t + ((y >> sh) & 255) * (1 - t));
      out += (v < 16 ? "0" : "") + v.toString(16);
    });
    return out;
  }

  Block.prototype.setTheme = function (theme) {
    this.opts.theme = theme;
    var before = this.themeKey;
    this.applyTheme();
    if (this.themeKey !== before) this.repaint();
  };

  // Перерисовать с новыми цветами (график берёт цвета из CSS-переменных)
  Block.prototype.repaint = function () {
    if (this.chart) { this.chart.destroy(); this.chart = null; }
    this.skeleton = false;
    this.render();
  };

  Block.prototype.start = function () {
    var self = this;
    if (!self.opts.src) {
      self.box.innerHTML = '<span class="msg">RobotStatistics: не указан data-src</span>';
      return;
    }
    if (self.type !== "value") self.box.innerHTML = '<div class="msg">Загрузка статистики…</div>';

    resolveStats(self.opts.src, self.opts.robot, self.opts.run).then(function (res) {
      self.res = res;
      if (self.unsub) self.unsub();
      self.unsub = subscribe(res.statsUrl, self.opts.refresh, function (data, err) {
        self.error = err;
        if (data) self.data = data;
        if (String(self.opts.theme).toLowerCase() === "osengine") {
          var before = self.themeKey;
          self.applyTheme();
          if (before && self.themeKey !== before && self.chart) { self.chart.destroy(); self.chart = null; self.skeleton = false; }
        }
        self.render();
      });
    }).catch(function (err) {
      self.error = err;
      self.render();
    });
  };

  Block.prototype.switchTo = function (patch) {
    for (var k in patch) this.opts[k] = patch[k];
    this.data = null;
    this.dealsAll = null;
    this.dealsLoading = false;
    if (this.chart) { this.chart.destroy(); this.chart = null; }
    this.skeleton = false;
    this.start();
  };

  Block.prototype.render = function () {
    var d = this.data, o = this.opts;

    if (!d) {
      if (this.error) {
        this.box.innerHTML = this.type === "value" ? "—" :
          '<div class="msg">Не удалось загрузить статистику: ' + esc(this.error.message) + "</div>";
      }
      return;
    }

    switch (this.type) {
      case "value": return this.renderValue();
      case "status": if (this.box.querySelector(".dd.open")) return; this.box.innerHTML = this.htmlHead(); return this.bindHead();
      case "cards": this.box.innerHTML = this.htmlCards(); return;
      case "stats": this.box.innerHTML = this.htmlStats(); return;
      case "open": this.box.innerHTML = this.htmlOpen(true); return;
      case "deals": this.box.innerHTML = this.htmlDeals(); return this.bindDeals();
      case "equity": return this.renderEquity(this.box);
      default: return this.renderWidget();
    }
  };

  Block.prototype.renderWidget = function () {
    var o = this.opts, parts = o.parts;
    var has = function (p) { return parts.indexOf(p) >= 0; };

    if (!this.skeleton) {
      this.box.innerHTML =
        (has("status") ? '<div class="sec s-head"></div>' : "") +
        (has("cards") ? '<div class="sec s-cards"></div>' : "") +
        (has("equity") ? '<div class="sec s-eq"></div>' : "") +
        (has("stats") ? '<div class="sec s-stats"></div>' : "") +
        (has("open") ? '<div class="sec s-open"></div>' : "") +
        (has("deals") ? '<div class="sec s-deals"></div>' : "") +
        '<div class="foot" part="footer"></div>';
      this.skeleton = true;
    }

    var q = this.box.querySelector.bind(this.box);
    if (has("status") && !q(".s-head .dd.open")) { q(".s-head").innerHTML = this.htmlHead(); this.bindHead(); }
    if (has("cards")) q(".s-cards").innerHTML = this.htmlCards();
    if (has("equity")) this.renderEquity(q(".s-eq"), true);
    if (has("stats")) q(".s-stats").innerHTML = '<h3 part="heading">Статистика</h3>' + this.htmlStats();
    if (has("open")) q(".s-open").innerHTML = this.htmlOpen(false);
    if (has("deals")) { q(".s-deals").innerHTML = this.htmlDeals(); this.bindDeals(); }

    q(".foot").innerHTML = "Данные OsEngine · " + (this.data.source === "tester" ? "прогон тестера " : "обновлено ") + time(this.data.generated_at) +
      (this.error ? " · ошибка обновления: " + esc(this.error.message) : "") +
      ' · <a href="https://github.com/si0683/robotstatistics" target="_blank" rel="noopener">RobotStatistics</a>';
  };

  Block.prototype.htmlHead = function () {
    var d = this.data, o = this.opts, res = this.res || {};
    var tester = d.source === "tester";
    var age = (Date.now() - new Date(d.generated_at).getTime()) / 60000;
    var offline = !tester && ((d.status && d.status.terminal !== "online") || (o.offline > 0 && age > o.offline));
    var statusText = tester
      ? "тестер" + (d.tester && d.tester.from ? " · " + time(d.tester.from).slice(0, 8) + " — " + time(d.tester.to).slice(0, 8) : "")
      : offline ? "не на связи с " + time(d.generated_at) : "робот в работе";

    var html = '<div class="head" part="header"><div class="title"><h2 class="name" part="title">' + esc(d.name || d.slug) + "</h2>" +
      '<span class="status" part="status"><span class="dot' + (tester ? " test" : offline ? " off" : "") + '"></span>' + statusText + "</span></div>";

    var pick = "";
    if (res.runs && res.runs.length > 1) {
      pick += dropdownHtml("run", "Прогон тестера", res.run, res.runs.map(function (r) {
        var parts = String(r.title || r.id).split(" · ");
        var item = (r.summary || []).filter(function (x) { return x.slug === res.robot; })[0] || (r.summary || [])[0];
        var pct = item ? Number(item.net_profit_percent) : null;
        return { value: r.id, label: parts[0], sub: parts[1] ? "период " + parts[1] : "", hint: isNum(pct) && pct ? signed(pct, 2, " %") : "", hintCls: cls(pct) };
      }));
    }
    if (res.robots && res.robots.length > 1) {
      pick += dropdownHtml("robot", "Робот", res.robot, res.robots.map(function (r) {
        var pct = Number(r.net_profit_percent);
        return { value: r.slug, label: r.name, sub: num(r.deals_count, 0) + " сделок" + (r.open_count ? " · открыто " + r.open_count : ""),
          hint: isNum(pct) && pct ? signed(pct, 2, " %") : "", hintCls: cls(pct) };
      }));
    }
    return html + (pick ? '<div class="pick">' + pick + "</div>" : "") + "</div>";
  };

  Block.prototype.bindHead = function () {
    var self = this;
    bindDropdowns(this.box, function (name, value) {
      if (name === "robot") self.switchTo({ robot: value });
      if (name === "run") self.switchTo({ run: value, robot: (self.res && self.res.robot) || null });
    });
  };

  // ---------- Выпадающий список (свой, чтобы раскрытый список выглядел одинаково везде) ----------

  function dropdownHtml(name, aria, value, items) {
    var current = items.filter(function (i) { return i.value === value; })[0] || items[0];
    var html = '<div class="dd" data-dd="' + esc(name) + '">' +
      '<button type="button" class="dd-btn" part="dropdown" aria-haspopup="listbox" aria-expanded="false" aria-label="' + esc(aria) + '">' +
      '<span class="lbl">' + esc(current.label) + "</span>" +
      (current.hint ? '<span class="hint ' + current.hintCls + '">' + esc(current.hint) + "</span>" : "") + CHEVRON + "</button>" +
      '<ul class="dd-list" part="dropdown-list" role="listbox" aria-label="' + esc(aria) + '" hidden>';
    items.forEach(function (i) {
      html += '<li class="dd-opt" role="option" tabindex="-1" data-value="' + esc(i.value) + '" aria-selected="' + (i === current) + '">' +
        '<span class="lbl">' + esc(i.label) + "</span>" +
        (i.hint ? '<span class="hint ' + i.hintCls + '">' + esc(i.hint) + "</span>" : "") +
        (i.sub ? '<span class="sub">' + esc(i.sub) + "</span>" : "") + "</li>";
    });
    return html + "</ul></div>";
  }

  function bindDropdowns(root, onChange) {
    Array.prototype.forEach.call(root.querySelectorAll(".dd"), function (dd) {
      var btn = dd.querySelector(".dd-btn");
      var list = dd.querySelector(".dd-list");
      var opts = Array.prototype.slice.call(list.querySelectorAll(".dd-opt"));
      var active = -1;

      function setActive(i) {
        if (!opts.length) return;
        active = (i + opts.length) % opts.length;
        opts.forEach(function (o, k) { o.classList.toggle("act", k === active); });
        opts[active].focus({ preventScroll: true });
        opts[active].scrollIntoView({ block: "nearest" });
      }
      function open() {
        closeAll(root, dd);
        list.hidden = false;
        dd.classList.add("open");
        btn.setAttribute("aria-expanded", "true");
        var sel = opts.findIndex(function (o) { return o.getAttribute("aria-selected") === "true"; });
        setActive(sel < 0 ? 0 : sel);
      }
      function close(focusBtn) {
        list.hidden = true;
        dd.classList.remove("open");
        btn.setAttribute("aria-expanded", "false");
        if (focusBtn) btn.focus();
      }
      function choose(o) {
        close(true);
        if (o.getAttribute("aria-selected") === "true") return;
        onChange(dd.getAttribute("data-dd"), o.getAttribute("data-value"));
      }
      dd._close = close;

      btn.addEventListener("click", function () { list.hidden ? open() : close(); });
      btn.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(); }
      });
      opts.forEach(function (o, k) {
        o.addEventListener("click", function () { choose(o); });
        o.addEventListener("mousemove", function () { if (active !== k) { active = k; opts.forEach(function (x, j) { x.classList.toggle("act", j === k); }); } });
      });
      list.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
        else if (e.key === "Home") { e.preventDefault(); setActive(0); }
        else if (e.key === "End") { e.preventDefault(); setActive(opts.length - 1); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (opts[active]) choose(opts[active]); }
        else if (e.key === "Escape" || e.key === "Tab") { close(e.key === "Escape"); }
      });
    });

    if (!root._ddOutside) {
      root._ddOutside = true;
      document.addEventListener("click", function (e) {
        var path = e.composedPath ? e.composedPath() : [];
        Array.prototype.forEach.call(root.querySelectorAll(".dd.open"), function (dd) {
          if (path.indexOf(dd) < 0 && dd._close) dd._close(false);
        });
      });
    }
  }

  function closeAll(root, except) {
    Array.prototype.forEach.call(root.querySelectorAll(".dd.open"), function (dd) {
      if (dd !== except && dd._close) dd._close(false);
    });
  }

  Block.prototype.htmlCards = function () {
    var d = this.data, o = this.opts, money = d.money_shown !== false;
    var items = String(o.items || DEFAULT_CARDS).split(",").map(function (s) { return s.trim(); });
    var cards = [];
    items.forEach(function (key) {
      var m = METRICS[key];
      if (!m) return;
      if ((m.fmt === "money" || m.fmt === "plainmoney") && !money) return;
      var v = m.get(d);
      if (v == null || (m.hideZero && !Number(v))) return;
      var label = typeof m.label === "function" ? m.label(o) : m.label;
      cards.push('<div class="card" part="card"><div class="l" part="card-label">' + esc(label) + '</div><div part="card-value" class="v ' + valueClass(v, m.fmt) + '">' + formatValue(v, m.fmt) + "</div></div>");
    });
    var n = cards.length;
    var n2 = n <= 4 ? n : Math.ceil(n / 2);
    return '<div part="cards" class="cards' + (n % 2 ? " odd" : "") + '" style="--n:' + n + ";--n2:" + n2 + '">' + cards.join("") + "</div>";
  };

  Block.prototype.renderValue = function () {
    var o = this.opts, d = this.data, m = METRICS[o.field];
    var v = m ? m.get(d) : getPath(d, o.field);
    var fmt = o.format || (m ? m.fmt : "number");
    this.box.className = "rs v " + valueClass(v, fmt) + (this.box.classList.contains("dark") ? " dark" : "");
    this.box.textContent = formatValue(v, fmt);
  };

  // Выбор посетителя (точки на графике, сколько сделок показать) — запоминаем в его браузере
  function prefGet(key) { try { return window.localStorage.getItem("robot-stats:" + key); } catch (e) { return null; } }
  function prefSet(key, v) { try { window.localStorage.setItem("robot-stats:" + key, v); } catch (e) { /* приватный режим */ } }

  // Нужны все сделки (для точек на графике или списка 50/100) — грузим deals.json один раз на робота
  Block.prototype.needAllDeals = function (after) {
    var self = this, d = this.data;
    var total = getPath(d, "summary.deals_count") || 0;
    if (self.dealsAll || total <= (d.last_deals || []).length) return false;
    if (!self.dealsLoading) {
      self.dealsLoading = true;
      load(resolveUrl(self.res.statsUrl, "deals.json")).then(function (doc) {
        self.dealsAll = doc.deals || [];
        self.render();
      }).catch(function () { self.dealsAll = d.last_deals || []; /* deals.json не опубликован */ });
    }
    return true;
  };

  Block.prototype.markersShown = function () {
    var pref = prefGet("markers");
    var mode = pref || this.opts.markers || "auto";
    if (mode === "on") return true;
    if (mode === "off") return false;
    return (getPath(this.data, "summary.deals_count") || 0) <= 300;
  };

  Block.prototype.renderEquity = function (el, inWidget) {
    var self = this, d = this.data, o = this.opts;
    if (!el.querySelector(".eqchart")) {
      el.innerHTML = '<h3 class="eqhead" part="heading"></h3><div class="chart eqchart" part="chart"></div>';
      self.chart = null;
    }
    var head = el.querySelector(".eqhead");
    var chartEl = el.querySelector(".eqchart");
    if (!self.chart) self.chart = new EquityChart(chartEl, {});

    var u = self.chart.unitInfo.call({ data: d, opts: { unit: o.unit, currency: o.currency } });
    var markers = self.markersShown();
    var tools = "";
    if (o.markersToggle !== "off" && (d.equity || []).length > 1) {
      tools += '<button type="button" part="switch" class="tgl' + (markers ? " on" : "") + '" data-act="markers" aria-pressed="' + markers + '" title="Показать или скрыть точки сделок">' +
        '<span class="dots"><i></i><i></i></span>Сделки</button>';
    }
    if (u.hasAbs && u.hasPct) {
      tools += '<span class="seg" part="switch"><button type="button" data-unit="abs" class="' + (u.unit === "abs" ? "on" : "") + '">' + esc(o.currency) +
        '</button><button type="button" data-unit="percent" class="' + (u.unit === "percent" ? "on" : "") + '">%</button></span>';
    }
    var title = o.title != null ? o.title : "Доходность";
    head.style.display = title || tools ? "" : "none";
    head.innerHTML = '<span class="h-title">' + esc(title) + "</span>" + (tools ? '<span class="tools">' + tools + "</span>" : "");
    Array.prototype.forEach.call(head.querySelectorAll("[data-unit]"), function (b) {
      b.onclick = function () { o.unit = b.getAttribute("data-unit"); self.renderEquity(el, inWidget); };
    });
    var tgl = head.querySelector('[data-act="markers"]');
    if (tgl) tgl.onclick = function () { prefSet("markers", self.markersShown() ? "off" : "on"); self.renderEquity(el, inWidget); };

    if ((d.equity || []).length < 2) {
      chartEl.innerHTML = '<div class="msg">Пока мало сделок для графика</div>';
      self.chart.mode = null;
      return;
    }

    // точки ставим на каждую сделку: если в stats.json только последние — догружаем все
    if (markers) self.needAllDeals();

    self.chart.update(d, {
      unit: u.unit, currency: o.currency, height: o.height || (inWidget ? 300 : 360),
      drawdown: o.drawdown !== "off", markers: markers ? "on" : "off", engine: o.chart === "svg" ? "svg" : "lwc",
      deals: self.dealsAll || d.last_deals, colorsFrom: self.box, lwcSrc: o.lwcSrc
    });
  };

  Block.prototype.htmlStats = function () {
    var s = this.data.statistics, money = this.data.money_shown !== false;
    if (!s) return '<div class="msg">Нет статистики</div>';
    var html = '<div class="tw"><table class="stats" part="table"><thead><tr><th></th><th>Все</th><th>Long</th><th>Short</th></tr></thead><tbody>';
    STAT_ROWS.forEach(function (row) {
      if (row[3] && !money) return;
      if (!s.all || s.all[row[0]] == null) return;
      html += "<tr><td>" + row[1] + "</td>";
      ["all", "long", "short"].forEach(function (side) {
        var v = s[side] ? s[side][row[0]] : null;
        html += "<td>" + (row[2] == null ? esc(duration(v)) : num(v, row[2])) + "</td>";
      });
      html += "</tr>";
    });
    return html + "</tbody></table></div>";
  };

  Block.prototype.htmlOpen = function (standalone) {
    var list = this.data.open_positions;
    if (!list || !list.length) return standalone ? '<div class="msg">Открытых позиций нет</div>' : "";
    var hasStop = list.some(function (p) { return isNum(p.stop_price); });
    var hasTake = list.some(function (p) { return isNum(p.take_price); });
    var html = "<h3 part=\"heading\">Открытые позиции</h3><div class=\"tw\"><table class=\"open\" part=\"table\"><thead><tr><th>Бумага</th><th>Вход</th><th>Цена входа</th>" +
      (hasStop ? "<th>Стоп</th>" : "") + (hasTake ? "<th>Тейк</th>" : "") + "<th>Результат</th></tr></thead><tbody>";
    list.forEach(function (p) {
      html += "<tr>" + secCell(p) + '<td class="c-tin">' + time(p.open_time) + '</td><td class="c-pin">' + num(p.entry_price, 6) + "</td>" +
        (hasStop ? '<td class="c-sl">' + optNum(p.stop_price) + "</td>" : "") +
        (hasTake ? '<td class="c-tp">' + optNum(p.take_price) + "</td>" : "") +
        '<td class="c-pct ' + cls(p.profit_percent) + '">' + signed(p.profit_percent, 2, " %") + "</td>" +
        '<td class="c-mob"><span>' + time(p.open_time) + " · " + num(p.entry_price, 6) + "</span>" + stopLine(p) + "</td></tr>";
    });
    return html + "</tbody></table></div>";
  };

  function secCell(p) {
    var long = p.direction === "Long";
    var tip = [];
    if (p.signal_open) tip.push("Вход: " + p.signal_open);
    if (p.signal_close) tip.push("Выход: " + p.signal_close);
    var exit = p.exit_by === "stop" ? '<span class="exit stop">стоп</span>' : p.exit_by === "take" ? '<span class="exit take">тейк</span>' : "";
    return '<td class="c-sec"' + (tip.length ? ' title="' + esc(tip.join(" · ")) + '"' : "") + '><span class="sec-name">' + esc(p.security) +
      '</span><span class="side ' + (long ? "long" : "short") + '">' + (long ? "Long" : "Short") + "</span>" + exit + "</td>";
  }

  function optNum(v) { return isNum(v) ? num(v, 6) : "—"; }

  // «стоп 295,5 · тейк 309» для телефона
  function stopLine(p) {
    var parts = [];
    if (isNum(p.stop_price)) parts.push("стоп " + num(p.stop_price, 6));
    if (isNum(p.take_price)) parts.push("тейк " + num(p.take_price, 6));
    return parts.length ? "<span>" + parts.join(" · ") + "</span>" : "";
  }

  var DEALS_STEPS = [20, 50, 100];

  // Сколько сделок показывать: свой data-limit (5, 10…) — фиксированно без переключателя; иначе 20 / 50 / 100 на выбор
  Block.prototype.dealsLimit = function () {
    var fixed = parseInt(this.opts.limit || 0, 10);
    if (fixed > 0 && DEALS_STEPS.indexOf(fixed) < 0) return { n: fixed, filter: false };
    var n = parseInt(prefGet("deals") || 0, 10) || fixed || 20;
    if (DEALS_STEPS.indexOf(n) < 0) n = 20;
    return { n: n, filter: this.opts.dealsFilter !== "off" };
  };

  Block.prototype.htmlDeals = function () {
    var d = this.data, o = this.opts, money = d.money_shown !== false;
    var lim = this.dealsLimit();
    var total = getPath(d, "summary.deals_count") || (d.last_deals || []).length;
    var lastLen = (d.last_deals || []).length;

    if (lim.n > lastLen && total > lastLen) this.needAllDeals();
    var source = this.dealsAll && this.dealsAll.length ? this.dealsAll : (d.last_deals || []);
    var list = source.slice().sort(function (a, b) { return String(b.close_time).localeCompare(String(a.close_time)); });
    var shown = list.slice(0, lim.n);

    var byStop = getPath(d, "summary.closed_by_stop"), byTake = getPath(d, "summary.closed_by_take");
    var noteParts = [];
    if (isNum(byStop) && (byStop > 0 || list.some(function (p) { return isNum(p.stop_price); }))) noteParts.push("по стопу " + num(byStop, 0));
    if (isNum(byTake) && (byTake > 0 || list.some(function (p) { return isNum(p.take_price); }))) noteParts.push("по тейку " + num(byTake, 0));
    var note = noteParts.length ? '<span class="note">' + noteParts.join(" · ") + "</span>" : "";

    var filter = "";
    if (lim.filter && total > DEALS_STEPS[0]) {
      filter = '<span class="tools"><span class="seg" part="switch" role="group" aria-label="Сколько сделок показать">';
      DEALS_STEPS.forEach(function (n, i) {
        if (i > 0 && total <= DEALS_STEPS[i - 1]) return; // нет смысла показывать «100», если сделок 30
        filter += '<button type="button" data-deals="' + n + '" class="' + (n === lim.n ? "on" : "") + '">' + n + "</button>";
      });
      filter += "</span></span>";
    }

    var html = '<h3 part="heading"><span class="h-title">Последние сделки</span>' + note + filter + "</h3>";
    if (!shown.length) return html + '<div class="msg">Закрытых сделок пока нет</div>';

    // нет стопов и тейков у робота — колонки нет вовсе; есть только стопы или только тейки — показываем только их
    var hasStop = list.some(function (p) { return isNum(p.stop_price); });
    var hasTake = list.some(function (p) { return isNum(p.take_price); });
    var stopHead = hasStop && hasTake ? "Стоп / тейк" : hasStop ? "Стоп" : hasTake ? "Тейк" : "";
    var maxH = parseInt(o.maxHeight || 520, 10);
    html += '<div class="tw' + (maxH > 0 ? " scroll" : "") + '"' + (maxH > 0 ? ' style="--mh:' + maxH + 'px"' : "") + ' tabindex="0">' +
      '<table class="deals" part="table"><thead><tr><th>Бумага</th><th>Вход</th><th>Выход</th><th>Цена входа</th><th>Цена выхода</th>' +
      (stopHead ? "<th>" + stopHead + "</th>" : "") + "<th>Результат</th>" +
      (money ? "<th>" + esc(o.currency) + "</th>" : "") + "</tr></thead><tbody>";
    shown.forEach(function (p) {
      html += "<tr>" + secCell(p) + '<td class="c-tin">' + time(p.open_time) + '</td><td class="c-tout">' + time(p.close_time) +
        '</td><td class="c-pin">' + num(p.entry_price, 6) + '</td><td class="c-pout">' + num(p.close_price, 6) + "</td>" +
        (stopHead ? '<td class="c-st">' + (hasStop && hasTake ? optNum(p.stop_price) + " / " + optNum(p.take_price) : hasStop ? optNum(p.stop_price) : optNum(p.take_price)) + "</td>" : "") +
        '<td class="c-pct ' + cls(p.profit_percent) + '">' + signed(p.profit_percent, 2, " %") + "</td>" +
        (money ? '<td class="c-abs ' + cls(p.profit_abs) + '">' + signed(p.profit_abs, 2) + "</td>" : "") +
        '<td class="c-mob"><span>' + time(p.open_time) + " → " + time(p.close_time) + "</span><span>" +
        num(p.entry_price, 6) + " → " + num(p.close_price, 6) + "</span>" + stopLine(p) + "</td></tr>";
    });
    html += "</tbody></table></div>";

    var base = this.res.statsUrl;
    var shownNote = '<span class="note">показано ' + num(shown.length, 0) + " из " + num(total, 0) + "</span>";
    if (o.links !== "off") {
      html += '<div class="more">' + shownNote +
        '<a part="button" class="btn" href="' + esc(resolveUrl(base, "deals.csv")) + '" download>Все сделки — CSV</a>' +
        '<a part="button" class="btn" href="' + esc(resolveUrl(base, "deals.rss")) + '" target="_blank" rel="noopener">RSS</a></div>';
    } else {
      html += '<div class="more">' + shownNote + "</div>";
    }
    return html;
  };

  Block.prototype.bindDeals = function () {
    var self = this;
    Array.prototype.forEach.call(this.box.querySelectorAll("[data-deals]"), function (b) {
      b.onclick = function () {
        prefSet("deals", b.getAttribute("data-deals"));
        var host = self.type === "widget" ? self.box.querySelector(".s-deals") : self.box;
        host.innerHTML = self.htmlDeals();
        self.bindDeals();
      };
    });
  };

  // =====================================================================
  // Запуск
  // =====================================================================

  function readOpts(el, defaults) {
    var o = {};
    for (var k in defaults) o[k] = defaults[k];
    var map = {
      src: "data-src", robot: "data-robot", run: "data-run", theme: "data-theme", currency: "data-currency",
      refresh: "data-refresh", offline: "data-offline", height: "data-height", unit: "data-unit", items: "data-items",
      field: "data-field", format: "data-format", limit: "data-limit", markers: "data-markers", chart: "data-chart",
      drawdown: "data-drawdown", title: "data-title", links: "data-links", frame: "data-frame",
      markersToggle: "data-markers-toggle", dealsFilter: "data-deals-filter", maxHeight: "data-max-height",
      lwcSrc: "data-lwc-src"
    };
    for (var key in map) {
      var v = attr(el, map[key], null);
      if (v != null) o[key] = v;
    }
    var parts = attr(el, "data-parts", null);
    if (parts) o.parts = parts.split(",").map(function (s) { return s.trim(); });
    if (o.src && el !== defaults.__script && attr(el, "data-src", null)) o.src = resolveUrl(location.href, o.src);
    o.refresh = parseInt(o.refresh, 10) || 0;
    o.offline = parseInt(o.offline, 10) || 0;
    return o;
  }

  function scriptDefaults(script) {
    var src = attr(script, "data-src", "");
    return {
      __script: script,
      src: src ? resolveUrl(location.href, src) : "",
      theme: attr(script, "data-theme", "auto"),
      currency: attr(script, "data-currency", "₽"),
      refresh: attr(script, "data-refresh", "30"),
      offline: attr(script, "data-offline", "5"),
      robot: attr(script, "data-robot", null),
      run: attr(script, "data-run", null),
      lwcSrc: attr(script, "data-lwc-src", null),
      chart: attr(script, "data-chart", null),
      parts: ["status", "cards", "equity", "stats", "open", "deals"]
    };
  }

  function mount(el, type, opts) {
    if (el.getAttribute("data-rs-init")) return null;
    var block = new Block(el, TYPES.indexOf(type) >= 0 ? type : "widget", opts);
    block.applyTheme();
    block.start();
    return block;
  }

  var lastDefaults = null;

  function boot(script) {
    var defaults = scriptDefaults(script);
    if (defaults.src || !lastDefaults) lastDefaults = defaults;

    function run() {
      var blocks = document.querySelectorAll("[data-rs]:not([data-rs-init])");
      Array.prototype.forEach.call(blocks, function (el) {
        mount(el, attr(el, "data-rs", "widget"), readOpts(el, lastDefaults));
      });

      // Уровень 1: готовый виджет
      var targetId = attr(script, "data-target", null);
      var target = targetId ? document.getElementById(targetId) : document.getElementById("robot-stats");
      if (target && !target.getAttribute("data-rs-init")) {
        mount(target, "widget", readOpts(script, defaults));
      } else if (!target && !targetId && !blocks.length && defaults.src && script && script.parentNode) {
        var div = document.createElement("div");
        script.parentNode.insertBefore(div, script.nextSibling);
        mount(div, "widget", readOpts(script, defaults));
      }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
    else run();
  }

  // =====================================================================
  // Публичный API (уровень 3)
  // =====================================================================

  window.RobotStats = {
    __ready: true,
    __boot: boot,
    version: VERSION,

    /** Загрузить stats.json / robots.json / runs.json (с кэшем). */
    load: load,

    /** Найти stats.json робота: resolve("/robot-stats/robots.json", "candlemonster-1") → { statsUrl, robots, … } */
    resolve: function (src, robot, run) { return resolveStats(src, robot, run); },

    /** Подписаться на обновления: возвращает функцию отписки. */
    subscribe: function (url, refreshSec, cb) { return subscribe(resolveUrl(location.href, url), refreshSec || 30, cb); },

    /** Вставить блок в элемент: RobotStats.mount(el, "cards", { src, robot, items }) */
    mount: function (el, type, opts) {
      var o = {};
      var defs = lastDefaults || scriptDefaults(null);
      for (var k in defs) o[k] = defs[k];
      for (var j in (opts || {})) o[j] = opts[j];
      if (o.src) o.src = resolveUrl(location.href, o.src);
      o.refresh = parseInt(o.refresh, 10) || 0;
      o.offline = parseInt(o.offline, 10) || 0;
      if (typeof o.parts === "string") o.parts = o.parts.split(",");
      return mount(el, type || "widget", o);
    },

    /** Нарисовать график доходности в любом элементе из уже загруженных данных. */
    equityChart: function (el, data, opts) {
      var c = new EquityChart(el, {});
      opts = opts || {};
      if (!opts.colorsFrom) opts.colorsFrom = el;
      c.update(data, opts);
      return c;
    },

    /** Форматирование как в виджете: RobotStats.format(1.9876, "number") → "1,99" */
    format: formatValue,

    /** Сменить тему всех блоков: "auto" | "light" | "dark" | "smartlab" | "midnight" | "tiffany" | "bloomberg" | "osengine" */
    setTheme: function (theme) { BLOCKS.forEach(function (b) { b.setTheme(theme); }); },

    /** Сайт сменил тему не через html/body (например, у своего контейнера) — пересчитать «auto» */
    refreshTheme: function () { BLOCKS.forEach(function (b) { var k = b.themeKey; b.applyTheme(); if (b.themeKey !== k) b.repaint(); }); },
    themes: ["auto", "light", "dark"].concat(Object.keys(THEMES)).concat(["osengine"]),
    metrics: Object.keys(METRICS)
  };

  boot(currentScript);
})();
