import type { ReviewItem } from "./types.js";

export const DEMO_QUEUE: readonly ReviewItem[] = [
  {
    id: "review-critical-label",
    caseId: "synthetic-case-001",
    documentTitle: "Synthetic demo document — label review",
    documentKind: "PDF",
    pageText:
      "Pagina 1. Il record sintetico mostra un codice visibile: DEMO-CODE-42. Il documento è fittizio e usato solo per verifica tecnica.",
    evidence: [
      {
        id: "ev-label",
        page: 1,
        text: "codice visibile: DEMO-CODE-42",
        language: "it",
        boundingBox: { x: 0.18, y: 0.26, width: 0.44, height: 0.08 },
      },
    ],
    rule: {
      id: "rule-visible-label",
      title: "Il codice sintetico deve essere visibile",
      sourceSection: "SYN-REF-001 §1",
      riskLevel: "CRITICAL",
      validationScope: "TECHNICAL_DEMO",
      provenance: "AI_ASSISTED",
    },
    trace: [
      {
        id: "trace-applicability",
        label: "Applicabilità",
        value: "TRUE",
        explanation: "Il caso contiene un record sintetico con codice.",
      },
      {
        id: "trace-evidence",
        label: "Evidenza richiesta",
        value: "TRUE",
        explanation: "Il testo evidenziato contiene un codice demo visibile.",
      },
    ],
    status: "PENDING",
    version: 1,
    decision: null,
    exportBlockedReason: "Revisione critica non completata.",
  },
  {
    id: "review-json-retention",
    caseId: "synthetic-case-002",
    documentTitle: "Synthetic JSON facts — retention review",
    documentKind: "JSON",
    pageText: '{ "retentionDays": 7, "source": "synthetic", "validationScope": "TECHNICAL_DEMO" }',
    evidence: [
      {
        id: "ev-retention",
        page: 1,
        text: '"retentionDays": 7',
        language: "en",
        boundingBox: { x: 0.08, y: 0.18, width: 0.36, height: 0.06 },
      },
    ],
    rule: {
      id: "rule-retention-days",
      title: "Il valore retentionDays deve essere presente",
      sourceSection: "SYN-REF-002 §2",
      riskLevel: "LOW",
      validationScope: "TECHNICAL_DEMO",
      provenance: "MANUAL",
    },
    trace: [
      {
        id: "trace-json-present",
        label: "Fatto JSON",
        value: "TRUE",
        explanation: "Il campo retentionDays è presente nel JSON sintetico.",
      },
    ],
    status: "PENDING",
    version: 1,
    decision: null,
    exportBlockedReason: "Revisione del fatto JSON non completata.",
  },
];
