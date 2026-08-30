import type { Assessment, AssessmentScan } from "./types";

export interface AssessmentReadOutcome {
  assessment: Assessment | null;
  failed: boolean;
}

export function summarizeAssessmentReads(
  count: number,
  outcomes: readonly AssessmentReadOutcome[],
  capped: boolean,
): AssessmentScan {
  return {
    count,
    capped,
    failedReads: outcomes.filter((outcome) => outcome.failed || outcome.assessment === null).length,
    assessments: outcomes
      .map((outcome) => outcome.assessment)
      .filter((assessment): assessment is Assessment => assessment !== null)
      .sort((left, right) => right.sequenceNumber - left.sequenceNumber),
  };
}

export function exactLatestAssessment(
  assessments: readonly Assessment[],
  assessmentCount: number,
): Assessment | null {
  if (assessmentCount <= 0) return null;
  return assessments.find((assessment) => assessment.sequenceNumber === assessmentCount) ?? null;
}
