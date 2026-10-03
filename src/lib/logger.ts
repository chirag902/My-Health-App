type LogLevel = "info" | "warn" | "error";

type LogData = Record<string, unknown>;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: LogData;
}

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordconfirmation",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "set-cookie",
  "apikey",
  "api_key",
  "groq_api_key",
  "firebaseapikey",
  "secret",
  "privatekey",

  // Healthcare / user-sensitive data
  "symptoms",
  "diagnosis",
  "diagnoses",
  "journal",
  "journalentry",
  "journalentries",
  "medicaldocument",
  "medicaldocuments",
  "documenttext",
  "ocrtext",
  "labresults",
  "healthrecords",
  "healthrecord",
  "medicalhistory",
  "conversation",
  "messages",
]);

function normalizeKey(key: string): string {
  return key.replace(/[-_\s]/g, "").toLowerCase();
}

function sanitizeValue(
  key: string,
  value: unknown
): unknown {
  if (SENSITIVE_KEYS.has(normalizeKey(key))) {
    return "[REDACTED]";
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === "object" && item !== null
        ? sanitizeObject(item as Record<string, unknown>)
        : item
    );
  }

  if (
    typeof value === "object" &&
    value !== null
  ) {
    return sanitizeObject(
      value as Record<string, unknown>
    );
  }

  return value;
}

function sanitizeObject(
  data: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    sanitized[key] = sanitizeValue(key, value);
  }

  return sanitized;
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      error: "Unable to serialize log entry",
    });
  }
}

class Logger {
  private log(
    level: LogLevel,
    message: string,
    data?: LogData
  ): void {
    const sanitizedData =
      data && Object.keys(data).length > 0
        ? sanitizeObject(data)
        : undefined;

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(sanitizedData
        ? { data: sanitizedData }
        : {}),
    };

    if (process.env.NODE_ENV === "development") {
      const prefix = `[${level.toUpperCase()}]`;

      switch (level) {
        case "info":
          console.info(
            prefix,
            message,
            sanitizedData ?? ""
          );
          break;

        case "warn":
          console.warn(
            prefix,
            message,
            sanitizedData ?? ""
          );
          break;

        case "error":
          console.error(
            prefix,
            message,
            sanitizedData ?? ""
          );
          break;
      }

      return;
    }

    /*
     * Keep production logs structured.
     *
     * Avoid logging routine informational events in production
     * unless they are intentionally useful for monitoring.
     */
    if (level === "info") {
      return;
    }

    const serialized = safeSerialize(logEntry);

    if (level === "warn") {
      console.warn(serialized);
    } else {
      console.error(serialized);
    }
  }

  info(
    message: string,
    data?: LogData
  ): void {
    this.log("info", message, data);
  }

  warn(
    message: string,
    data?: LogData
  ): void {
    this.log("warn", message, data);
  }

  error(
    message: string,
    data?: LogData
  ): void {
    this.log("error", message, data);
  }
}

export const logger = new Logger();