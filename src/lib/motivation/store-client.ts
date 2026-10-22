"use client";

import { auth, db } from "@/lib/firebase"; // ⚠️ VERIFY: adjust path/exports to your actual init file
import {
  doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs, serverTimestamp,
} from "firebase/firestore";

// store-client.ts — add source to the interface
export interface MotivationRecord {
  message: string;
  theme: string;
  date: string;
  source: "ai" | "fallback"; // add this
}

const LOCAL_HISTORY_KEY = "motivation_history_v1";
const HISTORY_LIMIT = 20;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // UTC date boundary — see assumptions note
}

function localHistory(): MotivationRecord[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalHistory(records: MotivationRecord[]) {
  localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(records.slice(0, HISTORY_LIMIT)));
}

export async function getTodayAndHistory(): Promise<{
  today: MotivationRecord | null;
  history: MotivationRecord[];
  uid: string | null;
}> {
  const uid = auth.currentUser?.uid ?? null;
  const date = todayStr();

  if (!uid) {
    const history = localHistory();
    const today = history.find((h) => h.date === date) ?? null;
    return { today, history, uid: null };
  }

  const todayRef = doc(db, "users", uid, "motivation", date);
  const todaySnap = await getDoc(todayRef);
  const today = todaySnap.exists() ? (todaySnap.data() as MotivationRecord) : null;

  const q = query(
    collection(db, "users", uid, "motivation"),
    orderBy("date", "desc"),
    limit(HISTORY_LIMIT)
  );
  const snap = await getDocs(q);
  const history = snap.docs.map((d) => d.data() as MotivationRecord);

  return { today, history, uid };
}

export async function saveToday(record: MotivationRecord, uid: string | null) {
  if (!uid) {
    const history = localHistory().filter((h) => h.date !== record.date);
    saveLocalHistory([record, ...history]);
    return;
  }
  const ref = doc(db, "users", uid, "motivation", record.date);
  await setDoc(ref, { ...record, createdAt: serverTimestamp() });
}