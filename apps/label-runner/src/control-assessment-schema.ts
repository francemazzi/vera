import { createControlAssessmentSchema } from "./create-control-assessment-schema.js";

/** Reads versioned decision evidence, including historical assessments. */
export const ControlAssessmentSchema = createControlAssessmentSchema(false);
