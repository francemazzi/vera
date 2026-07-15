# Metodologia VERA

Questa specifica definisce il comportamento metodologico minimo di VERA. I termini `DEVE`,
`NON DEVE`, `DOVREBBE` e `PUÒ` hanno valore normativo. In caso di divergenza tra esempi e testo
normativo prevale il testo; i contract test devono però rendere la divergenza visibile e bloccare il
gate di fase.

> **Limite di validazione:** VERA esegue una verifica esclusivamente tecnica. Fonti, identità,
> approvazioni, regole, fixture e risultati inclusi nel repository sono sintetici e dichiarano
> `validationScope=TECHNICAL_DEMO`. Un output VERA non costituisce certificazione, consulenza o
> validazione professionale.

## 1. Principi e termini

- Una **fonte** è una versione immutabile di un contenuto da cui derivano requisiti tracciabili.
- Una **Rule Card** è l'interpretazione revisionabile di un requisito, ancora indipendente dalla sua
  espressione eseguibile.
- Una **regola** è una definizione dichiarativa che separa applicabilità, eccezioni e condizione di
  rispetto del requisito.
- Una **fixture** è un caso sintetico con facts, evidenze, data di valutazione ed esito atteso.
- Un **Rule Pack** è uno snapshot versionato di regole e riferimenti approvati.
- Un **finding** è l'esito grezzo e immutabile prodotto dal kernel per una regola.
- Una **decisione di revisione** è un evento umano successivo al finding: non riscrive né nasconde
  l'esito del kernel.
- Un **attore** è un'identità autenticata. I controlli di separazione si applicano all'identità,
  anche quando la stessa identità possiede più ruoli.

L'AI PUÒ estrarre facts o proporre Rule Card in stato `DRAFT`; NON DEVE approvare fonti, Rule Card,
regole o Rule Pack, creare eventi di attivazione oppure produrre direttamente un esito normativo. Il
kernel usa soltanto input validati e non dipende da AI, rete, database o interfaccia.

## 2. Flusso normativo

Il flusso obbligatorio è:

```text
source → rule card → rule → test → approval → activation
```

Ogni passaggio conserva gli identificatori e gli hash del passaggio precedente. Una modifica al
contenuto crea una nuova revisione o versione, invalida test e approvazioni riferiti al vecchio hash
e NON DEVE aggiornare retroattivamente uno snapshot già approvato.

### 2.1 Source

Ogni versione di fonte segue la sequenza append-only:

| Stato corrente | Operazione   | Ruolo richiesto | Stato risultante | Vincoli principali                         |
| -------------- | ------------ | --------------- | ---------------- | ------------------------------------------ |
| —              | caricamento  | `AUTHOR`        | `UPLOADED`       | byte, hash, licenza e periodo presenti     |
| `UPLOADED`     | revisione    | `REVIEWER`      | `REVIEWED`       | attore diverso da chi ha caricato          |
| `REVIEWED`     | approvazione | `APPROVER`      | `APPROVED`       | attore diverso da autore e reviewer        |
| `APPROVED`     | ritiro       | `APPROVER`      | `RETIRED`        | motivo obbligatorio; nessuna cancellazione |

Non esistono transizioni all'indietro. Una revisione o approvazione negativa viene registrata come
decisione con motivazione; la correzione produce una nuova versione `UPLOADED`. Una fonte `RETIRED`
resta disponibile per replay storici, ma non entra in nuove attivazioni.

### 2.2 Rule Card

Una Rule Card identifica almeno fonte e sezione, attore, oggetto o azione, ambito, `normativeKey`,
categoria deontica, eccezioni, evidenze richieste, rischio, costi d'errore e periodo di validità.

Il suo workflow logico è:

```text
DRAFT → IN_REVIEW → APPROVED → RETIRED
              ↘ CHANGES_REQUESTED → nuova revisione DRAFT
```

- Solo `DRAFT` è modificabile e ogni scrittura usa optimistic concurrency.
- L'invio a `IN_REVIEW` congela la revisione e richiede una fonte `APPROVED`.
- `CHANGES_REQUESTED` è terminale per quella revisione; la correzione è una nuova revisione.
- L'approvazione è legata all'hash della revisione e applica il quorum della sezione 8.
- `APPROVED` e `CHANGES_REQUESTED` sono proiezioni delle decisioni firmate, non transizioni
  esplicite che un consumer può inserire direttamente.
