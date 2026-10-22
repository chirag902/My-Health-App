"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import dynamic from "next/dynamic";
import {
  AlertTriangle,
  DatabaseZap,
  Download,
  FileScan,
  FileText,
  Loader2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

// client-document.ts pulls in pdfjs-dist (~1MB). It is imported dynamically, inside handleFile
// below, only once a file is actually picked -- not here at the top of the module -- so visiting
// this page does not pay that cost until someone uploads something.
import { MAX_INPUT_BYTES } from "@/lib/upload-limits";
import type { PreparedDocument } from "@/lib/client-document";
import {
  buildDemoRecords,
  buildMonthlyTrends,
  describeHttpFailure,
  getErrorMessage,
  isHeicFile,
  isSuccessfulAnalysisResponse,
  resolveMimeType,
  type HealthRecord,
} from "@/lib/health-records-utils";
import { getIdToken } from "@/lib/auth-client";
import { logger } from "@/lib/logger";
import type { AnalyzeDocumentOutput } from "@/lib/types";

/* ============================================================
   LAZY-LOADED HEAVY COMPONENTS
   ============================================================ */

const HealthTrendsChart = dynamic(() => import("./health-trends-chart"), {
  ssr: false,
  loading: () => <Skeleton className="h-[350px] w-full rounded-lg" />,
});

const DocumentAnalysisResults = dynamic(
  () => import("./document-analysis-results"),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[300px] w-full rounded-lg" />,
  }
);

/* ============================================================
   CONSTANTS
   ============================================================ */

/** The server allows 60s; this only guards against a dead connection. */
const REQUEST_TIMEOUT_MS = 75_000;

/** After this long we tell the user that scans and photos are slower. */
const SLOW_NOTICE_MS = 10_000;

type Stage = "idle" | "reading" | "analyzing";

/* ============================================================
   NETWORK
   ============================================================ */

async function postDocument(
  prepared: PreparedDocument,
  token: string,
  signal: AbortSignal
): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

  if (prepared.kind === "text") {
    return fetch("/api/analyze-document", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ text: prepared.text }),
      signal,
    });
  }

  const formData = new FormData();
  prepared.files.forEach((file) => formData.append("document", file));

  // No Content-Type here: the browser must set multipart/form-data with its own boundary.
  return fetch("/api/analyze-document", { method: "POST", headers, body: formData, signal });
}

/* ============================================================
   COMPONENT
   ============================================================ */

