/**
 * Rubric Engine — composable, exception-isolated scoring for agent output.
 *
 * Ported from the design of prompt-eval-rubric (Python) to TypeScript.
 * Each rubric is a function (output: string) => number (0.0–1.0).
 * If a rubric throws, it scores 0.0 and the pipeline continues.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type RubricFn = (output: string) => number;

export interface RubricResult {
  name: string;
  score: number;   // 0.0 – 1.0
  weight: number;  // normalized weight
  reason: string;
  error?: string;  // set if the rubric threw
}

export interface ScoreResult {
  score: number;          // 0.0 – 1.0 (weighted aggregate)
  passed: boolean;        // score >= passThreshold
  breakdown: RubricResult[];
  errors: Record<string, string>;  // rubricName → error message
}

// ── Helper ───────────────────────────────────────────────────────────────────

function safe(fn: RubricFn, name: string, output: string): { score: number; error?: string } {
  try {
    const s = fn(output);
    return { score: Math.min(1, Math.max(0, s)) };
  } catch (e) {
    return { score: 0, error: `${name}: ${(e as Error).message}` };
  }
}

// ── Built-in Rubrics ─────────────────────────────────────────────────────────

/** Output must contain ALL of the given keywords (case-insensitive). */
export function ContainsKeywords(keywords: string[]): RubricFn {
  return (output: string) => {
    if (!keywords.length) return 1;
    const lower = output.toLowerCase();
    const hits = keywords.filter(k => lower.includes(k.toLowerCase()));
    return hits.length / keywords.length;
  };
}

/** Output length (characters) must be between min and max. */
export function LengthBetween(min: number, max: number = Infinity): RubricFn {
  return (output: string) => {
    const len = output.length;
    if (len < min) return Math.min(1, len / min);
    if (len > max) return Math.min(1, max / len);
    return 1;
  };
}

/** Output must be valid JSON matching the given schema (basic structural check). */
export function JsonSchema(schema: {
  type?: string;
  required?: string[];
  properties?: Record<string, { type?: string }>;
}): RubricFn {
  return (output: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      return 0;
    }
    if (schema.type === 'object' && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))) {
      return 0;
    }
    if (schema.required && typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      const present = schema.required.filter(k => k in obj);
      return present.length / schema.required.length;
    }
    return 1;
  };
}

/** Output must match a regex pattern. Score 1.0 if matched, 0.0 otherwise. */
export function MatchesRegex(pattern: RegExp): RubricFn {
  return (output: string) => pattern.test(output) ? 1 : 0;
}

/** Output must NOT contain any of the forbidden phrases. Score 1.0 if clean, 0.0 if any found. */
export function NoForbiddenPhrases(phrases: string[]): RubricFn {
  return (output: string) => {
    if (!phrases.length) return 1;
    const lower = output.toLowerCase();
    const found = phrases.some(p => lower.includes(p.toLowerCase()));
    return found ? 0 : 1;
  };
}

// ── Composable Rubrics ───────────────────────────────────────────────────────

/**
 * Weighted rubric: weighted average across multiple rubrics.
 * Weights are normalized so they don't need to sum to 1.
 */
export class WeightedRubric {
  private rubrics: Array<{ fn: RubricFn; weight: number; name: string }>;

  constructor(rubrics: Array<{ fn: RubricFn; weight: number; name?: string }>) {
    this.rubrics = rubrics.map((r, i) => ({
      fn: r.fn,
      weight: r.weight,
      name: r.name ?? `rubric_${i}`,
    }));
  }

  score(output: string, passThreshold: number = 0.6): ScoreResult {
    const breakdown: RubricResult[] = [];
    const errors: Record<string, string> = {};
    let totalWeight = 0;
    let weightedSum = 0;

    for (const r of this.rubrics) {
      const { score, error } = safe(r.fn, r.name, output);
      if (error) errors[r.name] = error;
      breakdown.push({ name: r.name, score, weight: r.weight, reason: error ? 'CRASHED' : '', error });
      weightedSum += score * r.weight;
      totalWeight += r.weight;
    }

    const finalScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
    return {
      score: Math.round(finalScore * 1000) / 1000,
      passed: finalScore >= passThreshold,
      breakdown,
      errors,
    };
  }
}

/**
 * AllRubric: strict mode — fails if ANY rubric scores below threshold.
 * Useful when every check must pass, not just the weighted average.
 */
export class AllRubric {
  private rubrics: Array<{ fn: RubricFn; name: string }>;
  private threshold: number;

  constructor(rubrics: Array<{ fn: RubricFn; name?: string }>, threshold: number = 0.5) {
    this.rubrics = rubrics.map((r, i) => ({
      fn: r.fn,
      name: r.name ?? `rubric_${i}`,
    }));
    this.threshold = threshold;
  }

  score(output: string): ScoreResult {
    const breakdown: RubricResult[] = [];
    const errors: Record<string, string> = {};
    let allPassed = true;

    for (const r of this.rubrics) {
      const { score, error } = safe(r.fn, r.name, output);
      if (error) errors[r.name] = error;
      const passed = !error && score >= this.threshold;
      if (!passed) allPassed = false;
      breakdown.push({
        name: r.name,
        score,
        weight: 1 / this.rubrics.length,
        reason: error ? 'CRASHED' : passed ? 'PASS' : 'BELOW_THRESHOLD',
        error,
      });
    }

    const avgScore = breakdown.reduce((s, r) => s + r.score, 0) / breakdown.length;
    return {
      score: Math.round(avgScore * 1000) / 1000,
      passed: allPassed,
      breakdown,
      errors,
    };
  }
}
