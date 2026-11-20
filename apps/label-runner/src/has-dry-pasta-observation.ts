import type { RunnerEvaluation } from "./contracts.js";

/** Limits the dry-pasta post-guards to the printed identity of the focused product. */
export function hasDryPastaObservation(productFacts: RunnerEvaluation["productFacts"]): boolean {
  const product = productFacts?.products.length === 1 ? productFacts.products[0] : undefined;
  return (
    product?.facts.some(
      (fact) =>
        fact.status === "OBSERVED" &&
        ["denominazione_commerciale", "denominazione_legale_vendita"].includes(fact.field) &&
        /\b(?:pasta|noodles?|spaghetti|pappardelle|tagliatelle|fettuccine|macaroni)\b/iu.test(
          fact.text,
        ) &&
        /\b(?:dry|dried|secca|essiccata)\b/iu.test(fact.text),
    ) ?? false
  );
}
