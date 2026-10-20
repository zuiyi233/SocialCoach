"use client";
import { useMemo, useState } from "react";
import type { Lang } from "@/data/taxonomy";
import type { TKey } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import type { Persona } from "@/lib/love-persona";
import { buildPersonaPack } from "@/lib/love-persona-pack";
import { Button } from "@/components/ui";
import { personaFileName, personaToBasicJson, summarizeExport } from "./persona-editor-logic";

/**
 * 导出面板（spec-love-persona §2.1、§4.2、§9）。
 * 下载前先摆清楚「会包含什么」；可勾「公开导出」剥掉 `storyConstraints.secret`。
 * 另给基础 JSON 出口，只映射 `importBasicPersonaJson` 认得的核心字段。
 */

const INCLUDE_LABEL: Record<string, TKey> = {
  name: "love_persona_f_name",
  bio: "love_persona_f_bio",
  personality: "love_persona_f_personality",
  goals: "love_persona_f_goals",
  boundaries: "love_persona_f_boundaries",
  preferences: "love_persona_f_preferences",
  speechStyle: "love_persona_f_speech",
  role: "love_persona_f_role",
  language: "love_persona_f_language",
  greetings: "love_persona_f_greetings",
  appearance: "love_persona_f_appearance",
  voice: "love_persona_f_voice",
  "storyConstraints.goal": "love_persona_f_goal",
  "storyConstraints.redLine": "love_persona_f_redline",
  "storyConstraints.secret": "love_persona_f_secret",
};

function download(bytes: Uint8Array, filename: string, mime: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadText(text: string, filename: string, mime: string) {
  download(new TextEncoder().encode(text), filename, mime);
}

export interface PersonaExportPanelProps {
  persona: Persona;
  lang: Lang;
  refImage: string | null;
}

export function PersonaExportPanel({ persona, lang, refImage }: PersonaExportPanelProps) {
  const [publicOnly, setPublicOnly] = useState(false);
  const [notice, setNotice] = useState<TKey | null>(null);

  const summary = useMemo(
    () => summarizeExport(persona, publicOnly, !!refImage, persona.assets?.portraits ? Object.keys(persona.assets.portraits).length : 0),
    [persona, publicOnly, refImage],
  );

  const included = useMemo(() => {
    const rows = summary.fields.map((field) => t(lang, INCLUDE_LABEL[field] ?? "love_persona_f_name"));
    if (summary.worldbookEntries > 0) rows.push(t(lang, "love_persona_export_worldbook", { n: summary.worldbookEntries }));
    if (summary.hasStyle) rows.push(t(lang, "love_persona_export_style"));
    if (summary.hasRefImage) rows.push(t(lang, "love_persona_export_image"));
    if (summary.portraitCount > 0) rows.push(t(lang, "love_persona_export_portraits", { n: summary.portraitCount }));
    return rows;
  }, [summary, lang]);

  const exportPack = () => {
    const built = buildPersonaPack(persona, {
      publicOnly,
      assets: refImage ? { refs: { ref: refImage } } : undefined,
    });
    if (!built.ok) {
      setNotice("love_persona_export_failed");
      return;
    }
    download(built.bytes, personaFileName(persona, lang, "scpersona"), "application/zip");
    setNotice("love_persona_export_ready");
  };

  const exportJson = () => {
    downloadText(JSON.stringify(personaToBasicJson(persona, lang), null, 2), personaFileName(persona, lang, "json"), "application/json");
    setNotice("love_persona_export_ready_json");
  };

  return (
    <section aria-label={t(lang, "love_persona_export")} className="card p-5 flex flex-col gap-4">
      <div>
        <h2 className="display text-[18px]">{t(lang, "love_persona_export")}</h2>
        <p className="text-[12px] text-ink-3 mt-1">{t(lang, "love_persona_export_included")}</p>
      </div>

      <ul className="flex flex-wrap gap-1.5" aria-label={t(lang, "love_persona_export_included")}>
        {included.length === 0 && <li className="text-[12px] text-ink-3">{t(lang, "love_persona_export_none")}</li>}
        {included.map((label, i) => (
          <li key={`${label}-${i}`} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">
            {label}
          </li>
        ))}
      </ul>

      {persona.storyConstraints?.secret && (
        <p className="text-[11px] leading-relaxed text-ink-3">
          {t(lang, "love_persona_export_secret")}
        </p>
      )}

      <label className="flex items-start gap-2 text-[13px] text-ink-2">
        <input type="checkbox" checked={publicOnly} onChange={(e) => setPublicOnly(e.target.checked)} className="mt-0.5 h-4 w-4" />
        <span className="flex flex-col gap-0.5">
          <span>{t(lang, "love_persona_export_public")}</span>
          <span className="text-[11px] leading-relaxed text-ink-3">{t(lang, "love_persona_export_public_note")}</span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={exportPack}>
          {t(lang, "love_persona_export_pack")}
        </Button>
        <Button size="sm" variant="secondary" onClick={exportJson}>
          {t(lang, "love_persona_export_json")}
        </Button>
      </div>

      {notice && (
        <p role="status" aria-live="polite" className="text-[12px] text-ink-2">
          {t(lang, notice)}
        </p>
      )}
    </section>
  );
}