// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { AuditDesk, resetReviewQueue } from "../../src/index.js";

function renderDesk(): RenderResult {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AuditDesk role="REVIEWER" onLogout={() => undefined} />
    </QueryClientProvider>,
  );
}

describe("review workflow integration", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetReviewQueue();
  });

  it("keeps export blocked until every queue item has a human review", async () => {
    renderDesk();

    expect(await screen.findByRole("button", { name: "Esporta audit" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Salva decisione" }));
    await waitFor(() => expect(screen.getAllByText("revisionato")[0]).toBeVisible());
    expect(screen.getByRole("button", { name: "Esporta audit" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /retention review/i }));
    fireEvent.click(screen.getByRole("button", { name: "Salva decisione" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Esporta audit" })).toBeEnabled(),
    );
  });
});
