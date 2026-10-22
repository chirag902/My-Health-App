// @vitest-environment jsdom
//
// Behaviour tests for the Health Records screen.
// Shadcn components, the toast hook, next/dynamic and client-document are replaced by test doubles;
// everything else (the component itself, the helpers, the logger) is real.

import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  prepareDocument: vi.fn(),
  getIdToken: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

vi.mock("@/lib/auth-client", () => ({ getIdToken: mocks.getIdToken }));

vi.mock("@/lib/client-document", () => ({
  MAX_INPUT_BYTES: 15 * 1024 * 1024,
  prepareDocument: mocks.prepareDocument,
}));

/* Replaced so the test needs neither recharts nor the real results renderer. */
vi.mock("./health-trends-chart", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ data }: { data: unknown }) =>
      createElement("div", { "data-testid": "chart", "data-points": JSON.stringify(data) }),
  };
});

vi.mock("./document-analysis-results", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ result }: { result: { summary: string } }) =>
      createElement("div", { "data-testid": "results" }, result.summary),
  };
});

/* next/dynamic: render the lazily imported module synchronously-ish through React.lazy. */
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: (loader: () => Promise<{ default: React.ComponentType<any> }>) => {
      const Lazy = React.lazy(loader);
      return function Dynamic(props: any) {
        return React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy, props));
      };
    },
  };
});

import HealthRecords from "./health-records";

/* ============================================================
   HELPERS
   ============================================================ */

const fetchMock = vi.fn();

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

/** What Vercel returns for 413/504: an HTML/plain page, not JSON. */
const nonJsonResponse = (status: number) =>
  ({
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError("Unexpected token <");
    },
  }) as unknown as Response;

const SUCCESS = { success: true, data: { summary: "All values look normal.", keyDataPoints: [], recommendations: [] } };

const pdf = (name = "report.pdf", type = "application/pdf") => new File(["%PDF-1.4 content"], name, { type });

const fileInput = (container: HTMLElement) => container.querySelector('input[type="file"]') as HTMLInputElement;
const uploadButton = () => screen.getByRole("button", { name: /upload document/i }) as HTMLButtonElement;
const consentBox = () => screen.getByRole("checkbox") as HTMLInputElement;

const chooseFile = (container: HTMLElement, file: File) =>
  fireEvent.change(fileInput(container), { target: { files: [file] } });

/** Tick consent, then pick a file, the way a real user would. */
function startUpload(container: HTMLElement, file: File = pdf()) {
  fireEvent.click(consentBox());
  chooseFile(container, file);
}

/** The inline consent error. Looked up by id: shadcn <Alert> also renders role="alert", so the role is not unique. */
const consentError = () => document.getElementById("analysis-consent-error");

const toastTitles = () => mocks.toast.mock.calls.map(([arg]) => (arg as { title: string }).title);
const lastToast = () => mocks.toast.mock.calls.at(-1)?.[0] as { title: string; description?: string; variant?: string };

/** Let pending promises (prepareDocument, fetch, json) settle. */
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  mocks.getIdToken.mockImplementation(async (forceRefresh?: boolean) => (forceRefresh ? "fresh-token" : "token-123"));
  mocks.prepareDocument.mockResolvedValue({ kind: "text", text: "Haemoglobin 13.5 g/dL 13 - 17" });
  fetchMock.mockResolvedValue(jsonResponse(SUCCESS));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mocks.toast.mockReset();
  mocks.prepareDocument.mockReset();
  mocks.getIdToken.mockReset();
  fetchMock.mockReset();
});

/* ============================================================
   1. THE REPORTED BUG: "my upload button is not working"
   ============================================================ */

