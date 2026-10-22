const hits = new Map<string, { count: number; resetAt: number }>();

export function checkMotivationRateLimit(
  key: string,
  limit: number,
  windowSec: number
): { allowed: boolean } {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { allowed: true };
  }

  if (entry.count >= limit) return { allowed: false };

  entry.count += 1;
  return { allowed: true };
}