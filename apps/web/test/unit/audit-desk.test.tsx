// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AuditDesk, resetReviewQueue } from "../../src/index.js";

function renderDesk(role: "AUTHOR" | "REVIEWER" | "APPROVER" | "ADMIN" = "REVIEWER"): RenderResult {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AuditDesk role={role} onLogout={() => undefined} />
    </QueryClientProvider>,
  );
}

describe("AuditDesk", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetReviewQueue();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders accessible document, evidence, rule and export regions", async () => {
    renderDesk();

    expect(await screen.findByRole("heading", { name: "Revisione tecnica VERA" })).toBeVisible();
    expect(screen.getByText("Documento e evidenze")).toBeVisible();
    expect(screen.getAllByText(/DEMO-CODE-42/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Esporta audit" })).toBeDisabled();
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
  });

  it("blocks read-only roles from saving decisions", async () => {
    renderDesk("AUTHOR");

    expect(await screen.findByText(/può leggere ma non decidere/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Salva decisione" })).toBeDisabled();
  });

  it("requires rationale for critical not-applicable overrides", async () => {
    renderDesk("APPROVER");

    fireEvent.click(await screen.findByLabelText("Non applicabile"));
    fireEvent.click(screen.getByRole("button", { name: "Salva decisione" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Motivazione obbligatoria");
  });

  it("surfaces optimistic concurrency conflicts", async () => {
    renderDesk("REVIEWER");

    fireEvent.click(await screen.findByRole("button", { name: "Simula conflitto" }));
    await waitFor(() => expect(screen.getByText(/corrente 2/)).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Salva decisione" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("modificata da un’altra sessione");
  });
});
