---
layout: home
title: Registro tecnico
description: Contratti verificabili, regole versionate e valutazioni deterministiche.

hero:
  name: VERA
  text: Registro delle evidenze
  tagline:
    Contratti verificabili, regole versionate e valutazioni deterministiche — documentati come una
    catena di custodia tecnica.
  actions:
    - theme: brand
      text: Guida npm · in preparazione
      link: /npm-integration
    - theme: alt
      text: Esplora l’architettura
      link: /architecture

features:
  - title: Contratti prima del codice
    details:
      Schemi runtime e tipi TypeScript condividono lo stesso confine pubblico, validato prima di
      ogni valutazione.
  - title: Decisioni riproducibili
    details:
      Il kernel è puro, usa una data UTC esplicita e conserva finding, trace, versione e hash degli
      input.
  - title: Incertezza visibile
    details:
      Evidenze assenti o ambigue producono REVIEW; nessun valore sconosciuto viene promosso a
      conformità.
---

<section class="home-ledger" aria-labelledby="ledger-heading">
  <div class="home-ledger__main">
    <p class="home-ledger__eyebrow">Nota di apertura / 17</p>
    <h2 id="ledger-heading">Ogni esito deve poter tornare alle sue prove.</h2>
    <p>VERA separa acquisizione, interpretazione e decisione. Le fonti diventano regole dichiarative; gli input vengono validati; il kernel produce un risultato immutabile che conserva finding e trace. Questa documentazione racconta il sistema nello stesso ordine in cui può essere verificato.</p>
  </div>
  <aside class="home-ledger__status" aria-label="Stato della distribuzione">
    <p class="home-ledger__label">Stato distribuzione</p>
    <div class="home-ledger__entry">
      <strong>npm / preparato</strong>
      <span>I pacchetti 0.2.0 non sono ancora pubblicati.</span>
    </div>
    <div class="home-ledger__entry">
      <strong>Pages / manuale</strong>
      <span>Il portale richiede attivazione e deploy espliciti.</span>
    </div>
    <div class="home-ledger__entry">
      <strong>Ambito / tecnico</strong>
      <span>Ogni esempio dichiara TECHNICAL_DEMO.</span>
    </div>
  </aside>
</section>

<section class="evidence-flow" aria-label="Flusso di valutazione">
  <div class="evidence-flow__step">
    <strong>JSON validato</strong>
    <span>Gli schemi rifiutano input incompleti o incoerenti.</span>
  </div>
  <div class="evidence-flow__step">
    <strong>Versione fissata</strong>
    <span>Rule Pack e data UTC rendono esplicito il contesto.</span>
  </div>
  <div class="evidence-flow__step">
    <strong>Kernel puro</strong>
    <span>La valutazione non consulta rete, AI, UI o storage.</span>
  </div>
  <div class="evidence-flow__step">
    <strong>Finding + trace</strong>
    <span>Esito aggregato e prove restano ispezionabili.</span>
  </div>
</section>

## Percorsi di lettura

- Parti dalla [guida all’integrazione npm](./npm-integration.md) per consumare i due package
  pubblici dopo il futuro rilascio.
- Leggi la [metodologia](./methodology.md), quindi [DSL](./dsl.md) e [kernel](./kernel.md), per
  ricostruire la semantica degli esiti.
- Consulta le [decisioni architetturali](./adr/index.md) per capire i confini e il
  [registro delle verifiche](./verification/index.md) per ripetere i gate.

::: warning Limite di validazione

VERA dimostra un processo tecnico su materiali sintetici con `validationScope=TECHNICAL_DEMO`. I
suoi output non costituiscono certificazione, consulenza o validazione professionale.

:::
