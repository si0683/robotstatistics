/** Типы для robot-stats-receiver.mjs (чтобы TypeScript / astro check не ругались на импорт). */

export interface ReceiverOptions {
  /** Папка для данных. По умолчанию ROBOT_STATS_DIR или ./robot-stats-data */
  dataDir?: string;
  /** Ключ из OsEngine («Ключ для webhook»). По умолчанию ROBOT_STATS_KEY. Пустой — без проверки (только локально!) */
  key?: string;
  /** Часть адреса перед именем файла. По умолчанию "/robot-stats/" */
  prefix?: string;
  /** CORS для чтения файлов. По умолчанию "*" */
  allowOrigin?: string;
  log?: (message: string) => void;
}

export interface Receiver {
  /** POST — принять данные от OsEngine, GET/HEAD — отдать файл, OPTIONS — CORS */
  handle(request: Request): Promise<Response>;
  dataDir: string;
}

export function createReceiver(options?: ReceiverOptions): Receiver;

/** Обёртка для node:http / Express / Connect */
export function nodeHandler(receiver: Receiver): (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => Promise<void>;
