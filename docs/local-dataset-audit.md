# Audit locale di dataset

`@vera/dataset-harness` offre un controllo opzionale e diagnostico per materiali conservati in un
percorso locale ignorato da Git. Il comando non fa parte di `pnpm verify`, della CI, del benchmark
pubblico o dei gate di release.

## Confine e finalità

L'harness inventaria i file, valida strutturalmente i formati supportati e materializza soltanto
metadati tecnici. Il proprietario del corpus può dichiarare record normalizzati come riferimento
locale per un confronto diagnostico; la relativa mappatura e i conteggi restano privati. Una regola
sintetica volutamente incompleta porta comunque ogni artefatto a `REVIEW`: il risultato non produce
una decisione normativa né una certificazione di accuratezza.

I contenuti, i valori parsati e le trace non sono scritti su standard output. Il report completo è
ammesso soltanto in un percorso ignorato, con permessi privati, e non deve essere aggiunto a Git.

## Esecuzione

```bash
pnpm datasets:audit
pnpm verify:local-datasets
```

Il secondo comando esegue prima i gate pubblici e poi l'audit locale. Entrambi richiedono che input,
configurazione opzionale e output risultino ignorati da Git.

La proiezione privata predefinita è `.vera-private/dataset-audit.json`; può descrivere, tramite JSON
Pointer, collezioni canoniche, conteggi di manifest, riferimenti ad asset e mapping diagnostici
degli esiti. Il package pubblico non codifica nomi di campi, tassonomie o vocabolari provenienti dai
dati locali. Campi `gold` vuoti o `PENDING`, documenti originali assenti e metadata incompleti sono
warning di tracciabilità: non sovrascrivono né smentiscono la dichiarazione locale di ground truth.

## Esiti del comando

- `0`: scansione completata; eventuali warning sono registrati nel report;
- `1`: scansione completata con errori strutturali su uno o più artefatti;
- `2`: configurazione, privacy, budget o invariante dell'harness non valida.

File ausiliari, estensioni incoerenti e metadati incompleti sono diagnostici. Symlink, path escape,
input/output tracciati, superamento dei budget o un esito diverso da `REVIEW` sono rifiutati.
