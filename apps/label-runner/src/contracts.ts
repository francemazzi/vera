import { z } from "zod";

export const LABEL_FIELD_CODES = [
  "altezza_cifre_quantita_nominale",
  "altezza_minima_caratteri",
  "atmosfera_protettiva",
  "biologico",
  "bollatura_sanitaria_marchio_identificazione",
  "campo_visivo",
  "condizioni_particolari_conservazione",
  "denominazione_commerciale",
  "denominazione_legale_vendita",
  "denominazioni_dop_igp_stg",
  "elenco_ingredienti",
  "etichettatura_specifica_prodotto",
  "indicazione_allergeni",
  "indicazioni_aggiuntive",
  "indicazioni_ambientali",
  "informazioni_nutrizionali",
  "istruzioni_uso",
  "lotto_partita",
  "origine_ingrediente_primario",
  "paese_origine",
  "produttore_distributore_indirizzo",
  "quantita_netto_volume_nominale",
  "sede_stabilimento_produzione_confezionamento",
  "termine_minimo_conservazione_data_scadenza",
] as const;

export const LabelOutcomeSchema = z.enum(["PASS", "FAIL", "REVIEW", "NOT_APPLICABLE"]);
export type LabelOutcome = z.infer<typeof LabelOutcomeSchema>;

export const LabelTaskSchema = z.object({ analysisId: z.uuid() }).strict();
export type LabelTask = z.infer<typeof LabelTaskSchema>;

export const RunnerInputSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    countryCodes: z.array(z.string().length(2)).min(1).max(27),
    inputSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    normalizedPageObjectKey: z
      .string()
      .regex(/^label-analyses\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/page-1\.png$/u),
    status: z.enum(["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"]),
    version: z.int().nonnegative(),
  })
  .strict();
export type RunnerInput = z.infer<typeof RunnerInputSchema>;

export const RunnerControlSchema = z
  .object({
    fieldCode: z.enum(LABEL_FIELD_CODES),
    countryCode: z.string().length(2).optional(),
    outcome: LabelOutcomeSchema,
    rationale: z.string().min(1).max(8_000),
    sourceCitation: z.string().min(1).max(2_000).optional(),
    ruleVersion: z.string().min(1).max(120),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const RunnerEvaluationSchema = z
  .object({
    provider: z.literal("openrouter"),
    model: z.string().min(1).max(240),
    promptVersion: z.string().min(1).max(120),
    rulePackVersion: z.string().min(1).max(120),
    sourceSnapshot: z.string().regex(/^[0-9a-f]{64}$/u),
    controls: z.array(RunnerControlSchema).length(LABEL_FIELD_CODES.length),
  })
  .strict()
  .superRefine((value, context) => {
    const codes = new Set(value.controls.map((control) => control.fieldCode));
    if (codes.size !== LABEL_FIELD_CODES.length) {
      context.addIssue({
        code: "custom",
        message: "Each required field code must be evaluated once",
      });
    }
  });
export type RunnerEvaluation = z.infer<typeof RunnerEvaluationSchema>;

export const ClaimResponseSchema = z
  .object({
    status: z.literal("success"),
    data: z.object({ version: z.int().nonnegative() }).loose(),
    meta: z.object({ acquired: z.boolean(), replayed: z.boolean() }).strict(),
  })
  .strict();
