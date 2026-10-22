"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  Bot,
  Loader2,
  MessageCircleQuestion,
  Phone,
  PlusCircle,
  Send,
  User,
  UserCog,
  Zap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getDiagnosisAction } from "@/app/actions";
import { cn } from "@/lib/utils";
import type { AiDiagnosisInput } from "@/lib/types";
import DiagnosisResults from "./diagnosis-results";
import {
  detectCrisis,
  diagnosisToText,
  hasProfile,
  sanitizeProfile,
  getLocalHistory,
  addLocalHistoryEntry,
  historyToLines,
  hasHistoryConsent,
  setHistoryConsent,
  LOCALES,
  getSavedLocale,
  saveLocale,
  type Crisis,
  type DiagnosisData,
  type HealthProfile,
  type LocaleId,
} from "@/lib/diagnosis-ui";

/* ---------- types ---------- */

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  apiText?: string; // structured intake prefix, sent to API only, not shown
  intakeSummary?: string; // shown as a small caption on the user's bubble
  diagnosis?: DiagnosisData;
}

type ChatMode = "quick" | "detailed";

const PROFILE_KEY = "mha.healthProfile.v1"; // add to account-deletion cleanup
const MAX_HISTORY = 16;
const EXAMPLES = [
  "Headache for 3 days with light sensitivity",
  "Anxious and unable to sleep for a week",
  "Acidity and bloating after meals",
];

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const isFollowUp = (d: unknown): d is { followUpQuestion: string } =>
  !!d &&
  typeof d === "object" &&
  typeof (d as Record<string, unknown>).followUpQuestion === "string" &&
  ((d as Record<string, string>).followUpQuestion as string).trim().length > 0;

const isDiagnosis = (d: unknown): d is { diagnosis: DiagnosisData } =>
  !!d &&
  typeof d === "object" &&
  typeof (d as Record<string, unknown>).diagnosis === "object" &&
  (d as Record<string, unknown>).diagnosis !== null;

/* ---------- structured intake ---------- */

function IntakeChips({ onApply, onSkip }: { onApply: (summary: string) => void; onSkip: () => void }) {
  const [onset, setOnset] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string | null>(null);
  const [fever, setFever] = useState<string | null>(null);

  const group = (label: string, options: string[], value: string | null, set: (v: string | null) => void) => (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => set(value === o ? null : o)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              value === o ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary"
            )}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );

  const apply = () => {
    const parts = [onset && `Onset: ${onset}`, severity && `Severity: ${severity}`, fever && `Fever: ${fever}`].filter(Boolean);
    onApply(parts.length ? `[${parts.join(" | ")}]` : "");
  };

  return (
    <div className="mb-3 space-y-3 rounded-xl border bg-background p-3 text-left">
      <p className="text-xs text-muted-foreground">Optional — helps give a more specific first answer.</p>
      {group("When did it start?", ["Today", "2–3 days", "1+ week"], onset, setOnset)}
      {group("How severe?", ["Mild", "Moderate", "Severe"], severity, setSeverity)}
      {group("Fever?", ["Yes", "No", "Not sure"], fever, setFever)}
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={apply}>Continue</Button>
        <Button size="sm" variant="ghost" onClick={onSkip}>Skip</Button>
      </div>
    </div>
  );
}

/* ---------- crisis banner ---------- */

