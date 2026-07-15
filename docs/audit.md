# Provenienza e audit

La Fase 13 introduce un audit trail tecnico, immutabile ed esportabile per ogni valutazione. Il
modello segue una forma Entity–Activity–Agent:

- `AuditEntityRef` registra hash e descrizione di input, prompt, provider, facts, evidence, snapshot
  Rule Pack, risultato, findings e trace.
- `AuditActivity` collega attività, agenti, entità usate ed entità generate.
- `AuditAgent` collega identità locale, ruolo esercitato e ambito `TECHNICAL_DEMO`.
- `EvaluationRun` conserva lo snapshot completo di valutazione, i digest derivati e il proprio
  `contentHash`.
- `ReviewDecision` è un evento append-only con sequenza, motivazione, identità, ruolo, timestamp e
  hash dell’evento precedente.
- `EvaluationAuditExport` serializza run e decisioni in JSON canonico con `exportHash`.

## Hash registrati

Ogni run registra hash SHA-256 canonicali per:

- input originale;
- prompt, quando presente;
- provider/runtime, quando presente;
- facts ed evidenze passate al kernel;
- snapshot Rule Pack;
- risultato di valutazione;
- findings;
- trace.

Gli hash di snapshot, risultato, findings e trace vengono ricalcolati dagli schemi Zod durante la
validazione. Un mismatch rende il run invalido.

## Catena append-only

Le decisioni umane non modificano mai `EvaluationRun`. Ogni `ReviewDecision` punta a:

- `runId`;
- `runContentHash`;
- `sequence`;
- `previousEventHash`.

La prima decisione deve avere `sequence=1` e `previousEventHash=null`; ogni decisione successiva
deve puntare al `contentHash` dell’evento precedente. Il ledger in memoria rifiuta sequenze stale,
duplicati e decisioni collegate a un hash run non corrente.

## Replay storico

`replayEvaluationAuditExport` legge solo l’export canonico e restituisce lo snapshot storico
contenuto nel run. Non consulta repository correnti, attivazioni correnti o versioni mutate. Questo
mantiene riproducibile un risultato anche quando Rule Pack o fonti evolvono in seguito.

## Limite

L’audit trail dimostrativo verifica integrità tecnica, provenienza e replay. Non costituisce
certificazione, validazione professionale o consulenza.
