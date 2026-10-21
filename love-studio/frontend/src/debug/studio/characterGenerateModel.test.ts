import { describe, expect, it } from 'vitest';
import {
  clampExpressions,
  clampScenes,
  imageBreakdown,
  jobProgress,
  validateDescription,
} from './characterGenerateModel';

describe('character form bounds', () => {
  it('clamps expressions to 2–8 and scenes to 0–6', () => {
    expect(clampExpressions(1)).toBe(2);
    expect(clampExpressions(9)).toBe(8);
    expect(clampExpressions(4.7)).toBe(4);
    expect(clampExpressions(Number.NaN)).toBe(4);
    expect(clampScenes(-1)).toBe(0);
    expect(clampScenes(7)).toBe(6);
    expect(clampScenes(3.9)).toBe(3);
    expect(clampScenes(Number.NaN)).toBe(3);
  });

  it('validates the description with the same bilingual messages the wizard shows', () => {
    expect(validateDescription('   ', 'zh')).toMatch(/角色描述/);
    expect(validateDescription('   ', 'en')).toMatch(/description/);
    expect(validateDescription('x'.repeat(2001), 'zh')).toMatch(/2000/);
    expect(validateDescription('x'.repeat(2000), 'zh')).toBeNull();
    expect(validateDescription('一家书店的店员', 'zh')).toBeNull();
  });
});

describe('job progress', () => {
  it('keeps running jobs below 100 and completed jobs at 100', () => {
    expect(jobProgress(null)).toBe(0);
    expect(jobProgress({ status: 'running', step: 0, total: 0 })).toBe(4);
    expect(jobProgress({ status: 'running', step: 2, total: 7 })).toBe(29);
    expect(jobProgress({ status: 'running', step: 7, total: 7 })).toBe(99);
    expect(jobProgress({ status: 'done', step: 7, total: 7 })).toBe(100);
    expect(jobProgress({ status: 'error', step: 2, total: 7 })).toBe(0);
  });

  it('splits successful images into portraits and scenes without going negative', () => {
    expect(imageBreakdown(7, 4)).toEqual({ portraits: 4, scenes: 3 });
    expect(imageBreakdown(2, 4)).toEqual({ portraits: 2, scenes: 0 });
    expect(imageBreakdown(0, 4)).toEqual({ portraits: 0, scenes: 0 });
    expect(imageBreakdown(-3, 4)).toEqual({ portraits: 0, scenes: 0 });
  });
});