function CrisisBanner({ type }: { type: Exclude<Crisis, null> }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {type === "mental" ? "You are not alone. Please talk to someone now." : "This may be an emergency."}
      </AlertTitle>
      <AlertDescription className="space-y-1">
        <p>
          {type === "mental"
            ? "Call Tele-MANAS (free, 24x7) or go to the nearest hospital. If you are in immediate danger, call 112."
            : "Do not wait for a chat reply. Call 112 or go to the nearest emergency department."}
        </p>
        <div className="flex flex-wrap gap-3 font-semibold">
          <a href="tel:112" className="inline-flex items-center gap-1 underline">
            <Phone className="h-3.5 w-3.5" /> 112
          </a>
          {type === "mental" && (
            <a href="tel:14416" className="inline-flex items-center gap-1 underline">
              <Phone className="h-3.5 w-3.5" /> Tele-MANAS 14416
            </a>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

/* ---------- profile panel ---------- */

function ProfilePanel({
  profile,
  onChange,
  onClear,
}: {
  profile: HealthProfile;
  onChange: (p: HealthProfile) => void;
  onClear: () => void;
}) {
  const set = (k: keyof HealthProfile, v: string | boolean) =>
    onChange(sanitizeProfile({ ...profile, [k]: v }));
  const field = "space-y-1 text-left text-xs font-medium";

  return (
    <div className="mx-auto mt-6 max-w-2xl rounded-xl border bg-background p-4 text-left">
      <p className="mb-3 text-xs text-muted-foreground">
        Optional. Makes advice specific to you. Stored only on this device and sent with your
        messages to our AI provider (Groq) to personalise results.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>
          Age
          <Input inputMode="numeric" maxLength={3} value={profile.age ?? ""} onChange={(e) => set("age", e.target.value)} />
        </label>
        <label className={field}>
          Sex
          <select
            value={profile.sex ?? ""}
            onChange={(e) => set("sex", e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className={cn(field, "sm:col-span-2")}>
          Existing conditions (e.g. diabetes, thyroid, asthma)
          <Input value={profile.conditions ?? ""} onChange={(e) => set("conditions", e.target.value)} />
        </label>
        <label className={field}>
          Current medicines
          <Input value={profile.medications ?? ""} onChange={(e) => set("medications", e.target.value)} />
        </label>
        <label className={field}>
          Allergies
          <Input value={profile.allergies ?? ""} onChange={(e) => set("allergies", e.target.value)} />
        </label>
        {profile.sex !== "male" && (
          <label className="flex items-center gap-2 text-xs font-medium sm:col-span-2">
            <input
              type="checkbox"
              checked={!!profile.pregnant}
              onChange={(e) => set("pregnant", e.target.checked)}
            />
            Pregnant or breastfeeding
          </label>
        )}
      </div>
      {hasProfile(profile) && (
        <Button variant="ghost" size="sm" className="mt-3" onClick={onClear}>
          Clear my health profile
        </Button>
      )}
    </div>
  );
}

/* ---------- component ---------- */

export default function SymptomChecker() {
  const [chatMode, setChatMode] = useState<ChatMode | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<Crisis>(null);
  const [profile, setProfile] = useState<HealthProfile>({});
  const [showProfile, setShowProfile] = useState(false);
  const [pendingIntake, setPendingIntake] = useState("");
  const [intakeDone, setIntakeDone] = useState(false);
  const [historyOn, setHistoryOn] = useState(false);
  const [lang, setLang] = useState<LocaleId>("en-IN");

  const { toast } = useToast();
  const endRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  /* profile + preferences: load once */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (raw) setProfile(sanitizeProfile(JSON.parse(raw)));
    } catch {
      /* corrupted or blocked storage */
    }
    setHistoryOn(hasHistoryConsent());
    setLang(getSavedLocale());
  }, []);

  const saveProfile = useCallback((p: HealthProfile) => {
    setProfile(p);
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  }, []);

  const clearProfile = useCallback(() => {
    setProfile({});
    try {
      localStorage.removeItem(PROFILE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  /* auto-scroll */
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, isLoading, error, crisis]);

  const startChat = useCallback((mode: ChatMode) => {
    const text =
      mode === "quick"
        ? "Quick mode: tell me what's bothering you and I'll give a fast, focused analysis."
        : "Detailed mode: describe your symptoms, when they started, and anything that makes them better or worse.";
    requestId.current++;
    setError(null);
    setCrisis(null);
    setInput("");
    setMessages([{ id: uid(), role: "assistant", text }]);
    setChatMode(mode);
    setPendingIntake("");
    setIntakeDone(false);
  }, []);

  const handleNewChat = useCallback(() => {
    requestId.current++; // invalidate any in-flight response
    setMessages([]);
    setInput("");
    setIsLoading(false);
    setChatMode(null);
    setError(null);
    setCrisis(null);
    setPendingIntake("");
    setIntakeDone(false);
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading || !chatMode) return;

    const found = detectCrisis(text);
    if (found) setCrisis((prev) => (prev === "mental" ? prev : found));

    const previous = messages;
    const isFirstUserTurn = previous.filter((m) => m.role === "user").length === 0;
    const apiText = isFirstUserTurn && pendingIntake ? `${pendingIntake} ${text}` : undefined;
    const next: Message[] = [
      ...previous,
      { id: uid(), role: "user", text, apiText, intakeSummary: isFirstUserTurn ? pendingIntake || undefined : undefined },
    ];
    if (isFirstUserTurn) setPendingIntake("");
    const myId = ++requestId.current;

    setMessages(next);
    setInput("");
    setIsLoading(true);
    setError(null);

    const fail = (msg: string, title: string) => {
      if (myId !== requestId.current) return;
      setMessages(previous); // roll back failed turn
      setInput(text); // user keeps what they typed
      setError(msg);
      toast({ variant: "destructive", title, description: msg });
    };

    try {
      const payload: AiDiagnosisInput = {
        mode: chatMode,
        history: next.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.apiText ?? m.text })),
        locale: lang,
        ...(hasProfile(profile) ? { profile } : {}),
        ...(historyOn ? { recentHistory: historyToLines(getLocalHistory()) } : {}),
      };

      const result = await getDiagnosisAction(payload);

      if (myId !== requestId.current) return; // chat was reset meanwhile

      if (!result || result.success !== true) {
        return fail(result?.error || "The AI service could not process your request.", "AI Service Error");
      }

      const data: unknown = result.data;
      let reply: Message;

      if (isFollowUp(data)) {
        reply = { id: uid(), role: "assistant", text: data.followUpQuestion };
      } else if (isDiagnosis(data)) {
        reply = { id: uid(), role: "assistant", text: diagnosisToText(data.diagnosis), diagnosis: data.diagnosis };
        if (historyOn) {
          const topIssue =
            data.diagnosis.possibleConditions[0] ??
            data.diagnosis.relatedPhysicalIllnesses[0] ??
            data.diagnosis.mentalHealthConditions[0] ??
            "unspecified";
          addLocalHistoryEntry({ date: new Date().toISOString().slice(0, 10), urgency: data.diagnosis.urgency, topIssue });
        }
      } else {
        return fail("I received an unexpected response. Please try again.", "Unexpected response");
      }

      setMessages((m) => [...m, reply]);
    } catch (err) {
      console.error("Symptom checker error:", err);
      fail(
        err instanceof Error ? err.message : "Something went wrong contacting the AI service.",
        "Something went wrong"
      );
    } finally {
      if (myId === requestId.current) setIsLoading(false);
    }
  };

  /* ---------- views ---------- */

  const modeSelect = (
    <div className="px-2 pt-8 text-center text-muted-foreground">
      <Bot className="mx-auto mb-4 h-12 w-12" />
      <p className="text-lg font-medium text-foreground">How would you like to proceed?</p>
      <p className="mb-8 text-sm">Choose what fits your situation.</p>

      <div className="mx-auto grid max-w-2xl gap-4 md:grid-cols-2">
        {(
          [
            ["quick", Zap, "Quick Solutions", "Fast, focused analysis with minimal questions."],
            ["detailed", MessageCircleQuestion, "Detailed Symptoms", "A guided conversation that explores your symptoms in depth."],
          ] as const
        ).map(([mode, Icon, title, desc]) => (
          <button
            key={mode}
            type="button"
            onClick={() => startChat(mode)}
            className="rounded-xl border bg-card p-5 text-left transition-all hover:border-primary hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="flex items-center gap-2 font-semibold text-foreground">
              <Icon className="h-5 w-5 text-primary" />
              {title}
            </span>
            <span className="mt-1 block text-sm">{desc}</span>
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setShowProfile((v) => !v)} aria-expanded={showProfile}>
          <UserCog className="mr-2 h-4 w-4" />
          {hasProfile(profile) ? "Edit my health profile" : "Personalise with my health profile"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const v = !historyOn;
            setHistoryOn(v);
            setHistoryConsent(v);
          }}
        >
          {historyOn ? "Forget my recent check-ins" : "Remember my recent check-ins"}
        </Button>
        <div className="flex gap-1">
          {LOCALES.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                setLang(l.id);
                saveLocale(l.id);
              }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs",
                lang === l.id ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:border-primary"
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
      {showProfile && <ProfilePanel profile={profile} onChange={saveProfile} onClear={clearProfile} />}
    </div>
  );

  const chat = (
    <div className="space-y-6" role="log" aria-live="polite" aria-relevant="additions">
      {messages.map((m) => (
        <div key={m.id}>
          {m.role === "user" && m.intakeSummary && (
            <p className="mb-1 pr-11 text-right text-[10px] text-muted-foreground">{m.intakeSummary}</p>
          )}
          <div className={cn("flex items-start gap-3", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "assistant" && (
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="bg-primary/80">
                  <Bot className="h-5 w-5 text-primary-foreground" />
                </AvatarFallback>
              </Avatar>
            )}
            <div
              className={cn(
                "rounded-2xl p-3",
                m.diagnosis ? "w-full max-w-[92%] md:max-w-xl" : "max-w-[85%] md:max-w-md",
                m.role === "user"
                  ? "rounded-br-none bg-primary/90 text-primary-foreground"
                  : "rounded-bl-none bg-muted"
              )}
            >
              {m.diagnosis ? (
                <DiagnosisResults diagnosis={m.diagnosis} mode={chatMode ?? "quick"} />
              ) : (
                <p className="whitespace-pre-wrap text-sm">{m.text}</p>
              )}
            </div>
            {m.role === "user" && (
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback>
                  <User className="h-5 w-5" />
                </AvatarFallback>
              </Avatar>
            )}
          </div>
        </div>
      ))}

      {messages.length === 1 && !isLoading && (
        <div className="flex flex-wrap gap-2 pl-11">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setInput(ex)}
              className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="flex items-start gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/80">
              <Bot className="h-5 w-5 text-primary-foreground" />
            </AvatarFallback>
          </Avatar>
          <div className="flex items-center gap-2 rounded-2xl rounded-bl-none bg-muted p-3">
            <Loader2 className="h-4 w-4 animate-spin" />
            <p className="text-sm text-muted-foreground">Analysing and checking sources...</p>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );

  return (
    <div className="mx-auto flex h-[calc(100dvh-8rem)] min-h-[32rem] max-w-4xl flex-col rounded-xl border bg-card shadow-lg">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Bot className="h-6 w-6 text-primary" />
          AI Companion
          {chatMode && (
            <span className="text-sm font-normal text-muted-foreground">
              ({chatMode === "quick" ? "Quick" : "Detailed"}
              {hasProfile(profile) ? ", personalised" : ""})
            </span>
          )}
        </h2>
        <Button variant="outline" size="sm" onClick={handleNewChat} disabled={isLoading}>
          <PlusCircle className="mr-2 h-4 w-4" />
          New Chat
        </Button>
      </div>

      {crisis && (
        <div className="border-b p-3">
          <CrisisBanner type={crisis} />
        </div>
      )}

      <ScrollArea className="flex-1 p-4">{chatMode ? chat : modeSelect}</ScrollArea>

      {chatMode && (
        <div className="border-t p-4">
          {error && (
            <Alert variant="destructive" className="mb-3">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Unable to complete request</AlertTitle>
              <AlertDescription>{error} Your message is restored. Press send to retry.</AlertDescription>
            </Alert>
          )}
          {messages.length === 1 && !intakeDone && (
            <IntakeChips
              onApply={(s) => {
                setPendingIntake(s);
                setIntakeDone(true);
              }}
              onSkip={() => setIntakeDone(true)}
            />
          )}
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe your symptoms or answer the question..."
              className="flex-1"
              disabled={isLoading}
              autoFocus
              maxLength={2000}
              aria-label="Your message"
            />
            <Button type="submit" size="icon" disabled={isLoading || !input.trim()} aria-label="Send message">
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </Button>
          </form>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            General health information only. Not a substitute for professional medical advice,
            diagnosis, or treatment. In an emergency call 112.
          </p>
        </div>
      )}
    </div>
  );
}