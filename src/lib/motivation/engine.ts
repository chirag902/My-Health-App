import { z } from "zod";

export const motivationAIResponseSchema = z.object({
  message: z.string().min(10).max(220),
});
export type DailyMotivationOutput = z.infer<typeof motivationAIResponseSchema>;

export const MOTIVATION_THEMES = [
  { id: "discipline", angle: "discipline beats motivation on hard days" },
  { id: "small-wins", angle: "small consistent actions compounding over time" },
  { id: "progress-not-perfection", angle: "progress over perfectionism" },
  { id: "resilience", angle: "bouncing back after a missed day/setback" },
  { id: "self-compassion", angle: "self-kindness without excusing avoidance" },
  { id: "data-driven", angle: "tracking/logging as self-knowledge, not judgment" },
  { id: "patience", angle: "trusting a slow process" },
  { id: "identity", angle: "becoming the kind of person who shows up" },
  { id: "energy", angle: "managing energy, not just time" },
  { id: "today-only", angle: "focus only on today's single next action" },
  { id: "compound-effect", angle: "tiny habits compounding into big change" },
  { id: "rest-as-strategy", angle: "rest/recovery as part of performance" },
  { id: "accountability", angle: "keeping promises to yourself" },
  { id: "courage-to-start", angle: "starting imperfectly beats waiting" },
  { id: "long-term-vision", angle: "connecting today's action to a future self" },
  { id: "overcoming-excuses", angle: "naming and moving past excuses" },
  { id: "feedback-not-failure", angle: "treating setbacks as data, not failure" },
  { id: "mental-health", angle: "mental wellbeing as part of health" },
  { id: "celebrate-wins", angle: "acknowledging progress already made" },
  { id: "avoid-comparison", angle: "running your own race, not comparing" },
] as const;

export type ThemeId = (typeof MOTIVATION_THEMES)[number]["id"];

// 2 curated, non-generic fallbacks per theme — used only when AI call fails/rate-limited,
// never silently reused as "the" default.
export const FALLBACK_POOL: Record<ThemeId, string[]> = {
  discipline: [
    "Motivation got you started; discipline is what shows up when you don't feel like it. Do the smallest version of today's habit right now.",
    "You don't need to feel ready. You need to take the next 2-minute action, then decide again.",
  ],
  "small-wins": [
    "One tracked habit today beats a perfect plan you never start. Log one thing.",
    "Small, boring, repeated actions are the actual engine of change — not big dramatic ones.",
  ],
  "progress-not-perfection": [
    "A 60% day that gets logged still beats a 100% day that gets skipped. Keep the streak of showing up, not of being perfect.",
    "You're allowed an imperfect entry today. An honest 'okay' beats a skipped 'perfect'.",
  ],
  resilience: [
    "Missing yesterday doesn't erase your progress — only quitting does. Open the app, log today, move on.",
    "A setback is one data point, not your whole story. Reset the count and continue.",
  ],
  "self-compassion": [
    "Talk to yourself the way you'd talk to someone you're trying to help, not punish.",
    "Being hard on yourself hasn't made this easier so far — try being accurate instead of harsh.",
  ],
  "data-driven": [
    "Every log you add makes your own pattern clearer. You're building evidence about yourself, not just a diary.",
    "Your trends are more honest than your mood. Log it and let the data do the noticing.",
  ],
  patience: [
    "Health changes are usually invisible week to week and obvious month to month. Keep going without proof today.",
    "You won't feel today's log mattering. It will matter in 30 days of them stacked together.",
  ],
  identity: [
    "Every entry is a vote for the kind of person you're becoming — cast one today.",
    "You're not 'trying to be healthy', you're practicing being someone who tracks and follows through.",
  ],
  energy: [
    "Protect your energy today like it's a resource, because it is — rest counts as productive.",
    "If you're low today, do less but do it anyway. Consistency, not intensity, is the goal.",
  ],
  "today-only": [
    "Forget the whole journey for a second — what's the one next action for today only?",
    "You only ever have to manage today. Handle that, and the rest takes care of itself.",
  ],
  "compound-effect": [
    "This log feels tiny today. In 90 days it's a pattern you can see and trust.",
    "No single day of tracking looks impressive. The stack of them does.",
  ],
  "rest-as-strategy": [
    "Recovery isn't the opposite of progress — it's part of the plan. Rest on purpose, not by accident.",
    "A planned rest day logged is still discipline. Burnout is not a badge of honor.",
  ],
  accountability: [
    "This app is a promise to yourself. Keep today's small promise.",
    "Nobody's watching except you — that's exactly why it counts.",
  ],
  "courage-to-start": [
    "You don't need the perfect plan to start, just the next honest entry.",
    "Starting messy beats waiting for the 'right' moment that never comes.",
  ],
  "long-term-vision": [
    "The person you'll be in a year is built by what you log today — not someday.",
    "Future you is counting on today you to not skip this.",
  ],
  "overcoming-excuses": [
    "\"I'll start tomorrow\" is the most expensive sentence in health. Start with one log now.",
    "The excuse is real, the action is still possible. Do both can be true — act anyway.",
  ],
  "feedback-not-failure": [
    "An off day in your data isn't failure — it's information you can actually use.",
    "Your trend line can absorb one bad day. It can't recover from you quitting.",
  ],
  "mental-health": [
    "How you feel is part of your health data too — it's okay for today's log to be about that.",
    "Taking care of your mind today is still taking care of your health.",
  ],
  "celebrate-wins": [
    "Look back at last week's entries for a second — that's real progress, not nothing.",
    "You've already shown up more times than you're giving yourself credit for.",
  ],
  "avoid-comparison": [
    "Your only competition is your own last month, not anyone else's highlight reel.",
    "Someone else's pace says nothing about your progress. Log your own day.",
  ],
};

