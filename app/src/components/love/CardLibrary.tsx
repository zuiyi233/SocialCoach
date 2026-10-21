"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Download, FileUp, Play, Trash2 } from "lucide-react";
import type { Lang } from "@/data/taxonomy";
import { t } from "@/lib/i18n";
import { useLang } from "@/store/useApp";
import { loveCardToJson, parseLoveCardJson, parseLoveCardPng, type LoveCard, type LoveCardParse } from "@/lib/love-card";
import { addLoveCard, readLoveCards, removeLoveCard, type LoveCardWrite } from "@/lib/love-card-store";
import { Shell } from "@/components/Shell";
import { Button, Empty, Page } from "@/components/ui";

/**
 * 卡片库（spec-love-user-cards §2.4）：/love/cards。
 *
 * 只读 `readLoveCards()`、写走 `addLoveCard` / `removeLoveCard`，不另造一套 slot。
 * 导入失败展示解析器给的双语 message；配额/冲突/损坏的写入失败**显式**提示，
 * 绝不静默丢卡。删除是二次确认，且明确告知已产生的档案与故事不会删除。
 *
 * 服务端首帧没有 localStorage：初始状态与 SSR 渲染一致（空列表），挂载后再读取。
 */
export function CardLibrary() {
  const lang = useLang();
  const fileRef = useRef<HTMLInputElement>(null);
  const [cards, setCards] = useState<LoveCard[]>([]);
  const [slotStatus, setSlotStatus] = useState<"empty" | "ok" | "corrupt">("empty");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const reload = useCallback(() => {
    const read = readLoveCards();
    setSlotStatus(read.status);
    setCards(read.cards);
  }, []);

  useEffect(() => {
    // 服务端首帧没有 localStorage：挂载后在宏任务里读盘（与 love 首页读记录同口径），
    // 避免 hydration 不一致与级联渲染。
    const timer = window.setTimeout(reload, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  /** 写入失败的用户可读提示（配额 / 冲突 / 损坏 / 存储不可用），不静默。 */
  const writeNotice = (result: LoveCardWrite): string => {
    if (result.ok) return "";
    switch (result.code) {
      case "quota":
        return t(lang, "love_cards_import_quota");
      case "conflict":
        return t(lang, "love_cards_import_conflict");
      case "corrupt":
        return t(lang, "love_cards_import_corrupt");
      default:
        return t(lang, "love_cards_storage_unavailable");
    }
  };

  const attemptImport = async (file: File) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      let parsed: LoveCardParse;
      // PNG 卡按字节读；JSON 卡按文本读（8 MiB 上限由解析器把关）。
      if (file.type === "image/png" || /\.png$/i.test(file.name)) {
        parsed = parseLoveCardPng(await file.arrayBuffer(), lang);
      } else {
        parsed = parseLoveCardJson(await file.text(), lang);
      }
      if (!parsed.ok) {
        setNotice({ kind: "error", text: t(lang, "love_cards_import_failed", { message: parsed.message }) });
        return;
      }
      const result = addLoveCard(parsed.card);
      if (!result.ok) {
        setNotice({ kind: "error", text: writeNotice(result) });
        return;
      }
      setNotice({ kind: "ok", text: t(lang, "love_cards_import_ok", { name: parsed.card.name }) });
      reload();
    } catch {
      setNotice({ kind: "error", text: t(lang, "love_cards_import_failed", { message: t(lang, "error_generic") }) });
    } finally {
      setBusy(false);
    }
  };

  /** 导出卡：`loveCardToJson`（V2 信封）→ 下载 .json。 */
  const exportCard = (card: LoveCard) => {
    try {
      const safeName = card.name.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "character-card";
      const blob = new Blob([loveCardToJson(card)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setNotice({ kind: "error", text: t(lang, "love_cards_delete_failed") });
    }
  };

  const removeCard = (id: string) => {
    const result = removeLoveCard(id);
    if (!result.ok) {
      setNotice({ kind: "error", text: t(lang, "love_cards_delete_failed") });
      return;
    }
    setConfirmingId(null);
    reload();
  };

  const sourceLabel = (card: LoveCard): string =>
    card.source === "tavern-png"
      ? t(lang, "love_cards_source_png")
      : card.source === "tavern-json"
        ? t(lang, "love_cards_source_json")
        : t(lang, "love_cards_source_manual");

  const importedAt = (card: LoveCard): string =>
    new Date(card.importedAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <Shell>
      <Page className="pt-5 lg:pt-10 flex flex-col gap-6 lg:gap-8">
        <header className="pb-6 border-b border-line">
          <Link href="/love" className="press inline-flex items-center gap-1 min-h-11 text-[13px] text-ink-3 hover:text-ink-2">
            <ArrowLeft size={16} />
            {t(lang, "love_cards_back_love")}
          </Link>
          <p className="eyebrow mb-3 mt-2 text-accent-deep">{t(lang, "love_cards_eyebrow")}</p>
          <h1 className="display text-[26px] md:text-[32px] leading-tight whitespace-pre-line">{t(lang, "love_cards_heading")}</h1>
          <p className="text-[14px] text-ink-3 mt-3 max-w-[var(--measure)]">{t(lang, "love_cards_sub")}</p>
        </header>

        {slotStatus === "corrupt" && (
          <div role="alert" className="rounded-[var(--radius-sm)] bg-danger-soft px-4 py-3 text-[13px] text-danger max-w-[var(--measure)]">
            {t(lang, "love_cards_corrupt_slot")}
          </div>
        )}

        {/* 导入：文件选择 + 拖拽区。失败显式展示解析器/写入方的双语提示。 */}
        <section aria-label={t(lang, "love_cards_import")} className="flex flex-col gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".png,.json,application/json,image/png"
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void attemptImport(file);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => fileRef.current?.click()} disabled={busy}>
              <FileUp size={16} className="shrink-0" />
              {t(lang, "love_cards_import")}
            </Button>
            <span className="text-[12px] text-ink-3">{t(lang, "love_cards_import_hint")}</span>
          </div>
          <div
            role="button"
            tabIndex={0}
            aria-label={t(lang, "love_cards_drop_hint")}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void attemptImport(file);
            }}
            className={`press flex flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed px-6 py-10 text-center ${
              dragging ? "border-ink-2 bg-inset" : "border-line-strong bg-card"
            }`}
          >
            <FileUp size={20} className="text-ink-3" aria-hidden />
            <span className="text-[14px] text-ink-2">{t(lang, "love_cards_drop_hint")}</span>
          </div>
          {busy && (
            <p className="text-[12px] text-ink-3" role="status">
              <span className="dot" /><span className="dot" /><span className="dot" />
            </p>
          )}
          {notice && (
            <p
              role={notice.kind === "error" ? "alert" : "status"}
              className={`text-[13px] leading-relaxed max-w-[var(--measure)] ${notice.kind === "error" ? "text-danger" : "text-ink-2"}`}
            >
              {notice.text}
            </p>
          )}
        </section>

        {/* 列表：卡名、标签、来源、导入时间；每张卡 玩一局 / 导出 / 删除。 */}
        <section aria-label={t(lang, "love_cards_list_title")} className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="display text-[20px]">{t(lang, "love_cards_list_title")}</h2>
            <span className="num text-[12px] text-ink-3">{t(lang, "love_cards_count", { n: cards.length })}</span>
          </div>

          {cards.length === 0 && (
            <Empty
              title={t(lang, "love_cards_empty_title")}
              body={t(lang, "love_cards_empty_body")}
              action={
                <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
                  {t(lang, "love_cards_import")}
                </Button>
              }
            />
          )}

          <div className="flex flex-col">
            {cards.map((card) => {
              const confirming = confirmingId === card.id;
              return (
                <article key={card.id} className="notebook-row flex items-start gap-2 md:gap-4 py-5 md:p-5 -mx-1 px-1">
                  <span className="flex flex-1 min-w-0 flex-col gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[16px] leading-snug">{card.name}</span>
                      <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3">
                        {sourceLabel(card)}
                      </span>
                      {card.spec !== "unknown" && (
                        <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3">
                          {card.spec}
                        </span>
                      )}
                    </span>
                    {card.description && (
                      <span className="text-[13px] text-ink-2 leading-relaxed max-w-[var(--measure)] line-clamp-2">
                        {card.description}
                      </span>
                    )}
                    {card.tags.length > 0 && (
                      <span className="flex flex-wrap gap-1.5">
                        {card.tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="rounded-full bg-inset px-2 py-0.5 text-[11px] text-ink-3">
                            {tag}
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="text-[11px] text-ink-3">{t(lang, "love_cards_imported_at", { date: importedAt(card) })}</span>
                  </span>

                  <span className="flex shrink-0 flex-col items-end gap-2 pt-1">
                    {confirming ? (
                      <div className="rounded-[var(--radius-sm)] bg-inset px-3 py-2 flex flex-col gap-2" role="alertdialog" aria-label={t(lang, "love_cards_delete_confirm_title")}>
                        <p className="text-[13px] font-semibold text-ink">{t(lang, "love_cards_delete_confirm_title")}</p>
                        <p className="text-[12px] leading-relaxed text-ink-3 max-w-[220px]">{t(lang, "love_cards_delete_confirm_note")}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="danger" onClick={() => removeCard(card.id)}>
                            {t(lang, "love_cards_delete_confirm_ok")}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)}>
                            {t(lang, "cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/love/play/card/${card.id}`}
                          className="press inline-flex min-h-10 items-center gap-1.5 rounded-full bg-ink text-paper px-4 text-[13px] font-medium"
                        >
                          <Play size={15} className="shrink-0" />
                          {t(lang, "love_cards_play")}
                        </Link>
                        <button
                          type="button"
                          onClick={() => exportCard(card)}
                          className="press inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line px-3 text-[12px] text-ink-2 hover:border-line-strong"
                        >
                          <Download size={14} className="shrink-0" />
                          {t(lang, "love_cards_export")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(card.id)}
                          aria-label={`${t(lang, "love_cards_delete")} · ${card.name}`}
                          className="press inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line px-3 text-[12px] text-danger hover:border-danger"
                        >
                          <Trash2 size={14} className="shrink-0" />
                          {t(lang, "love_cards_delete")}
                        </button>
                      </div>
                    )}
                  </span>
                </article>
              );
            })}
          </div>

          {cards.length > 0 && (
            <Link href="/love" className="press card card-link p-4 flex items-center gap-3">
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-[14px]">{t(lang, "love_cards_back_love")}</span>
              </span>
              <ArrowRight size={17} className="shrink-0 text-accent-deep" />
            </Link>
          )}
        </section>
      </Page>
    </Shell>
  );
}
