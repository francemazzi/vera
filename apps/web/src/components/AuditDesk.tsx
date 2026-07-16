import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

import { pdfSupportStatus } from "../pdf-support.js";
import { canExport, canRoleReview, requiresCriticalRationale } from "../review-store.js";
import { useReviewQueue } from "../use-review-queue.js";
import type { DecisionType, ReviewItem, UserRole } from "../types.js";

const DECISIONS: readonly { readonly value: DecisionType; readonly label: string }[] = [
  { value: "CONFIRM", label: "Conferma" },
  { value: "CORRECT", label: "Correggi" },
  { value: "NOT_APPLICABLE", label: "Non applicabile" },
  { value: "DEEPEN", label: "Approfondisci" },
];

export interface AuditDeskProps {
  readonly role: UserRole;
  readonly onLogout: () => void;
}

function statusLabel(item: ReviewItem): string {
  return item.status === "REVIEWED" ? "revisionato" : "in attesa";
}

export function AuditDesk({ role, onLogout }: AuditDeskProps): ReactElement {
  const { queue, saveDecision, conflict, reset } = useReviewQueue();
  const items = queue.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadedVersions, setLoadedVersions] = useState<Readonly<Record<string, number>>>({});
  const [decisionType, setDecisionType] = useState<DecisionType>("CONFIRM");
  const [rationale, setRationale] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const selected = useMemo(
    () => items.find((item) => item.id === (selectedId ?? items[0]?.id)),
    [items, selectedId],
  );
  const pdfStatus = pdfSupportStatus();

  useEffect(() => {
    if (selectedId === null && items[0] !== undefined) setSelectedId(items[0].id);
  }, [items, selectedId]);

  useEffect(() => {
    if (selected === undefined) return;
    setLoadedVersions((current) =>
      current[selected.id] === undefined
        ? { ...current, [selected.id]: selected.version }
        : current,
    );
  }, [selected]);

  if (queue.isLoading) {
    return <main aria-busy="true">Caricamento coda…</main>;
  }

  if (selected === undefined) {
    return <main>Nessun elemento di revisione disponibile.</main>;
  }

  const roleCanReview = canRoleReview(role);
  const exportReady = canExport(items);
  const expectedVersion = loadedVersions[selected.id] ?? selected.version;
  const criticalRationaleRequired = requiresCriticalRationale(selected, decisionType);

  const submitDecision = async (): Promise<void> => {
    setFormError(null);
    try {
      await saveDecision.mutateAsync({
        itemId: selected.id,
        expectedVersion,
        decisionType,
        rationale,
        role,
      });
      setRationale("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Decisione non salvata.");
    }
  };

  const simulateConflict = async (): Promise<void> => {
    setFormError(null);
    await conflict.mutateAsync(selected.id);
  };

  const resetQueue = async (): Promise<void> => {
    setLoadedVersions({});
    setDecisionType("CONFIRM");
    setRationale("");
    setFormError(null);
    await reset.mutateAsync(undefined);
  };

  return (
    <main className="audit-shell" aria-labelledby="desk-title">
      <header className="topbar">
        <div>
          <p className="eyebrow">Audit desk</p>
          <h1 id="desk-title">Revisione tecnica VERA</h1>
        </div>
        <div className="session-box" aria-label="Sessione corrente">
          <span>Ruolo: {role}</span>
          <button type="button" onClick={onLogout}>
            Esci
          </button>
        </div>
      </header>

      <section className="notice" aria-label="Limiti della demo">
        <strong>TECHNICAL_DEMO.</strong> Fonti, regole e decisioni sono sintetiche. La UI non mostra
        valori di confidenza non calibrati e non produce certificazioni.
      </section>

      <div className="workspace">
        <aside className="queue-panel" aria-labelledby="queue-title">
          <h2 id="queue-title">Coda revisioni persistente</h2>
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === selected.id ? "queue-item active" : "queue-item"}
                  onClick={() => {
                    setSelectedId(item.id);
                    setDecisionType("CONFIRM");
                    setRationale("");
                    setFormError(null);
                  }}
                  aria-current={item.id === selected.id ? "true" : undefined}
                >
                  <span>{item.documentTitle}</span>
                  <small>{statusLabel(item)}</small>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              void resetQueue();
            }}
          >
            Reimposta demo
          </button>
        </aside>

        <section className="document-panel" aria-labelledby="document-title">
          <p className="eyebrow">Documento e evidenze</p>
          <h2 id="document-title">{selected.documentTitle}</h2>
          <p>
            Tipo: {selected.documentKind}. Renderer PDF.js{" "}
            {pdfStatus.enabled ? "disponibile" : "non disponibile"}.
          </p>
          <article className="document-page" aria-label="Testo documento sintetico">
            {selected.pageText}
          </article>
          <h3>Evidenze</h3>
          <ul className="evidence-list">
            {selected.evidence.map((evidence) => (
              <li key={evidence.id}>
                <mark>{evidence.text}</mark>
                <span>
                  pagina {evidence.page}, bbox [{evidence.boundingBox.x}, {evidence.boundingBox.y},{" "}
                  {evidence.boundingBox.width}, {evidence.boundingBox.height}]
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rule-panel" aria-labelledby="rule-title">
          <p className="eyebrow">Regola e trace</p>
          <h2 id="rule-title">{selected.rule.title}</h2>
          <dl className="metadata-grid">
            <div>
              <dt>Fonte</dt>
              <dd>{selected.rule.sourceSection}</dd>
            </div>
            <div>
              <dt>Rischio</dt>
              <dd>{selected.rule.riskLevel}</dd>
            </div>
            <div>
              <dt>Provenienza</dt>
              <dd>{selected.rule.provenance}</dd>
            </div>
            <div>
              <dt>Versione UI</dt>
              <dd>
                vista {expectedVersion}, corrente {selected.version}
              </dd>
            </div>
          </dl>

          <h3>Trace deterministica</h3>
          <ol className="trace-list">
            {selected.trace.map((step) => (
              <li key={step.id}>
                <strong>
                  {step.label}: {step.value}
                </strong>
                <p>{step.explanation}</p>
              </li>
            ))}
          </ol>

          <form
            className="decision-form"
            aria-labelledby="decision-title"
            onSubmit={(event) => {
              event.preventDefault();
              void submitDecision();
            }}
          >
            <h3 id="decision-title">Decisione umana</h3>
            {!roleCanReview ? (
              <p role="status">Il ruolo {role} può leggere ma non decidere revisioni.</p>
            ) : null}
            <fieldset disabled={!roleCanReview || selected.status === "REVIEWED"}>
              <legend>Esito revisione</legend>
              {DECISIONS.map((decision) => (
                <label key={decision.value}>
                  <input
                    type="radio"
                    name="decision"
                    value={decision.value}
                    checked={decisionType === decision.value}
                    onChange={() => {
                      setDecisionType(decision.value);
                    }}
                  />
                  {decision.label}
                </label>
              ))}
            </fieldset>
            <label htmlFor="rationale">
              Motivazione
              {criticalRationaleRequired ? " obbligatoria per override critici" : ""}
            </label>
            <textarea
              id="rationale"
              value={rationale}
              onChange={(event) => {
                setRationale(event.target.value);
              }}
              disabled={!roleCanReview || selected.status === "REVIEWED"}
            />
            {formError === null ? null : (
              <p className="error" role="alert">
                {formError}
              </p>
            )}
            <div className="actions">
              <button type="submit" disabled={!roleCanReview || selected.status === "REVIEWED"}>
                Salva decisione
              </button>
              <button
                type="button"
                onClick={() => {
                  void simulateConflict();
                }}
              >
                Simula conflitto
              </button>
            </div>
          </form>

          <section className="export-box" aria-labelledby="export-title">
            <h3 id="export-title">Export</h3>
            <p>
              {exportReady
                ? "Tutte le revisioni richieste sono complete."
                : selected.exportBlockedReason}
            </p>
            <button type="button" disabled={!exportReady}>
              Esporta audit
            </button>
          </section>
        </section>
      </div>
    </main>
  );
}