export function pickTheme(dayIndex: number, recentThemes: string[]): ThemeId {
  const themes = MOTIVATION_THEMES.map((t) => t.id);
  let idx = dayIndex % themes.length;
  let tries = 0;
  while (recentThemes.includes(themes[idx]) && tries < themes.length) {
    idx = (idx + 1) % themes.length;
    tries++;
  }
  return themes[idx];
}

function normalize(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean)
  );
}

export function isTooSimilar(candidate: string, recent: string[]): boolean {
  const a = normalize(candidate);
  for (const r of recent) {
    const b = normalize(r);
    const intersection = [...a].filter((w) => b.has(w)).length;
    const union = new Set([...a, ...b]).size;
    if (union > 0 && intersection / union > 0.5) return true;
  }
  return false;
}

export function pickFallback(theme: ThemeId, recent: string[]): string {
  const pool = FALLBACK_POOL[theme];
  const unused = pool.filter((m) => !isTooSimilar(m, recent));
  const candidates = unused.length > 0 ? unused : pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function buildPrompt(theme: ThemeId, recentMessages: string[]): string {
  const themeDef = MOTIVATION_THEMES.find((t) => t.id === theme)!;
  const avoidList = recentMessages.slice(0, 8).map((m) => `- "${m.slice(0, 60)}..."`).join("\n");
  return `
Write one short, original daily motivational message for a health/habit-tracking app user.

Theme angle for today: ${themeDef.angle}

Hard constraints:
1. Maximum two sentences.
2. No medical advice, no diagnosis.
3. No Markdown.
4. Do NOT use these overused openers/phrases: "Embrace today", "You've got this", "positive mindset", "Every day is a new opportunity".
5. Must feel concretely different in structure and wording from the messages below — do not paraphrase them, write something structurally distinct.
6. Return JSON only: {"message": "..."}

Messages already shown recently (avoid repeating these ideas/phrasing):
${avoidList || "(none)"}
`.trim();
}