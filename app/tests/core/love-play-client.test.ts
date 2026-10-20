/** G18 离线回归：/api/love-play 的成功响应过 zod 契约、失败体的 retryAt/modelIssue 透传、坏响应走结构化 ApiError。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lovePlayTurn, type LovePlayTurn } from '../../src/lib/love-play-client';
import { ApiError } from '../../src/lib/client-api';

const VALID: LovePlayTurn = {
  line: { zh: '那句是你加的，还是我的原话？', en: 'Was that line yours or mine?' },
  options: [
    { zh: '是我加的。', en: 'I added it.' },
    { zh: '我不记得了。', en: 'I do not remember.' },
  ],
  emotion: 'tight',
  stance: 20,
  revealed: false,
  terminal: null,
  ended: false,
};

const input = {
  scenario: { id: 'fixture' },
  learnerCharacterId: 'you',
  language: 'zh',
  messages: [],
} as unknown as Parameters<typeof lovePlayTurn>[0];

/** 只替换本进程的 fetch；node:test 每个文件是独立进程，不会污染其他测试。 */
const install = (respond: () => Promise<unknown> | unknown) => {
  Object.defineProperty(globalThis, 'fetch', { value: async () => respond(), configurable: true });
};
const http = (status: number, body: unknown, statusText = '') => ({
  ok: status >= 200 && status < 300,
  status,
  statusText,
  json: async () => body,
});

test('a well-formed turn passes the contract and is returned as-is', async () => {
  install(() => http(200, VALID));
  assert.deepEqual(await lovePlayTurn(input), VALID);
});

test('an extra unknown field is stripped, not fatal', async () => {
  install(() => http(200, { ...VALID, someday: true }));
  assert.deepEqual(await lovePlayTurn(input), VALID);
});

test('a malformed 200 body is refused with a structured error the existing retry path can use', async () => {
  const bad: Record<string, unknown> = {
    'missing options': { ...VALID, options: undefined },
    'one option only': { ...VALID, options: VALID.options.slice(0, 1) },
    'empty line key': { ...VALID, line: { zh: '', en: 'x' } },
    'unknown emotion': { ...VALID, emotion: 'happy' },
    'stance out of range': { ...VALID, stance: 150 },
    'unknown terminal': { ...VALID, terminal: 'win' },
    'array instead of object': [VALID],
    'plain prose body': 'NPC：那句是你加的。',
  };
  for (const [name, body] of Object.entries(bad)) {
    install(() => http(200, body));
    await assert.rejects(
      lovePlayTurn(input),
      (e: unknown) => e instanceof ApiError && e.status === 502 && e.kind === 'http' && /回复格式不对/.test(e.message),
      `a 200 with ${name} must not be rendered as a turn`,
    );
  }
});

test('a 200 whose body cannot even be parsed is refused the same way', async () => {
  install(() => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  }));
  await assert.rejects(lovePlayTurn(input), (e: unknown) => e instanceof ApiError && e.status === 502 && e.kind === 'http');
});

test('a failure body keeps its error text, status, modelIssue and retryAt', async () => {
  install(() => http(429, { error: '共享池这个分钟已满，请稍后再试。', status: 429, modelIssue: 'rate_limit', retryAt: 1790000000000 }, 'Too Many Requests'));
  await assert.rejects(lovePlayTurn(input), (e: unknown) => {
    assert.ok(e instanceof ApiError, 'the failure must surface as the structured ApiError');
    assert.equal(e.status, 429);
    assert.equal(e.kind, 'http');
    assert.equal(e.message, '共享池这个分钟已满，请稍后再试。');
    assert.equal(e.modelIssue, 'rate_limit');
    assert.equal(e.retryAt, 1790000000000, 'G18：retryAt 不再被丢掉');
    return true;
  });
});

test('a failure body without retryAt still throws, with retryAt left undefined', async () => {
  install(() => http(500, { error: 'boom', status: 500 }, 'Internal Server Error'));
  await assert.rejects(
    lovePlayTurn(input),
    (e: unknown) => e instanceof ApiError && e.status === 500 && e.message === 'boom' && e.retryAt === undefined,
  );
});

test('an unparseable failure body falls back to the status text', async () => {
  install(() => ({
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
    json: async () => {
      throw new SyntaxError('nope');
    },
  }));
  await assert.rejects(lovePlayTurn(input), (e: unknown) => e instanceof ApiError && e.status === 503 && e.message === 'Service Unavailable');
});

test('an aborted request is rethrown untouched, not wrapped as an error', async () => {
  install(() => {
    throw new DOMException('The operation was aborted.', 'AbortError');
  });
  const controller = new AbortController();
  await assert.rejects(
    lovePlayTurn(input, controller.signal),
    (e: unknown) => e instanceof DOMException && e.name === 'AbortError',
    'leaving the page / restarting a run is not an error',
  );
});

test('a fetch that rejects with anything else reads as offline', async () => {
  install(() => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(lovePlayTurn(input), (e: unknown) => e instanceof ApiError && e.status === 0 && e.kind === 'network');
});
