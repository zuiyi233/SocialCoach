"use client";
import type { Lang } from "@/data/taxonomy";
import type { TKey } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { isSingleLanguage, preferLanguage, type Persona } from "@/lib/love-persona";
import type { LovePersonaLinkReport } from "@/lib/love-persona-store";
import { Avatar } from "@/components/ui";
import { greetingPreviews, previewName } from "./persona-editor-logic";

/**
 * 预览（spec-love-persona §4.2）：头像/立绘、开场白、与现有剧情的适配提示。
 *
 * 「适配提示」只报**能从存储里诚实推出**的事实——引用这份人设的线与场景，
 * 由 `findPersonaLinkReport` 推出，不编造「适合哪些场景」。
 * 试音需要设备语音解锁与 persona→声线的映射，这里明确不提供（见报告里的 defer 说明）。
 */
export function PersonaPreview({
  persona,
  lang,
  refImage,
  links,
}: {
  persona: Persona;
  lang: Lang;
  refImage: string | null;
  links: LovePersonaLinkReport;
}) {
  const name = previewName(persona, lang);
  const hue = persona.appearance?.hue ?? 40;
  const greetings = greetingPreviews(persona, lang, 3);
  const originalNote = isSingleLanguage(persona.name) && (persona.name.zh.trim() || persona.name.en.trim());
  const appearance = persona.appearance?.text?.trim();
  const role = persona.role ? preferLanguage(persona.role, lang).trim() : "";
  const linkCount = links.seriesIds.length + links.scenarioIds.length;

  return (
    <section aria-label={t(lang, "love_persona_preview")} className="card p-5 flex flex-col gap-4">
      <h2 className="display text-[18px]">{t(lang, "love_persona_preview")}</h2>

      <div className="flex items-start gap-4">
        <Avatar name={name} hue={hue} seed={persona.id} size={64} imageData={refImage ?? undefined} />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <p className="font-semibold text-[16px] leading-snug">{name}</p>
          {role && <p className="text-[12px] text-ink-2">{role}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3">
              {t(lang, persona.kind === "player" ? "love_persona_kind_player" : "love_persona_kind_npc")}
            </span>
            <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3">
              {t(lang, "love_persona_revision_label", { n: persona.revision })}
            </span>
            {persona.language && (
              <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3">
                {t(lang, `love_persona_lang_${persona.language}` as TKey)}
              </span>
            )}
            {originalNote && (
              <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3">
                {t(lang, "love_persona_original")}
              </span>
            )}
          </div>
        </div>
      </div>

      {appearance && <p className="text-[12px] leading-relaxed text-ink-2">{appearance}</p>}

      <div className="flex flex-col gap-2">
        <p className="text-[12px] text-ink-3">{t(lang, "love_persona_preview_greetings")}</p>
        {greetings.length === 0 ? (
          <p className="text-[12px] text-ink-3">{t(lang, "love_persona_preview_no_greetings")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {greetings.map((line, i) => (
              <li key={i} className="border-l-2 border-line-strong pl-3 text-[13px] leading-relaxed text-ink">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <p className="text-[12px] text-ink-3">{t(lang, "love_persona_preview_links")}</p>
        {linkCount === 0 ? (
          <p className="text-[12px] text-ink-3">{t(lang, "love_persona_preview_no_links")}</p>
        ) : (
          <p className="num text-[12px] text-ink-2">
            {t(lang, "love_persona_preview_links_value", { series: links.seriesIds.length, scenarios: links.scenarioIds.length })}
          </p>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-3">{t(lang, "love_persona_preview_voice_deferred")}</p>
    </section>
  );
}