- Una card ritirata resta leggibile per replay, ma non genera nuove regole.
- Una proposta generata da AI nasce sempre `DRAFT`, indica il provider ed esige gli stessi controlli
  di una proposta manuale.

### 2.3 Rule, test, approval e activation

1. Una regola `DRAFT` può essere creata soltanto da una revisione di Rule Card `APPROVED` e deve
   conservarne identificatore e hash. La richiesta registra separatamente `generationAt` ed
   `evaluationDate`: il quorum della card deve esistere al primo istante e la fonte deve risultare
   approvata sia allora sia al momento della richiesta; la validità del contenuto è verificata al
   secondo. Il replay storico usa gli snapshot di audit e non riapre questo percorso di generazione.
2. La regola esprime almeno `appliesWhen`, `satisfiedWhen`, eventuali `exceptions`, periodo,
   riferimenti alle evidenze richieste e `unknownPolicy=REVIEW`.
3. Il test runner congela regola e fixture per hash. Ogni regola deve avere almeno un caso sintetico
   per `PASS`, `FAIL`, `REVIEW` e `NOT_APPLICABLE`, oltre ai casi pertinenti per eccezioni, override
   e confini temporali.
4. Una modifica della regola o di una fixture obbligatoria azzera lo stato verificato. Solo un run
   completo e riuscito rende la regola idonea a uno snapshot candidato.
5. L'approvazione riguarda l'intero snapshot candidato del Rule Pack, inclusi elenco regole,
   fixture, risultati, fonti e Rule Card. Il quorum è calcolato sul rischio effettivo massimo.
6. Un Rule Pack approvato è immutabile. Correzioni e aggiornamenti producono una nuova versione
   SemVer e un nuovo ciclo di test e approvazione.
7. L'attivazione è un `ActivationEvent` append-only separato dalla versione. Deve indicare attore,
   timestamp UTC, motivo e versione approvata. Un rollback è un nuovo evento verso una versione
   precedente approvata, non una mutazione dello storico.

L'attivazione DEVE fallire se una fonte o card riferita non è approvata, una fixture obbligatoria
manca, un test fallisce, il quorum non è raggiunto, gli intervalli non sono compatibili oppure
l'hash candidato differisce da quello approvato.

## 3. Logica a tre valori

Ogni espressione DSL restituisce esattamente `TRUE`, `FALSE` o `UNKNOWN`. `UNKNOWN` non equivale a
`FALSE` e non può essere convertito implicitamente in un booleano.

Un operatore che richiede un valore restituisce `UNKNOWN` quando il fact è assente, `NULL`,
`NOT_FOUND`, `NOT_READABLE`, `CONFLICT`, non valido per tipo oppure privo dell'evidenza richiesta.
L'unica eccezione è `present`: un'osservazione `NOT_FOUND` supportata da evidenza produce `FALSE`;
senza evidenza resta `UNKNOWN`. Un fact manuale deve avere un'evidenza di attestazione; il solo
inserimento di un valore non è sufficiente.

### 3.1 Operatori logici

| `not` input | Risultato |
| ----------- | --------- |
| `TRUE`      | `FALSE`   |
| `FALSE`     | `TRUE`    |
| `UNKNOWN`   | `UNKNOWN` |

| `all`     | `TRUE`    | `FALSE` | `UNKNOWN` |
| --------- | --------- | ------- | --------- |
| `TRUE`    | `TRUE`    | `FALSE` | `UNKNOWN` |
| `FALSE`   | `FALSE`   | `FALSE` | `FALSE`   |
| `UNKNOWN` | `UNKNOWN` | `FALSE` | `UNKNOWN` |

| `any`     | `TRUE` | `FALSE`   | `UNKNOWN` |
| --------- | ------ | --------- | --------- |
| `TRUE`    | `TRUE` | `TRUE`    | `TRUE`    |
| `FALSE`   | `TRUE` | `FALSE`   | `UNKNOWN` |
| `UNKNOWN` | `TRUE` | `UNKNOWN` | `UNKNOWN` |

`all([])` e `any([])` sono schemi invalidi: una combinazione logica DEVE contenere almeno un
operando. Il kernel può evitare di calcolare rami che non cambiano il valore, ma la trace deve
registrare il motivo dello short-circuit.

