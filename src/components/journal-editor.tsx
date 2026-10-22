"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc, getDocs, limit, orderBy, query, startAfter, updateDoc,
  type Query, type DocumentData,
} from "firebase/firestore";
import { format } from "date-fns";
import { BookCheck, ChevronDown, Loader2, Pencil, Search, Trash2, X } from "lucide-react";

import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import { useFirestore, useUser, useCollection } from "@/firebase";
import { errorEmitter } from "@/firebase/error-emitter";
import { FirestorePermissionError } from "@/firebase/errors";

interface JournalEntry {
  id: string;
  content: string;
  date: string;
  userId?: string;
  updatedAt?: string;
}

const MIN_ENTRY_LENGTH = 10;
const MAX_ENTRY_LENGTH = 5000;
const PAGE_SIZE = 20;
const FULL_SEARCH_PAGE_CAP = 25; // hard cap: 25 pages * 20 = 500 entries max per full-history search

export default function JournalEditor() {
  const [entry, setEntry] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);

  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [olderEntries, setOlderEntries] = useState<JournalEntry[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isSearchingFullHistory, setIsSearchingFullHistory] = useState(false);

  const { toast } = useToast();
  const db = useFirestore();
  const { user } = useUser();

  const journalQuery = useMemo<Query<JournalEntry, DocumentData> | null>(() => {
    if (!db || !user) return null;
    const journalCollection = collection(db, "users", user.uid, "journal") as Query<JournalEntry, DocumentData>;
    return query(journalCollection, orderBy("date", "desc"), limit(PAGE_SIZE));
  }, [db, user]);

  // Defensive cast — this hook's exact return shape (incl. whether it
  // exposes `error`) wasn't confirmed. If it doesn't, `error` stays
  // undefined and this block is inert.
  const { data: entries, loading, error } = useCollection<JournalEntry>(journalQuery) as {
    data: JournalEntry[] | undefined;
    loading: boolean;
    error?: { code?: string; message?: string } | null;
  };

  const combinedEntries = useMemo(() => [...(entries ?? []), ...olderEntries], [entries, olderEntries]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return combinedEntries;
    return combinedEntries.filter((e) => e.content.toLowerCase().includes(q));
  }, [combinedEntries, searchQuery]);

  useEffect(() => {
    if (!loading && entries && entries.length < PAGE_SIZE) setHasMore(false);
  }, [loading, entries]);

  const handleLoadMore = async () => {
    if (!db || !user || isLoadingMore || !hasMore) return;
    const cursorDate = combinedEntries[combinedEntries.length - 1]?.date;
    if (!cursorDate) return;

    setIsLoadingMore(true);
    try {
      const journalCollection = collection(db, "users", user.uid, "journal");
      const olderQuery = query(journalCollection, orderBy("date", "desc"), startAfter(cursorDate), limit(PAGE_SIZE));
      const snapshot = await getDocs(olderQuery);
      const fetched = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as JournalEntry));
      setOlderEntries((prev) => [...prev, ...fetched]);
      setHasMore(fetched.length === PAGE_SIZE);
    } catch (err: unknown) {
      const firebaseError = err as { code?: string; message?: string };
      console.error("Failed to load older journal entries:", { code: firebaseError.code ?? "unknown", message: firebaseError.message ?? "Unknown error" });
      toast({ variant: "destructive", title: "Couldn't load more entries", description: "Please try again." });
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Search only covers already-loaded entries by default (free, instant).
  // This explicitly loads the rest of the user's history, bounded by
  // FULL_SEARCH_PAGE_CAP, so cost is visible and capped rather than
  // silently fetching everything on every keystroke.
  const handleSearchFullHistory = async () => {
    if (!db || !user || isSearchingFullHistory || !hasMore) return;
    setIsSearchingFullHistory(true);
    try {
      const journalCollection = collection(db, "users", user.uid, "journal");
      let cursorDate = combinedEntries[combinedEntries.length - 1]?.date;
      let pagesLoaded = 0;
      const allFetched: JournalEntry[] = [];

      while (cursorDate && pagesLoaded < FULL_SEARCH_PAGE_CAP) {
        const pageQuery = query(journalCollection, orderBy("date", "desc"), startAfter(cursorDate), limit(PAGE_SIZE));
        const snapshot = await getDocs(pageQuery);
        const fetched = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as JournalEntry));
        allFetched.push(...fetched);
        pagesLoaded += 1;
        if (fetched.length < PAGE_SIZE) { setHasMore(false); break; }
        cursorDate = fetched[fetched.length - 1]?.date;
      }

      setOlderEntries((prev) => [...prev, ...allFetched]);
      if (pagesLoaded >= FULL_SEARCH_PAGE_CAP) {
        toast({ title: "Searched most recent entries", description: `Scanned up to ${FULL_SEARCH_PAGE_CAP * PAGE_SIZE} entries. Older entries weren't included.` });
      }
    } catch (err: unknown) {
      const firebaseError = err as { code?: string; message?: string };
      console.error("Full-history search failed:", { code: firebaseError.code ?? "unknown", message: firebaseError.message ?? "Unknown error" });
      toast({ variant: "destructive", title: "Search failed", description: "Couldn't load your full history. Please try again." });
    } finally {
      setIsSearchingFullHistory(false);
    }
  };

  const handleSave = async () => {
    const trimmedEntry = entry.trim();

    if (!user || !db) {
      toast({ variant: "destructive", title: "Not ready", description: "Please wait until your account is fully loaded." });
      return;
    }
    if (trimmedEntry.length < MIN_ENTRY_LENGTH) {
      toast({ variant: "destructive", title: "Entry is too short", description: `Please write at least ${MIN_ENTRY_LENGTH} characters.` });
      return;
    }
    if (trimmedEntry.length > MAX_ENTRY_LENGTH) {
      toast({ variant: "destructive", title: "Entry is too long", description: `Please keep your journal entry under ${MAX_ENTRY_LENGTH} characters.` });
      return;
    }
    if (isSaving) return;

    setIsSaving(true);
    const journalCollection = collection(db, "users", user.uid, "journal");
    const data = { content: trimmedEntry, date: new Date().toISOString(), userId: user.uid };

    try {
      await addDoc(journalCollection, data);
      setEntry("");
      toast({ title: "Entry saved", description: "Your journal entry has been securely saved." });
    } catch (err: unknown) {
      const firebaseError = err as { code?: string; message?: string };
      console.error("Failed to save journal entry:", { code: firebaseError.code ?? "unknown", message: firebaseError.message ?? "Unknown error" });

      if (firebaseError.code === "permission-denied") {
        errorEmitter.emit("permission-error", new FirestorePermissionError({ path: journalCollection.path, operation: "create", requestResourceData: data }));
      }

      toast({ variant: "destructive", title: "Unable to save entry", description: "Your journal entry could not be saved. Please try again." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartEdit = (journalEntry: JournalEntry) => {
    if (deletingEntryId || isUpdating) return;
    setEditingEntryId(journalEntry.id);
    setEditContent(journalEntry.content);
  };

  const handleCancelEdit = () => {
    setEditingEntryId(null);
    setEditContent("");
  };

  const handleSaveEdit = async (entryId: string) => {
    if (!user || !db || isUpdating) return;

    const trimmed = editContent.trim();
    if (trimmed.length < MIN_ENTRY_LENGTH) {
      toast({ variant: "destructive", title: "Entry is too short", description: `Please write at least ${MIN_ENTRY_LENGTH} characters.` });
      return;
    }
    if (trimmed.length > MAX_ENTRY_LENGTH) {
      toast({ variant: "destructive", title: "Entry is too long", description: `Please keep your journal entry under ${MAX_ENTRY_LENGTH} characters.` });
      return;
    }

    const entryDoc = doc(db, "users", user.uid, "journal", entryId);
    setIsUpdating(true);

    try {
      // `date` (original creation timestamp) is intentionally untouched —
      // only `updatedAt` changes, so ordering and history stay stable and
      // the entry can be marked "(edited)" without losing when it was written.
      await updateDoc(entryDoc, { content: trimmed, updatedAt: new Date().toISOString() });
      setOlderEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, content: trimmed, updatedAt: new Date().toISOString() } : e)));
      setEditingEntryId(null);
      setEditContent("");
      toast({ title: "Entry updated", description: "Your changes have been saved." });
    } catch (err: unknown) {
      const firebaseError = err as { code?: string; message?: string };
      console.error("Failed to update journal entry:", { code: firebaseError.code ?? "unknown", message: firebaseError.message ?? "Unknown error" });

      if (firebaseError.code === "permission-denied") {
        errorEmitter.emit("permission-error", new FirestorePermissionError({ path: entryDoc.path, operation: "update" }));
      }

      toast({ variant: "destructive", title: "Unable to update entry", description: "Your changes could not be saved. Please try again." });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async (entryId: string) => {
    if (!user || !db || deletingEntryId) return;

    const target = combinedEntries.find((e) => e.id === entryId);
    const preview = target ? target.content.slice(0, 60) + (target.content.length > 60 ? "..." : "") : "this entry";
    const confirmed = window.confirm(`Delete this journal entry? This cannot be undone.\n\n"${preview}"`);
    if (!confirmed) return;

    const entryDoc = doc(db, "users", user.uid, "journal", entryId);
    setDeletingEntryId(entryId);

    try {
      await deleteDoc(entryDoc);
      setOlderEntries((prev) => prev.filter((e) => e.id !== entryId));
      toast({ title: "Entry deleted", description: "Your journal entry has been removed." });
    } catch (err: unknown) {
      const firebaseError = err as { code?: string; message?: string };
      console.error("Failed to delete journal entry:", { code: firebaseError.code ?? "unknown", message: firebaseError.message ?? "Unknown error" });

      if (firebaseError.code === "permission-denied") {
        errorEmitter.emit("permission-error", new FirestorePermissionError({ path: entryDoc.path, operation: "delete" }));
      }

      toast({ variant: "destructive", title: "Unable to delete entry", description: "Your journal entry could not be deleted. Please try again." });
    } finally {
      setDeletingEntryId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Daily Journal</CardTitle>
          <CardDescription>Write about how you are feeling, your habits, symptoms, or anything else you would like to keep track of.</CardDescription>
        </CardHeader>

        <CardContent>
          <Textarea
            value={entry}
            onChange={(event) => setEntry(event.target.value)}
            placeholder="How are you feeling today?"
            className="min-h-[180px] resize-y"
            maxLength={MAX_ENTRY_LENGTH}
            disabled={isSaving || !user}
            aria-label="Journal entry"
          />
          <div className="mt-2 flex justify-end">
            <span className={`text-xs ${entry.length > MAX_ENTRY_LENGTH - 500 ? "text-destructive" : "text-muted-foreground"}`}>
              {entry.length}/{MAX_ENTRY_LENGTH}
            </span>
          </div>
        </CardContent>

        <CardFooter className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving || !user || !db || entry.trim().length < MIN_ENTRY_LENGTH}>
            {isSaving ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>) : (<><BookCheck className="mr-2 h-4 w-4" />Save Entry</>)}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Journal History</CardTitle>
          <CardDescription>Your saved journal entries appear here.</CardDescription>

          {user && combinedEntries.length > 0 && (
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                placeholder="Search your entries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                aria-label="Search journal entries"
              />
            </div>
          )}
        </CardHeader>

        <CardContent>
          {!user ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Please sign in to view your journal.</div>
          ) : error ? (
            <div className="py-8 text-center">
              <p className="font-medium text-destructive">Couldn't load your journal</p>
              <p className="mt-1 text-sm text-muted-foreground">{error.message ?? "Please refresh and try again."}</p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading your journal...
            </div>
          ) : combinedEntries.length === 0 ? (
            <div className="py-8 text-center">
              <BookCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-medium">No journal entries yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Your saved entries will appear here.</p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="py-8 text-center">
              <p className="font-medium">No matches in loaded entries</p>
              {hasMore && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => void handleSearchFullHistory()} disabled={isSearchingFullHistory}>
                  {isSearchingFullHistory ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Searching...</>) : "Search full history"}
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {filteredEntries.map((journalEntry) => {
                  const entryDate = new Date(journalEntry.date);
                  const formattedDate = Number.isNaN(entryDate.getTime()) ? "Unknown date" : format(entryDate, "PPP · p");
                  const isDeleting = deletingEntryId === journalEntry.id;
                  const isEditing = editingEntryId === journalEntry.id;

                  return (
                    <div key={journalEntry.id} className="rounded-lg border bg-card p-4">
                      {isEditing ? (
                        <div className="space-y-3">
                          <Textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="min-h-[120px] resize-y"
                            maxLength={MAX_ENTRY_LENGTH}
                            disabled={isUpdating}
                            aria-label="Edit journal entry"
                          />
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">{editContent.length}/{MAX_ENTRY_LENGTH}</span>
                            <div className="flex gap-2">
                              <Button variant="ghost" size="sm" onClick={handleCancelEdit} disabled={isUpdating}>
                                <X className="mr-1 h-3.5 w-3.5" />Cancel
                              </Button>
                              <Button size="sm" onClick={() => void handleSaveEdit(journalEntry.id)} disabled={isUpdating || editContent.trim().length < MIN_ENTRY_LENGTH}>
                                {isUpdating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="mb-2 text-xs font-medium text-muted-foreground">
                              {formattedDate}
                              {journalEntry.updatedAt && <span className="ml-1.5 italic">(edited)</span>}
                            </p>
                            <p className="whitespace-pre-wrap break-words text-sm leading-6">{journalEntry.content}</p>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleStartEdit(journalEntry)}
                              disabled={isDeleting || Boolean(editingEntryId)}
                              aria-label="Edit journal entry"
                              title="Edit journal entry"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => void handleDelete(journalEntry.id)}
                              disabled={isDeleting || isSaving || Boolean(editingEntryId)}
                              aria-label="Delete journal entry"
                              title="Delete journal entry"
                            >
                              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {!searchQuery && hasMore && (
                <div className="mt-4 flex justify-center">
                  <Button variant="outline" size="sm" onClick={() => void handleLoadMore()} disabled={isLoadingMore}>
                    {isLoadingMore ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading...</>) : (<><ChevronDown className="mr-2 h-4 w-4" />Load older entries</>)}
                  </Button>
                </div>
              )}

              {searchQuery && hasMore && (
                <div className="mt-4 text-center text-xs text-muted-foreground">
                  Searching your {combinedEntries.length} most recent entries.{" "}
                  <button type="button" className="underline" onClick={() => void handleSearchFullHistory()} disabled={isSearchingFullHistory}>
                    {isSearchingFullHistory ? "Searching..." : "Search full history"}
                  </button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">Journal entries are associated with your authenticated account.</p>
    </div>
  );
}