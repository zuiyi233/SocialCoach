import { z } from "zod";
import type { L } from "@/data/taxonomy";

/**
 * BGM/环境音播放器（spec-love-interactive-story §4.5 / 拍板 Q5：BGM 优先，无 CG）。
 *
 * 资产与授权纪律：音频必须是**构建期**放进 `public/love-ambient/` 的文件，
 * 每条在 manifest 里登记来源与授权（`license` / `source`）。当前没有任何
 * 有授权的音频资产，manifest 是空数组——播放器整个链路必须对「无素材」
 * 静默降级：不报错、不崩、不占资源，将来把带授权的资产与 manifest 条目
 * 一起提交即可生效，代码无需再改。
 *
 * 播放口径：按场景 tone 选轨、音量小（BASE 0.16）、循环；TTS 朗读时自动
 * ducking（音量压到 0.05）；拍点时刻「静音一拍」（约 0.7s 归零后恢复）。
 */

/** 与 PlaySceneFigure.scenarioTone 同一口径的场景色板名。 */
export type LoveSceneTone = "clay" | "ochre" | "rose" | "olive" | "teal";

export const LOVE_AMBIENT_MANIFEST_URL = "/love-ambient/manifest.json";
/** 常驻音量：环境音是衬底，永远不遮台词与 TTS。 */
export const LOVE_AMBIENT_VOLUME = 0.16;
/** TTS ducking 后的音量。 */
export const LOVE_AMBIENT_DUCKED_VOLUME = 0.05;
/** 「静音一拍」的时长（毫秒）。 */
export const LOVE_AMBIENT_BEAT_MUTE_MS = 700;
/** 渐变步进间隔（毫秒）。 */
export const LOVE_AMBIENT_FADE_TICK_MS = 100;

/** manifest 里的一条轨：来源与授权是必填——没有出处的音频不进 manifest。 */
export interface LoveAmbientTrack {
  id: string;
  tone: LoveSceneTone;
  /** 相对 public 的路径，如 "love-ambient/rio-loop.mp3"。 */
  src: string;
  title: L;
  license: string;
  source: string;
}

const trackSchema = z.object({
  id: z.string().min(1).max(120),
  tone: z.enum(["clay", "ochre", "rose", "olive", "teal"]),
  src: z.string().min(1).max(300),
  title: z.object({ zh: z.string().min(1).max(120), en: z.string().min(1).max(120) }),
  license: z.string().min(1).max(300),
  source: z.string().min(1).max(500),
});

/** 逐条校验：坏条目丢弃，好的保留——一条坏数据不拖垮整份 manifest。 */
export function parseLoveAmbientManifest(raw: unknown): LoveAmbientTrack[] {
  if (!Array.isArray(raw)) return [];
  const out: LoveAmbientTrack[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const parsed = trackSchema.safeParse(item);
    if (!parsed.success) continue;
    if (seen.has(parsed.data.id) || seen.has(parsed.data.src)) continue;
    seen.add(parsed.data.id);
    seen.add(parsed.data.src);
    out.push(parsed.data);
  }
  return out;
}

/**
 * 拉 manifest：404 / 断网 / 坏 JSON / 形状不对一律返回 `[]`（静默降级）。
 * `fetchFn` 可注入以便离线测试。
 */
export async function loadLoveAmbientManifest(fetchFn: typeof fetch = fetch): Promise<LoveAmbientTrack[]> {
  try {
    const res = await fetchFn(LOVE_AMBIENT_MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) return [];
    const raw: unknown = await res.json();
    return parseLoveAmbientManifest(raw);
  } catch {
    return [];
  }
}

/** 按场景 tone 选轨：同一 tone 取第一条；没有匹配轨（或 manifest 为空）返回 null。 */
export function loveAmbientTrackForTone(manifest: LoveAmbientTrack[], tone: LoveSceneTone): LoveAmbientTrack | null {
  return manifest.find((track) => track.tone === tone) ?? null;
}

/** 渐变的一步：向目标音量走一段（最小步长 0.01，保证收敛）。 */
export function stepAmbientVolume(current: number, target: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= 0.011) return target;
  const step = Math.max(0.012, Math.abs(delta) * 0.28);
  return current + Math.sign(delta) * step;
}

/** 播放器内核对音频元素的最低要求；便于测试注入假元素。 */
export interface LoveAmbientAudio {
  volume: number;
  loop: boolean;
  src: string;
  play(): Promise<void> | void;
  pause(): void;
}

export type AmbientAudioFactory = (src: string) => LoveAmbientAudio;

function defaultAudioFactory(src: string): LoveAmbientAudio {
  if (typeof Audio === "undefined") throw new Error("no Audio in this environment");
  const audio = new Audio(src);
  audio.preload = "auto";
  return audio as unknown as LoveAmbientAudio;
}

