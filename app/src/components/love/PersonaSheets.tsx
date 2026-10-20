"use client";
import type { Lang } from "@/data/taxonomy";
import type { TKey } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { preferLanguage, type Persona } from "@/lib/love-persona";
import type { LovePersonaLinkReport } from "@/lib/love-persona-store";
import { Button, Sheet } from "@/components/ui";
import type { CoachCopyRow, ConflictContext, ConflictDecision } from "./persona-editor-logic";

/**
 * 编辑器的三个对话框（spec-love-persona §5、§7、§9）。
 * 每个都在动作前把「会发生什么」摆清楚：冲突给真选择、复制给字段清单、删除给关联报告。
 */

const MERGE_FIELD_LABEL: Record<string, TKey> = {
  name: "love_persona_f_name",
  bio: "love_persona_f_bio",
  personality: "love_persona_f_personality",
  goals: "love_persona_f_goals",
  boundaries: "love_persona_f_boundaries",
  preferences: "love_persona_f_preferences",
  speechStyle: "love_persona_f_speech",
  role: "love_persona_f_role",
  greetings: "love_persona_f_greetings",
  aliases: "love_persona_f_name",
  language: "love_persona_f_language",
  characterKey: "love_persona_f_role",
  appearance: "love_persona_f_appearance",
  voice: "love_persona_f_voice",
  storyConstraints: "love_persona_f_constraints",
  assets: "love_persona_f_appearance",
  tavern: "love_persona_f_bio",
  license: "source",
  source: "source",
};

function labelOf(field: string, lang: Lang): string {
  const key = MERGE_FIELD_LABEL[field];
  return key ? t(lang, key) : field;
}

/* ------------------------------------------------------------------ *
 * 冲突裁决
 * ------------------------------------------------------------------ */

export interface ConflictSheetProps {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  context: ConflictContext;
  /** 合并会采用的新版字段（来自 `mergePersona` 的 changes）。 */
  mergeFields: string[];
  onDecision: (decision: ConflictDecision) => void;
}

export function ConflictSheet({ open, onClose, lang, context, mergeFields, onDecision }: ConflictSheetProps) {
  const current = context.current;
  const incoming = context.incoming;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t(lang, current ? "love_persona_conflict_title" : "love_persona_import_collision_title")}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t(lang, "love_persona_conflict_cancel")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {current ? (
          <p className="text-[13px] leading-relaxed text-ink-2">
            {t(lang, "love_persona_conflict_body", { n: current.revision, m: incoming.revision })}
          </p>
        ) : (
          <p className="text-[13px] leading-relaxed text-ink-2">{t(lang, "love_persona_import_collision_body")}</p>
        )}

        {context.sameName.length > 0 && (
          <p className="text-[12px] leading-relaxed text-ink-3" role="note">
            {t(lang, "love_persona_conflict_samename", { n: context.sameName.length })}
          </p>
        )}

        {current && (
          <div className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-line bg-inset p-3">
            <p className="text-[12px] text-ink-3">{t(lang, "love_persona_conflict_merge")}</p>
            {mergeFields.length === 0 ? (
              <p className="text-[12px] text-ink-2">{t(lang, "love_persona_conflict_merge_none")}</p>
            ) : (
              <p className="text-[12px] leading-relaxed text-ink-2">
                {t(lang, "love_persona_conflict_merge_fields", { fields: mergeFields.map((field) => labelOf(field, lang)).join("、") })}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {current && (
            <>
              <Button variant="secondary" onClick={() => onDecision("keep")}>
                {t(lang, "love_persona_conflict_keep")}
              </Button>
              <Button variant="secondary" onClick={() => onDecision("replace")}>
                {t(lang, "love_persona_conflict_replace")}
              </Button>
              <Button variant="secondary" onClick={() => onDecision("merge")}>
                {t(lang, "love_persona_conflict_merge")}
              </Button>
            </>
          )}
          <Button variant="primary" onClick={() => onDecision("import-new")}>
            {t(lang, "love_persona_conflict_new")}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ *
 * 复制到教练档案
 * ------------------------------------------------------------------ */

export interface CoachCopySheetProps {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  rows: CoachCopyRow[];
  onConfirm: () => void;
}

export function CoachCopySheet({ open, onClose, lang, rows, onConfirm }: CoachCopySheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t(lang, "love_persona_coach_copy")}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t(lang, "cancel")}
          </Button>
          <Button onClick={onConfirm} disabled={rows.length === 0}>
            {t(lang, "love_persona_coach_copy_confirm")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] leading-relaxed text-ink-2">{t(lang, "love_persona_coach_copy_note")}</p>
        {rows.length === 0 ? (
          <p className="text-[13px] text-ink-3">{t(lang, "love_persona_coach_copy_empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.field} className="flex flex-col gap-0.5 rounded-[var(--radius-sm)] border border-line bg-card p-3">
                <span className="text-[12px] text-ink-3">
                  {t(lang, `love_persona_coach_copy_field_${row.field}` as TKey)}
                </span>
                <span className="break-words text-[13px] text-ink">
                  {row.field === "lang" ? t(lang, `love_persona_lang_${row.value}` as TKey) : row.value}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ *
 * 删除
 * ------------------------------------------------------------------ */

export interface DeleteSheetProps {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  persona: Persona;
  links: LovePersonaLinkReport;
  onConfirm: () => void;
}

export function DeleteSheet({ open, onClose, lang, persona, links, onConfirm }: DeleteSheetProps) {
  const count = links.seriesIds.length + links.scenarioIds.length;
  const name = preferLanguage(persona.name, lang).trim() || persona.id;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t(lang, "love_persona_delete_title")}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t(lang, "cancel")}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {t(lang, "love_persona_delete_confirm")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[14px] text-ink">{name}</p>
        {count === 0 ? (
          <p className="text-[13px] leading-relaxed text-ink-2">{t(lang, "love_persona_delete_nolinks")}</p>
        ) : (
          <p className="text-[13px] leading-relaxed text-ink-2" role="note">
            {t(lang, "love_persona_delete_links", {
              n: count,
              series: links.seriesIds.length,
              scenarios: links.scenarioIds.length,
            })}
          </p>
        )}
      </div>
    </Sheet>
  );
}