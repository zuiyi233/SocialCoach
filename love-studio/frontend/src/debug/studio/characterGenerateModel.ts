/**
 * 一句话生成角色的纯逻辑（表单范围、校验、进度换算），与 React 分开，便于单测。
 * 真正的请求/轮询在 CharacterGenerate.tsx；这里不碰网络、不读 DOM。
 */

export type CharacterLanguage = 'zh' | 'en';

export const EXPRESSION_MIN = 2;
export const EXPRESSION_MAX = 8;
export const SCENE_MIN = 0;
export const SCENE_MAX = 6;
export const DESCRIPTION_MAX = 2000;
/** 轮询间隔与总上限（与组件保持一致）。 */
export const JOB_POLL_MS = 2000;
export const JOB_MAX_WAIT_MS = 10 * 60 * 1000;

export function clampExpressions(value: number): number {
  if (!Number.isFinite(value)) return 4;
  return Math.max(EXPRESSION_MIN, Math.min(EXPRESSION_MAX, Math.trunc(value)));
}

export function clampScenes(value: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.max(SCENE_MIN, Math.min(SCENE_MAX, Math.trunc(value)));
}

/** 描述校验：空 / 超长各返回一条用户可读消息；合法返回 null。 */
export function validateDescription(text: string, language: CharacterLanguage): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return language === 'zh' ? '请先写一段角色描述（1–2000 字）。' : 'Write a character description first (1–2000 characters).';
  }
  if (trimmed.length > DESCRIPTION_MAX) {
    return language === 'zh' ? '角色描述最多 2000 字。' : 'The description is limited to 2000 characters.';
  }
  return null;
}

/** 进度百分比：running 且 total 未知时给一个很小的起步值，不假装 0%。 */
export function jobProgress(job: { status: string; step: number; total: number } | null): number {
  if (!job) return 0;
  if (job.status === 'done') return 100;
  if (job.status === 'error') return 0;
  if (job.total <= 0) return 4;
  return Math.max(0, Math.min(99, Math.round((job.step / job.total) * 100)));
}

/** 结果里的图片拆分：立绘数 = expressions（失败时可能更少），其余算场景图。 */
export function imageBreakdown(imagesOk: number, expressions: number): { portraits: number; scenes: number } {
  const ok = Math.max(0, Math.trunc(imagesOk));
  const portraits = Math.min(ok, Math.max(0, Math.trunc(expressions)));
  return { portraits, scenes: Math.max(0, ok - portraits) };
}