export interface LoveAmbientPlayer {
  /** 装载 manifest（无素材 = 空数组，播放器保持待机）。 */
  setManifest(manifest: LoveAmbientTrack[]): void;
  /** 当前场景 tone 变化时调用；无匹配轨则静默待机。 */
  setTone(tone: LoveSceneTone): void;
  /** 首次用户手势后调用：绕过浏览器自动播放限制（失败也保持静默）。 */
  unlock(): void;
  /** TTS ducking：true = 压低音量。 */
  setDucked(ducked: boolean): void;
  /** 页面进后台时整体挂起（连暂停都算不上，直接停），回来再续。 */
  setSuspended(suspended: boolean): void;
  /** 拍点「静音一拍」：短暂归零后自动恢复；没在播就是 no-op。 */
  beatMute(): void;
  /** 诊断/测试：当前状态快照。 */
  debugState(): { trackId: string | null; playing: boolean; volume: number; target: number };
  /** 驱动一次渐变（内部定时器自动调用；测试可手动调用）。 */
  tick(): void;
  dispose(): void;
}

/**
 * 创建播放器。所有浏览器 API 都有守卫：无 Audio、播放被拒、manifest 缺失，
 * 都停在待机态，绝不抛错。
 */
export function createLoveAmbientPlayer(options?: {
  audioFactory?: AmbientAudioFactory;
  now?: () => number;
}): LoveAmbientPlayer {
  const audioFactory = options?.audioFactory ?? defaultAudioFactory;
  const now = options?.now ?? (() => Date.now());

  let manifest: LoveAmbientTrack[] = [];
  let tone: LoveSceneTone | null = null;
  let audio: LoveAmbientAudio | null = null;
  let trackId: string | null = null;
  let playing = false;
  let ducked = false;
  let beatUntil = 0;
  let volume = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const ensureTimer = () => {
    if (timer) return;
    timer = setInterval(() => tick(), LOVE_AMBIENT_FADE_TICK_MS);
  };
  const clearTimer = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  };

  const targetVolume = (): number => {
    if (!playing) return 0;
    if (now() < beatUntil) return 0;
    return ducked ? LOVE_AMBIENT_DUCKED_VOLUME : LOVE_AMBIENT_VOLUME;
  };

  const tick = () => {
    const target = targetVolume();
    if (!audio) {
      if (!playing) clearTimer();
      return;
    }
    volume = stepAmbientVolume(volume, target);
    try {
      audio.volume = Math.max(0, Math.min(1, volume));
    } catch {
      /* 只读环境忽略 */
    }
    // 到达目标且没有待恢复的静音拍：停表省资源；下一次目标变化由
    // setDucked / beatMute / setSuspended / tryStart 重新 ensureTimer。
    if (volume === target && now() >= beatUntil) {
      clearTimer();
    }
  };

  const tryStart = () => {
    if (!tone || playing) return;
    const track = loveAmbientTrackForTone(manifest, tone);
    if (!track) return;
    try {
      if (!audio || trackId !== track.id) {
        audio?.pause();
        audio = audioFactory(track.src);
        audio.loop = true;
        volume = 0;
        audio.volume = 0;
        trackId = track.id;
      }
      const result = audio.play();
      if (result && typeof result.then === "function") {
        void result.then(
          () => {
            playing = true;
            ensureTimer();
          },
          () => {
            // 自动播放被拒（无手势）：保持待机，等 unlock() 再试。
            playing = false;
          },
        );
      } else {
        playing = true;
        ensureTimer();
      }
    } catch {
      playing = false;
    }
  };

  const player: LoveAmbientPlayer = {
    setManifest(next) {
      manifest = Array.isArray(next) ? next : [];
      // 换 manifest 后当前轨可能已不存在：只在当前轨消失时重选。
      if (playing && tone && !loveAmbientTrackForTone(manifest, tone)) {
        playing = false;
        audio?.pause();
        audio = null;
        trackId = null;
      }
      tryStart();
    },
    setTone(next) {
      if (tone === next) return;
      tone = next;
      if (playing && !loveAmbientTrackForTone(manifest, next)) {
        playing = false;
        audio?.pause();
        audio = null;
        trackId = null;
        volume = 0;
      }
      tryStart();
    },
    unlock() {
      tryStart();
    },
    setDucked(next) {
      ducked = next;
      if (playing) ensureTimer();
    },
    setSuspended(suspended) {
      if (suspended) {
        playing = false;
        clearTimer();
        try {
          audio?.pause();
        } catch {
          /* 已停止 */
        }
        return;
      }
      // 回到前台：同一轨继续（audio 还在，只是暂停了）。
      tryStart();
    },
    beatMute() {
      if (!playing) return;
      beatUntil = now() + LOVE_AMBIENT_BEAT_MUTE_MS;
      ensureTimer();
    },
    debugState: () => ({ trackId, playing, volume, target: targetVolume() }),
    tick,
    dispose() {
      clearTimer();
      try {
        audio?.pause();
      } catch {
        /* 已停止 */
      }
      audio = null;
      trackId = null;
      playing = false;
      manifest = [];
    },
  };
  return player;
}
