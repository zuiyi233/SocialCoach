"use client";
import { useState } from "react";
import { BrandMark } from "./BrandMark";
import { LanguagePicker } from "./LanguagePicker";
import { Button, Sheet } from "./ui";
import { useApp, useLang } from "@/store/useApp";
import { t, pick } from "@/lib/i18n";
import { clearLovePlaySlots, LOVE_PLAY_PREFIX } from "@/lib/love-carry-store";

const resetFailed = {
  zh: "设备数据未能清除，请先导出备份再重试。",
  en: "Device data could not be cleared. Export a backup and try again.",
};

/** Do not silently reset unreadable practice records or leave a blank shell. */
export function StorageRecovery({ issue }: { issue: "unreadable" | "unavailable" }) {
  const lang = useLang();
  const conflict=useApp(s=>s.saveIssue==="conflict");
  const [backedUp, setBackedUp] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(false);
  const [resetError, setResetError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  /** 扫描 love 前缀的现存 key 数；读不了返回 null——「一条不剩」与「没法确认」必须分开。 */
  const countLovePlaySlots = () => {
    try {
      let count = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(LOVE_PLAY_PREFIX)) count++;
      }
      return count;
    } catch {
      return null;
    }
  };
  /** 主档 reset() 清不掉独立 love slot（G16）；先删并复验，删不干净就不宣称成功、不关确认层。 */
  const restart = () => {
    const before = countLovePlaySlots();
    clearLovePlaySlots();
    if (before === null || countLovePlaySlots() !== 0) {
      setResetError(true);
      return;
    }
    setResetError(false);
    useApp.getState().reset();
    setConfirm(false);
  };
  const backup = () => {
    try {
      const raw = localStorage.getItem("socialcoach.v1");
      if (raw === null) throw new Error("No raw backup available");
      const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "socialcoach-recovery.json";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setBackedUp(true);
      setError(false);
    } catch {
      setError(true);
    }
  };
  const retry = async () => {
    setRetrying(true);
    try { await useApp.persist.rehydrate(); }
    finally { setRetrying(false); }
  };
  return (
    <main className="min-h-dvh flex flex-col justify-center gap-6 px-5 py-12 max-w-[var(--dialog-max)] mx-auto">
      <div className="flex items-center justify-between gap-4">
        <BrandMark size={44} />
        <LanguagePicker lang={lang} onChange={useApp.getState().setLang} />
      </div>
      <header>
        <p className="eyebrow text-accent-deep mb-3">{t(lang, "app_name")}</p>
        <h1 className="display text-[28px] leading-snug">{t(lang, "storage_title")}</h1>
      </header>
      <p role="alert" className="text-[15px] text-ink-2 leading-relaxed">{t(lang, issue === "unreadable" ? "storage_unreadable" : "storage_unavailable")}</p>
      {issue === "unreadable" && <Button block onClick={backup}>{t(lang, "storage_backup")}</Button>}
      {error && <p role="alert" className="text-[13px] text-danger">{t(lang, "storage_backup_failed")}</p>}
      <Button block variant="secondary" onClick={retry} disabled={retrying}>{t(lang, "storage_retry")}</Button>
      {issue === "unreadable" && <>
        {backedUp && <p className="text-[13px] text-ink-3 leading-relaxed">{t(lang, "storage_backup_check")}</p>}
        <Button block variant="ghost" disabled={!backedUp||conflict} onClick={() => { setResetError(false); setConfirm(true); }}>{t(lang, "storage_restart")}</Button>
      </>}
      <Sheet open={confirm} onClose={() => setConfirm(false)} title={t(lang, "storage_restart")}>
        <div className="flex flex-col gap-4 pt-2">
          <p className="text-[14px] text-ink-2 leading-relaxed">{t(lang, "storage_reset_confirm")}</p>
          <Button block disabled={conflict} onClick={restart}>{t(lang, "storage_restart")}</Button>
          {resetError && <p role="alert" className="text-[13px] text-danger">{pick(resetFailed, lang)}</p>}
          <Button block variant="ghost" onClick={() => setConfirm(false)}>{t(lang, "cancel")}</Button>
        </div>
      </Sheet>
    </main>
  );
}