### 3.2 Dalla regola al finding

Le eccezioni di una regola sono combinate con `any`: una singola eccezione vera restringe
l'applicabilità. `—` indica che il valore non viene calcolato.

| `appliesWhen` | Eccezione | `satisfiedWhen` | Finding          | Motivo                   |
| ------------- | --------- | --------------- | ---------------- | ------------------------ |
| `FALSE`       | —         | —               | `NOT_APPLICABLE` | ambito non applicabile   |
| `UNKNOWN`     | —         | —               | `REVIEW`         | applicabilità incerta    |
| `TRUE`        | `TRUE`    | —               | `NOT_APPLICABLE` | eccezione applicabile    |
| `TRUE`        | `UNKNOWN` | —               | `REVIEW`         | eccezione incerta        |
| `TRUE`        | `FALSE`   | `TRUE`          | `PASS`           | requisito rispettato     |
| `TRUE`        | `FALSE`   | `FALSE`         | `FAIL`           | requisito non rispettato |
| `TRUE`        | `FALSE`   | `UNKNOWN`       | `REVIEW`         | evidenza insufficiente   |

Se non sono dichiarate eccezioni, il relativo valore operativo è `FALSE`. `unknownPolicy` è fissato
a `REVIEW`: una regola o un Rule Pack non può configurare `UNKNOWN` come `PASS`, `FAIL` o
`NOT_APPLICABLE`.

### 3.3 Aggregazione

L'aggregazione considera i finding già risolti per eccezioni, override e conflitti:

1. Se almeno un finding è `FAIL`, l'esito aggregato è `FAIL`.
2. Altrimenti, se almeno un finding è `REVIEW`, l'esito è `REVIEW`.
3. Altrimenti, se almeno un finding è `PASS`, l'esito è `PASS`.
4. Se esiste almeno un finding e sono tutti `NOT_APPLICABLE`, l'esito è `NOT_APPLICABLE`.

Un Rule Pack vuoto o l'assenza di una versione risolvibile è un errore controllato di valutazione,
non un `NOT_APPLICABLE`. I finding individuali restano sempre disponibili anche quando
l'aggregazione ha un esito diverso.

## 4. Categorie deontiche

La categoria descrive il significato della Rule Card; non cambia la truth table. In ogni categoria
`satisfiedWhen` DEVE essere formulato come predicato di rispetto del requisito.

| Categoria     | Significato                                        | Forma del predicato di rispetto                                       |
| ------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| `OBLIGATION`  | un'azione o uno stato è richiesto                  | prova che l'azione o lo stato richiesto è presente                    |
| `PROHIBITION` | un'azione o uno stato è vietato                    | prova che la condizione vietata è assente, normalmente con `not(...)` |
| `PERMISSION`  | un'azione è consentita soltanto a certe condizioni | prova che le condizioni di autorizzazione sono soddisfatte            |

Per `PERMISSION`, `appliesWhen` indica che l'azione consentita è esercitata o richiesta. Se non lo
è, il finding è `NOT_APPLICABLE`; se lo è e le condizioni non sono soddisfatte, il finding è `FAIL`.
Una permission non crea implicitamente un'obbligation e l'assenza dell'azione non produce un
fallimento.

Ogni card DEVE avere una `normativeKey` canonica che identifica attore, oggetto o azione e ambito.
La chiave serve a rilevare relazioni e conflitti tra regole; non sostituisce i riferimenti alla
fonte.

## 5. Eccezioni, override e conflitti

### 5.1 Eccezioni

Un'eccezione appartiene a una sola regola, restringe il suo ambito e deve avere identificatore,
predicato, motivazione e riferimento stabile alla fonte. Non può essere aggiunta dopo una
valutazione per modificarne l'esito. Più eccezioni sono valutate con `any`:

- almeno una `TRUE` produce `NOT_APPLICABLE` per la regola;
- nessuna `TRUE` e almeno una `UNKNOWN` produce `REVIEW`;
- tutte `FALSE` fanno proseguire con `satisfiedWhen`.

### 5.2 Override

