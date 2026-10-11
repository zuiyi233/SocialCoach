import type { ChatOpts, ReasoningTier } from "./llm-core";
export type { ReasoningTier };

/**
 * What the person chose to spend, not what one vendor calls it. `fast` keeps
 * every task's own intent; the two higher tiers are an explicit override that
 * says "think, even where the task did not ask".
 */
export const REASONING_TIERS: readonly ReasoningTier[] = ["fast", "balanced", "deep"];
export const tierOf = (value: unknown): ReasoningTier => (value === "balanced" || value === "deep" ? value : "fast");

/** A turn answers someone who is waiting for a reply; a debrief or a generated
 * scene is read after the conversation already ended. Only the second kind gets
 * the large budget — 32K of thinking in a turn would feel like a hang. */
const TURN_BUDGET: Record<ReasoningTier, number> = { fast: 0, balanced: 2048, deep: 8192 };
const REASONED_BUDGET: Record<ReasoningTier, number> = { fast: 0, balanced: 4096, deep: 32768 };

/** Whether this client can put a ceiling on what one call may spend thinking.
 * Anthropic always can; an OpenAI-compatible endpoint can only if it takes
 * `thinking:{type:"enabled",budget_tokens}`. The learner declares it per endpoint. */
export interface ReasoningCaps {
  canCapThinking: boolean;
}

/**
 * Resolve one call's reasoning shape. The task's own `thinking` flag is the
 * signal for how patient this step is allowed to be: a step that already asks
 * for reasoning is a debrief or a generated result someone reads later, the
 * rest are replies someone is waiting on. Providers that cannot take a numeric
 * budget ignore it and get the effort label, so the tier still means something
 * on every endpoint.
 */
export function applyReasoningTier(o: ChatOpts, tier: ReasoningTier, caps?: ReasoningCaps): ChatOpts {
  if (tier === "fast") return o;
  // A tier that cannot cap the spend is not a slower version of the same request,
  // it is a different and worse one. Measured on an OpenAI-compatible endpoint
  // without `budget_tokens`: 13 of 35 role-match replies came back with an empty
  // `content` channel — the thinking ate the whole output allowance — and unit
  // time went p50 16s → 84s. So where there is no ceiling, a step that explicitly
  // asked not to think keeps that, and the tier only deepens the steps that
  // already reason.
  if (!caps?.canCapThinking && o.thinking === false) return o;
  const reasoned = o.thinking !== false;
  const budget = (reasoned ? REASONED_BUDGET : TURN_BUDGET)[tier];
  if (!budget) return o;
  return { ...o, thinking: true, thinkingBudget: budget, effort: tier === "deep" ? "high" : "low", maxTokens: o.maxTokens + budget };
}

/** How much longer a step may take once the person agreed to pay for thinking. */
const TIER_TIMEOUT: Record<ReasoningTier, number> = { fast: 1, balanced: 2, deep: 4 };
export const reasoningTimeoutFactor = (tier: ReasoningTier) => TIER_TIMEOUT[tier];