describe("upload button and consent", () => {
  it("is NOT disabled before consent is given (regression: it used to look dead)", () => {
    render(<HealthRecords />);

    expect(uploadButton().disabled).toBe(false);
  });

  it("explains what is missing, focuses the checkbox, and does not open the file picker", async () => {
    const pickerOpened = vi.spyOn(HTMLInputElement.prototype, "click");
    render(<HealthRecords />);

    await userEvent.setup().click(uploadButton());

    await screen.findByText(/tick the box above/i);
    expect(consentError()?.textContent).toMatch(/tick the box/i);
    expect(consentError()?.getAttribute("role")).toBe("alert");
    expect(document.activeElement).toBe(consentBox());
    expect(consentBox().getAttribute("aria-invalid")).toBe("true");
    expect(pickerOpened).not.toHaveBeenCalled();
  });

  it("opens the file picker once consent is given, and clears the error", async () => {
    const pickerOpened = vi.spyOn(HTMLInputElement.prototype, "click");
    render(<HealthRecords />);
    const user = userEvent.setup();

    await user.click(uploadButton()); // no consent -> error
    expect(consentError()).not.toBeNull();

    await user.click(consentBox());
    expect(consentError()).toBeNull();

    await user.click(uploadButton());
    expect(pickerOpened).toHaveBeenCalledTimes(1);
  });

  it("enforces consent even if the file input fires on its own", () => {
    const { container } = render(<HealthRecords />);

    chooseFile(container, pdf()); // no consent ticked

    expect(mocks.prepareDocument).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consentError()).not.toBeNull();
  });
});

/* ============================================================
   2. FILE VALIDATION
   ============================================================ */

