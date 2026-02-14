import fs from "fs";
import path from "path";
import { env } from "../config/env.js";

type LogLevel = "debug" | "info" | "warn" | "error" | "http";

const levelRank: Record<Exclude<LogLevel, "http">, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const rankFor = (level: LogLevel) => (level === "http" ? levelRank.info : levelRank[level]);

const formatSessionId = (date: Date) => {
  const pad = (value: number) => value.toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  return `${year}${month}${day}_${hour}${minute}${second}_pid${process.pid}`;
};

const toSerializableError = (error: unknown) => {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
};

const serialize = (value: unknown) => {
  if (value instanceof Error) return toSerializableError(value);
  return value;
};

class SessionLogger {
  readonly sessionId: string;
  readonly sessionDir: string;
  readonly appLogPath: string;
  readonly errorLogPath: string;

  private readonly configuredRank: number;
  private readonly appStream: fs.WriteStream;
  private readonly errorStream: fs.WriteStream;

  constructor() {
    const sessionId = formatSessionId(new Date());
    const sessionDir = path.resolve(process.cwd(), env.LOG_DIRECTORY, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });

    this.sessionId = sessionId;
    this.sessionDir = sessionDir;
    this.appLogPath = path.join(sessionDir, `app-${sessionId}.log`);
    this.errorLogPath = path.join(sessionDir, `error-${sessionId}.log`);
    this.configuredRank = levelRank[env.LOG_LEVEL];
    this.appStream = fs.createWriteStream(this.appLogPath, { flags: "a", encoding: "utf8" });
    this.errorStream = fs.createWriteStream(this.errorLogPath, { flags: "a", encoding: "utf8" });
  }

  private shouldWrite(level: LogLevel) {
    return rankFor(level) >= this.configuredRank;
  }

  private emit(level: LogLevel, event: string, data?: Record<string, unknown>) {
    if (!this.shouldWrite(level)) return;

    const payload = data
      ? Object.fromEntries(Object.entries(data).map(([key, value]) => [key, serialize(value)]))
      : undefined;

    const record = {
      timestamp: new Date().toISOString(),
      level,
      event,
      sessionId: this.sessionId,
      pid: process.pid,
      ...(payload ? { data: payload } : {})
    };

    const line = `${JSON.stringify(record)}\n`;
    this.appStream.write(line);

    if (level === "error") {
      this.errorStream.write(line);
    }

    if (level === "error") {
      console.error(line.trimEnd());
    } else if (level === "warn") {
      console.warn(line.trimEnd());
    } else {
      console.log(line.trimEnd());
    }
  }

  debug(event: string, data?: Record<string, unknown>) {
    this.emit("debug", event, data);
  }

  info(event: string, data?: Record<string, unknown>) {
    this.emit("info", event, data);
  }

  warn(event: string, data?: Record<string, unknown>) {
    this.emit("warn", event, data);
  }

  error(event: string, data?: Record<string, unknown>) {
    this.emit("error", event, data);
  }

  http(event: string, data?: Record<string, unknown>) {
    this.emit("http", event, data);
  }

  close(): Promise<void> {
    const closeStream = (stream: fs.WriteStream) =>
      new Promise<void>((resolve) => {
        stream.end(() => resolve());
      });

    return Promise.all([closeStream(this.appStream), closeStream(this.errorStream)]).then(() => undefined);
  }
}

export const logger = new SessionLogger();

export const logSession = {
  id: logger.sessionId,
  directory: logger.sessionDir,
  appLogPath: logger.appLogPath,
  errorLogPath: logger.errorLogPath
};
