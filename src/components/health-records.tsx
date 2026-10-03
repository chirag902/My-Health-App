"use client";

import {
  ChangeEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
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

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

import type { AnalyzeDocumentOutput } from "@/lib/types";
import { logger } from "@/lib/logger";

/* ============================================================
   LAZY-LOADED HEAVY COMPONENTS
   ============================================================ */

/**
 * Recharts is relatively heavy.
 *
 * Keep it out of the initial Health Records bundle and load it
 * only when the Health Trends section needs to render.
 */
const HealthTrendsChart = dynamic(
  () => import("./health-trends-chart"),
  {
    ssr: false,
    loading: () => (
      <Skeleton className="h-[350px] w-full rounded-lg" />
    ),
  }
);

/**
 * Document analysis results can also be relatively large.
 *
 * Load them only after an analysis has completed.
 */
const DocumentAnalysisResults = dynamic(
  () => import("./document-analysis-results"),
  {
    ssr: false,
    loading: () => (
      <Skeleton className="h-[300px] w-full rounded-lg" />
    ),
  }
);

/* ============================================================
   CONSTANTS
   ============================================================ */

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_FILE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MONTHS_TO_DISPLAY = 6;

/* ============================================================
   TYPES
   ============================================================ */

interface HealthTrendPoint {
  month: string;
  records: number;
}

interface HealthRecord {
  id: string;
  date: string;
  type: string;
  title: string;
  status: string;
}

/**
 * Demo records are intentionally kept separate from real data.
 *
 * IMPORTANT:
 * These are UI examples only.
 * They must never be presented as the user's actual medical data.
 */
const demoRecords: HealthRecord[] = [
  {
    id: "demo-1",
    date: "2024-05-10",
    type: "Lab Result",
    title: "Annual Blood Panel",
    status: "Demo",
  },
  {
    id: "demo-2",
    date: "2024-04-22",
    type: "Diagnosis",
    title: "Example Diagnosis Record",
    status: "Demo",
  },
  {
    id: "demo-3",
    date: "2023-11-05",
    type: "Consultation Note",
    title: "Example Consultation Note",
    status: "Demo",
  },
];

/* ============================================================
   HELPERS
   ============================================================ */

function isSupportedFile(file: File): boolean {
  return ALLOWED_FILE_TYPES.has(file.type);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Something went wrong. Please try again.";
}

/**
 * Safely checks whether an unknown value looks like the expected
 * server action/API response.
 */
function isSuccessfulAnalysisResponse(
  value: unknown
): value is {
  success: true;
  data: AnalyzeDocumentOutput;
} {
  if (
    typeof value !== "object" ||
    value === null ||
    !("success" in value) ||
    !("data" in value)
  ) {
    return false;
  }

  const response = value as {
    success?: unknown;
    data?: unknown;
  };

  return response.success === true && response.data !== undefined;
}

/**
 * Returns a stable YYYY-MM key for grouping dates.
 *
 * Dates produced by the application are expected to be ISO/date
 * strings. Invalid values are ignored.
 */
function getMonthKey(dateValue: string): string | null {
  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `${date.getUTCFullYear()}-${String(
    date.getUTCMonth() + 1
  ).padStart(2, "0")}`;
}

/**
 * Converts a YYYY-MM key into a compact chart label.
 */
function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);

  if (!year || !month) {
    return monthKey;
  }

  const date = new Date(Date.UTC(year, month - 1, 1));

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
  }).format(date);
}

/**
 * Creates six monthly buckets ending with the current month.
 *
 * This does NOT fabricate health measurements.
 * It only counts real records supplied to the function.
 */
function buildMonthlyTrends(
  records: HealthRecord[]
): HealthTrendPoint[] {
  const now = new Date();

  const buckets: Array<{
    key: string;
    label: string;
    records: number;
  }> = [];

  for (
    let offset = MONTHS_TO_DISPLAY - 1;
    offset >= 0;
    offset--
  ) {
    const date = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() - offset,
        1
      )
    );

    const key = `${date.getUTCFullYear()}-${String(
      date.getUTCMonth() + 1
    ).padStart(2, "0")}`;

    buckets.push({
      key,
      label: formatMonthLabel(key),
      records: 0,
    });
  }

  const bucketMap = new Map(
    buckets.map((bucket) => [bucket.key, bucket])
  );

  for (const record of records) {
    const monthKey = getMonthKey(record.date);

    if (!monthKey) {
      continue;
    }

    const bucket = bucketMap.get(monthKey);

    if (bucket) {
      bucket.records += 1;
    }
  }

  return buckets.map((bucket) => ({
    month: bucket.label,
    records: bucket.records,
  }));
}

