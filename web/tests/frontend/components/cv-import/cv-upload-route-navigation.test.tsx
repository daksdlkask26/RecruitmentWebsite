import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCvImport } from "@/frontend/features/cv-import/client/use-cv-import";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

function Harness() {
  const importer = useCvImport({ csrfProof: "csrf_fixture" });
  return (
    <button
      type="button"
      onClick={() =>
        void importer.upload(
          new File(["%PDF-1.7\nfixture"], "candidate.pdf", {
            type: "application/pdf",
          }),
          "DETERMINISTIC_INTERNAL",
        )
      }
    >
      start upload
    </button>
  );
}

class FakeUploadRequest {
  status = 202;
  responseText = JSON.stringify({
    uploadId: "upload_route_fixture",
    status: "VALIDATION_QUEUED",
    replayed: false,
    statusUrl: "/api/account/cv-imports/upload_route_fixture",
  });
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open = vi.fn();
  setRequestHeader = vi.fn();
  abort = vi.fn(() => this.onabort?.());
  send = vi.fn(() => queueMicrotask(() => this.onload?.()));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CV upload durable handoff", () => {
  it("parses both upload contracts and pushes the canonical status URL without polling", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          uploadId: "upload_route_fixture",
          status: "AWAITING_CONTENT",
          contentUrl: "/api/account/cv-imports/upload_route_fixture/content",
          expiresAt: "2026-09-08T12:00:00.000Z",
          limits: {
            maximumBytes: 5_000_000,
            requiredContentType: "application/pdf",
            requiredContentLength: 15,
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    const request = new FakeUploadRequest();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "XMLHttpRequest",
      vi.fn(function () {
        return request;
      }),
    );

    render(<Harness />);
    await act(async () => {
      screen.getByRole("button", { name: "start upload" }).click();
    });

    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        "/profile/cv-imports/upload_route_fixture",
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/cv-imports",
      expect.objectContaining({ method: "POST" }),
    );
    expect(request.open).toHaveBeenCalledWith(
      "PUT",
      "/api/account/cv-imports/upload_route_fixture/content",
    );
  });
});