Un override è una relazione versionata ed esplicita `overridingRuleId → overriddenRuleId`,
accompagnata da predicato `when`, motivo e fonte. Gli override formano un grafo diretto aciclico
nello stesso Rule Pack; self-loop, cicli, riferimenti mancanti e relazioni tra intervalli che non si
sovrappongono invalidano lo snapshot.

- `when=TRUE` e regola prevalente applicabile: la regola subordinata diventa `NOT_APPLICABLE` con
  motivo `OVERRIDDEN`.
- `when=FALSE`: entrambe le regole vengono valutate normalmente.
- `when=UNKNOWN` oppure applicabilità incerta della regola prevalente: le regole coinvolte producono
  `REVIEW` con la relazione nella trace.

Un override sopprime l'applicabilità della regola subordinata; non converte mai un `FAIL` o `REVIEW`
in `PASS`. L'ordine è deterministico: ordinamento topologico e, a parità, identificatore canonico
della regola.

### 5.3 Conflitti

Esiste un conflitto quando due regole temporalmente valide e simultaneamente applicabili hanno la
stessa `normativeKey` e categorie o condizioni di rispetto incompatibili. `OBLIGATION` contro
`PROHIBITION` e `PERMISSION` contro `PROHIBITION` sulla stessa azione sono incompatibilità
predefinite; altre incompatibilità devono essere dichiarate con una relazione `conflictsWith`.

Una relazione di override applicabile risolve il conflitto. Senza precedenza esplicita, tutti i
finding coinvolti diventano `REVIEW` con motivo `UNRESOLVED_CONFLICT`; un eventuale `FAIL`
indipendente continua a prevalere nell'aggregazione. La selezione silenziosa per ordine di
caricamento, data di creazione o identificatore è vietata.

Una decisione umana successiva può registrare una disposizione operativa, ma non modifica i finding
originali. Per rischio effettivo `HIGH` o `CRITICAL` la motivazione è obbligatoria e si applica lo
stesso quorum di approvazione previsto per il rischio.

## 6. Rischio e costi d'errore

Ogni Rule Card dichiara:

- `riskLevel`: rischio intrinseco del requisito;
- `falsePositiveCost`: costo di classificare come non conforme un caso conforme;
- `falseNegativeCost`: costo di classificare come conforme un caso non conforme;
- una motivazione testuale per ciascun valore.

La scala ordinale è:

| Livello    | Criterio minimo                                                          |
| ---------- | ------------------------------------------------------------------------ |
| `LOW`      | impatto locale, limitato e facilmente reversibile                        |
| `MEDIUM`   | impatto circoscritto che richiede correzione pianificata                 |
| `HIGH`     | impatto materiale, durevole o difficile da correggere                    |
| `CRITICAL` | impatto sistemico, potenzialmente irreversibile o su funzioni essenziali |

Il **rischio effettivo** è il massimo ordinale tra i tre valori. Determina quorum, controlli di
revisione e limiti di automazione. In caso di dubbio tra due livelli si usa quello superiore e la
motivazione deve indicare l'incertezza. Una riduzione del livello o di un costo in una nuova
revisione richiede motivazione esplicita ed entra nel version diff.

Per materiale `TECHNICAL_DEMO`, una regola con rischio effettivo `HIGH` o `CRITICAL` non può
produrre un `PASS` operativo automatico: il finding tecnico resta `PASS`, ma la disposizione
esportabile rimane `REVIEW_REQUIRED` fino a decisione umana.

## 7. Tempo e validità

Tutti gli istanti pubblici sono stringhe RFC 3339 validate in UTC con suffisso `Z` e sono
confrontati come istanti, non come testo. Date locali, timestamp non validi e offset equivalenti
devono essere rifiutati al confine; un adapter può normalizzarli prima della validazione del
contratto pubblico. Il confronto DEVE conservare tutte le cifre dei secondi frazionari senza
troncarle ai millisecondi; frazioni che differiscono soltanto per zeri finali rappresentano lo
stesso istante.

Ogni intervallo è semiaperto:

```text
validFrom <= evaluationDate < validTo
```

- `validFrom` è obbligatorio ed è incluso.
- `validTo` è escluso; `validTo=null` equivale a durata indefinita.
- Se presente, `validTo` deve essere strettamente successivo a `validFrom`.
- Un istante uguale a `validTo` non appartiene all'intervallo.

