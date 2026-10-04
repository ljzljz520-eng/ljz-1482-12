type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, meta?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: "script-collab-backend",
    msg,
    ...(meta ?? {}),
  });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const logger = {
  debug: (m: Record<string, unknown> | string, msg?: string) =>
    emit("debug", typeof m === "string" ? m : (msg ?? ""), typeof m === "object" ? m : undefined),
  info: (m: Record<string, unknown> | string, msg?: string) =>
    emit("info", typeof m === "string" ? m : (msg ?? ""), typeof m === "object" ? m : undefined),
  warn: (m: Record<string, unknown> | string, msg?: string) =>
    emit("warn", typeof m === "string" ? m : (msg ?? ""), typeof m === "object" ? m : undefined),
  error: (m: Record<string, unknown> | string, msg?: string) =>
    emit("error", typeof m === "string" ? m : (msg ?? ""), typeof m === "object" ? m : undefined),
};
