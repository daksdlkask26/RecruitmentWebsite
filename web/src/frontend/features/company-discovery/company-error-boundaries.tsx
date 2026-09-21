"use client";

export function CompanyListError({ reset }: { reset: () => void }) {
  return (
    <main role="alert">
      <h1>Companies could not be loaded</h1>
      <p>Try again in a moment.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}

export function CompanyDetailError({ reset }: { reset: () => void }) {
  return (
    <main role="alert">
      <h1>Company details could not be loaded</h1>
      <p>This company may no longer be publicly available.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
