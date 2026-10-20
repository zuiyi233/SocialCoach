"use client";
import { useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { Lang } from "@/data/taxonomy";
import type { TKey } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import {
  LOVE_PERSONA_JSON_MAX_BYTES,
  classifyPersonaFile,
  importBasicPersonaJson,
  type Persona,
  type PersonaImportCarry,
  type PersonaImportNotice,
  type LovePersonaErrorCode,
} from "@/lib/love-persona";
import { readPersonaPack, type PersonaPackAssets } from "@/lib/love-persona-pack";
import { loveStudioOpenUrl } from "@/lib/love-studio-link";
import { Button } from "@/components/ui";

/**
 * 导入面板（spec-love-persona §4.2 导入 / §9 验收）。
 *
 * v1 只吃 `.scpersona` 与基础 JSON。PNG / 世界书 / 预设一律**不半成品解析**，
 * 直接给「去 Studio 完整导入」的引导与「先导出基础 JSON」的路。
 * 失败时保留原文件可重试（§9「导入失败保留原文件并可重试」）。
 */

const ERROR_KEYS: Record<LovePersonaErrorCode, TKey> = {
  "persona/bad-json": "love_persona_err_bad_json",
  "persona/bad-shape": "love_persona_err_bad_shape",
  "persona/bad-version": "love_persona_err_bad_version",
  "persona/text-too-long": "love_persona_err_text_too_long",
  "persona/too-large": "love_persona_err_too_large",
  "persona/asset-too-large": "love_persona_err_asset_too_large",
  "persona/asset-budget": "love_persona_err_asset_budget",
  "persona/unsupported": "love_persona_err_unsupported",
  "persona/pack-unreadable": "love_persona_err_pack_unreadable",
  "persona/pack-missing": "love_persona_err_pack_missing",
  "persona/pack-manifest": "love_persona_err_pack_manifest",
  "persona/pack-hash": "love_persona_err_pack_hash",
  "persona/pack-too-large": "love_persona_err_pack_too_large",
};

function decodeJson(bytes: Uint8Array): unknown | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface PersonaImportPanelProps {
  lang: Lang;
  onPersona: (persona: Persona, notices: PersonaImportNotice[], assets?: PersonaPackAssets) => void;
}

export function PersonaImportPanel({ lang, onPersona }: PersonaImportPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [error, setError] = useState<TKey | null>(null);
  const [studioCarries, setStudioCarries] = useState<PersonaImportCarry[] | null>(null);

  const attempt = async (file: File) => {
    setError(null);
    setStudioCarries(null);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      setError("love_persona_err_unknown");
      return;
    }

    const cls = classifyPersonaFile({ name: file.name, bytes });

    if (cls.kind === "scpersona") {
      const read = readPersonaPack(bytes);
      if (!read.ok) {
        setError(ERROR_KEYS[read.code]);
        return;
      }
      onPersona(read.pack.persona, [], read.pack.assets);
      return;
    }

    if (cls.kind === "tavern-card" || cls.kind === "world-book" || cls.kind === "preset") {
      // 完整 Tavern 制品：只报去哪做，不解析字段。
      const carries: PersonaImportCarry[] =
        cls.kind === "world-book" ? ["worldbook"] : cls.kind === "preset" ? ["preset"] : [];
      setStudioCarries(carries);
      return;
    }

    // 基础 JSON 路径：JPEG/PNG 已在上面拦掉，这里只剩 JSON 或未知。
    if (bytes.length > LOVE_PERSONA_JSON_MAX_BYTES) {
      setError("love_persona_err_too_large");
      return;
    }
    const json = decodeJson(bytes);
    if (json === null) {
      setError("love_persona_err_bad_json");
      return;
    }
    const imported = importBasicPersonaJson(json, { sourceFile: file.name });
    if (!imported.ok) {
      if (imported.guide === "studio") {
        setStudioCarries([]);
        return;
      }
      setError(ERROR_KEYS[imported.code]);
      return;
    }
    onPersona(imported.persona, imported.notices);
  };

  const onPick = (file: File | undefined) => {
    if (!file) return;
    setLastFile(file);
    void attempt(file);
  };

  return (
    <section aria-label={t(lang, "love_persona_import")} className="card p-5 flex flex-col gap-4">
      <div>
        <h2 className="display text-[18px]">{t(lang, "love_persona_import")}</h2>
        <p className="text-[12px] text-ink-3 mt-1">{t(lang, "love_persona_import_hint")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".scpersona,.json,.png,.jpg,.jpeg,.gif,.webp"
          aria-label={t(lang, "love_persona_import_pick")}
          className="sr-only"
          onChange={(e) => {
            onPick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
          {t(lang, "love_persona_import_pick")}
        </Button>
        {lastFile && (
          <span className="text-[11px] text-ink-3" aria-live="polite">
            {lastFile.name}
          </span>
        )}
      </div>

      {error && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] bg-danger-soft px-3 py-2.5" role="alert">
          <p className="text-[12.5px] text-danger">{t(lang, error)}</p>
          <p className="text-[11px] text-danger">{t(lang, "love_persona_import_failed")}</p>
          {lastFile && (
            <div>
              <Button size="sm" variant="danger" onClick={() => void attempt(lastFile)}>
                {t(lang, "love_persona_import_retry")}
              </Button>
            </div>
          )}
        </div>
      )}

      {studioCarries && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-dashed border-line-strong p-4" role="status">
          <div>
            <h3 className="font-semibold text-[14px]">{t(lang, "love_persona_studio_guide_title")}</h3>
            <p className="text-[12px] leading-relaxed text-ink-2 mt-1">{t(lang, "love_persona_studio_guide_body")}</p>
          </div>
          {studioCarries.length > 0 && (
            <p className="text-[12px] text-ink-3">
              {t(lang, "love_persona_import_carries", {
                what: studioCarries.map((carry) => t(lang, `love_persona_carry_${carry}` as TKey)).join(" / "),
              })}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => window.open(loveStudioOpenUrl(), "_blank", "noopener,noreferrer")}>
              {t(lang, "love_persona_studio_open")}
              <ExternalLink size={14} />
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-3">{t(lang, "love_persona_basic_json_path")}</p>
        </div>
      )}
    </section>
  );
}