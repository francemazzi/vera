import { sha256CanonicalJson } from "@vera/contracts";
import { z } from "zod";

/**
 * This vocabulary is deliberately code-only. Regulatory text, extracts and
 * source bodies remain in the private content store referenced by a snapshot.
 */
export const PRIVATE_LABEL_FIELD_CODES = [
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

export type PrivateLabelFieldCode = (typeof PRIVATE_LABEL_FIELD_CODES)[number];

export const PRIVATE_LABEL_EU_COUNTRY_CODES = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  // SILTO uses the EU interinstitutional country code for Greece. Keeping this
  // aligned with the public Label API prevents a selected country from being
  // silently dropped at the private-rule-pack boundary.
  "EL",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
] as const;

export type PrivateLabelEuCountryCode = (typeof PRIVATE_LABEL_EU_COUNTRY_CODES)[number];

const FieldCodeSchema = z.enum(PRIVATE_LABEL_FIELD_CODES);
export const PrivateLabelEuCountryCodeSchema = z.enum(PRIVATE_LABEL_EU_COUNTRY_CODES);
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const CategoryCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);

const SourceBindingSchema = z
  .object({
    sourceVersionId: z.uuid(),
    sourceContentHash: DigestSchema,
    citation: z.string().trim().min(1).max(2_000),
  })
  .strict();

const ControlRuleSchema = z
  .object({
    fieldCode: FieldCodeSchema,
    source: SourceBindingSchema,
    ruleVersion: z.string().trim().min(1).max(120),
  })
  .strict();

const BaselineControlRuleSchema = ControlRuleSchema.refine(
  ({ fieldCode }) => fieldCode !== "etichettatura_specifica_prodotto",
  {
    message: "etichettatura_specifica_prodotto belongs only to an approved category extension",
    path: ["fieldCode"],
  },
);

const CategoryControlRuleSchema = ControlRuleSchema.refine(
  ({ fieldCode }) => fieldCode === "etichettatura_specifica_prodotto",
  {
    message: "Category extensions may define only etichettatura_specifica_prodotto",
    path: ["fieldCode"],
  },
);

const CountryOverlaySchema = z
  .object({
    countryCode: PrivateLabelEuCountryCodeSchema,
    controls: z.array(ControlRuleSchema).max(PRIVATE_LABEL_FIELD_CODES.length),
  })
  .strict()
  .superRefine(({ controls }, context) => {
    const seen = new Set<string>();
    controls.forEach(({ fieldCode }, index) => {
      if (seen.has(fieldCode)) {
        context.addIssue({
          code: "custom",
          message: "A country overlay may contain a field at most once",
          path: ["controls", index, "fieldCode"],
        });
      }
      seen.add(fieldCode);
    });
  });

const CategoryExtensionSchema = z
  .object({
    categoryCode: CategoryCodeSchema,
    controls: z.array(CategoryControlRuleSchema).length(1),
  })
  .strict();

/**
 * A complete private Label rule-pack payload. Every binding points to an
 * immutable source version; only its opaque GCS reference is persisted in the
 * database, never the regulatory text itself.
 */
export const PrivateLabelRulePackSnapshotSchema = z
  .object({
    schemaVersion: z.literal("silto-label-rule-pack/v1"),
    baseline: z.array(BaselineControlRuleSchema).length(PRIVATE_LABEL_FIELD_CODES.length - 1),
    countryOverlays: z.array(CountryOverlaySchema).max(PRIVATE_LABEL_EU_COUNTRY_CODES.length),
    categoryExtensions: z.array(CategoryExtensionSchema).max(1_000),
  })
  .strict()
  .superRefine(({ baseline, countryOverlays, categoryExtensions }, context) => {
    const baselineCodes = new Set(baseline.map(({ fieldCode }) => fieldCode));
    PRIVATE_LABEL_FIELD_CODES.filter(
      (fieldCode) => fieldCode !== "etichettatura_specifica_prodotto",
    ).forEach((fieldCode) => {
      if (!baselineCodes.has(fieldCode)) {
        context.addIssue({
          code: "custom",
          message: `The EU baseline is missing ${fieldCode}`,
          path: ["baseline"],
        });
      }
    });
    const countries = new Set<string>();
    countryOverlays.forEach(({ countryCode }, index) => {
      if (countries.has(countryCode)) {
        context.addIssue({
          code: "custom",
          message: "Each EU country may have at most one overlay",
          path: ["countryOverlays", index, "countryCode"],
        });
      }
      countries.add(countryCode);
    });
    const categories = new Set<string>();
    categoryExtensions.forEach(({ categoryCode }, index) => {
      if (categories.has(categoryCode)) {
        context.addIssue({
          code: "custom",
          message: "Each product category may have at most one extension",
          path: ["categoryExtensions", index, "categoryCode"],
        });
      }
      categories.add(categoryCode);
    });
  });

