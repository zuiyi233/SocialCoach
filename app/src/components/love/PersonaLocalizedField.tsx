"use client";
import { useState } from "react";
import type { Lang, L } from "@/data/taxonomy";
import { t } from "@/lib/i18n";
import { isSingleLanguage, localizedFromSingle, preferLanguage } from "@/lib/love-persona";
import { useLang } from "@/store/useApp";

/**
 * 一个本地化字段的编辑控件（spec-love-persona §2 「单语卡用同一字符串填 zh/en，UI 标记『原文』，
 * 另给翻译按钮，不要伪造第二语言」）。
 *
 * 两种形态：
 *  - 未拆分（原文）：一个输入框同时写进 zh / en，旁边标「原文」；点「添加另一种语言」才展开双语。
 *  - 已拆分：中英各一个带 `<label>` 的输入框，各自独立；点「合并为原文」收回来。
 *
 * 这里**不接任何翻译服务**（组件不联网）：另一种语言由用户自己写，说明文案也这么讲。
 */
export interface PersonaLocalizedFieldProps {
  id: string;
  label: string;
  value: L;
  onChange: (value: L) => void;
  hint?: string;
  multiline?: boolean;
  rows?: number;
}

function FieldInput({
  id,
  label,
  value,
  onChange,
  multiline,
  rows,
  size,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  size?: string;
}) {
  const className =
    "min-h-11 w-full rounded-[var(--radius-sm)] border border-line bg-card px-3 py-2 text-[14px] leading-snug text-ink outline-none placeholder:text-ink-3 focus:border-ink-2";
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12px] text-ink-3">
        {label}
      </label>
      {multiline ? (
        <textarea id={id} value={value} rows={rows ?? 3} onChange={(e) => onChange(e.target.value)} className={`${className} resize-none`} />
      ) : (
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} className={className} />
      )}
      {size && <span className="num self-end text-[11px] text-ink-3">{size}</span>}
    </div>
  );
}

export function PersonaLocalizedField({ id, label, value, onChange, hint, multiline, rows }: PersonaLocalizedFieldProps) {
  const lang: Lang = useLang();
  // 初始拆分状态由值决定；之后由用户按钮驱动。输入框一度相等也不自动收回（否则刚拆分就回弹）。
  const [split, setSplit] = useState(!isSingleLanguage(value));
  const originalOnly = isSingleLanguage(value) && (value.zh.trim().length > 0 || value.en.trim().length > 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!split ? (
          <label htmlFor={id} className="text-[12px] text-ink-3">
            {label}
          </label>
        ) : (
          <span className="text-[12px] text-ink-3">{label}</span>
        )}
        {!split && originalOnly && (
          <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3" aria-label={t(lang, "love_persona_original_only")}>
            {t(lang, "love_persona_original")}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            if (split) {
              // 收回：以界面语言那一版为准，另一语言随之覆盖，绝不留下两半都半截。
              onChange(localizedFromSingle(preferLanguage(value, lang)));
              setSplit(false);
            } else {
              setSplit(true);
            }
          }}
          className="press ml-auto shrink-0 text-[11px] text-ink-2 underline"
        >
          {t(lang, split ? "love_persona_join" : "love_persona_split")}
        </button>
      </div>

      {hint && <p className="text-[11px] leading-relaxed text-ink-3">{hint}</p>}

      {!split ? (
        <FieldInput
          id={id}
          label={label}
          value={value.zh}
          onChange={(text) => onChange(localizedFromSingle(text))}
          multiline={multiline}
          rows={rows}
          size={`${value.zh.length}`}
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="text-[11px] leading-relaxed text-ink-3">{t(lang, "love_persona_translate_note")}</p>
          <FieldInput id={`${id}-zh`} label={t(lang, "love_persona_field_zh")} value={value.zh} onChange={(text) => onChange({ ...value, zh: text })} multiline={multiline} rows={rows} />
          <FieldInput id={`${id}-en`} label={t(lang, "love_persona_field_en")} value={value.en} onChange={(text) => onChange({ ...value, en: text })} multiline={multiline} rows={rows} />
        </div>
      )}
    </div>
  );
}