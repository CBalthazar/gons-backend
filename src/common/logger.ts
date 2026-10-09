import pino from "pino";
import type { FastifyBaseLogger } from "fastify";

export function buildLogger(dev: boolean): FastifyBaseLogger {
  return pino({ level: dev ? "debug" : "info" }) as FastifyBaseLogger;
}
