import { describe, it, expect } from 'vitest';
import {
  ContainsKeywords,
  LengthBetween,
  JsonSchema,
  MatchesRegex,
  NoForbiddenPhrases,
  WeightedRubric,
  AllRubric,
} from './rubricEngine.js';

describe('ContainsKeywords', () => {
  it('scores 1.0 when all keywords present', () => {
    const rubric = ContainsKeywords(['hello', 'world']);
    expect(rubric('hello world')).toBe(1);
  });

  it('scores partial match', () => {
    const rubric = ContainsKeywords(['hello', 'world', 'foo']);
    expect(rubric('hello world')).toBeCloseTo(0.666, 2);
  });

  it('scores 0 when no keywords present', () => {
    const rubric = ContainsKeywords(['hello', 'world']);
    expect(rubric('nothing here')).toBe(0);
  });

  it('handles empty keywords', () => {
    const rubric = ContainsKeywords([]);
    expect(rubric('anything')).toBe(1);
  });

  it('is case-insensitive', () => {
    const rubric = ContainsKeywords(['Hello']);
    expect(rubric('hello')).toBe(1);
  });
});

describe('LengthBetween', () => {
  it('scores 1.0 within range', () => {
    const rubric = LengthBetween(5, 20);
    expect(rubric('hello')).toBe(1);
  });

  it('scores partial when below min', () => {
    const rubric = LengthBetween(10);
    expect(rubric('hi')).toBeCloseTo(0.2, 1);
  });

  it('scores partial when above max', () => {
    const rubric = LengthBetween(0, 5);
    expect(rubric('hello world')).toBeCloseTo(0.454, 2);
  });

  it('open-ended max', () => {
    const rubric = LengthBetween(5);
    expect(rubric('a'.repeat(1000))).toBe(1);
  });
});

describe('JsonSchema', () => {
  it('scores 1.0 for valid JSON matching schema', () => {
    const rubric = JsonSchema({
      type: 'object',
      required: ['status', 'items'],
    });
    expect(rubric(JSON.stringify({ status: 'ok', items: [1, 2] }))).toBe(1);
  });

  it('scores partial when missing required fields', () => {
    const rubric = JsonSchema({
      required: ['a', 'b', 'c'],
    });
    expect(rubric(JSON.stringify({ a: 1, b: 2 }))).toBeCloseTo(0.666, 2);
  });

  it('scores 0 for invalid JSON', () => {
    const rubric = JsonSchema({ type: 'object' });
    expect(rubric('not json')).toBe(0);
  });

  it('scores 0 when type mismatch', () => {
    const rubric = JsonSchema({ type: 'object' });
    expect(rubric(JSON.stringify([1, 2, 3]))).toBe(0);
  });
});

describe('MatchesRegex', () => {
  it('scores 1.0 when matched', () => {
    const rubric = MatchesRegex(/\d{4}-\d{2}-\d{2}/);
    expect(rubric('today is 2026-05-28')).toBe(1);
  });

  it('scores 0 when not matched', () => {
    const rubric = MatchesRegex(/\d{4}-\d{2}-\d{2}/);
    expect(rubric('no date here')).toBe(0);
  });
});

describe('NoForbiddenPhrases', () => {
  it('scores 1.0 when clean', () => {
    const rubric = NoForbiddenPhrases(['error', 'failed']);
    expect(rubric('everything is working')).toBe(1);
  });

  it('scores 0 when forbidden phrase found', () => {
    const rubric = NoForbiddenPhrases(['error', 'failed']);
    expect(rubric('an error occurred')).toBe(0);
  });

  it('handles empty phrases', () => {
    const rubric = NoForbiddenPhrases([]);
    expect(rubric('anything')).toBe(1);
  });
});

describe('WeightedRubric', () => {
  it('computes weighted average', () => {
    const rubric = new WeightedRubric([
      { fn: () => 1, weight: 1, name: 'a' },
      { fn: () => 0, weight: 1, name: 'b' },
    ]);
    const result = rubric.score('test');
    expect(result.score).toBeCloseTo(0.5, 2);
    expect(result.passed).toBe(false); // default threshold 0.6
  });

  it('respects pass threshold', () => {
    const rubric = new WeightedRubric([
      { fn: () => 0.8, weight: 1, name: 'a' },
    ]);
    expect(rubric.score('test', 0.7).passed).toBe(true);
    expect(rubric.score('test', 0.9).passed).toBe(false);
  });

  it('isolates exceptions (crash = 0.0)', () => {
    const rubric = new WeightedRubric([
      { fn: () => { throw new Error('boom'); }, weight: 1, name: 'broken' },
      { fn: () => 1, weight: 1, name: 'good' },
    ]);
    const result = rubric.score('test');
    expect(result.score).toBeCloseTo(0.5, 2);
    expect(result.errors['broken']).toContain('boom');
    expect(result.breakdown.find(r => r.name === 'broken')?.error).toBeTruthy();
  });

  it('normalizes weights', () => {
    const rubric = new WeightedRubric([
      { fn: () => 1, weight: 3, name: 'a' },
      { fn: () => 0, weight: 1, name: 'b' },
    ]);
    const result = rubric.score('test');
    expect(result.score).toBeCloseTo(0.75, 2);
  });
});

describe('AllRubric', () => {
  it('passes when all rubrics above threshold', () => {
    const rubric = new AllRubric([
      { fn: () => 0.9, name: 'a' },
      { fn: () => 0.8, name: 'b' },
    ], 0.5);
    expect(rubric.score('test').passed).toBe(true);
  });

  it('fails when any rubric below threshold', () => {
    const rubric = new AllRubric([
      { fn: () => 0.9, name: 'a' },
      { fn: () => 0.3, name: 'b' },
    ], 0.5);
    expect(rubric.score('test').passed).toBe(false);
  });

  it('crashed rubric counts as failure', () => {
    const rubric = new AllRubric([
      { fn: () => { throw new Error('crash'); }, name: 'broken' },
      { fn: () => 1, name: 'good' },
    ], 0.5);
    const result = rubric.score('test');
    expect(result.passed).toBe(false);
    expect(result.errors['broken']).toBeTruthy();
  });
});
