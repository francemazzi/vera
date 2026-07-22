import {
  ComplianceSourceConflictError,
  ComplianceSourceEligibilityError,
  ComplianceSourceInvariantError,
  ComplianceSourceNotFoundError,
  ComplianceSourceValidationError,
  RuleCardConflictError,
  RuleCardEligibilityError,
  RuleCardInvariantError,
  RuleCardNotFoundError,
  RuleCardValidationError,
  RulePackActivationConflictError,
  RulePackActivationInvariantError,
  RulePackActivationNotFoundError,
  RulePackActivationValidationError,
  RulePackConflictError,
  RulePackEligibilityError,
  RulePackInvariantError,
  RulePackNotFoundError,
  RulePackValidationError,
} from "@vera/rules-core";
import { StorageConflictError } from "@vera/storage";

export interface DomainProblemDescriptor {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
}

export function domainProblemDescriptor(error: Error): DomainProblemDescriptor | null {
  if (
    error instanceof ComplianceSourceValidationError ||
    error instanceof RuleCardValidationError ||
    error instanceof RulePackValidationError ||
    error instanceof RulePackActivationValidationError
  ) {
    return { status: 400, title: "Bad Request", detail: error.message };
  }
  if (
    error instanceof ComplianceSourceNotFoundError ||
    error instanceof RuleCardNotFoundError ||
    error instanceof RulePackNotFoundError ||
    error instanceof RulePackActivationNotFoundError
  ) {
    return { status: 404, title: "Not Found", detail: error.message };
  }
  if (
    error instanceof ComplianceSourceConflictError ||
    error instanceof RuleCardConflictError ||
    error instanceof RulePackConflictError ||
    error instanceof RulePackActivationConflictError ||
    error instanceof StorageConflictError
  ) {
    return { status: 409, title: "Conflict", detail: error.message };
  }
  if (
    error instanceof ComplianceSourceInvariantError ||
    error instanceof ComplianceSourceEligibilityError ||
    error instanceof RuleCardInvariantError ||
    error instanceof RuleCardEligibilityError ||
    error instanceof RulePackInvariantError ||
    error instanceof RulePackEligibilityError ||
    error instanceof RulePackActivationInvariantError
  ) {
    return { status: 422, title: "Unprocessable Entity", detail: error.message };
  }
  return null;
}
