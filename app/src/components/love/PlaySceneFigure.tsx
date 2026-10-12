"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Lang, L } from "@/data/taxonomy";
import type { Scenario, Character } from "@/data/corpus/types";
import type { ChatMessage } from "@/lib/types";
import { AvatarFigure } from "@/data/avatars";
import { scenarioIconName } from "@/data/scenario-icons";
import { uid } from "@/lib/format";
import type { LovePlayEmotion } from "@/lib/love-play-client";

/** 与 ScenarioCover 私有 scenarioTone 同口径的色板：由场景图标决定，走 design token。 */
export function scenarioTone(scenario: Scenario) {
  const icon = scenarioIconName(scenario);
  if (["flame", "message-square-warning", "shield-alert", "megaphone", "user-x"].includes(icon)) return "clay";
  if (["banknote", "piggy-bank", "trophy", "receipt", "gift"].includes(icon)) return "ochre";
  if (["heart", "heart-crack", "coffee", "moon", "wine"].includes(icon)) return "rose";
  if (["split", "clock", "calendar-x", "clipboard-list", "package", "scale", "briefcase", "battery-low"].includes(icon)) return "olive";
  return "teal";
}

/** 场景开场作为第一条 NPC 台词（本地展示 + 进历史，与 Chat 的开场一致）。 */
export function startHistory(scenario: Scenario, lang: Lang): ChatMessage[] {
  return [{ id: uid(), role: "npc", characterId: scenario.opening.characterId, text: scenario.opening.text[lang], ts: Date.now() }];
}

/**
 * 表情驱动立绘：用覆盖层微动画表现 smile（上扬嘴角）/ tight（皱眉变暗）/
 * teary（泪滴），与原肖像几何对齐（viewBox 0-100）。色值全部走 CSS token。
 * 仅用于回退 AvatarFigure 模式——AI 立绘 PNG 已按表情生成，不再叠覆盖层。
 */
function EmotionOverlay({ emotion }: { emotion: LovePlayEmotion }) {
  return (
    <motion.span
      className="pointer-events-none absolute inset-0 rounded-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28 }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden focusable="false">
        {emotion === "smile" && <path d="M40 63 Q50 70 60 63" fill="none" stroke="var(--ink-2)" strokeWidth="1.7" strokeLinecap="round" />}
        {emotion === "tight" && (
          <g fill="none" stroke="var(--ink-2)" strokeWidth="1.8" strokeLinecap="round">
            <path d="M36 45 Q43 41 50 45" />
            <path d="M50 45 Q57 41 64 45" />
          </g>
        )}
        {emotion === "teary" && (
          <g fill="var(--teal)" opacity="0.85">
            <path d="M33 55 Q30 62 33 66 Q36 62 33 55Z" />
            <path d="M67 55 Q64 62 67 66 Q70 62 67 55Z" />
          </g>
        )}
      </svg>
      {emotion === "tight" && <span className="absolute inset-0 rounded-full" style={{ background: "color-mix(in oklch, var(--ink) 14%, transparent)" }} />}
    </motion.span>
  );
}

/** love-portraits/manifest.json 的类型：只取运行时要用的字段。 */
interface LovePortraitManifestCharacter {
  name: L;
  hue: number;
  emotions: Partial<Record<LovePlayEmotion, string>>;
}
interface LovePortraitManifest {
  characters: Record<string, LovePortraitManifestCharacter>;
}

/** manifest 模块级单例：静态 JSON 只请求一次，多角色共享同一份结果。 */
let portraitManifestPromise: Promise<LovePortraitManifest | null> | null = null;
function loadPortraitManifest(): Promise<LovePortraitManifest | null> {
  if (!portraitManifestPromise) {
    portraitManifestPromise = fetch("/love-portraits/manifest.json")
      .then((res) => (res.ok ? (res.json() as Promise<LovePortraitManifest>) : null))
      .catch(() => null);
  }
  return portraitManifestPromise;
}

