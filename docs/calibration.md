# Calibrazione e astensione

La Fase 10 introduce profili di calibrazione dimostrativi, versionati e riproducibili. I profili
servono a decidere quando una proposta tecnica può procedere e quando deve diventare `REVIEW`. Non
trasformano confidence grezze in garanzie e non autorizzano certificazioni automatiche.

## Profilo

`@vera/calibration` espone `CalibrationProfile` con:

- modello e digest;
- tipo target (`FACT` o `FINDING`);
- `factKey` opzionale per profili specifici;
- corpus hash;
- hash dei dati sorgente;
- algoritmo e hash parametri;
- reliability diagram;
- curva risk-coverage;
- soglia derivata;
- `validationScope=TECHNICAL_DEMO`;
- hash canonico del profilo.

Il profilo demo derivato dal benchmark sintetico ha:

```text
contentHash = 1ef8f3064c91d467a862a48ada1caa1d1e6a41b402c09522899bb9b9b92e95be
threshold   = 0.9
samples     = 4 calibration cases
```

## Astensione

`applyCalibration` produce sempre una decisione esplicita:

- `ALLOW` solo quando il profilo è compatibile, sufficiente e lo score supera la soglia;
- `REVIEW` se manca un profilo;
- `REVIEW` se i campioni sono insufficienti;
- `REVIEW` se lo score è sotto soglia;
- `REVIEW` per ogni `PASS` dimostrativo con rischio `HIGH` o `CRITICAL`.

## Fallback

`selectCalibrationProfile` preferisce un profilo esatto per `factKey`. Se non è disponibile o non ha
campioni minimi, può usare un profilo gerarchico con `factKey=null`, ma solo quando anche questo
supera i campioni minimi e possiede una soglia. Altrimenti la selezione torna `null` e
l’applicazione produce `REVIEW`.

## Replay

Il profilo conserva hash di corpus, osservazioni e parametri. Il replay non dipende dal dataset
locale ignorato e usa solo il corpus sintetico della Fase 9.
