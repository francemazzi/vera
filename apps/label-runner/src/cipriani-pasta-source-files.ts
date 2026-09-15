export type CiprianiPastaSourceFile = Readonly<{
  dest: string;
  downloadName: string;
  kind: "label" | "report";
}>;

/**
 * Maps consultant drop-folders onto the gitignored Cipriani pasta dataset.
 */
export const CIPRIANI_PASTA_SOURCE_FILES: readonly CiprianiPastaSourceFile[] = [
  { dest: "coperchi-250g.pdf", downloadName: "Coperchi 250g USA (2).pdf", kind: "label" },
  {
    dest: "fondo-classica.pdf",
    downloadName: "006592 - CIP001 R04 - Fondo Pasta - Classica - Bianca - USA (2).pdf",
    kind: "label",
  },
  {
    dest: "fondo-verde.pdf",
    downloadName: "006539 - CIP030 R03 - Fondo Pasta - Verde - USA (2).pdf",
    kind: "label",
  },
  {
    dest: "variable-print.jpeg",
    downloadName: "WhatsApp Image 2026-09-08 at 14.37.48 (2).jpeg",
    kind: "label",
  },
  {
    dest: "4197-family/4197-tagliolini-bianchi.pdf",
    downloadName: "4197 - Tagliolini bianchi USA.pdf",
    kind: "label",
  },
  {
    dest: "4197-family/4198-tagliolini-verdi.pdf",
    downloadName: "4198 - Tagliolini verdi USA.pdf",
    kind: "label",
  },
  {
    dest: "4197-family/4199-tagliardi-bianchi.pdf",
    downloadName: "4199 - Tagliardi bianchi USA.pdf",
    kind: "label",
  },
  {
    dest: "4197-family/4202-tagliardi-verdi.pdf",
    downloadName: "4202 - Tagliardi verdi USA.pdf",
    kind: "label",
  },
  {
    dest: "4197-family/4203-tagliarelle-verdi.pdf",
    downloadName: "4203 - Tagliarelle verdi USA.pdf",
    kind: "label",
  },
  {
    dest: "4197-family/4204-pappardelle-bianchi.pdf",
    downloadName: "4204 - Pappardelle bianchi USA.pdf",
    kind: "label",
  },
  {
    dest: "4197-family/4212-tagliarelle-bianchi.pdf",
    downloadName: "4212 - Tagliarelle bianchi USA.pdf",
    kind: "label",
  },
];
