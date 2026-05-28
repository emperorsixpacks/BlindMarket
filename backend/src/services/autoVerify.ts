import type { VerificationCriteria } from '../types.js';
import {
  WeightedRubric,
  ContainsKeywords,
  LengthBetween,
  JsonSchema,
  MatchesRegex,
  NoForbiddenPhrases,
} from './rubricEngine.js';
import type { RubricResult } from './rubricEngine.js';

export interface AutoVerifyResult {
  passed: boolean;
  score: number;          // 0-100
  reasons: string[];
  breakdown: RubricResult[];
  errors: Record<string, string>;
}

/**
 * Verify agent output against task criteria.
 *
 * Backward-compatible: old { required_fields, min_length, contains_keywords }
 * criteria still work — they feed into the rubric engine as weighted checks.
 * New fields (max_length, forbidden_phrases, regex_pattern, expected_schema,
 * rubric items) add richer scoring dimensions.
 *
 * Returns a 0-100 score. Task passes if score >= pass_threshold (default 60).
 */
export function autoVerify(
  resultData: Record<string, unknown>,
  criteria: VerificationCriteria,
): AutoVerifyResult {
  // Extract the output string (agent's text response) or stringify the whole object
  const output = typeof resultData.output === 'string'
    ? resultData.output
    : JSON.stringify(resultData);

  const rubrics: Array<{ fn: (output: string) => number; weight: number; name: string }> = [];

  // ── Legacy checks (backward-compatible) ──────────────────────────────────

  // Required fields: score = fraction of fields present
  if (criteria.required_fields?.length) {
    rubrics.push({
      name: 'required_fields',
      weight: 2,
      fn: (out: string) => {
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(out); } catch { return 0; }
        const present = criteria.required_fields!.filter(f => f in parsed && parsed[f] != null);
        return present.length / criteria.required_fields!.length;
      },
    });
  }

  // Min length
  if (criteria.min_length) {
    rubrics.push({
      name: 'min_length',
      weight: 1,
      fn: LengthBetween(criteria.min_length),
    });
  }

  // Contains keywords
  if (criteria.contains_keywords?.length) {
    rubrics.push({
      name: 'contains_keywords',
      weight: 1.5,
      fn: ContainsKeywords(criteria.contains_keywords),
    });
  }

  // ── New rubric fields ────────────────────────────────────────────────────

  // Max length (reject padding)
  if (criteria.max_length) {
    rubrics.push({
      name: 'max_length',
      weight: 0.5,
      fn: (out: string) => {
        const ratio = out.length / criteria.max_length!;
        return ratio <= 1 ? 1 : Math.max(0, 1 - (ratio - 1));
      },
    });
  }

  // Forbidden phrases
  if (criteria.forbidden_phrases?.length) {
    rubrics.push({
      name: 'forbidden_phrases',
      weight: 2,
      fn: NoForbiddenPhrases(criteria.forbidden_phrases),
    });
  }

  // Regex pattern
  if (criteria.regex_pattern) {
    try {
      rubrics.push({
        name: 'regex_pattern',
        weight: 1.5,
        fn: MatchesRegex(new RegExp(criteria.regex_pattern)),
      });
    } catch { /* invalid regex — skip */ }
  }

  // Expected schema
  if (criteria.expected_schema) {
    rubrics.push({
      name: 'expected_schema',
      weight: 2,
      fn: JsonSchema(criteria.expected_schema),
    });
  }

  // Expected answer (fuzzy: keyword overlap)
  if (criteria.expected_answer) {
    rubrics.push({
      name: 'expected_answer',
      weight: 1.5,
      fn: (out: string) => {
        const expected = criteria.expected_answer!.toLowerCase().split(/\s+/);
        const actual = out.toLowerCase().split(/\s+/);
        const actualSet = new Set(actual);
        const hits = expected.filter(w => actualSet.has(w));
        return hits.length / expected.length;
      },
    });
  }

  // Custom rubric items
  if (criteria.rubric?.length) {
    for (const item of criteria.rubric) {
      rubrics.push({
        name: `rubric_${item.criterion}`,
        weight: item.weight ?? 1,
        fn: (out: string) => {
          if (!item.keywords?.length) return 0.5; // no-op rubric
          const lower = out.toLowerCase();
          const hits = item.keywords.filter(k => lower.includes(k.toLowerCase()));
          const minMentions = item.min_mentions ?? 1;
          return Math.min(1, hits.length / Math.max(1, minMentions));
        },
      });
    }
  }

  // ── Fallback: if no rubrics at all, just check output exists ─────────────
  if (rubrics.length === 0) {
    rubrics.push({
      name: 'basic_output',
      weight: 1,
      fn: (out: string) => out.length > 0 ? 1 : 0,
    });
  }

  // ── Score ────────────────────────────────────────────────────────────────
  const threshold = (criteria.pass_threshold ?? 60) / 100;
  const rubric = new WeightedRubric(rubrics);
  const result = rubric.score(output, threshold);

  const reasons = result.breakdown
    .filter(r => r.error || r.score < 0.5)
    .map(r => r.error ? `[CRASHED] ${r.error}` : `${r.name}: ${(r.score * 100).toFixed(0)}%`);

  if (result.passed) reasons.unshift('All verification criteria met');

  return {
    passed: result.passed,
    score: Math.round(result.score * 100),
    reasons,
    breakdown: result.breakdown,
    errors: result.errors,
  };
}
