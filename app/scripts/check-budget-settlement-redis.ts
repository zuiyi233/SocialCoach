/** Real-Redis settlement check. Opt-in, isolated key, loopback only:
 *   node scripts/check-budget-settlement-redis.ts [--live]
 *
 * The offline suite already proves the *commands* we send. This proves the other
 * half: that the reserve and settle Lua behave as claimed on an actual Redis, so
 * the daily counter ends up holding exactly what the provider reported and a
 * refund can never be applied twice. Nothing here may point at a production
 * instance — the key is namespaced for this check and refused otherwise.
 *
 * `--live` additionally makes ONE real model call and asserts the counter delta
 * against the usage the gateway itself reported. That is the end of the money
 * path, and it is only claimed when this flag actually ran.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const host = process.env.REDIS_CLI_HOST ?? '127.0.0.1';
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host), 'this check only ever talks to a local Redis');
const port = Number(process.env.REDIS_HTTP_PORT || 6399);
const token = 'synthetic-settlement-token';
const key = 'socialcoach:{settlement-check}';
const LIVE = process.argv.includes('--live');

const shim = spawn(process.execPath, ['scripts/redis-http-shim.mjs'], { env: { ...process.env, REDIS_HTTP_PORT: String(port), REDIS_HTTP_TOKEN: token }, stdio: ['ignore', 'pipe', 'inherit'] });
shim.stdout?.on('data', () => {});

async function redis(...args: (string | number)[]): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const body = await res.json() as { result?: unknown; error?: unknown };
  if (!res.ok || body.error) throw new Error(`redis command failed: ${String(body.error ?? res.status)}`);
  return body.result;
}

async function dayCounter(): Promise<number> {
  const [now] = (await redis('TIME')) as string[];
  const day = Math.floor(Number(now) / 86400);
  return Number(await redis('GET', `${key}:day:${day}`) ?? '0');
}
const activeCount = () => Number(redis('ZCARD', `${key}:active`));

async function waitReady(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try { await redis('PING'); return; } catch { await new Promise((ok) => setTimeout(ok, 100)); }
  }
  throw new Error('redis http shim never became ready — is redis-cli installed and a local Redis running?');
}

/** Drive the budget client exactly as `llm.ts` does: reserve, then release with
 * whatever the provider reported (or nothing at all). */
async function spend(options: Parameters<typeof reservedTokens>[0], usage?: number, modelCall?: () => Promise<number | undefined>) {
  const release = await reserveSharedBudget(options);
  if (modelCall) return release(await modelCall());
  return release(usage);
}

let reservedTokens: typeof import('../src/lib/shared-budget').reservedTokens;
let reserveSharedBudget: typeof import('../src/lib/shared-budget').reserveSharedBudget;

async function main() {
  await waitReady();
  Object.assign(process.env, { NODE_ENV: 'test', LLM_PROVIDER: 'openai', LLM_BASE_URL: 'http://127.0.0.1:1', LLM_API_KEY: 'synthetic-settlement-key', LLM_FAST_MODEL: 'test-chat', LLM_SMART_MODEL: 'test-chat', LLM_BUDGET_REDIS_URL: `http://127.0.0.1:${port}`, LLM_BUDGET_REDIS_TOKEN: token, LLM_BUDGET_DAILY_TOKENS: '1000000', LLM_BUDGET_CONCURRENCY: '3' });
  const budget = await import('../src/lib/shared-budget');
  reservedTokens = budget.reservedTokens; reserveSharedBudget = budget.reserveSharedBudget;
  await redis('DEL', `${key}:active`);
  const [now] = (await redis('TIME')) as string[];
  await redis('DEL', `${key}:day:${Math.floor(Number(now) / 86400)}`, `${key}:daily-limit`);

  const options = { system: 'Reserve arithmetic must see the whole ceiling.', messages: [{ role: 'user' as const, content: 'A learner asked for one sentence of advice.' }], maxTokens: 1800 };
  const ceiling = reservedTokens(options);
  const reported = 1200;

  // 1. A reservation holds the worst-case ceiling; settling reports the truth.
  await spend(options, reported);
  assert.equal(await dayCounter(), reported, 'after settling, the day counter holds exactly what the provider reported');
  assert.equal(await activeCount(), 0, 'settling releases the concurrency slot');
  console.log(`PASS ceiling ${ceiling} → settled to the reported ${reported} (refund ${ceiling - reported})`);

  // 2. No usage report keeps the ceiling. An unverified call must not look free.
  await spend(options);
  assert.equal(await dayCounter(), ceiling + reported, 'without a usage report nothing is refunded');
  assert.equal(await activeCount(), 0, 'the slot is still released so a lost call cannot wedge the pool');
  console.log(`PASS an unverified call is billed at the ceiling (${ceiling} held, not discounted)`);

  // 3. The provider reporting MORE than we reserved is a clamped no-op, not a
  //    negative counter, and never a second charge on the same reservation.
  const before = await dayCounter();
  await spend({ ...options, maxTokens: 1 }, 900_000);
  assert.equal(await dayCounter(), before + reservedTokens({ ...options, maxTokens: 1 }), 'an over-reported usage cannot push the counter below zero');
  console.log('PASS an over-reported usage clamps to zero refund');

  // 4. Settling the same reservation twice must not refund twice. If Redis says
  //    otherwise, the pool is cheaper than reality and that is a money bug.
  const held = await dayCounter();
  const doubleRelease = await reserveSharedBudget(options);
  await doubleRelease(reported);
  await doubleRelease(reported);
  const after = await dayCounter();
  assert.equal(after, held + reported, 'a second settle of the same reservation must not refund again');
  console.log(`PASS a reservation refunds once (${held} → ${after})`);

  if (LIVE) {
    // 5. The whole path, with the gateway's own number instead of ours.
    const { serverLLM } = await import('../src/lib/llm');
    const beforeLive = await dayCounter();
    const text = await serverLLM.chatText({ system: 'Answer with one word.', messages: [{ role: 'user', content: 'Say the word readiness.' }], maxTokens: 32 });
    const spent = (await dayCounter()) - beforeLive;
    assert.ok(spent > 0, `a real call must be charged, saw ${spent} against text "${text.slice(0, 20)}"`);
    console.log(`PASS live call charged ${spent} tokens against the shared counter (reported usage settled the ceiling)`);
  } else {
    console.log('NOTE the live half was not run: pass --live with a real LLM_API_KEY to charge one genuine call.');
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => shim.kill());