export default function HealthRecords() {
  const [stage, setStage] = useState<Stage>("idle");
  const [isSlow, setIsSlow] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [analysisResult, setAnalysisResult] =
    useState<AnalyzeDocumentOutput | null>(null);

  // null until mounted: avoids a server/client hydration mismatch on "today"-based dates.
  const [records, setRecords] = useState<HealthRecord[] | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);

  /** The one request currently allowed to update the screen. Cancelled/stale requests are ignored. */
  const activeRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const requestCounter = useRef(0);

  const { toast } = useToast();

  const isBusy = stage !== "idle";

  useEffect(() => {
    setRecords(buildDemoRecords(new Date()));
  }, []);

  /* Abort any in-flight request when the user leaves the page. */
  useEffect(
    () => () => {
      activeRef.current?.controller.abort();
      activeRef.current = null;
    },
    []
  );

  /* "Still working..." notice for slow scans and photos. */
  useEffect(() => {
    if (stage !== "analyzing") {
      setIsSlow(false);
      return;
    }

    const timer = window.setTimeout(() => setIsSlow(true), SLOW_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [stage]);

  const monthlyTrends = useMemo(() => buildMonthlyTrends(records ?? []), [records]);

  /* ---------------- CONSENT ---------------- */

  /**
   * The upload button is never silently disabled. If consent is missing we say so right
   * next to the checkbox (a toast alone can be missed or may not be mounted) and move focus to it.
   */
  const requireConsent = useCallback((): boolean => {
    if (consent) return true;

    setConsentError(true);
    consentRef.current?.focus();

    return false;
  }, [consent]);

  /* ---------------- UPLOAD ---------------- */

  const handleFile = useCallback(
    async (original: File) => {
      if (isHeicFile(original)) {
        toast({
          variant: "destructive",
          title: "iPhone HEIC photos are not supported",
          description:
            "Take a screenshot of the report, or set your camera format to 'Most Compatible' and try again.",
        });
        return;
      }

      const mimeType = resolveMimeType(original);

      if (!mimeType) {
        toast({
          variant: "destructive",
          title: "Unsupported file",
          description: "Please upload a PDF, JPG, PNG, or WebP document.",
        });
        return;
      }

      if (original.size === 0) {
        toast({
          variant: "destructive",
          title: "Empty file",
          description: "This file has no content. Please choose another document.",
        });
        return;
      }

      if (original.size > MAX_INPUT_BYTES) {
        toast({
          variant: "destructive",
          title: "File is too large",
          description: `Please choose a file smaller than ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} MB.`,
        });
        return;
      }

      // Some browsers report an empty type; give the rest of the pipeline a correct one.
      const file =
        mimeType === original.type
          ? original
          : new File([original], original.name, { type: mimeType });

      const id = ++requestCounter.current;
      const controller = new AbortController();
      activeRef.current = { id, controller };

      const isCurrent = () => activeRef.current?.id === id;

      setAnalysisResult(null);
      setStage("reading");

      let timer: number | undefined;
      let timedOut = false;

      try {
        // Checked BEFORE reading the file: no point decoding a possibly large PDF for a
        // request that cannot be sent anyway.
        const token = await getIdToken();
        if (!isCurrent()) return;

        // Runs on the user's device: PDF text extraction / image compression.
        const { prepareDocument } = await import("@/lib/client-document");
        const prepared = await prepareDocument(file);
        if (!isCurrent()) return; // cancelled while reading

        setStage("analyzing");

        timer = window.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, REQUEST_TIMEOUT_MS);

        let response = await postDocument(prepared, token, controller.signal);

        // The ID token can expire between page load and upload. Refresh it ONCE (a fresh
        // refresh failure surfaces as its own message) and retry with the SAME prepared
        // document, never re-reading the file.
        if (response.status === 401) {
          const freshToken = await getIdToken(true);
          if (!isCurrent()) return;

          response = await postDocument(prepared, freshToken, controller.signal);
        }

        let result: unknown;

        try {
          result = await response.json();
        } catch {
          // Platform-level errors (413/504 from the host) are not JSON.
          throw new Error(
            response.ok
              ? "The document analysis service returned an invalid response."
              : describeHttpFailure(response.status)
          );
        }

        if (!isCurrent()) return; // cancelled while waiting

        if (!response.ok) {
          const apiError =
            typeof result === "object" &&
            result !== null &&
            "error" in result &&
            typeof (result as { error: unknown }).error === "string"
              ? (result as { error: string }).error
              : describeHttpFailure(response.status);

          throw new Error(apiError);
        }

        if (!isSuccessfulAnalysisResponse(result)) {
          throw new Error("The document analysis service returned an unexpected response.");
        }

        setAnalysisResult(result.data);

        toast({
          title: "Document analyzed",
          description: "Your document was successfully analyzed.",
        });
      } catch (error: unknown) {
        if (!isCurrent()) return; // the user cancelled: stay quiet

        // Never log the document or its contents; it may contain sensitive health data.
        logger.error("Document analysis failed", {
          error: error instanceof Error ? error.name : "UnknownError",
        });

        toast({
          variant: "destructive",
          title: "Analysis failed",
          description: timedOut
            ? "The request timed out. Please check your connection and try again."
            : getErrorMessage(error),
        });
      } finally {
        if (timer !== undefined) window.clearTimeout(timer);

        if (isCurrent()) {
          activeRef.current = null;
          setStage("idle");
        }
      }
    },
    [toast]
  );

  const handleUploadClick = useCallback(() => {
    if (isBusy) return;
    if (!requireConsent()) return;

    fileInputRef.current?.click();
  }, [isBusy, requireConsent]);

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      // Reset so choosing the same file again still fires a change event.
      event.target.value = "";

      if (!file) return;

      // Defense in depth: consent is also enforced here, not only when the button is clicked.
      if (!requireConsent()) return;

      void handleFile(file);
    },
    [handleFile, requireConsent]
  );

  const handleCancel = useCallback(() => {
    const active = activeRef.current;
    if (!active) return;

    activeRef.current = null; // from now on this request is ignored
    active.controller.abort();
    setStage("idle");

    toast({ title: "Analysis cancelled" });
  }, [toast]);

  /* ---------------- DRAG & DROP ---------------- */

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (!isBusy) setIsDragging(true);
    },
    [isBusy]
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    // ignore the flicker caused by moving over child elements
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);

      if (isBusy) return;

      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;

      if (files.length > 1) {
        toast({
          variant: "destructive",
          title: "One document at a time",
          description: "Please drop a single document.",
        });
        return;
      }

      if (!requireConsent()) return;

      void handleFile(files[0]);
    },
    [handleFile, isBusy, requireConsent, toast]
  );

  /* ---------------- EXPORT / CLEAR ---------------- */

  const handleExport = useCallback(() => {
    if (!analysisResult) {
      toast({
        variant: "destructive",
        title: "Nothing to export",
        description: "Analyze a document before exporting its results.",
      });
      return;
    }

    try {
      const blob = new Blob([JSON.stringify(analysisResult, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = `health-analysis-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      toast({
        title: "Export complete",
        description: "The analysis result has been exported as a JSON file.",
      });
    } catch (error: unknown) {
      logger.error("Health analysis export failed", {
        error: error instanceof Error ? error.name : "UnknownError",
      });

      toast({
        variant: "destructive",
        title: "Export failed",
        description: "The analysis result could not be exported.",
      });
    }
  }, [analysisResult, toast]);

  const handleClearAnalysis = useCallback(() => {
    if (isBusy) return;

    setAnalysisResult(null);
    toast({
      title: "Analysis cleared",
      description: "The current document analysis has been removed from this page.",
    });
  }, [isBusy, toast]);

  /* ---------------- DERIVED ---------------- */

  /** Announced by screen readers; toasts alone are easy to miss. */
  const statusMessage =
    stage === "reading"
      ? "Reading your document on this device."
      : stage === "analyzing"
        ? "Analyzing your document."
        : analysisResult
          ? "Analysis complete. Results are shown below."
          : "";

  /* ---------------- UI ---------------- */

  return (
    <div className="space-y-6">
      <p className="sr-only" role="status" aria-live="polite">
        {statusMessage}
      </p>

      <Alert>
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>How your health data is handled</AlertTitle>
        <AlertDescription>
          PDFs with selectable text are read on your device, and only the
          extracted text is sent to our server. Photos and scanned pages are
          compressed on your device and sent to our server for text recognition.
          Only the extracted lab values (not the file itself) are sent to our AI
          provider. This app does not save your document. Results are
          informational and should be reviewed by a qualified healthcare
          professional.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileScan className="h-5 w-5" aria-hidden="true" />
            Analyze Health Document
          </CardTitle>
          <CardDescription>
            Upload a medical report, laboratory result, or supported health
            document for automated analysis.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            aria-label="Choose a document to analyze"
            accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            disabled={isBusy}
            className="hidden"
          />

          <div>
            <label className="flex items-start gap-3 text-sm">
              <input
                ref={consentRef}
                type="checkbox"
                checked={consent}
                onChange={(event) => {
                  setConsent(event.target.checked);
                  if (event.target.checked) setConsentError(false);
                }}
                disabled={isBusy}
                aria-invalid={consentError || undefined}
                aria-describedby={consentError ? "analysis-consent-error" : undefined}
                className="mt-1 h-4 w-4 accent-[hsl(var(--brand))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <span>
                I consent to my health document being processed to generate this
                analysis, as described above, and I understand I can clear the
                result at any time.
              </span>
            </label>

            {consentError ? (
              <p
                id="analysis-consent-error"
                role="alert"
                className="mt-2 text-sm font-medium text-red-700 dark:text-red-400"
              >
                Please tick the box above to give your consent before uploading.
              </p>
            ) : null}
          </div>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`rounded-lg border border-dashed p-8 text-center transition-colors ${
              isDragging ? "border-primary bg-primary/10" : ""
            }`}
          >
            <FileText className="mx-auto mb-4 h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <h3 className="font-medium">Upload your document</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Drag a file here, or choose one. Supported formats: PDF, JPG, PNG, and
              WebP. Large photos are compressed automatically.
            </p>

            <Button className="mt-5" onClick={handleUploadClick} disabled={isBusy}>
              {isBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  {stage === "reading" ? "Reading on your device..." : "Analyzing..."}
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                  Upload Document
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isBusy && (
        <Card aria-busy="true">
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>
                  {stage === "reading" ? "Preparing document" : "Analyzing document"}
                </CardTitle>
                <CardDescription>
                  {stage === "reading"
                    ? "Reading your file on this device."
                    : isSlow
                      ? "Still working. Scanned and photographed reports can take up to a minute."
                      : "Extracting values and generating the analysis."}
                </CardDescription>
              </div>

              <Button variant="outline" size="sm" onClick={handleCancel}>
                <X className="mr-2 h-4 w-4" aria-hidden="true" />
                Cancel
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      )}

      {analysisResult && !isBusy && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Document Analysis</CardTitle>
                <CardDescription>
                  AI-generated analysis of the uploaded document.
                </CardDescription>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleExport}>
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                  Export
                </Button>
                <Button variant="outline" size="sm" onClick={handleClearAnalysis}>
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  Clear
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <DocumentAnalysisResults result={analysisResult} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseZap className="h-5 w-5" aria-hidden="true" />
            Health Trends
            <Badge variant="secondary">Sample data</Badge>
          </CardTitle>
          <CardDescription>
            Monthly count of health records over the last six months. This chart
            shows sample records until persistent health-record storage is
            connected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {records ? (
            <HealthTrendsChart data={monthlyTrends} />
          ) : (
            <Skeleton className="h-[350px] w-full rounded-lg" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Records</CardTitle>
          <CardDescription>
            Example records are shown below until persistent health-record
            storage is connected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(records ?? []).map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="whitespace-nowrap">{record.date}</TableCell>
                    <TableCell>{record.type}</TableCell>
                    <TableCell>{record.title}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{record.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Alert>
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Important</AlertTitle>
        <AlertDescription>
          Automated document analysis is for informational purposes only. It is
          not a medical diagnosis and should not replace advice from a
          qualified healthcare professional. Do not make treatment or
          medication decisions based solely on this analysis.
        </AlertDescription>
      </Alert>
    </div>
  );
}