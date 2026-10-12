import type { Lang } from "@/data/taxonomy";

/** Browser-independent stream lifecycle; the audio sink and native voice own their resources. */
export interface SpeechHandle {
  done: Promise<void>;
  cancel: () => void;
  pause: (paused: boolean) => void;
}
export interface PcmSink {
  write: (samples: Float32Array) => void;
  finish: () => Promise<void>;
  cancel: () => void;
  pause: (paused: boolean) => void;
}

/** Desktop Chrome kills a device utterance near 15s without firing end, so a long line is
 * spoken in sentence-sized pieces rather than left to the watchdog as dead air. Splitting may
 * not lose or reorder a character: `deviceChunks(t, lang).join("")` keeps every non-space of `t`.
 * 预算按语言分开：中文约 4–5 字/秒、英文约 15 字/秒，所以同一个 15 秒折成字符数差着三倍——
 * 只按英文那一档切，一条中文长台词照样会在块内被掐死。 */
const DEVICE_CHUNK_CHARS: Record<Lang, number> = { zh: 80, en: 200 };
export function deviceChunks(text: string, lang: Lang): string[] {
  const budget = DEVICE_CHUNK_CHARS[lang];
  if (text.length <= budget) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > budget) {
    const view = rest.slice(0, budget + 40);
    let cut = 0;
    for (const mark of ["。", "！", "？", "…", "；", ". ", "! ", "? ", "; ", "\n"]) {
      const at = view.lastIndexOf(mark);
      if (at >= 0 && at + mark.length > cut) cut = at + mark.length;
    }
    if (cut < budget / 2) {
      const space = view.lastIndexOf(" ");
      cut = space > budget / 2 ? space : budget;
    }
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest);
  return out.length ? out : [text];
}

export function startStreamSpeech(options: {
  fetch: (signal: AbortSignal) => Promise<Response>;
  sink: PcmSink;
  fallback: () => SpeechHandle;
  firstAudioMs?: number;
}): SpeechHandle {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancelled = false, started = false, paused = false, fallback: SpeechHandle | undefined;
  let finishCancel!: () => void;
  const cancellation = new Promise<void>(resolve => { finishCancel = resolve; });
  let timeout!: ReturnType<typeof setTimeout>;
  const abort = () => { controller.abort(); void reader?.cancel().catch(() => {}); };
  const firstDeadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { abort(); reject(new Error("Speech first audio timeout")); }, options.firstAudioMs ?? 3500);
  });
  const consume = async () => {
    const response = await options.fetch(controller.signal);
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error("Cancelled speech"); }
    if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/pcm") || !response.body) throw new Error("Unavailable speech");
    reader = response.body.getReader();
    let odd: number | undefined, size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        controller.signal.throwIfAborted();
        if (done) break;
        size += value.length;
        if (size > 4_000_000) throw new Error("Speech too large");
        const bytes = odd === undefined ? value : new Uint8Array([odd, ...value]);
        odd = bytes.length % 2 ? bytes[bytes.length - 1] : undefined;
        const samples = new Float32Array(Math.floor(bytes.length / 2));
        const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2);
        for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
        if (samples.length) {
          options.sink.write(samples); started = true; clearTimeout(timeout);
        }
      }
      if (!started || odd !== undefined) throw new Error("Missing PCM audio");
      await options.sink.finish();
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  };
  const run = async () => {
    try { await Promise.race([consume(), firstDeadline, cancellation]); }
    catch {
      abort(); options.sink.cancel();
      // Never replay a sentence the learner has already heard in part.
      if (!cancelled && !started) { fallback = options.fallback(); fallback.pause(paused); await Promise.race([fallback.done, cancellation]); }
    } finally { clearTimeout(timeout); }
  };
  return {
    done: run(),
    cancel() { cancelled = true; clearTimeout(timeout); abort(); options.sink.cancel(); fallback?.cancel(); finishCancel(); },
    pause(v) { paused = v; options.sink.pause(v); fallback?.pause(v); },
  };
}
