
"use client";

import { useEffect } from "react";

import { errorEmitter } from "@/firebase/error-emitter";
import { FirestorePermissionError } from "@/firebase/errors";
import { logger } from "@/lib/logger";
import { useToast } from "@/hooks/use-toast";

export function FirebaseErrorListener() {
  const { toast } = useToast();

  useEffect(() => {
    const handlePermissionError = (error: FirestorePermissionError) => {
      logger.error("Firebase permission denied", {
        path: error.context?.path,
        operation: error.context?.operation,
      });

      toast({
        variant: "destructive",
        title: "Access Denied",
        description:
          "You don't have permission to perform this action. Please check your account and try again.",
      });
    };

    errorEmitter.on("permission-error", handlePermissionError);

    return () => {
      errorEmitter.off("permission-error", handlePermissionError);
    };
  }, [toast]);

  return null;
}
