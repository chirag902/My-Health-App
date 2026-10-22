export type ActionErrorCode =
  | "invalid_input"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "not_configured"
  | "invalid_response"
  | "too_large";

export type ActionSuccess<T> = { success: true; data: T };
export type ActionError = {
  success: false;
  error: string;
  code?: ActionErrorCode;
  retryAfterSeconds?: number;
};
export type ActionResponse<T> = ActionSuccess<T> | ActionError;

export const ok = <T>(data: T): ActionSuccess<T> => ({ success: true, data });

export const fail = (
  error: string,
  code?: ActionErrorCode,
  retryAfterSeconds?: number
): ActionError => ({
  success: false,
  error,
  ...(code ? { code } : {}),
  ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
});