describe("file validation", () => {
  it("rejects unsupported types without touching the network", () => {
    const { container } = render(<HealthRecords />);

    startUpload(container, new File(["x"], "notes.docx", { type: "" }));

    expect(lastToast()).toMatchObject({ title: "Unsupported file", variant: "destructive" });
    expect(mocks.prepareDocument).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives iPhone HEIC photos a specific, helpful message", () => {
    const { container } = render(<HealthRecords />);

    startUpload(container, new File(["x"], "IMG_0001.HEIC", { type: "image/heic" }));

    expect(lastToast().title).toMatch(/HEIC/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects empty and oversized files", () => {
    const { container } = render(<HealthRecords />);

    startUpload(container, new File([], "empty.pdf", { type: "application/pdf" }));
    expect(lastToast().title).toBe("Empty file");

    const huge = pdf("huge.pdf");
    Object.defineProperty(huge, "size", { value: 16 * 1024 * 1024 });
    chooseFile(container, huge);
    expect(lastToast().title).toBe("File is too large");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a PDF whose browser-reported type is empty, and gives the pipeline a correct type", async () => {
    const { container } = render(<HealthRecords />);

    startUpload(container, pdf("lab-report.pdf", ""));
    await flush();

    expect(mocks.prepareDocument).toHaveBeenCalledTimes(1);

    const passed = mocks.prepareDocument.mock.calls[0][0] as File;
    expect(passed.type).toBe("application/pdf");
    expect(passed.name).toBe("lab-report.pdf");
  });
});

/* ============================================================
   3. HAPPY PATH + SERVER REQUESTS
   ============================================================ */

describe("analysis flow", () => {
  it("sends extracted text as JSON and shows the results", async () => {
    const { container } = render(<HealthRecords />);

    startUpload(container);

    expect((await screen.findByTestId("results")).textContent).toBe("All values look normal.");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/analyze-document");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ text: "Haemoglobin 13.5 g/dL 13 - 17" });

    expect(toastTitles()).toContain("Document analyzed");
    expect(uploadButton().disabled).toBe(false); // back to idle
  });

  it("sends images as multipart form data under the field 'document'", async () => {
    const image = new File(["jpegbytes"], "page-1.jpg", { type: "image/jpeg" });
    mocks.prepareDocument.mockResolvedValue({ kind: "files", files: [image] });

    const { container } = render(<HealthRecords />);
    startUpload(container, new File(["raw"], "photo.jpg", { type: "image/jpeg" }));

    await screen.findByTestId("results");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("document")).toBeInstanceOf(File);
  });

  it("shows the server's own error message", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "This PDF looks like a scan." }, 422));

    const { container } = render(<HealthRecords />);
    startUpload(container);
    await flush();
    await flush();

    expect(lastToast()).toMatchObject({
      title: "Analysis failed",
      description: "This PDF looks like a scan.",
      variant: "destructive",
    });
    expect(screen.queryByTestId("results")).toBeNull();
    expect(uploadButton().disabled).toBe(false);
  });

  it("explains platform errors that return no JSON (413/504)", async () => {
    fetchMock.mockResolvedValue(nonJsonResponse(413));

    const { container } = render(<HealthRecords />);
    startUpload(container);
    await flush();
    await flush();

    expect(lastToast().description).toMatch(/too large/i);
  });

  it("recovers from a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const { container } = render(<HealthRecords />);
    startUpload(container);
    await flush();
    await flush();

    expect(lastToast()).toMatchObject({ title: "Analysis failed", description: "Failed to fetch" });
    expect(uploadButton().disabled).toBe(false);
  });

  it("rejects a malformed success response instead of rendering garbage", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));

    const { container } = render(<HealthRecords />);
    startUpload(container);
    await flush();
    await flush();

    expect(lastToast().description).toMatch(/unexpected response/i);
    expect(screen.queryByTestId("results")).toBeNull();
  });

  it("can analyze a second document after the first", async () => {
    const { container } = render(<HealthRecords />);

    startUpload(container);
    await screen.findByTestId("results");

    chooseFile(container, pdf("second.pdf"));
    await flush();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/* ============================================================
   3b. SIGN-IN: the API now requires a Firebase ID token
   ============================================================ */

describe("authentication", () => {
  it("sends the signed-in user's token with text requests", async () => {
    const { container } = render(<HealthRecords />);

    startUpload(container);
    await screen.findByTestId("results");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer token-123");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("sends the token with file uploads WITHOUT setting Content-Type (the browser must add the multipart boundary)", async () => {
    mocks.prepareDocument.mockResolvedValue({
      kind: "files",
      files: [new File(["jpegbytes"], "page-1.jpg", { type: "image/jpeg" })],
    });

    const { container } = render(<HealthRecords />);
    startUpload(container, new File(["raw"], "photo.jpg", { type: "image/jpeg" }));
    await screen.findByTestId("results");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({ Authorization: "Bearer token-123" });
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("tells a signed-out user to sign in, BEFORE reading the file or touching the network", async () => {
    const { UserFacingError } = await import("@/lib/errors");
    mocks.getIdToken.mockRejectedValue(new UserFacingError("Please sign in to analyze a document."));

    const { container } = render(<HealthRecords />);
    startUpload(container);
    await flush();
    await flush();

    expect(lastToast()).toMatchObject({
      title: "Analysis failed",
      description: "Please sign in to analyze a document.",
      variant: "destructive",
    });
    expect(mocks.prepareDocument).not.toHaveBeenCalled(); // did not waste time reading a big PDF
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadButton().disabled).toBe(false);
  });

  it("refreshes an expired token ONCE and retries with the fresh one", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: false, error: "Please sign in to analyze a document." }, 401))
      .mockResolvedValueOnce(jsonResponse(SUCCESS));

    const { container } = render(<HealthRecords />);
    startUpload(container);

    await screen.findByTestId("results");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer token-123");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer fresh-token");
    expect(mocks.getIdToken).toHaveBeenLastCalledWith(true);
    expect(toastTitles()).not.toContain("Analysis failed"); // the user never saw the hiccup
  });

  it("does not loop: a second 401 is reported, after exactly two requests", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: "Please sign in to analyze a document." }, 401));

    const { container } = render(<HealthRecords />);
    startUpload(container);
    await flush();
    await flush();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastToast()).toMatchObject({ title: "Analysis failed", description: "Please sign in to analyze a document." });
  });

  it("shows the server's rate-limit message and does not retry", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: "Too many requests. Please try again in 8 minutes.", code: "rate_limited" }, 429)
    );

    const { container } = render(<HealthRecords />);
    startUpload(container);
    await flush();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastToast().description).toBe("Too many requests. Please try again in 8 minutes.");
  });

  it("explains a rate limit even if the response has no JSON body", async () => {
    fetchMock.mockResolvedValue(nonJsonResponse(429));

    const { container } = render(<HealthRecords />);
    startUpload(container);
    await flush();
    await flush();

    expect(lastToast().description).toMatch(/too many requests/i);
  });

  it("reports a session that cannot be refreshed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, error: "Please sign in." }, 401));
    mocks.getIdToken.mockImplementation(async (forceRefresh?: boolean) => {
      if (forceRefresh) throw new Error("Your session could not be refreshed. Please sign in again.");
      return "token-123";
    });

    const { container } = render(<HealthRecords />);
    startUpload(container);
    await flush();
    await flush();
    await flush();

    expect(lastToast().description).toBe("Your session could not be refreshed. Please sign in again.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/* ============================================================
   4. CANCEL, UNMOUNT, STALE REQUESTS, TIMEOUT
   ============================================================ */

/** A fetch that stays pending until aborted, like a slow server. */
function pendingUntilAborted() {
  const signals: AbortSignal[] = [];

  fetchMock.mockImplementation(
    (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        signals.push(init.signal);
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })
  );

  return signals;
}

describe("cancel, unmount and timeouts", () => {
  it("cancels an in-flight analysis quietly and returns to idle", async () => {
    const signals = pendingUntilAborted();
    const { container } = render(<HealthRecords />);

    startUpload(container);
    await flush();

    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    await flush();

    expect(signals[0].aborted).toBe(true);
    expect(toastTitles()).toContain("Analysis cancelled");
    expect(toastTitles()).not.toContain("Analysis failed");
    expect(uploadButton().disabled).toBe(false);
  });

  it("ignores a response that arrives AFTER the user cancelled", async () => {
    let finishRequest: (value: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (finishRequest = resolve)));

    const { container } = render(<HealthRecords />);
    startUpload(container);
    await flush();

    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    await act(async () => {
      finishRequest(jsonResponse(SUCCESS));
      await Promise.resolve();
    });
    await flush();

    expect(screen.queryByTestId("results")).toBeNull();
    expect(toastTitles()).not.toContain("Document analyzed");
  });

  it("aborts the request when the user leaves the page", async () => {
    const signals = pendingUntilAborted();
    const { container, unmount } = render(<HealthRecords />);

    startUpload(container);
    await flush();
    expect(signals[0].aborted).toBe(false);

    unmount();

    expect(signals[0].aborted).toBe(true);
  });

  it("reports a timeout with a clear message, and tells the user when work is slow", async () => {
    vi.useFakeTimers();
    pendingUntilAborted();

    const { container } = render(<HealthRecords />);
    startUpload(container);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(document.body.textContent).toMatch(/still working/i);

    await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });

    expect(lastToast()).toMatchObject({ title: "Analysis failed" });
    expect(lastToast().description).toMatch(/timed out/i);
    expect(uploadButton().disabled).toBe(false);
  });
});

