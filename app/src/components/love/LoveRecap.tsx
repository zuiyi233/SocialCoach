"use client";
import { useEffect, useMemo, useRef } from "react";
import { Volume2 } from "lucide-react";
import { clsx } from "clsx";
import type { Scenario } from "@/data/corpus/types";
import { Sheet } from "@/components/ui";
import { useApp, useLang } from "@/store/useApp";
import { t } from "@/lib/i18n";
import { defaultLearnerId, speakerOf } from "@/lib/session-utils";
import { buildLovePlayTranscript, type LovePlaySave } from "@/lib/love-story";
import { resolveLoveVoice } from "@/lib/love-voices";
import { playNpcLine, stopSpeaking } from "@/lib/speech";

/**
 * 本幕回想（spec-love-galgame-foundation §4）。
 *
 * `save` 是打开那一刻的冻结快照：面板开着时新回合结束也不会追加，关掉再开会拿到新的。
 * 只渲染 `history` 里已经确认的台词——选项、结局、hidden、routeState 都不在这里出现。
 * NPC 行可按角色声线重播单句；不自动朗读，不读学习者的话。
 */
export function LoveRecap({
  open,
  onClose,
  save,
  scenario,
}: {
  open: boolean;
  onClose: () => void;
  save: LovePlaySave | null;
  scenario: Scenario;
}) {
  const lang = useLang();
  const tts = useApp((s) => s.settings.tts);
  const profile = useApp((s) => s.profile);
  const bodyRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => (save ? buildLovePlayTranscript(save) : []), [save]);
  const cast = useMemo(() => new Map(scenario.characters.map((c) => [c.id, c])), [scenario]);
  const fallbackNpc = speakerOf(scenario, defaultLearnerId(scenario));

  const nameOf = (line: { role: "npc" | "learner"; characterId?: string }) => {
    if (line.role === "learner") return profile?.name?.trim() || t(lang, "love_recap_you");
    const character = line.characterId ? cast.get(line.characterId) : undefined;
    return (character ?? fallbackNpc).name[lang];
  };

  // 打开时滚到最新；关闭/卸载立刻停掉重播。
  useEffect(() => {
    if (!open) return;
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
    return () => stopSpeaking();
  }, [open]);

  const replay = (line: { text: string; characterId?: string }) => {
    // 一次只播一句：先停掉上一条（包括实时台词可能还在读的尾音），再走同一条声线。
    // 单句重播不走排队 `speak()`——那会把回想重播排到实时台词后面，造成面板关了还在出声。
    stopSpeaking();
    playNpcLine(line.text, lang, resolveLoveVoice(scenario.id, line.characterId ?? fallbackNpc.id));
  };

  const jump = (to: "opening" | "latest") => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = to === "opening" ? 0 : body.scrollHeight;
  };

  return (
    <Sheet open={open} onClose={onClose} title={t(lang, "love_recap_title")} bodyRef={bodyRef}>
      <div role="region" aria-label={t(lang, "love_recap_region")}>
        {lines.length === 0 ? (
          <p className="text-[14px] text-ink-3">{t(lang, "love_recap_empty")}</p>
        ) : (
          <>
            <div className="flex items-center gap-2 pb-3">
              <button
                type="button"
                onClick={() => jump("opening")}
                className="press rounded-full border border-line px-3 py-1.5 text-[12px] text-ink-2 hover:bg-inset"
              >
                {t(lang, "love_recap_opening")}
              </button>
              <button
                type="button"
                onClick={() => jump("latest")}
                className="press rounded-full border border-line px-3 py-1.5 text-[12px] text-ink-2 hover:bg-inset"
              >
                {t(lang, "love_recap_latest")}
              </button>
            </div>
            <ol className="flex flex-col gap-3 pb-2">
            {lines.map((line, index) => {
              const npc = line.role === "npc";
              return (
                <li
                  key={line.id}
                  className={clsx(
                    "rounded-[var(--radius-sm)] border px-4 py-3",
                    npc ? "border-line-strong bg-card" : "border-line bg-inset",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold text-ink-2">
                      {nameOf(line)}
                      {index === 0 && npc && (
                        <span className="ml-2 text-[11px] font-normal text-ink-3">{t(lang, "love_recap_opening")}</span>
                      )}
                    </span>
                    {npc && tts && (
                      <button
                        type="button"
                        onClick={() => replay(line)}
                        aria-label={t(lang, "love_recap_play")}
                        title={t(lang, "love_recap_play")}
                        className="press h-11 w-11 -my-2 -mr-2 inline-flex items-center justify-center rounded-full text-ink-3 hover:bg-inset hover:text-ink"
                      >
                        <Volume2 size={16} />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[14.5px] leading-relaxed text-ink">{line.text}</p>
                </li>
              );
            })}
          </ol>
          </>
        )}
      </div>
    </Sheet>
  );
}