export type PrivateLabelRulePackSnapshot = z.infer<typeof PrivateLabelRulePackSnapshotSchema>;

export interface PrivateLabelSourceBinding {
  readonly sourceVersionId: string;
  readonly sourceContentHash: string;
}

function allControlRules(
  snapshot: PrivateLabelRulePackSnapshot,
): readonly z.infer<typeof ControlRuleSchema>[] {
  return [
    ...snapshot.baseline,
    ...snapshot.countryOverlays.flatMap(({ controls }) => controls),
    ...snapshot.categoryExtensions.flatMap(({ controls }) => controls),
  ];
}

/** Returns hash-pinned source versions and rejects conflicting bindings. */
export function privateLabelSourceBindings(
  snapshotInput: PrivateLabelRulePackSnapshot,
): readonly PrivateLabelSourceBinding[] {
  const snapshot = PrivateLabelRulePackSnapshotSchema.parse(snapshotInput);
  const bindings = new Map<string, string>();
  for (const control of allControlRules(snapshot)) {
    const existing = bindings.get(control.source.sourceVersionId);
    if (existing !== undefined && existing !== control.source.sourceContentHash) {
      throw new Error("A source version cannot be bound to two different content hashes");
    }
    bindings.set(control.source.sourceVersionId, control.source.sourceContentHash);
  }
  return [...bindings.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourceVersionId, sourceContentHash]) => ({ sourceVersionId, sourceContentHash }));
}

export function computePrivateLabelSourceSnapshotHash(
  snapshotInput: PrivateLabelRulePackSnapshot,
): string {
  return sha256CanonicalJson(privateLabelSourceBindings(snapshotInput));
}

export interface ResolvedPrivateLabelControl {
  readonly fieldCode: PrivateLabelFieldCode;
  readonly applicable: boolean;
  readonly baseline: z.infer<typeof ControlRuleSchema> | null;
  readonly countryOverlays: readonly {
    readonly countryCode: PrivateLabelEuCountryCode;
    readonly rule: z.infer<typeof ControlRuleSchema>;
  }[];
  readonly categoryExtension: z.infer<typeof ControlRuleSchema> | null;
}

/**
 * Resolves a configured baseline plus only the selected national overlays.
 * The category-specific control is explicitly NOT applicable when there is no
 * approved extension for the supplied product category.
 */
export function resolvePrivateLabelRulePack(
  snapshotInput: PrivateLabelRulePackSnapshot,
  input: {
    readonly countryCodes: readonly PrivateLabelEuCountryCode[];
    readonly categoryCode?: string;
  },
): readonly ResolvedPrivateLabelControl[] {
  const snapshot = PrivateLabelRulePackSnapshotSchema.parse(snapshotInput);
  const selectedCountries = new Set(
    input.countryCodes.map((countryCode) => PrivateLabelEuCountryCodeSchema.parse(countryCode)),
  );
  const categoryCode =
    input.categoryCode === undefined ? undefined : CategoryCodeSchema.parse(input.categoryCode);
  const baselineByField = new Map(snapshot.baseline.map((rule) => [rule.fieldCode, rule] as const));
  const categoryRule =
    categoryCode === undefined
      ? undefined
      : snapshot.categoryExtensions.find((extension) => extension.categoryCode === categoryCode)
          ?.controls[0];

  return PRIVATE_LABEL_FIELD_CODES.map((fieldCode) => {
    const baseline = baselineByField.get(fieldCode) ?? null;
    const countryOverlays = snapshot.countryOverlays
      .filter((overlay) => selectedCountries.has(overlay.countryCode))
      .flatMap((overlay) => {
        const rule = overlay.controls.find((candidate) => candidate.fieldCode === fieldCode);
        return rule === undefined ? [] : [{ countryCode: overlay.countryCode, rule }];
      });
    const categoryExtension =
      fieldCode === "etichettatura_specifica_prodotto" && categoryRule !== undefined
        ? categoryRule
        : null;
    return {
      fieldCode,
      applicable: baseline !== null || categoryExtension !== null || countryOverlays.length > 0,
      baseline,
      countryOverlays,
      categoryExtension,
    };
  });
}