/* ============================================================
   5. DRAG AND DROP
   ============================================================ */

describe("drag and drop", () => {
  const dropZone = () => screen.getByText(/upload your document/i).closest("div") as HTMLElement;

  it("analyzes a dropped file when consent is given", async () => {
    render(<HealthRecords />);
    fireEvent.click(consentBox());

    fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf()] } });

    expect((await screen.findByTestId("results")).textContent).toContain("normal");
    expect(mocks.prepareDocument).toHaveBeenCalledTimes(1);
  });

  it("asks for consent instead of analyzing a dropped file", () => {
    render(<HealthRecords />);

    fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf()] } });

    expect(consentError()).not.toBeNull();
    expect(mocks.prepareDocument).not.toHaveBeenCalled();
  });

  it("refuses several files at once", () => {
    render(<HealthRecords />);
    fireEvent.click(consentBox());

    fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf("a.pdf"), pdf("b.pdf")] } });

    expect(lastToast().title).toBe("One document at a time");
    expect(mocks.prepareDocument).not.toHaveBeenCalled();
  });
});

/* ============================================================
   6. SAMPLE DATA + ACCESSIBILITY
   ============================================================ */

describe("sample data and accessibility", () => {
  it("shows a non-empty trend chart and clearly labelled sample rows (regression: chart was all zeros)", async () => {
    render(<HealthRecords />);

    const chart = await screen.findByTestId("chart");
    const points = JSON.parse(chart.getAttribute("data-points") as string) as Array<{ records: number }>;

    expect(points).toHaveLength(6);
    expect(points.reduce((sum, p) => sum + p.records, 0)).toBe(3);

    expect(screen.getAllByRole("row")).toHaveLength(4); // header + 3 sample records
    expect(screen.getAllByText("Sample").length).toBe(3);
  });

  it("announces progress to screen readers", async () => {
    pendingUntilAborted();
    const { container } = render(<HealthRecords />);

    startUpload(container);
    await flush();

    const status = screen.getAllByRole("status")[0];
    expect(status.textContent).toMatch(/analyzing/i);
  });

  it("labels the hidden file input", () => {
    const { container } = render(<HealthRecords />);

    expect(fileInput(container).getAttribute("aria-label")).toMatch(/choose a document/i);
  });
});