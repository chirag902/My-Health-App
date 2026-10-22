// Run: npx tsx --env-file=.env.local eval/run-eval.ts
// Requires Node 20.6+ for --env-file, or use `dotenv/config` instead.

import { assessSymptoms } from "@/lib/diagnosis-core";
import { EVAL_CASES, type Urgency } from "./cases";

const RANK: Record<Urgency, number> = { "self-care": 0, routine: 1, soon: 2, urgent: 3, emergency: 4 };
const CONCURRENCY = 3;

type Row = {
  id: string;
  expected: Urgency;
  got: Urgency | "followUpQuestion" | "error";
  exact: boolean;
  delta: number; // got - expected; negative = under-triage (dangerous)
  deterministic: boolean;
  trap: boolean;
  critical: boolean;
  ms: number;
  note?: string;
};

async function runOne(c: (typeof EVAL_CASES)[number]): Promise<Row> {
  const started = Date.now();
  const res = await assessSymptoms({
    mode: "quick", // forces a diagnosis object, no follow-up ambiguity
    history: [{ role: "user", content: c.message }],
    profile: c.profile,
  });
  const ms = Date.now() - started;

  if (!res.success) {
    return { id: c.id, expected: c.expected, got: "error", exact: false, delta: -99, deterministic: !!c.deterministic, trap: !!c.trap, critical: !!c.critical, ms, note: c.note };
  }
  if ("followUpQuestion" in res.data) {
    return { id: c.id, expected: c.expected, got: "followUpQuestion", exact: false, delta: -99, deterministic: !!c.deterministic, trap: !!c.trap, critical: !!c.critical, ms, note: c.note };
  }
  const got = res.data.diagnosis.urgency;
  return {
    id: c.id,
    expected: c.expected,
    got,
    exact: got === c.expected,
    delta: RANK[got] - RANK[c.expected],
    deterministic: !!c.deterministic,
    trap: !!c.trap,
    critical: !!c.critical,
    ms,
    note: c.note,
  };
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

async function main() {
  console.log(`Running ${EVAL_CASES.length} cases, concurrency ${CONCURRENCY}...\n`);
  const rows = await pool(EVAL_CASES, CONCURRENCY, runOne);

  const exactRate = rows.filter((r) => r.exact).length / rows.length;
  const underTriage = rows.filter((r) => r.delta < 0);
  const overTriage = rows.filter((r) => r.delta > 0);
  const criticalFails = rows.filter((r) => r.critical && r.delta < 0);
  const errors = rows.filter((r) => r.got === "error" || r.got === "followUpQuestion");

  console.log("=== SUMMARY ===");
  console.log(`Exact match:        ${(exactRate * 100).toFixed(1)}% (${rows.filter((r) => r.exact).length}/${rows.length})`);
  console.log(`Under-triage:       ${underTriage.length} (model said LESS urgent than reality — dangerous)`);
  console.log(`Over-triage:        ${overTriage.length} (model said MORE urgent — costly, safer)`);
  console.log(`Errors/no-answer:   ${errors.length}`);
  console.log(`CRITICAL failures:  ${criticalFails.length} (marked critical AND under-triaged)\n`);

  if (criticalFails.length) {
    console.log("=== CRITICAL FAILURES (fix before anything else) ===");
    for (const r of criticalFails) {
      console.log(`[${r.id}] expected=${r.expected} got=${r.got} ${r.note ? `— ${r.note}` : ""}`);
    }
    console.log("");
  }

  const byBucket = new Map<Urgency, { total: number; exact: number }>();
  for (const r of rows) {
    const b = byBucket.get(r.expected) ?? { total: 0, exact: 0 };
    b.total++;
    if (r.exact) b.exact++;
    byBucket.set(r.expected, b);
  }
  console.log("=== BY EXPECTED BUCKET ===");
  for (const [bucket, b] of byBucket) {
    console.log(`${bucket.padEnd(10)} ${b.exact}/${b.total}`);
  }

  console.log("\n=== ALL MISSES ===");
  for (const r of rows.filter((r) => !r.exact)) {
    console.log(`[${r.id}] expected=${r.expected} got=${r.got} delta=${r.delta} trap=${r.trap} ${r.note ? `— ${r.note}` : ""}`);
  }

  const fs = await import("node:fs/promises");
  await fs.writeFile(`eval/results-${Date.now()}.json`, JSON.stringify(rows, null, 2));

  if (criticalFails.length > 0) process.exitCode = 1; // fails CI
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});