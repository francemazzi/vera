import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ActorSchema,
  ComplianceSourceStateSchema,
  RuleCardStateSchema,
  UtcDateTimeSchema,
  ValidationScopeSchema,
  ValidityIntervalSchema,
  aggregateOutcomes,
  allTruth,
  anyTruth,
  canPerformComplianceSourceTransition,
  canPerformRuleCardTransition,
  canTransitionComplianceSource,
  canTransitionRuleCard,
  deriveRuleFinding,
  deriveRuleOutcome,
  negateTruth,
} from "@vera/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  LogicFixtureSchema,
  MethodologyScenarioSchema,
  MethodologyScenarioFixtureSchema,
  RuleFindingScenarioSchema,
} from "../../src/scenario.js";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, `../../fixtures/${name}`), "utf8"));
}

const TransitionSchema = z.object({
  from: z.string().nullable(),
  to: z.string(),
  valid: z.boolean(),
});

const AuthorizationTransitionSchema = TransitionSchema.extend({
  actor: ActorSchema,
  contributorIds: z.array(z.uuid()),
  excludedActorIds: z.array(z.uuid()),
  reason: z.string().optional(),
});

describe("synthetic methodology scenarios", () => {
  it("validates and executes the complete applicability and satisfaction truth table", () => {
    const { scenarios } = MethodologyScenarioFixtureSchema.parse(fixture("scenarios.json"));
    expect(scenarios).toHaveLength(9);
    for (const scenario of scenarios) {
      expect(deriveRuleOutcome(scenario.applies, scenario.satisfied)).toBe(scenario.expected);
    }
  });

  it("executes every documented finding case, including exceptions", () => {
    const parsed = z
      .object({
        validationScope: ValidationScopeSchema,
        scenarios: z.array(RuleFindingScenarioSchema),
      })
      .strict()
      .parse(fixture("rule-findings.json"));

    expect(parsed.scenarios.map(({ id }) => id)).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    for (const scenario of parsed.scenarios) {
      expect(deriveRuleFinding(scenario.applies, scenario.exception, scenario.satisfied)).toBe(
        scenario.expected,
      );
    }
  });

  it("executes the complete ternary logic tables and aggregation precedence", () => {
    const logic = LogicFixtureSchema.parse(fixture("logic.json"));

    for (const example of logic.not) expect(negateTruth(example.input)).toBe(example.expected);
    for (const example of logic.all) expect(allTruth(example.inputs)).toBe(example.expected);
    for (const example of logic.any) expect(anyTruth(example.inputs)).toBe(example.expected);
    for (const example of logic.aggregation) {
      expect(aggregateOutcomes(example.inputs)).toBe(example.expected);
    }
  });

  it("rejects invalid scenario and temporal examples", () => {
    const invalid = z
      .object({
        validationScope: ValidationScopeSchema,
        scenarios: z.array(z.unknown()),
        intervals: z.array(z.unknown()),
      })
      .parse(fixture("invalid.json"));
    expect(
      invalid.scenarios.every((value) => !MethodologyScenarioSchema.safeParse(value).success),
    ).toBe(true);
    expect(
      invalid.intervals.every((value) => !ValidityIntervalSchema.safeParse(value).success),
    ).toBe(true);
    expect(UtcDateTimeSchema.safeParse("2026-01-01T01:00:00+01:00").success).toBe(false);
  });

  it("executes every declared valid and invalid lifecycle state transition", () => {
    const transitions = z
      .object({
        validationScope: ValidationScopeSchema,
        sources: z.array(TransitionSchema),
        ruleCards: z.array(TransitionSchema),
        sourceAuthorizations: z.array(AuthorizationTransitionSchema),
        ruleCardAuthorizations: z.array(AuthorizationTransitionSchema),
      })
      .parse(fixture("transitions.json"));

    for (const transition of transitions.sources) {
      const from =
        transition.from === null ? null : ComplianceSourceStateSchema.parse(transition.from);
      const to = ComplianceSourceStateSchema.parse(transition.to);
      expect(canTransitionComplianceSource(from, to)).toBe(transition.valid);
    }
    for (const transition of transitions.ruleCards) {
      const from = transition.from === null ? null : RuleCardStateSchema.parse(transition.from);
      const to = RuleCardStateSchema.parse(transition.to);
      expect(canTransitionRuleCard(from, to)).toBe(transition.valid);
    }

    for (const transition of transitions.sourceAuthorizations) {
      const from =
        transition.from === null ? null : ComplianceSourceStateSchema.parse(transition.from);
      const to = ComplianceSourceStateSchema.parse(transition.to);
      const context = {
        actor: transition.actor,
        contributorIds: transition.contributorIds,
        excludedActorIds: transition.excludedActorIds,
        ...(transition.reason === undefined ? {} : { reason: transition.reason }),
      };
      expect(canPerformComplianceSourceTransition(from, to, context)).toBe(transition.valid);
    }

    for (const transition of transitions.ruleCardAuthorizations) {
      const from = transition.from === null ? null : RuleCardStateSchema.parse(transition.from);
      const to = RuleCardStateSchema.parse(transition.to);
      const context = {
        actor: transition.actor,
        contributorIds: transition.contributorIds,
        excludedActorIds: transition.excludedActorIds,
        ...(transition.reason === undefined ? {} : { reason: transition.reason }),
      };
      expect(canPerformRuleCardTransition(from, to, context)).toBe(transition.valid);
    }
  });
});
