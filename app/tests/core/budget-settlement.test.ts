/** Offline: the shared pool must charge what the provider actually spent. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('a reservation is settled against the tokens the provider reported', async () => {
  Object.assign(process.env, { NODE_ENV: 'production', LLM_BUDGET_REDIS_URL: 'https://redis.settle.invalid', LLM_BUDGET_REDIS_TOKEN: 'synthetic-budget-key', LLM_BUDGET_DAILY_TOKENS: '10000000', LLM_BUDGET_CONCURRENCY: '8' });
  const commands: (string | number)[][] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const command = JSON.parse(String(init?.body)) as (string | number)[];
    commands.push(command);
    return Response.json({ result: String(command[1]).includes('INCRBY') ? 1 : 0 });
  };
  try {
    const { reserveSharedBudget, reservedTokens } = await import('../../src/lib/shared-budget');
    const opts = { system: 'x', messages: [{ role: 'user' as const, content: 'y' }], maxTokens: 1800 };
    const ceiling = reservedTokens(opts);
    const release = await reserveSharedBudget(opts);
    const reserve = commands.find((c) => c[0] === 'EVAL' && String(c[1]).includes('INCRBY'));
    assert.ok(reserve, 'the up-front ceiling decides admission before any token is spent');
    assert.equal(Number(reserve![4]), ceiling);

    await release(1200);
    const settle = commands.find((c) => c[0] === 'EVAL' && String(c[1]).includes('DECRBY'));
    assert.ok(settle, 'a reported usage must settle the ceiling instead of keeping it');
    assert.equal(Number(settle![4]), ceiling);
    assert.equal(Number(settle![5]), 1200);
    assert.ok(String(settle![1]).includes('if refund>used then refund=used'), 'a refund can never drive the daily counter below zero');
    assert.ok(String(settle![1]).includes('if refund<0 then refund=0'), 'an under-estimated call is never billed twice');

    commands.length = 0;
    await (await reserveSharedBudget(opts))();
    assert.ok(commands.some((c) => c[0] === 'ZREM'), 'without a usage report the ceiling stays held');
    assert.equal(commands.find((c) => String(c[1]).includes('DECRBY')), undefined, 'an unverified call must not become a discount');
  } finally { globalThis.fetch = realFetch; }
});