/** 取角色对应表情的 PNG 路径；角色未生成立绘或该表情缺图时返回 null（走 AvatarFigure 回退）。 */
function portraitSrcOf(manifest: LovePortraitManifest | null, characterId: string, emotion: LovePlayEmotion): string | null {
  if (!manifest) return null;
  const face = manifest.characters[characterId];
  if (!face) return null;
  const file = face.emotions[emotion] ?? face.emotions.neutral;
  return file ? `/love-portraits/${file}` : null;
}

/** manifest 读一次给多个组件用：立绘台与恋爱首页的跟进卡都要同一份角色表。 */
function usePortraitManifest(): LovePortraitManifest | null {
  const [manifest, setManifest] = useState<LovePortraitManifest | null>(null);
  useEffect(() => {
    let alive = true;
    void loadPortraitManifest().then((m) => {
      if (alive) setManifest(m);
    });
    return () => {
      alive = false;
    };
  }, []);
  return manifest;
}

/**
 * 跟进卡用：按 character id 取那张立绘与它的主色，manifest 没这个角色（例如自定义排练里
 * 的人物）就返回 null，调用方回退 AvatarFigure。
 * **只有图按 id 取**：卡片上「这是谁说的」永远读存储里那份 `npcName` 快照——语料里 `tess`
 * 同时是两个人，按 id 反查会把承诺安到错误的人头上，而图本来就是同一个人共享的。
 */
export function useLovePortrait(characterId: string): { src: string | null; hue: number } {
  const manifest = usePortraitManifest();
  return {
    src: portraitSrcOf(manifest, characterId, "neutral"),
    hue: manifest?.characters[characterId]?.hue ?? 40,
  };
}

/** 立绘台：角色有 AI 生成的 PNG 立绘（manifest 命中）就用竖版立绘；否则回退 SVG 占位。
 *  emphasize 用于 hidden 揭示回合：把说话人轻微推近（scale 1.06+）并加一圈 rose 描边，
 *  只影响视觉，不碰立绘管线与表情判定。 */
export function AvatarStand({ character, lang, emotion, active, emphasize = false, size = 216 }: { character: Character; lang: Lang; emotion: LovePlayEmotion; active: boolean; emphasize?: boolean; size?: number }) {
  const manifest = usePortraitManifest();
  const portraitSrc = portraitSrcOf(manifest, character.id, emotion);
  const highlight = emphasize && active;
  const ring = "0 0 0 3px color-mix(in oklch, var(--rose) 55%, transparent)";

  return (
    <motion.div
      className="flex flex-col items-center"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0, scale: highlight ? 1.07 : active ? 1.04 : 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 26 }}
    >
      {portraitSrc ? (
        // PNG 立绘模式：竖版画布（832×1248，2:3），透明底由模型原生生成，直接叠在场景渐变上。
        // 表情已由生成管线内置，不再叠加 EmotionOverlay；覆盖层只留给回退模式。
        <div
          className="relative overflow-hidden"
          style={{
            width: size,
            height: Math.round(size * 1.46),
            borderRadius: Math.round(size * 0.07),
            boxShadow: highlight ? `0 18px 44px -22px var(--edge-shadow), ${ring}` : "0 18px 44px -22px var(--edge-shadow)",
          }}
        >
          <span
            aria-hidden
            className="absolute inset-0 bg-no-repeat"
            style={{ backgroundImage: `url("${portraitSrc}")`, backgroundSize: "contain", backgroundPosition: "center bottom" }}
          />
        </div>
      ) : (
        // 回退：SVG 占位（AvatarFigure）保持圆形，表情微动画覆盖层保留。
        <div className="relative overflow-hidden rounded-full" style={{ width: size, height: size, boxShadow: highlight ? `0 18px 44px -22px var(--edge-shadow), ${ring}` : "0 18px 44px -22px var(--edge-shadow)" }}>
          <AvatarFigure seed={character.name[lang]} hue={character.hue} size={size} />
          <AnimatePresence initial={false}>{active && emotion !== "neutral" ? <EmotionOverlay key={emotion} emotion={emotion} /> : null}</AnimatePresence>
        </div>
      )}
      <p className="mt-3 text-[13px] font-medium text-ink">{character.name[lang]}</p>
    </motion.div>
  );
}