Una regola è eleggibile soltanto nell'intersezione non vuota degli intervalli di fonte, Rule Card,
regola e Rule Pack. Uno snapshot che dichiara una regola fuori dall'intersezione è invalido. Il
resolver usa la `evaluationDate` richiesta e gli eventi di attivazione disponibili a quell'istante;
un evento successivo non cambia un replay storico.

## 8. Ruoli, quorum e separazione dei compiti

| Ruolo      | Operazioni consentite                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| `AUTHOR`   | caricare fonti, creare bozze, proporre regole e fixture, inviare a revisione       |
| `REVIEWER` | verificare provenienza e coerenza, accettare la review o richiedere modifiche      |
| `APPROVER` | approvare o rifiutare snapshot, ritirare versioni e creare eventi di attivazione   |
| `ADMIN`    | gestire account, assegnazioni e configurazione; non ottiene approvazioni implicite |

Le assegnazioni possono comprendere più ruoli, ma per ogni versione o revisione:

- nessun contributor può revisionare o approvare il contenuto a cui ha contribuito;
- reviewer e approver devono essere identità distinte;
- per rischio effettivo `LOW` o `MEDIUM` serve un reviewer e un approver;
- per rischio effettivo `HIGH` o `CRITICAL` servono un reviewer e due approver distinti tra loro;
- l'attore che attiva deve avere ruolo `APPROVER`, non deve essere contributor e può essere uno
  degli approver che hanno già formato il quorum;
- `ADMIN` non può ignorare quorum, test, immutabilità o separazione dei compiti;
- ogni decisione registra actor ID, ruolo esercitato, timestamp UTC, motivo, hash del contenuto e
  `validationScope`.

Il quorum del Rule Pack usa il rischio effettivo massimo delle regole incluse. Rimozioni o
sostituzioni non riducono retroattivamente il quorum di una versione già sottoposta ad approvazione:
è necessario creare un nuovo candidato e ripetere test e approvazione.

## 9. Esiti tecnici e revisione umana

Gli unici esiti del kernel sono `PASS`, `FAIL`, `REVIEW` e `NOT_APPLICABLE`. Non esiste un esito
`CERTIFIED` e nessun ruolo, provider o configurazione può introdurlo.

Ogni export o report deve distinguere:

1. finding tecnico originale;
2. eventuale decisione umana append-only;
3. ambito di validazione;
4. fonti, versioni, facts, evidenze e trace usati;
5. disclaimer che esclude certificazione e validazione professionale.

La revisione umana può confermare, correggere facts, dichiarare non applicabilità o richiedere
approfondimento. Una correzione dei facts genera una nuova valutazione collegata alla precedente;
non modifica il run originario. In ambito `TECHNICAL_DEMO`, anche le identità e le approvazioni
umane sono dimostrative e non vengono presentate come verifica professionale.

## 10. Esempi normativi sintetici

Gli esempi seguenti sono neutrali, fittizi e destinati ai contract test.

| Caso | Applicabilità | Eccezione | Requisito | Esito atteso     |
| ---- | ------------- | --------- | --------- | ---------------- |
| A    | `TRUE`        | `FALSE`   | `TRUE`    | `PASS`           |
| B    | `TRUE`        | `FALSE`   | `FALSE`   | `FAIL`           |
| C    | `TRUE`        | `FALSE`   | `UNKNOWN` | `REVIEW`         |
| D    | `FALSE`       | —         | —         | `NOT_APPLICABLE` |
| E    | `TRUE`        | `TRUE`    | —         | `NOT_APPLICABLE` |
| F    | `TRUE`        | `UNKNOWN` | —         | `REVIEW`         |
| G    | `UNKNOWN`     | —         | —         | `REVIEW`         |

Esempi di transizione validi: `UPLOADED → REVIEWED` da un reviewer distinto e `APPROVED → RETIRED`
con motivo. Esempi invalidi: `UPLOADED → APPROVED`, self-approval e ritiro senza motivo. Gli
invarianti di attivazione e del grafo di override sono specificati qui e diventano eseguibili nei
gate delle fasi che introducono quegli oggetti.

Ogni esempio deve essere materializzato come fixture machine-readable con
`validationScope=TECHNICAL_DEMO`; i nomi dei casi della tabella costituiscono identificatori stabili
per i contract test della metodologia.
