"use client";

import { useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  orderBy,
  query,
  type Query,
  type DocumentData,
} from "firebase/firestore";
import { format } from "date-fns";
import { BookCheck, Loader2, Trash2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
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
}

const MIN_ENTRY_LENGTH = 10;
const MAX_ENTRY_LENGTH = 5000;

export default function JournalEditor() {
  const [entry, setEntry] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);

  const { toast } = useToast();
  const db = useFirestore();
  const { user } = useUser();

  const journalQuery = useMemo<Query<JournalEntry, DocumentData> | null>(() => {
    if (!db || !user) {
      return null;
    }

    const journalCollection = collection(
      db,
      "users",
      user.uid,
      "journal"
    ) as Query<JournalEntry, DocumentData>;

    return query(
      journalCollection,
      orderBy("date", "desc")
    );
  }, [db, user]);

  const {
    data: entries,
    loading,
  } = useCollection<JournalEntry>(journalQuery);

  const handleSave = async () => {
    const trimmedEntry = entry.trim();

    if (!user || !db) {
      toast({
        variant: "destructive",
        title: "Not ready",
        description:
          "Please wait until your account is fully loaded.",
      });
      return;
    }

    if (trimmedEntry.length < MIN_ENTRY_LENGTH) {
      toast({
        variant: "destructive",
        title: "Entry is too short",
        description:
          `Please write at least ${MIN_ENTRY_LENGTH} characters.`,
      });
      return;
    }

    if (trimmedEntry.length > MAX_ENTRY_LENGTH) {
      toast({
        variant: "destructive",
        title: "Entry is too long",
        description:
          `Please keep your journal entry under ${MAX_ENTRY_LENGTH} characters.`,
      });
      return;
    }

    if (isSaving) {
      return;
    }

    setIsSaving(true);

    const journalCollection = collection(
      db,
      "users",
      user.uid,
      "journal"
    );

    const data = {
      content: trimmedEntry,
      date: new Date().toISOString(),
      userId: user.uid,
    };

    try {
      await addDoc(journalCollection, data);

      setEntry("");

      toast({
        title: "Entry saved",
        description:
          "Your journal entry has been securely saved.",
      });
    } catch {
      const permissionError = new FirestorePermissionError({
        path: journalCollection.path,
        operation: "create",
        requestResourceData: data,
      });

      errorEmitter.emit(
        "permission-error",
        permissionError
      );

      toast({
        variant: "destructive",
        title: "Unable to save entry",
        description:
          "Your journal entry could not be saved. Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (entryId: string) => {
    if (!user || !db || deletingEntryId) {
      return;
    }

    const entryDoc = doc(
      db,
      "users",
      user.uid,
      "journal",
      entryId
    );

    setDeletingEntryId(entryId);

    try {
      await deleteDoc(entryDoc);

      toast({
        title: "Entry deleted",
        description:
          "Your journal entry has been removed.",
      });
    } catch {
      const permissionError = new FirestorePermissionError({
        path: entryDoc.path,
        operation: "delete",
      });

      errorEmitter.emit(
        "permission-error",
        permissionError
      );

      toast({
        variant: "destructive",
        title: "Unable to delete entry",
        description:
          "Your journal entry could not be deleted. Please try again.",
      });
    } finally {
      setDeletingEntryId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Daily Journal</CardTitle>

          <CardDescription>
            Write about how you are feeling, your habits, symptoms,
            or anything else you would like to keep track of.
          </CardDescription>
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
            <span
              className={`text-xs ${
                entry.length > MAX_ENTRY_LENGTH - 500
                  ? "text-destructive"
                  : "text-muted-foreground"
              }`}
            >
              {entry.length}/{MAX_ENTRY_LENGTH}
            </span>
          </div>
        </CardContent>

        <CardFooter className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={
              isSaving ||
              !user ||
              !db ||
              entry.trim().length < MIN_ENTRY_LENGTH
            }
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <BookCheck className="mr-2 h-4 w-4" />
                Save Entry
              </>
            )}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Journal History</CardTitle>

          <CardDescription>
            Your saved journal entries appear here.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {!user ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Please sign in to view your journal.
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading your journal...
            </div>
          ) : !entries || entries.length === 0 ? (
            <div className="py-8 text-center">
              <BookCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />

              <p className="font-medium">
                No journal entries yet
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                Your saved entries will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {entries.map((journalEntry) => {
                const entryDate = new Date(journalEntry.date);

                const formattedDate = Number.isNaN(
                  entryDate.getTime()
                )
                  ? "Unknown date"
                  : format(entryDate, "PPP · p");

                const isDeleting =
                  deletingEntryId === journalEntry.id;

                return (
                  <div
                    key={journalEntry.id}
                    className="rounded-lg border bg-card p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          {formattedDate}
                        </p>

                        <p className="whitespace-pre-wrap break-words text-sm leading-6">
                          {journalEntry.content}
                        </p>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          handleDelete(journalEntry.id)
                        }
                        disabled={
                          isDeleting ||
                          isSaving
                        }
                        aria-label="Delete journal entry"
                        title="Delete journal entry"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-destructive" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Journal entries are associated with your authenticated account.
      </p>
    </div>
  );
}