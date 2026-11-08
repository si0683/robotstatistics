/**
 * Типы данных RobotStatistics и API виджета robot-stats.js (window.RobotStats).
 * https://github.com/si0683/robotstatistics
 *
 * Подключение в TypeScript-проекте: положите файл рядом с кодом и добавьте
 *   /// <reference path="./robot-stats.d.ts" />
 */

declare namespace RobotStatistics {
  /** Время сделок — как в журнале OsEngine, без часового пояса: "2026-11-08T18:45:00". */
  type LocalTime = string;

  interface Deal {
    number: number;
    security: string;
    direction: "Long" | "Short";
    open_time: LocalTime;
    /** нет у открытой позиции */
    close_time?: LocalTime;
    entry_price: number;
    /** нет у открытой позиции */
    close_price?: number;
    /** только если в RobotStatistics включено «Показывать объём позиций» */
    volume?: number;
    /** результат сделки в % на один контракт */
    profit_percent: number;
    /** результат в пунктах цены */
    profit_points: number;
    /** уровень стопа: у открытой — текущий (с трейлингом), у закрытой — последний перед выходом. Только при «Показывать стоп и тейк» */
    stop_price?: number;
    /** уровень тейка — как stop_price */
    take_price?: number;
    /** чем закрыта сделка: по подписи сигнала, иначе по близости цены закрытия к уровню (3 шага цены или 0,3 %) */
    exit_by?: "stop" | "take";
    /** подписи сигналов робота (SignalTypeOpen / SignalTypeClose). Только при «Показывать сигналы робота» */
    signal_open?: string;
    signal_close?: string;
    /** только если включено «Показывать суммы в деньгах» */
    profit_abs?: number;
    commission?: number;
  }

  interface StatisticsBlock {
    net_profit?: number;
    net_profit_percent: number;
    deals_count: number;
    profitable_deals: number;
    losing_deals: number;
    profitable_percent: number;
    profit_factor: number;
    payoff_ratio: number;
    recovery: number;
    sharpe: number;
    max_drawdown_percent: number;
    /** формат OsEngine: "H 14 M 20 S 0" */
    average_holding_time: string;
    commission?: number;
  }

  interface CurvePoint {
    time: LocalTime;
    /** % от депозита (0, если депозит вкладки неизвестен) */
    percent: number;
    /** в деньгах — только если суммы показываются */
    abs?: number;
  }

  /** <robot>/stats.json */
  interface Stats {
    schema: 1;
    slug: string;
    name: string;
    type: string;
    source: "terminal" | "tester";
    generated_at: string;
    money_shown: boolean;
    status: { terminal: "online" | "tester"; last_trade_time: LocalTime | null };
    tester?: { run: string; from?: LocalTime; to?: LocalTime; set?: string };
    summary: {
      net_profit?: number;
      net_profit_percent: number;
      deals_count: number;
      open_count: number;
      /** закрыто по стопу / тейку — только при «Показывать стоп и тейк» */
      closed_by_stop?: number;
      closed_by_take?: number;
      period_from: LocalTime | null;
      period_to: LocalTime | null;
    };
    statistics: { all: StatisticsBlock; long: StatisticsBlock; short: StatisticsBlock };
    equity: CurvePoint[];
    drawdown: CurvePoint[];
    /** нет при «Открытые позиции = Не показывать», пустой при «Только после закрытия» */
    open_positions?: Deal[];
    /** последние N закрытых сделок, новые первыми */
    last_deals: Deal[];
  }

  /** <robot>/deals.json */
  interface Deals {
    schema: 1;
    slug: string;
    name: string;
    generated_at: string;
    money_shown: boolean;
    count: number;
    /** все закрытые сделки, по времени закрытия */
    deals: Deal[];
  }

  /** robots.json */
  interface Robots {
    schema: 1;
    source: "terminal" | "tester";
    generated_at: string;
    robots: Array<{
      slug: string;
      name: string;
      type: string;
      net_profit_percent: number;
      net_profit?: number;
      deals_count: number;
      open_count: number;
      files: { stats_json?: string; deals_json?: string; deals_csv?: string; stats_csv?: string; deals_rss?: string };
    }>;
  }

  /** tester/runs.json — прогоны тестера, новые первыми */
  interface Runs {
    schema: 1;
    source: "tester";
    generated_at: string;
    runs: Array<{
      id: string;
      title: string;
      finished_at: string;
      /** путь к robots.json прогона относительно runs.json */
      robots: string;
      summary: Robots["robots"];
    }>;
  }

  type BlockType = "widget" | "status" | "cards" | "equity" | "stats" | "open" | "deals" | "value";

  type Metric =
    | "profit" | "profit_percent" | "deals" | "open" | "winrate" | "pf"
    | "drawdown" | "sharpe" | "recovery" | "payoff" | "commission" | "holding" | "by_stop" | "by_take";

  interface BlockOptions {
    /** stats.json робота, robots.json или tester/runs.json */
    src?: string;
    /** slug робота из robots.json */
    robot?: string;
    /** id прогона из runs.json (по умолчанию — последний) */
    run?: string;
    theme?: "auto" | "light" | "dark";
    currency?: string;
    /** секунды; 0 — не обновлять */
    refresh?: number;
    /** минут без обновления до «не на связи»; 0 — не проверять */
    offline?: number;
    /** widget: какие части показать */
    parts?: Array<"status" | "cards" | "equity" | "stats" | "open" | "deals"> | string;
    /** cards: список показателей через запятую */
    items?: string;
    /** value: показатель или путь в stats.json ("statistics.long.profit_factor") */
    field?: Metric | string;
    format?: "money" | "plainmoney" | "percent" | "plainpercent" | "drawdown" | "int" | "number" | "duration" | "text";
    /** equity */
    height?: number;
    unit?: "abs" | "percent";
    markers?: "auto" | "on" | "off";
    drawdown?: "on" | "off";
    chart?: "lwc" | "svg";
    title?: string;
    /** deals */
    limit?: number;
    links?: "on" | "off";
    allButton?: "on" | "off";
    /** widget: рамка вокруг */
    frame?: "on" | "off";
    /** свой адрес Lightweight Charts (если CDN недоступен) */
    lwcSrc?: string;
  }

  interface EquityChartOptions {
    height?: number;
    unit?: "abs" | "percent";
    currency?: string;
    drawdown?: boolean;
    markers?: "auto" | "on" | "off";
    /** сделки для отметок на графике (по умолчанию last_deals) */
    deals?: Deal[];
    engine?: "lwc" | "svg";
    /** элемент, из CSS-переменных которого брать цвета (--up, --down, --line …) */
    colorsFrom?: Element;
  }

  interface EquityChart {
    update(data: Stats, opts?: EquityChartOptions): Promise<void> | void;
    destroy(): void;
  }

  interface Api {
    version: string;
    load<T = Stats | Robots | Runs | Deals>(url: string): Promise<T>;
    resolve(src: string, robot?: string, run?: string): Promise<{ statsUrl: string; robots?: Robots["robots"]; runs?: Runs["runs"] }>;
    subscribe(url: string, refreshSec: number, cb: (data: any, error: Error | null) => void): () => void;
    mount(el: HTMLElement, type?: BlockType, opts?: BlockOptions): unknown;
    equityChart(el: HTMLElement, data: Stats, opts?: EquityChartOptions): EquityChart;
    format(value: unknown, fmt: BlockOptions["format"]): string;
    metrics: Metric[];
  }
}

interface Window {
  RobotStats: RobotStatistics.Api;
}
