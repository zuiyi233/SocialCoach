"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Page } from "@/components/ui";
import { PersonaEditor } from "@/components/love/PersonaEditor";
import { useLang } from "@/store/useApp";
import { t } from "@/lib/i18n";

/**
 * 恋爱系统的聚焦人设编辑器（spec-love-persona §4.2）。
 *
 * 与 Studio 共享同一份 Persona schema，但只做恋爱系统需要的字段与导入导出：
 * `.scpersona` + 基础 JSON；完整 Tavern 制品引导到 Studio。
 */
export default function LovePersona() {
  const lang = useLang();

  return (
    <Shell>
      <Page className="pt-5 lg:pt-10 flex flex-col gap-7 lg:gap-9">
        <header className="pb-6 border-b border-line">
          <div className="mb-4">
            <Link
              href="/love"
              aria-label={t(lang, "love_persona_back_love")}
              className="press inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink-2"
            >
              <ArrowLeft size={15} />
              {t(lang, "love_persona_back_love")}
            </Link>
          </div>
          <p className="eyebrow mb-3 text-accent-deep">{t(lang, "love_persona_eyebrow")}</p>
          <h1 className="display text-[29px] md:text-[34px] lg:text-[38px] leading-tight whitespace-pre-line">{t(lang, "love_persona_heading")}</h1>
          <p className="text-[14px] text-ink-3 mt-3 max-w-[var(--measure)]">{t(lang, "love_persona_sub")}</p>
        </header>

        <PersonaEditor lang={lang} />
      </Page>
    </Shell>
  );
}