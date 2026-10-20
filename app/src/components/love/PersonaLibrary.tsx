"use client";
import type { Lang } from "@/data/taxonomy";
import { t } from "@/lib/i18n";
import { preferLanguage, type Persona } from "@/lib/love-persona";
import { Button, Empty } from "@/components/ui";
import { personaIdentityKey } from "./persona-editor-logic";

/**
 * 人设库列表（spec-love-persona §5）。身份按 `id` 并列，同名不同 id 只做视觉上的并列，
 * 绝不按显示名合并——所以这里每一行都显式标出 `id` 与 `characterPackId`。
 */
export function PersonaLibrary({
  personas,
  activePlayerId,
  currentId,
  lang,
  onSelect,
  onNewPlayer,
  onNewNpc,
  onSetActive,
}: {
  personas: Persona[];
  activePlayerId?: string;
  currentId: string;
  lang: Lang;
  onSelect: (persona: Persona) => void;
  onNewPlayer: () => void;
  onNewNpc: () => void;
  onSetActive: (persona: Persona) => void;
}) {
  const players = personas.filter((p) => p.kind === "player");
  const npcs = personas.filter((p) => p.kind === "npc");

  const row = (persona: Persona) => {
    const name = preferLanguage(persona.name, lang).trim() || (lang === "zh" ? "未命名" : "Untitled");
    const active = persona.id === currentId;
    return (
      <li key={persona.id} className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSelect(persona)}
          aria-current={active ? "true" : undefined}
          aria-label={`${t(lang, "love_persona_edit")} · ${name}`}
          className={`press flex-1 min-w-0 flex flex-col gap-0.5 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left ${
            active ? "border-ink-2 bg-inset" : "border-line bg-card hover:border-line-strong"
          }`}
        >
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-[14px] leading-snug">{name}</span>
            {activePlayerId === persona.id && (
              <span className="rounded-full border border-accent-soft px-1.5 py-0.5 text-[10px] text-accent-deep">{t(lang, "love_persona_active_player")}</span>
            )}
          </span>
          <span className="num break-all text-[10px] text-ink-3" title={personaIdentityKey(persona)}>
            {t(lang, "love_persona_id_label", { id: personaIdentityKey(persona) })} · {t(lang, "love_persona_revision_label", { n: persona.revision })}
          </span>
        </button>
        {persona.kind === "player" && activePlayerId !== persona.id && (
          <button
            type="button"
            onClick={() => onSetActive(persona)}
            className="press shrink-0 self-stretch rounded-[var(--radius-sm)] border border-line px-3 text-[11px] text-ink-3 hover:border-line-strong"
          >
            {t(lang, "love_persona_set_active")}
          </button>
        )}
      </li>
    );
  };

  return (
    <section aria-label={t(lang, "love_persona_library")} className="card p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="display text-[18px]">{t(lang, "love_persona_library")}</h2>
        <span className="num text-[12px] text-ink-3">{t(lang, "love_persona_library_count", { n: personas.length })}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onNewPlayer}>
          {t(lang, "love_persona_new_player")}
        </Button>
        <Button size="sm" variant="secondary" onClick={onNewNpc}>
          {t(lang, "love_persona_new_npc")}
        </Button>
      </div>

      {personas.length === 0 && <Empty title={t(lang, "love_persona_empty")} body="" />}

      {players.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-ink-3">{t(lang, "love_persona_kind_player")}</p>
          <ul className="flex flex-col gap-2">{players.map(row)}</ul>
        </div>
      )}

      {npcs.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-ink-3">{t(lang, "love_persona_kind_npc")}</p>
          <ul className="flex flex-col gap-2">{npcs.map(row)}</ul>
        </div>
      )}
    </section>
  );
}