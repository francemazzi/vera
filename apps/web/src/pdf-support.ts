import type { PDFDocumentProxy } from "pdfjs-dist";

export type VeraPdfDocument = PDFDocumentProxy;

export interface PdfSupportStatus {
  readonly enabled: boolean;
  readonly renderer: "pdfjs";
}

export function pdfSupportStatus(): PdfSupportStatus {
  return { enabled: true, renderer: "pdfjs" };
}
