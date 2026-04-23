export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export function createLogger(defaultContext: LogContext = {}): Logger {
  function write(level: "info" | "warn" | "error", message: string, context?: LogContext): void {
    const payload = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...defaultContext,
      ...(context ?? {}),
    };

    const line = JSON.stringify(payload);

    if (level === "error") {
      console.error(line);
      return;
    }

    if (level === "warn") {
      console.warn(line);
      return;
    }

    console.log(line);
  }

  return {
    info(message: string, context?: LogContext): void {
      write("info", message, context);
    },
    warn(message: string, context?: LogContext): void {
      write("warn", message, context);
    },
    error(message: string, context?: LogContext): void {
      write("error", message, context);
    },
  };
}
