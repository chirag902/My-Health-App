"use client";

import { useEffect, useState } from "react";
import {
  type DocumentData,
  type FirestoreError,
  type Query,
  onSnapshot,
} from "firebase/firestore";
import { errorEmitter } from "../error-emitter";
import { FirestorePermissionError } from "../errors";

export type FirestoreDocument<T> = T & {
  id: string;
};

export function useCollection<T = DocumentData>(
  query: Query<T> | null
) {
  const [data, setData] = useState<FirestoreDocument<T>[] | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FirestoreError | null>(null);

  useEffect(() => {
    if (!query) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const unsubscribe = onSnapshot(
      query,
      (snapshot) => {
        const documents = snapshot.docs.map(
          (document) => ({
            ...document.data(),
            id: document.id,
          })
        );

        setData(documents);
        setLoading(false);
      },
      (serverError: FirestoreError) => {
        if (serverError.code === "permission-denied") {
          const permissionError =
            new FirestorePermissionError({
              path: "firestore-query",
              operation: "list",
            });

          errorEmitter.emit(
            "permission-error",
            permissionError
          );
        }

        setError(serverError);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [query]);

  return {
    data,
    loading,
    error,
  };
}