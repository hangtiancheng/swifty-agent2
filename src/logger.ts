// Application logger: pino with pretty console output and a plain file stream.
// The file log is the stable tail target for graph traces (log/app.log).
import fs from "node:fs";
import path from "node:path";

import pino from "pino";
import pretty from "pino-pretty";

import { settings } from "./config.ts";

const logDir = path.join(settings.root, "log");
fs.mkdirSync(logDir, { recursive: true });

const streams: pino.StreamEntry[] = [
  {
    level: "info",
    stream: pretty({
      colorize: true,
      translateTime: "SYS:HH:MM:ss",
      ignore: "pid,hostname",
    }),
  },
  {
    level: "info",
    stream: pino.destination({
      dest: path.join(logDir, "app.log"),
      sync: false,
      mkdir: true,
    }),
  },
];

export const logger = pino(
  { level: "info", base: null, timestamp: pino.stdTimeFunctions.isoTime },
  pino.multistream(streams),
);

export function childLogger(name: string): pino.Logger {
  return logger.child({ module: name });
}

export function flushLogs(): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.flush((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
