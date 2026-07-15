import {
  ActorSchema,
  EvaluationOutcomeSchema,
  TruthValueSchema,
  ValidationScopeSchema,
} from "@vera/contracts";
import { z } from "zod";

export const MethodologyScenarioSchema = z
  .object({
    id: z.string().regex(/^SYN-METHOD-[0-9]{3}$/),
    description: z.string().min(1).max(200),
    applies: TruthValueSchema,
    satisfied: TruthValueSchema,
    expected: EvaluationOutcomeSchema,
    actor: ActorSchema,
  })
  .strict();

export type MethodologyScenario = z.infer<typeof MethodologyScenarioSchema>;

export const MethodologyScenarioFixtureSchema = z
  .object({
    validationScope: ValidationScopeSchema,
    scenarios: z.array(MethodologyScenarioSchema).min(1),
  })
  .strict();

export const RuleFindingScenarioSchema = z
  .object({
    id: z.enum(["A", "B", "C", "D", "E", "F", "G"]),
    applies: TruthValueSchema,
    exception: TruthValueSchema.nullable(),
    satisfied: TruthValueSchema.nullable(),
    expected: EvaluationOutcomeSchema,
  })
  .strict();

const TruthExampleSchema = z
  .object({
    inputs: z.array(TruthValueSchema).min(1),
    expected: TruthValueSchema,
  })
  .strict();

export const LogicFixtureSchema = z
  .object({
    validationScope: ValidationScopeSchema,
    not: z.array(z.object({ input: TruthValueSchema, expected: TruthValueSchema }).strict()),
    all: z.array(TruthExampleSchema),
    any: z.array(TruthExampleSchema),
    aggregation: z.array(
      z
        .object({
          inputs: z.array(EvaluationOutcomeSchema).min(1),
          expected: EvaluationOutcomeSchema,
        })
        .strict(),
    ),
  })
  .strict();
