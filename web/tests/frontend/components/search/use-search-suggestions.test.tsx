import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSearchSuggestions } from "@/frontend/features/search/client/use-search-suggestions";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function Probe({ value }: { value: string }) {
  const result = useSearchSuggestions("JOBS", value);
  return (
    <output data-testid="suggestion">
      {result.suggestions[0]?.labelEn ?? "empty"}
    </output>
  );
}

function response(query: string, labelEn: string) {
  return new Response(
    JSON.stringify({
      scope: "JOBS",
      query,
      catalogVersion: "test-catalog",
      suggestions: [
        {
          id: `title-${query}`,
          type: "TITLE",
          labelVi: labelEn,
          labelEn,
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("useSearchSuggestions", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("debounces requests and ignores a stale response after the query changes", async () => {
    vi.useFakeTimers();
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<Probe value="frotend" />);
    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    view.rerender(<Probe value="frontend" />);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal,
    ).toHaveProperty("aborted", true);

    await act(async () => {
      second.resolve(response("frontend", "Frontend Developer"));
      await second.promise;
    });
    expect(screen.getByTestId("suggestion")).toHaveTextContent(
      "Frontend Developer",
    );

    await act(async () => {
      first.resolve(response("frotend", "Stale Suggestion"));
      await first.promise;
    });
    expect(screen.getByTestId("suggestion")).toHaveTextContent(
      "Frontend Developer",
    );
  });
});
