import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 恋爱 Galgame 的"流式打字机"。
 *
 * P3 起后端 /api/love-play 仍保持非流式 JSON 契约（一次返回 line+options 全套），
 * 前端用本模块把收到台词模拟成"边到边读"：中文逐字、英文逐词（含空格），
 * 句末标点附加停顿（句间约 120ms）。观感等同网络流式，零后端风险。
 */

/** 逐字 / 逐词节奏的节拍器（毫秒）。 */
const CJK_BASE_MS = 46;
const PUNCT_BASE_MS = 40;
/** 英文单词按长度加权：短词快、长词慢，封顶避免拖沓。 */
const WORD_BASE_MS = 60;
const WORD_PER_CHAR_MS = 6;
const WORD_MAX_MS = 220;
/** 句末（。！？…）之后的句间停顿。 */
const SENTENCE_PAUSE_MS = 120;
/** 句中停顿（，、；：）。 */
const CLAUSE_PAUSE_MS = 60;

/** CJK 统一表意文字 + 中文标点（含全角），这些位置按"单个字符"步进。 */
const CJK_RE = /[\u2E80-\u2EFF\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;
/** 英文单词字符：字母、数字、撇号、连字符。 */
const WORD_RE = /[A-Za-z0-9_'-]/;
/** 句末标点：决定句间停顿。 */
const SENTENCE_END_RE = /[。！？!?…]/;
/** 句中停顿标点。 */
const CLAUSE_PAUSE_RE = /[，,、；;：:]/;

export interface TypeLoveLineHandle {
  /** 本次打字的收尾 Promise：true = 被跳过/中止打断，false = 自然打完。 */
  promise: Promise<boolean>;
  /** 立即完成：直接回调全文并收尾，不再排任何定时器。 */
  skip: () => void;
}

/**
 * 把一段台词按自然节奏"打"出来。onChar(n) 的 n 是已揭示的切片终点
 * （text.slice(0, n)），从 0 逐段涨到 text.length。signal 中止时立即停表收尾。
 * 组件卸载 / 换台词时务必传入新的 AbortController 并 abort，避免 setInterval
 * 类泄漏（内部全部用 setTimeout 链，abort 后不再排队）。
 */
export function typeLoveLine(text: string, onChar: (n: number) => void, signal?: AbortSignal): TypeLoveLineHandle {
  let alive = true;
  let timer = 0;
  let endResolve!: (interrupted: boolean) => void;
  const endPromise = new Promise<boolean>((resolve) => {
    endResolve = resolve;
  });

  const finish = (interrupted: boolean) => {
    if (!alive) return;
    alive = false;
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    endResolve(interrupted);
  };
  const onAbort = () => finish(true);
  signal?.addEventListener("abort", onAbort);
  if (signal?.aborted) onAbort();

  // 尊重 prefers-reduced-motion：不逐字拖延，几帧内直接出全文。
  const fast =
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  /** 从 i 起推一段：返回下一段起点与本段展示前等待的时长。 */
  const nextSegment = (i: number): { next: number; delay: number } => {
    if (i >= text.length) return { next: text.length, delay: 0 };
    const ch = text[i];
    if (CJK_RE.test(ch)) {
      return { next: i + 1, delay: CJK_BASE_MS + pauseFor(text, i + 1) };
    }
    if (WORD_RE.test(ch)) {
      let next = i + 1;
      while (next < text.length && WORD_RE.test(text[next])) next++;
      // 空格并进单词段，词间不产生"纯空格步"。
      while (next < text.length && text[next] === " ") next++;
      const wordLen = next - i;
      const delay = Math.min(WORD_BASE_MS + wordLen * WORD_PER_CHAR_MS, WORD_MAX_MS);
      return { next, delay: delay + pauseFor(text, next - 1) };
    }
    // 独立标点 / 空白 / 换行：单字符步，短停顿。
    return { next: i + 1, delay: PUNCT_BASE_MS + pauseFor(text, i + 1) };
  };

  /** 刚展示到 index 处（不含），若落在句末/句中标点则追加停顿。 */
  const pauseFor = (text: string, index: number): number => {
    if (index <= 0) return 0;
    const last = text[index - 1];
    if (SENTENCE_END_RE.test(last)) return SENTENCE_PAUSE_MS;
    if (CLAUSE_PAUSE_RE.test(last)) return CLAUSE_PAUSE_MS;
    return 0;
  };

  const step = (i: number) => {
    if (!alive) return;
    const seg = nextSegment(i);
    timer = window.setTimeout(
      () => {
        if (!alive) return;
        onChar(i);
        if (i >= text.length) {
          finish(false);
          return;
        }
        step(seg.next);
      },
      fast ? 0 : seg.delay,
    );
  };

  const skip = () => {
    if (!alive) return;
    alive = false;
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    onChar(text.length);
    endResolve(true);
  };

  step(0);
  return { promise: endPromise, skip };
}

/** 打字进度状态：key 对齐台词、n 为已揭示切片终点、total 为全文长度。 */
export interface LoveTypingStep {
  key: string;
  n: number;
  total: number;
}

/**
 * PlayScene 用的打字机状态：新台词 putLine 即启动逐字浮现；skipNow 立即显示全文。
 * 内部用 AbortController 保证换台词 / 卸载时停止上一轮定时器链，不泄漏。
 */
export function useLoveTyping(): { typing: LoveTypingStep | null; skip: boolean; putLine: (key: string, text: string) => void; skipNow: () => void } {
  const [typing, setTyping] = useState<LoveTypingStep | null>(null);
  const [skip, setSkip] = useState(false);
  const ctlRef = useRef<AbortController | null>(null);
  const skipFnRef = useRef<(() => void) | null>(null);

  const putLine = useCallback((key: string, text: string) => {
    ctlRef.current?.abort();
    skipFnRef.current = null;
    setSkip(false);
    setTyping({ key, n: 0, total: text.length });
    const ctl = new AbortController();
    ctlRef.current = ctl;
    const run = typeLoveLine(
      text,
      (n) => setTyping((prev) => (prev && prev.key === key ? { ...prev, n } : prev)),
      ctl.signal,
    );
    skipFnRef.current = run.skip;
    // 结果只看不打：PlayScene 用 skip 状态 + typing.n 渲染，这里不需要消费。
    void run.promise;
  }, []);

  const skipNow = useCallback(() => {
    if (skipFnRef.current) {
      skipFnRef.current();
      skipFnRef.current = null;
    }
    setSkip(true);
  }, []);

  // 卸载时停表，防卸载后 setState。
  useEffect(() => () => ctlRef.current?.abort(), []);

  return { typing, skip, putLine, skipNow };
}
