// src/lib/logger.ts
//
// Structured, PII-safe logger for a health application.
//
// WHY THIS EXISTS (read before changing):
//  - Logs are copied to third-party systems (Vercel, Sentry, ...) and kept for weeks. Health data
//    and credentials must never reach them, even by accident.
//  - So redaction is layered: (1) by KEY name, (2) by VALUE pattern (tokens, emails, data URIs, blobs),
//    (3) by SIZE (long strings, big arrays and deep objects are cut), (4) by TYPE (files and binary
//    are never printed). Any one layer alone is not enough.
//  - Logging must NEVER throw or block a request, whatever it is given (cycles, BigInt, hostile getters).
//
// USAGE
//   logger.info("analysis finished", { ms: 420, ok: true });
//   logger.error("analysis failed", error);                 // Error -> name, scrubbed message, short stack
//   const log = logger.child({ requestId });                // bound context on every line
//   const done = log.startTimer("ocr"); ...; done({ pages }); // logs "ocr finished" with { ms }
//
// CONFIG (env)
//   LOG_LEVEL = debug | info | warn | error | silent
//   default: development -> debug, production -> info, test -> silent

/* ============================================================
   TYPES
   ============================================================ */

   export type LogLevel = "debug" | "info" | "warn" | "error";

   export type LogData = Record<string, unknown>;
   
   export interface LogEntry {
     timestamp: string;
     level: LogLevel;
     message: string;
     env?: string;
     region?: string;
     release?: string;
     context?: LogData;
     data?: LogData;
   }
   
   /** Receives every emitted entry (already sanitized). Use it to forward errors to Sentry/Datadog. */
   export type LogSink = (entry: LogEntry) => void;
   
   /* ============================================================
      LIMITS
      ============================================================ */
   
   const MAX_DEPTH = 5;
   const MAX_KEYS = 50;
   const MAX_ARRAY_ITEMS = 20;
   const MAX_STRING_LENGTH = 300;
   const MAX_MESSAGE_LENGTH = 500;
   const MAX_STACK_LINES = 8;
   const MAX_ENTRY_CHARS = 8_000;
   
   /** Strings are cut to this size BEFORE regex scrubbing so hostile input cannot make us slow. */
   const SCRUB_INPUT_LIMIT = 2_000;
   
   const REDACTED = "[REDACTED]";
   
   const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
   
   /* ============================================================
      KEY-BASED REDACTION
      ============================================================ */
   
   /** Keys are compared lowercase with "-", "_" and spaces removed. */
   const SENSITIVE_EXACT_KEYS = new Set([
     // credentials
     "password",
     "passwd",
     "pwd",
     "otp",
     "pin",
     "cvv",
     "authorization",
     "cookie",
     "setcookie",
     "apikey",
     // personal identifiers
     "email",
     "phone",
     "phonenumber",
     "mobile",
     "address",
     "dob",
     "dateofbirth",
     "birthdate",
     "fullname",
     "firstname",
     "lastname",
     "patientname",
     "filename",
     "aadhaar",
     "aadhar",
     "pan",
     "passport",
     // health / user content
     "symptoms",
     "history",
     "messages",
     "text",
     "content",
     "rawtext",
     "summary",
     "recommendations",
     "keydatapoints",
     "note",
     "notes",
     "comment",
     "comments",
     "conversation",
     "document",
     "file",
     "body",
   ]);
   
   /**
    * Substring patterns catch variants ("idToken", "userPassword", "journalEntries", "documentDataUri").
    * For these, plain numbers/booleans are kept, so usage counters such as `promptTokens: 120` survive.
    */
   const SENSITIVE_KEY_FRAGMENTS = [
     "password",
     "secret",
     "token",
     "apikey",
     "authorization",
     "cookie",
     "credential",
     "privatekey",
     "sessionid",
     "symptom",
     "diagnos",
     "journal",
     "medical",
     "ocrtext",
     "documenttext",
     "labresult",
     "healthrecord",
     "prompt",
     "transcript",
     "datauri",
   ];
   
   function normalizeKey(key: string): string {
     return key.replace(/[-_\s]/g, "").toLowerCase();
   }
   
   function isSensitiveKey(key: string | null, value: unknown): boolean {
     if (key === null) return false;
   
     const normalized = normalizeKey(key);
   
     if (SENSITIVE_EXACT_KEYS.has(normalized)) return true;
   
     if (!SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))) return false;
   
     return typeof value !== "number" && typeof value !== "boolean";
   }
   
   /* ============================================================
      VALUE-BASED SCRUBBING
      ============================================================ */
   
   const VALUE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
     [/data:[\w./+-]+;base64,[A-Za-z0-9+/=]+/g, "[REDACTED_DATA_URI]"],
     [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[REDACTED_JWT]"],
     [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]"],
     [/\bgsk_[A-Za-z0-9]{20,}/g, "[REDACTED_KEY]"],
     [/\bAIza[0-9A-Za-z_-]{30,}/g, "[REDACTED_KEY]"],
     [/\bsk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_KEY]"],
     [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]"],
     // long base64 / hex-looking runs: file contents, keys, hashes we never want in logs
     [/[A-Za-z0-9+/_-]{120,}={0,2}/g, "[REDACTED_BLOB]"],
   ];
   
   function truncate(value: string, max: number): string {
     return value.length <= max ? value : `${value.slice(0, max)}…[+${value.length - max} chars]`;
   }
   
   function scrubString(value: string, max = MAX_STRING_LENGTH): string {
     let result = value.length > SCRUB_INPUT_LIMIT ? value.slice(0, SCRUB_INPUT_LIMIT) : value;
   
     for (const [pattern, replacement] of VALUE_PATTERNS) {
       result = result.replace(pattern, replacement);
     }
   
     return truncate(result, max);
   }
   
   /* ============================================================
      SANITIZATION
      ============================================================ */
   
   interface SanitizeState {
     seen: WeakSet<object>;
   }
   
   function describeBinary(value: object): string | null {
     if (typeof ArrayBuffer !== "undefined") {
       if (value instanceof ArrayBuffer) return `[Binary ${value.byteLength} bytes]`;
       if (ArrayBuffer.isView(value)) return `[Binary ${value.byteLength} bytes]`;
     }
   
     /* File name is deliberately omitted: report names often contain the patient's name. */
     if (typeof Blob !== "undefined" && value instanceof Blob) return `[Blob ${value.size} bytes]`;
   
     return null;
   }
   
   function serializeError(error: Error, depth: number, state: SanitizeState): LogData {
     const out: LogData = {
       name: scrubString(String(error.name), 80),
       message: scrubString(String(error.message), MAX_STRING_LENGTH),
     };
   
     const code = (error as { code?: unknown }).code;
     if (typeof code === "string" || typeof code === "number") {
       out.code = typeof code === "string" ? scrubString(code, 80) : code;
     }
   
     if (typeof error.stack === "string") {
       out.stack = scrubString(
         error.stack.split("\n").slice(0, MAX_STACK_LINES).join("\n"),
         MAX_STRING_LENGTH * 4
       );
     }
   
     const cause = (error as { cause?: unknown }).cause;
     if (cause !== undefined && depth < MAX_DEPTH) {
       out.cause = sanitize(cause, "cause", depth + 1, state);
     }
   
     return out;
   }
   
   function sanitize(value: unknown, key: string | null, depth: number, state: SanitizeState): unknown {
     if (isSensitiveKey(key, value)) return REDACTED;
   
     switch (typeof value) {
       case "string":
         return scrubString(value);
       case "number":
         return Number.isFinite(value) ? value : String(value);
       case "bigint":
         return value.toString();
       case "boolean":
       case "undefined":
         return value;
       case "symbol":
         return value.toString();
       case "function":
         return "[Function]";
       default:
         break;
     }
   
     if (value === null) return null;
   
     const object = value as object;
   
     if (depth >= MAX_DEPTH) return "[MaxDepth]";
     if (state.seen.has(object)) return "[Circular]";
   
     const binary = describeBinary(object);
     if (binary) return binary;
   
     state.seen.add(object);
   
     try {
       if (object instanceof Error) return serializeError(object, depth, state);
   
       if (object instanceof Date) {
         return Number.isNaN(object.getTime()) ? "[Invalid Date]" : object.toISOString();
       }
   
       if (object instanceof URL) return scrubString(object.toString());
   
       if (object instanceof Map || object instanceof Set) {
         const items = [...(object instanceof Map ? object.entries() : object.values())];
         return sanitizeArray(items, depth, state);
       }
   
       if (Array.isArray(object)) return sanitizeArray(object, depth, state);
   
       const result: LogData = {};
       const entries = Object.entries(object as Record<string, unknown>);
   
       for (const [entryKey, entryValue] of entries.slice(0, MAX_KEYS)) {
         result[entryKey] = sanitize(entryValue, entryKey, depth + 1, state);
       }
   
       if (entries.length > MAX_KEYS) {
         result._truncatedKeys = entries.length - MAX_KEYS;
       }
   
       return result;
     } catch {
       return "[Unserializable]";
     } finally {
       // allow the same object to appear twice (siblings) without being flagged as a cycle
       state.seen.delete(object);
     }
   }
   
   function sanitizeArray(items: unknown[], depth: number, state: SanitizeState): unknown[] {
     const result = items
       .slice(0, MAX_ARRAY_ITEMS)
       .map((item) => sanitize(item, null, depth + 1, state));
   
     if (items.length > MAX_ARRAY_ITEMS) {
       result.push(`[+${items.length - MAX_ARRAY_ITEMS} more items]`);
     }
   
     return result;
   }
   
   /** Sanitize any value for logging. Exported so other modules can reuse the exact same rules. */
   export function sanitizeForLog(value: unknown): unknown {
     try {
       return sanitize(value, null, 0, { seen: new WeakSet() });
     } catch {
       return "[Unserializable]";
     }
   }
   
   function sanitizeData(data: unknown): LogData | undefined {
     if (data === undefined || data === null) return undefined;
   
     /* logger.error("msg", error) shorthand */
     if (data instanceof Error) {
       return sanitizeForLog({ error: data }) as LogData;
     }
   
     if (typeof data !== "object" || Array.isArray(data)) {
       return { value: sanitizeForLog(data) };
     }
   
     const clean = sanitizeForLog(data);
   
     if (typeof clean !== "object" || clean === null) return undefined;
   
     return Object.keys(clean).length > 0 ? (clean as LogData) : undefined;
   }
   
   /* ============================================================
      ENVIRONMENT
      ============================================================ */
   
   /** Evaluated per call (not once at import) so behaviour can be controlled in tests. */
   function isBrowser(): boolean {
     return typeof window !== "undefined";
   }
   
   function readEnv(name: string): string | undefined {
     return typeof process !== "undefined" ? process.env?.[name] : undefined;
   }
   
   function currentNodeEnv(): string | undefined {
     // literal access so Next.js can inline it in client bundles
     return typeof process !== "undefined" ? process.env.NODE_ENV : undefined;
   }
   
   function minimumLevel(): LogLevel | "silent" {
     const configured = readEnv("LOG_LEVEL")?.toLowerCase();
   
     if (configured === "silent" || (configured && configured in LEVEL_RANK)) {
       return configured as LogLevel | "silent";
     }
   
     const env = currentNodeEnv();
   
     if (env === "test") return "silent";
     if (env === "development") return "debug";
   
     return "info";
   }
   
   function shouldLog(level: LogLevel): boolean {
     const minimum = minimumLevel();
   
     if (minimum === "silent") return false;
   
     return LEVEL_RANK[level] >= LEVEL_RANK[minimum];
   }
   
   function now(): number {
     return typeof performance !== "undefined" ? performance.now() : Date.now();
   }
   
   /* ============================================================
      SINKS
      ============================================================ */
   
   const sinks = new Set<LogSink>();
   
   /** Register a forwarder (e.g. Sentry). Returns an unsubscribe function. */
   export function addLogSink(sink: LogSink): () => void {
     sinks.add(sink);
     return () => sinks.delete(sink);
   }
   
   /* ============================================================
      LOGGER
      ============================================================ */
   
   function consoleMethod(level: LogLevel): (...args: unknown[]) => void {
     switch (level) {
       case "debug":
         return console.debug;
       case "info":
         return console.info;
       case "warn":
         return console.warn;
       case "error":
         return console.error;
     }
   }
   
   export class Logger {
     private readonly context: LogData | undefined;
   
     constructor(context?: LogData) {
       this.context = context;
     }
   
     /** A logger that adds `context` (e.g. requestId) to every line. Context is sanitized too. */
     child(context: LogData): Logger {
       const clean = sanitizeData(context);
   
       return new Logger(clean ? { ...this.context, ...clean } : this.context);
     }
   
     /** Returns a function that logs "<label> finished" with the elapsed milliseconds. */
     startTimer(label: string, data?: LogData): (extra?: LogData) => number {
       const start = now();
   
       return (extra) => {
         const ms = Math.round(now() - start);
         this.info(`${label} finished`, { ...data, ...extra, ms });
         return ms;
       };
     }
   
     debug(message: string, data?: unknown): void {
       this.emit("debug", message, data);
     }
   
     info(message: string, data?: unknown): void {
       this.emit("info", message, data);
     }
   
     warn(message: string, data?: unknown): void {
       this.emit("warn", message, data);
     }
   
     error(message: string, data?: unknown): void {
       this.emit("error", message, data);
     }
   
     private emit(level: LogLevel, message: string, data: unknown): void {
       try {
         if (!shouldLog(level)) return;
   
         const clean = sanitizeData(data);
   
         const entry: LogEntry = {
           timestamp: new Date().toISOString(),
           level,
           message: scrubString(String(message), MAX_MESSAGE_LENGTH),
         };
   
         if (!isBrowser()) {
           const env = readEnv("VERCEL_ENV") ?? currentNodeEnv();
           const region = readEnv("VERCEL_REGION");
           const release = readEnv("VERCEL_GIT_COMMIT_SHA")?.slice(0, 7);
   
           if (env) entry.env = env;
           if (region) entry.region = region;
           if (release) entry.release = release;
         }
   
         if (this.context) entry.context = this.context;
         if (clean) entry.data = clean;
   
         this.write(entry);
   
         for (const sink of sinks) {
           try {
             sink(entry);
           } catch {
             /* a broken sink must never break the app */
           }
         }
       } catch {
         /* logging must never throw */
       }
     }
   
     private write(entry: LogEntry): void {
       const print = consoleMethod(entry.level);
   
       /* Browser or local development: readable output. */
       if (isBrowser() || currentNodeEnv() === "development") {
         const prefix = `[${entry.level.toUpperCase()}]`;
         const details = { ...entry.context, ...entry.data };
   
         if (Object.keys(details).length > 0) {
           print(prefix, entry.message, details);
         } else {
           print(prefix, entry.message);
         }
   
         return;
       }
   
       /* Server production: exactly one JSON line per event (what log platforms parse best). */
       let line: string;
   
       try {
         line = JSON.stringify(entry);
   
         if (line.length > MAX_ENTRY_CHARS) {
           line = JSON.stringify({
             ...entry,
             data: { _truncated: true, _originalChars: line.length },
           });
         }
       } catch {
         line = JSON.stringify({
           timestamp: entry.timestamp,
           level: entry.level,
           message: entry.message,
           data: { _error: "unserializable log entry" },
         });
       }
   
       print(line);
     }
   }
   
   export const logger = new Logger();
   
   export function createLogger(context?: LogData): Logger {
     return context ? logger.child(context) : logger;
   }