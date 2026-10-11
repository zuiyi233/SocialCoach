/** Shared runner for the live eval scripts: distinguish a real regression from
 * a transient model/gateway failure.
 *
 * - AssertionError and other non-retryable throws fail the eval immediately —
 *   a wrong behavior must not be laundered by retries.
 * - Retryable LLMError (contract/format failures the repair chain already gave
 *   up on) and gateway throttles get bounded retries; 429 waits out the minute
 *   window, because the account-level rpm cap makes an immediate retry a
 *   guaranteed second 429 (see wiki/80「容量探针用最小请求测并发」).
 *
 * `EVAL_ATTEMPTS` caps total attempts (default 3).
 */
import { LLMError } from "../../src/lib/llm-core";

export async function runEval(main: () => Promise<void>): Promise<void> {
  const attempts = Math.max(1, Number(process.env.EVAL_ATTEMPTS ?? 3) || 3);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await main();
      return;
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      const throttled = /429|rpm exhausted|rate.?limit|quota/i.test(message);
      const retryable = error instanceof LLMError ? error.retryable : !/^AssertionError/.test((error as Error)?.name ?? "");
      if (attempt === attempts || (!retryable && !throttled)) {
        console.error(`[eval] attempt ${attempt}/${attempts} failed (final): ${message.slice(0, 300)}`);
        process.exitCode = 1;
        return;
      }
      const waitMs = throttled ? 65_000 : 15_000;
      console.error(`[eval] attempt ${attempt}/${attempts} failed, retrying in ${Math.round(waitMs / 1000)}s: ${message.slice(0, 200)}`);
      await new Promise((ok) => setTimeout(ok, waitMs));
    }
  }
}
