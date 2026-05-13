type LogData = Record<string, unknown>;

type LogLevel = "info" | "warn" | "error";

function emit(level: LogLevel, event: string, data?: LogData) {
  if (process.env.NODE_ENV === "test") return;
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...data,
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info(event: string, data?: LogData) {
    emit("info", event, data);
  },
  warn(event: string, data?: LogData) {
    emit("warn", event, data);
  },
  error(event: string, err: unknown, data?: LogData) {
    const errorData: LogData = {
      ...data,
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
    };
    emit("error", event, errorData);
  },
};
