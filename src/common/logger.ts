import pino from "pino";

export function buildLogger(dev: boolean) {
  return pino({ level: dev ? "debug" : "info" });
}
