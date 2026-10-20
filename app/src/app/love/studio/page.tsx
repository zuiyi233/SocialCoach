"use client";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Button, Page, Spinner } from "@/components/ui";
import { useLoveStudioProbe } from "@/components/love/useLoveStudioProbe";
import { loveStudioOpenUrl } from "@/lib/love-studio-link";
import { useLang } from "@/store/useApp";
import { t } from "@/lib/i18n";

/**
 * Love Studio 的入口页（spec-love-studio §3.2 方案 A、§5 P1）。
 *
 * Studio 是独立本地运行时：主站只负责探测它开没开、给启动说明、把用户送过去，
 * 不代理它的请求、不共享存储。它没启动时这一页必须仍然可读可操作。
 */
export default function LoveStudio() {
  const lang = useLang();
  const { state, recheck } = useLoveStudioProbe();

  return (
    <Shell>
      <Page className="pt-5 lg:pt-10 flex flex-col gap-7 lg:gap-9">
        <header className="pb-6 border-b border-line">
          <div className="mb-4">
            <Link
              href="/love"
              aria-label={t(lang, "love_play_back_love")}
              className="press inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink-2"
            >
              <ArrowLeft size={15} />
              {t(lang, "love_play_back_love")}
            </Link>
          </div>
          <p className="eyebrow mb-3 text-accent-deep">{t(lang, "love_studio_play")}</p>
          <h1 className="display text-[29px] md:text-[34px] lg:text-[38px] leading-tight">{t(lang, "love_studio_name")}</h1>
          <p className="text-[14px] text-ink-3 mt-3 max-w-[var(--measure)]">{t(lang, "love_studio_sub")}</p>
        </header>

        <section aria-label={t(lang, "love_studio_name")} aria-live="polite" className="card p-5 flex flex-col gap-4">
          {state.kind === "checking" && (
            <p className="flex items-center gap-2 text-[14px] text-ink-2">
              <Spinner />
              {t(lang, "love_studio_checking")}
            </p>
          )}

          {state.kind === "up" && (
            <>
              <p className="flex items-center gap-2 text-[14px] text-ink">
                <CheckCircle2 size={18} className="shrink-0 text-teal" />
                {state.version ? t(lang, "love_studio_up_version", { version: state.version }) : t(lang, "love_studio_up")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => window.open(loveStudioOpenUrl(), "_blank", "noopener,noreferrer")}>
                  {t(lang, "love_studio_open")}
                  <ExternalLink size={15} />
                </Button>
                <Button variant="secondary" onClick={recheck}>
                  <RefreshCw size={15} />
                  {t(lang, "love_studio_recheck")}
                </Button>
              </div>
            </>
          )}

          {state.kind === "degraded" && (
            <>
              <p className="flex items-center gap-2 text-[14px] text-ink">
                <AlertCircle size={18} className="shrink-0 text-ink-2" />
                {t(lang, "love_studio_degraded")}
              </p>
              <p className="text-[13px] text-ink-2 leading-relaxed max-w-[var(--measure)]">
                {t(lang, "love_studio_degraded_body")}
              </p>
              <div>
                <Button variant="secondary" onClick={recheck}>
                  <RefreshCw size={15} />
                  {t(lang, "love_studio_recheck")}
                </Button>
              </div>
            </>
          )}

          {state.kind === "down" && (
            <>
              <p className="flex items-center gap-2 text-[14px] text-ink">
                <AlertCircle size={18} className="shrink-0 text-ink-3" />
                {t(lang, "love_studio_down")}
              </p>
              <div className="flex flex-col gap-2">
                <h2 className="font-semibold text-[15px]">{t(lang, "love_studio_install_title")}</h2>
                <p className="text-[13px] text-ink-2 leading-relaxed max-w-[var(--measure)]">
                  {t(lang, "love_studio_install_body")}
                </p>
                <ul className="flex flex-col gap-1 text-[13px] text-ink-2">
                  <li>{t(lang, "love_studio_install_win")}</li>
                  <li>{t(lang, "love_studio_install_mac")}</li>
                  <li>{t(lang, "love_studio_install_nix")}</li>
                </ul>
                <p className="text-[12px] text-ink-3">{t(lang, "love_studio_install_port")}</p>
                <p className="text-[12px] text-ink-3">{t(lang, "love_studio_unreachable_note")}</p>
              </div>
              <div>
                <Button variant="secondary" onClick={recheck}>
                  <RefreshCw size={15} />
                  {t(lang, "love_studio_recheck")}
                </Button>
              </div>
            </>
          )}

          <p className="text-[12px] text-ink-3 border-t border-line pt-3">{t(lang, "love_studio_gate_note")}</p>
        </section>
      </Page>
    </Shell>
  );
}