import { defineConfig } from "vitepress";

// Keep navigation explicit so the docs build also validates every published route.
const adrItems = [
  { text: "Indice delle decisioni", link: "/adr/" },
  { text: "0001 · Confine del core pubblico", link: "/adr/0001-public-core-boundary" },
  { text: "0002 · Monorepo TypeScript", link: "/adr/0002-typescript-monorepo" },
  {
    text: "0003 · Confini DSL e semantica",
    link: "/adr/0003-dsl-boundaries-and-value-semantics",
  },
  {
    text: "0004 · Kernel e risoluzione",
    link: "/adr/0004-deterministic-kernel-and-resolution",
  },
  { text: "0005 · Ledger dei Rule Pack", link: "/adr/0005-immutable-rule-pack-ledger" },
  { text: "0006 · Correzione Fase 14", link: "/adr/0006-corrective-phase-14-boundary" },
];

const verificationItems = [
  { text: "Indice delle verifiche", link: "/verification/" },
  ...Array.from({ length: 18 }, (_, phase) => ({
    text: `Fase ${phase}`,
    link: `/verification/phase-${phase}`,
  })),
];

export default defineConfig({
  lang: "it-IT",
  title: "VERA",
  titleTemplate: ":title · Registro tecnico VERA",
  description:
    "Documentazione tecnica di VERA: contratti, kernel deterministico, Rule Pack e integrazione npm.",
  base: "/vera/",
  outDir: ".vitepress/dist",
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: false,
  appearance: true,
  head: [
    ["meta", { name: "theme-color", content: "#f2ecde", media: "(prefers-color-scheme: light)" }],
    ["meta", { name: "theme-color", content: "#0b1822", media: "(prefers-color-scheme: dark)" }],
    ["meta", { name: "color-scheme", content: "light dark" }],
  ],
  markdown: {
    codeCopyButtonTitle: "Copia codice",
    lineNumbers: true,
  },
  themeConfig: {
    siteTitle: "VERA / registro",
    nav: [
      { text: "Indice", link: "/" },
      { text: "Integrazione npm", link: "/npm-integration" },
      {
        text: "Fondamenti",
        items: [
          { text: "Architettura", link: "/architecture" },
          { text: "Metodologia", link: "/methodology" },
          { text: "DSL", link: "/dsl" },
          { text: "Kernel", link: "/kernel" },
        ],
      },
      {
        text: "Registro",
        items: [
          { text: "Roadmap", link: "/roadmap" },
          { text: "Decisioni architetturali", link: "/adr/" },
          { text: "Verifiche", link: "/verification/" },
          { text: "Release", link: "/release" },
        ],
      },
    ],
    sidebar: [
      {
        text: "Orientamento",
        items: [
          { text: "Registro VERA", link: "/" },
          { text: "Integrazione npm", link: "/npm-integration" },
          { text: "Architettura", link: "/architecture" },
          { text: "Metodologia", link: "/methodology" },
        ],
      },
      {
        text: "Motore deterministico",
        collapsed: false,
        items: [
          { text: "DSL dichiarativa", link: "/dsl" },
          { text: "Kernel", link: "/kernel" },
          { text: "Rule Pack", link: "/rule-packs" },
          { text: "Test e version diff", link: "/rule-testing" },
        ],
      },
      {
        text: "Dati e revisione",
        collapsed: true,
        items: [
          { text: "RAG e ingestione", link: "/rag" },
          { text: "Calibrazione", link: "/calibration" },
          { text: "Provenienza e audit", link: "/audit" },
          { text: "API e persistenza", link: "/api-storage" },
          { text: "UI di revisione", link: "/ui-review" },
        ],
      },
      {
        text: "Esecuzione e operazioni",
        collapsed: true,
        items: [
          { text: "MVP sintetico", link: "/demo-mvp" },
          { text: "Benchmark", link: "/benchmark" },
          { text: "Sviluppo locale", link: "/development" },
          { text: "Audit dataset locali", link: "/local-dataset-audit" },
          { text: "Release", link: "/release" },
          { text: "Roadmap", link: "/roadmap" },
        ],
      },
      {
        text: "Decisioni architetturali",
        collapsed: true,
        items: adrItems,
      },
      {
        text: "Evidenze di verifica",
        collapsed: true,
        items: verificationItems,
      },
    ],
    search: {
      provider: "local",
      options: {
        translations: {
          button: {
            buttonText: "Cerca",
            buttonAriaLabel: "Cerca nella documentazione",
          },
          modal: {
            noResultsText: "Nessun risultato per",
            resetButtonTitle: "Cancella la ricerca",
            backButtonTitle: "Chiudi la ricerca",
            displayDetails: "Mostra l’elenco dettagliato",
            footer: {
              selectText: "seleziona",
              selectKeyAriaLabel: "Invio",
              navigateText: "naviga",
              navigateUpKeyAriaLabel: "Freccia su",
              navigateDownKeyAriaLabel: "Freccia giù",
              closeText: "chiudi",
              closeKeyAriaLabel: "Esc",
            },
          },
        },
      },
    },
    outline: {
      level: [2, 3],
      label: "In questa pagina",
    },
    docFooter: {
      prev: "Pagina precedente",
      next: "Pagina successiva",
    },
    darkModeSwitchLabel: "Tema",
    lightModeSwitchTitle: "Usa il tema chiaro",
    darkModeSwitchTitle: "Usa il tema scuro",
    skipToContentLabel: "Vai al contenuto",
    sidebarMenuLabel: "Menu",
    returnToTopLabel: "Torna all’inizio",
    langMenuLabel: "Lingua",
    externalLinkIcon: true,
    lastUpdated: {
      text: "Ultimo aggiornamento",
      formatOptions: {
        dateStyle: "medium",
        timeStyle: "short",
      },
    },
    footer: {
      message: "Materiali sintetici · Ambito di validazione TECHNICAL_DEMO",
      copyright: "Apache-2.0 · VERA",
    },
  },
});
