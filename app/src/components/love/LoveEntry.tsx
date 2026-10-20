"use client";
import Link from "next/link";
import { ArrowRight, Play, Sparkles } from "lucide-react";
import type { Lang } from "@/data/taxonomy";
import { t } from "@/lib/i18n";
import { useLoveStudioProbe } from "./useLoveStudioProbe";

/**
 * `/love` 的两个主入口（spec-love-semi-coach §5「入口」）。
 *
 * 两条路并列，不替用户选：Studio 是生成式沙盒（初始实践），
 * 剧情模式是半教练（关系连续）。Studio 未运行时也照样能进剧情模式——
 * 这里的状态行只是路标，不是门禁。
 */
export function LoveEntry({ lang }: { lang: Lang }) {
  const { state } = useLoveStudioProbe();
  const status =
    state.kind === "checking"
      ? t(lang, "love_studio_checking")
      : state.kind === "up"
        ? state.version
          ? t(lang, "love_studio_up_version", { version: state.version })
          : t(lang, "love_studio_up")
        : state.kind === "degraded"
          ? t(lang, "love_studio_degraded")
          : t(lang, "love_studio_down");

  return (
    <section aria-label={t(lang, "love_studio_name")} className="grid gap-3 md:grid-cols-2">
      <Link href="/love/studio" className="press card card-link text-left p-5 flex items-start gap-4">
        <span className="shrink-0 w-12 h-12 rounded-full grid place-items-center bg-accent-soft text-accent-deep">
          <Sparkles size={22} />
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="block font-semibold text-[16px] leading-snug">{t(lang, "love_studio_play")}</span>
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3">
              {t(lang, "love_studio_name")}
            </span>
          </span>
          <span className="block text-[12px] text-ink-2 leading-relaxed">{t(lang, "love_studio_play_sub")}</span>
          <span className="block text-[11px] text-ink-3 mt-0.5" aria-live="polite">
            {status}
          </span>
        </span>
        <ArrowRight size={17} className="shrink-0 mt-1 text-accent-deep" />
      </Link>

      <a href="#love-series" className="press card card-link text-left p-5 flex items-start gap-4">
        <span className="shrink-0 w-12 h-12 rounded-full grid place-items-center bg-accent-soft text-accent-deep">
          <Play size={22} />
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="block font-semibold text-[16px] leading-snug">{t(lang, "love_studio_continue")}</span>
          <span className="block text-[12px] text-ink-2 leading-relaxed">{t(lang, "love_studio_continue_sub")}</span>
        </span>
        <ArrowRight size={17} className="shrink-0 mt-1 text-accent-deep" />
      </a>
    </section>
  );
}