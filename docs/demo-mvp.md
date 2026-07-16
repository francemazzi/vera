# MVP dimostrativo sintetico

`@vera/demo-mvp` orchestra un percorso tecnico completo con soli asset sintetici:

1. genera il corpus deterministico della Fase 9 con seed `42`;
2. registra una fonte sintetica approvata e un Rule Pack dimostrativo;
3. ingerisce i 20 casi con documenti PDF, immagine e JSON sintetici;
4. produce facts tramite adapter manuale locale deterministico;
5. valuta i casi con il kernel Rule Pack;
6. crea decisioni umane demo e audit export immutabili;
7. esegue benchmark e calibrazione sintetici;
8. produce un report JSON canonicalmente hashato.

Il report si genera con:

```bash
pnpm --filter @vera/demo-mvp build
pnpm --silent --filter @vera/demo-mvp report > /tmp/vera-demo-mvp-report.json
```

## Output atteso

Il report contiene:

- `corpus`: seed, hash, split 60/20/20 e blind case IDs;
- `source` e `rulePack`: riferimenti sintetici, hash e gate fixture;
- `ingestion`: conteggio casi e documenti per PDF/immagine/JSON;
- `extraction`: adapter, run, facts, evidenze e hash output grezzo;
- `evaluation`: conteggio esiti, match con atteso e review rate;
- `review` e `audit`: decisioni, export, replay e hash catena;
- `benchmark`: metriche con intervalli bootstrap, digest modello e latenza;
- `calibration`: profilo demo e decisione di astensione;
- `tuning`: massimo due cicli, entrambi limitati allo split development;
- `modelCards` e `limitations`: uso previsto e limiti della configurazione.

Valori principali della configurazione dimostrativa:

- 20 casi sintetici: 12 development, 4 calibration, 4 blind.
- 60 documenti sintetici: 20 PDF, 20 immagini SVG, 20 JSON.
- Esiti bilanciati: 5 `PASS`, 5 `FAIL`, 5 `REVIEW`, 5 `NOT_APPLICABLE`.
- Tutti i 20 casi del Rule Pack demo corrispondono all’esito atteso.
- L’export audit viene prodotto per ogni caso dopo decisione umana demo.

## Limiti

Questo MVP misura solo riproducibilità, schema, tracciabilità e completamento tecnico della
pipeline. Fonti, Rule Pack, facts, evidenze, revisioni, benchmark e profili sono sintetici e marcati
`TECHNICAL_DEMO`. Non costituiscono accuratezza reale, validazione professionale, certificazione o
consulenza.