/* ============================================================
   COMPONENT
   ============================================================ */

export default function HealthRecords() {
  const [isLoading, setIsLoading] = useState(false);

  const [analysisResult, setAnalysisResult] =
    useState<AnalyzeDocumentOutput | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();

  /**
   * Currently there is no persisted health-record collection
   * wired into this component.
   *
   * Therefore we intentionally use the existing demo records
   * only for the record-count trend.
   *
   * Once Firestore health records are connected, replace
   * `demoRecords` with the authenticated user's records.
   */
  const records = demoRecords;

  const monthlyTrends = useMemo(
    () => buildMonthlyTrends(records),
    [records]
  );

  /* ============================================================
     UPLOAD
     ============================================================ */

  const handleUploadClick = useCallback(() => {
    if (isLoading) {
      return;
    }

    fileInputRef.current?.click();
  }, [isLoading]);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      if (!file) {
        return;
      }

      /**
       * Client-side validation is for UX only.
       *
       * The server/API MUST validate the same constraints again.
       */
      if (!isSupportedFile(file)) {
        toast({
          variant: "destructive",
          title: "Unsupported file",
          description:
            "Please upload a PDF, JPG, PNG, or WebP document.",
        });

        event.target.value = "";
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        toast({
          variant: "destructive",
          title: "File is too large",
          description:
            "Please upload a document smaller than 10 MB.",
        });

        event.target.value = "";
        return;
      }

      setIsLoading(true);
      setAnalysisResult(null);

      try {
        const formData = new FormData();

        formData.append("document", file);

        const response = await fetch(
          "/api/analyze-document",
          {
            method: "POST",
            body: formData,
          }
        );

        let result: unknown;

        try {
          result = await response.json();
        } catch {
          throw new Error(
            "The document analysis service returned an invalid response."
          );
        }

        if (!response.ok) {
          const apiError =
            typeof result === "object" &&
            result !== null &&
            "error" in result &&
            typeof result.error === "string"
              ? result.error
              : "Document analysis failed.";

          throw new Error(apiError);
        }

        if (!isSuccessfulAnalysisResponse(result)) {
          throw new Error(
            "The document analysis service returned an unexpected response."
          );
        }

        setAnalysisResult(result.data);

        toast({
          title: "Document analyzed",
          description:
            "Your document was successfully analyzed.",
        });
      } catch (error: unknown) {
        /**
         * Do not log the uploaded document or its contents.
         *
         * Medical documents can contain sensitive health information.
         */
        logger.error("Document analysis failed", {
          error:
            error instanceof Error
              ? error.name
              : "UnknownError",
        });

        toast({
          variant: "destructive",
          title: "Analysis failed",
          description: getErrorMessage(error),
        });
      } finally {
        setIsLoading(false);

        /**
         * Allows the same file to be selected again.
         */
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [toast]
  );

  /* ============================================================
     EXPORT
     ============================================================ */

  const handleExport = useCallback(() => {
    if (!analysisResult) {
      toast({
        variant: "destructive",
        title: "Nothing to export",
        description:
          "Analyze a document before exporting its results.",
      });

      return;
    }

    try {
      const exportData = JSON.stringify(
        analysisResult,
        null,
        2
      );

      const blob = new Blob([exportData], {
        type: "application/json",
      });

      const url = URL.createObjectURL(blob);

      const anchor = document.createElement("a");

      anchor.href = url;

      anchor.download = `health-analysis-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;

      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      URL.revokeObjectURL(url);

      toast({
        title: "Export complete",
        description:
          "The analysis result has been exported as a JSON file.",
      });
    } catch (error: unknown) {
      logger.error("Health analysis export failed", {
        error:
          error instanceof Error
            ? error.name
            : "UnknownError",
      });

      toast({
        variant: "destructive",
        title: "Export failed",
        description:
          "The analysis result could not be exported.",
      });
    }
  }, [analysisResult, toast]);

  /* ============================================================
     CLEAR
     ============================================================ */

  const handleClearAnalysis = useCallback(() => {
    if (isLoading) {
      return;
    }

    setAnalysisResult(null);

    toast({
      title: "Analysis cleared",
      description:
        "The current document analysis has been removed from this page.",
    });
  }, [isLoading, toast]);

  /* ============================================================
     UI
     ============================================================ */

  return (
    <div className="space-y-6">
      {/* ======================================================
          SECURITY / INFORMATION NOTICE
          ====================================================== */}

      <Alert>
        <ShieldCheck className="h-4 w-4" />

        <AlertTitle>
          Your health information
        </AlertTitle>

        <AlertDescription>
          Documents uploaded here are sent to the application&apos;s
          document-analysis service. Do not upload information you
          do not want processed by the application. Analysis results
          are informational and should be reviewed by a qualified
          healthcare professional.
        </AlertDescription>
      </Alert>

      {/* ======================================================
          DOCUMENT UPLOAD
          ====================================================== */}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileScan className="h-5 w-5" />
            Analyze Health Document
          </CardTitle>

          <CardDescription>
            Upload a medical report, laboratory result, or supported
            health document for automated analysis.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <input
            ref={fileInputRef}
            type="file"
            accept="
              .pdf,
              .jpg,
              .jpeg,
              .png,
              .webp,
              application/pdf,
              image/jpeg,
              image/png,
              image/webp
            "
            onChange={handleFileChange}
            disabled={isLoading}
            className="hidden"
          />

          <div className="rounded-lg border border-dashed p-8 text-center">
            <FileText className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />

            <h3 className="font-medium">
              Upload your document
            </h3>

            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Supported formats: PDF, JPG, PNG, and WebP.
              Maximum file size: 10 MB.
            </p>

            <Button
              className="mt-5"
              onClick={handleUploadClick}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Document
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ======================================================
          ANALYSIS LOADING STATE
          ====================================================== */}

      {isLoading && (
        <Card>
          <CardHeader>
            <CardTitle>
              Analyzing document
            </CardTitle>

            <CardDescription>
              Extracting information and generating the analysis.
              This may take a little while.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      )}

      {/* ======================================================
          ANALYSIS RESULT
          ====================================================== */}

      {analysisResult && !isLoading && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>
                  Document Analysis
                </CardTitle>

                <CardDescription>
                  AI-generated analysis of the uploaded document.
                </CardDescription>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExport}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearAnalysis}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <DocumentAnalysisResults
              result={analysisResult}
            />
          </CardContent>
        </Card>
      )}

      {/* ======================================================
          HEALTH TRENDS
          ====================================================== */}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseZap className="h-5 w-5" />
            Health Trends
          </CardTitle>

          <CardDescription>
            Monthly count of health records available to the
            application over the last six months.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <HealthTrendsChart data={monthlyTrends} />
        </CardContent>
      </Card>

      {/* ======================================================
          RECORDS
          ====================================================== */}

      <Card>
        <CardHeader>
          <CardTitle>
            Records
          </CardTitle>

          <CardDescription>
            Example records are shown below until persistent
            health-record storage is connected.
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
                {records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="whitespace-nowrap">
                      {record.date}
                    </TableCell>

                    <TableCell>
                      {record.type}
                    </TableCell>

                    <TableCell>
                      {record.title}
                    </TableCell>

                    <TableCell>
                      <Badge variant="secondary">
                        {record.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ======================================================
          MEDICAL DISCLAIMER
          ====================================================== */}

      <Alert>
        <AlertTriangle className="h-4 w-4" />

        <AlertTitle>
          Important
        </AlertTitle>

        <AlertDescription>
          Automated document analysis is for informational purposes
          only. It is not a medical diagnosis and should not replace
          advice from a qualified healthcare professional. Do not
          make treatment or medication decisions based solely on this
          analysis.
        </AlertDescription>
      </Alert>
    </div>
  );
}