"use client";
import { useId, useRef } from "react";
import type { Lang } from "@/data/taxonomy";
import type { TKey } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { localizedFromSingle, type Persona, type PersonaKind, type PersonaLanguage } from "@/lib/love-persona";
import { Button } from "@/components/ui";
import { Avatar } from "@/components/ui";
import { fieldsForKind, type PersonaFieldKey } from "./persona-editor-logic";
import { PersonaLocalizedField } from "./PersonaLocalizedField";

/**
 * 玩家 / 角色人设的聚焦表单（spec-love-persona §4.2）。
 * 字段面严格等于 §4.2：玩家（名字/语言/简介/目标/边界/偏好/外观/声线），
 * 角色（名字/定位/公开简介/性格/说话风格/外观/声线 + 可选 goal/redLine/secret）。
 */

const FIELD_LABEL: Record<PersonaFieldKey, TKey> = {
  name: "love_persona_f_name",
  language: "love_persona_f_language",
  bio: "love_persona_f_bio",
  goals: "love_persona_f_goals",
  boundaries: "love_persona_f_boundaries",
  preferences: "love_persona_f_preferences",
  personality: "love_persona_f_personality",
  speechStyle: "love_persona_f_speech",
  role: "love_persona_f_role",
  appearance: "love_persona_f_appearance",
  voice: "love_persona_f_voice",
  greetings: "love_persona_f_greetings",
  storyConstraints: "love_persona_f_constraints",
};

/** 直接写进 persona 顶层的本地化字段。 */
const LOC_KEYS = ["name", "bio", "goals", "boundaries", "preferences", "personality", "speechStyle", "role"] as const;
type LocKey = (typeof LOC_KEYS)[number];

function isLocKey(key: PersonaFieldKey): key is LocKey {
  return (LOC_KEYS as readonly string[]).includes(key);
}

const LANGUAGES: readonly (PersonaLanguage | "none")[] = ["none", "zh", "en", "ja", "other"];
const PROVIDERS = ["none", "device", "studio", "external"] as const;

export interface PersonaFormProps {
  persona: Persona;
  kind: PersonaKind;
  lang: Lang;
  onChange: (patch: Partial<Persona>) => void;
  refImage: string | null;
  onRefImage: (dataUrl: string | null) => void;
  /** 参考图读取失败（不是图片 / 读不出来）时的回调，交给编排层提示。 */
  onRefImageError?: () => void;
}

const inputClass =
  "min-h-11 w-full rounded-[var(--radius-sm)] border border-line bg-card px-3 py-2 text-[14px] leading-snug text-ink outline-none placeholder:text-ink-3 focus:border-ink-2";

export function PersonaForm({ persona, kind, lang, onChange, refImage, onRefImage, onRefImageError }: PersonaFormProps) {
  const baseId = useId();
  const refInput = useRef<HTMLInputElement>(null);
  const fields = fieldsForKind(kind);
  const hue = persona.appearance?.hue ?? 40;

  const locField = (key: LocKey) => {
    const labelKey: TKey = key === "bio" && kind === "player" ? "love_persona_f_bio_player" : FIELD_LABEL[key];
    return (
      <PersonaLocalizedField
        key={key}
        id={`${baseId}-${key}`}
        label={t(lang, labelKey)}
        value={persona[key] ?? localizedFromSingle("")}
        onChange={(v) => onChange({ [key]: v } as Partial<Persona>)}
        multiline={key !== "name"}
        rows={key === "name" ? undefined : key === "bio" ? 4 : 2}
      />
    );
  };

  const greetingRows = (persona.greetings ?? []).map((g, i) => (
    <div key={i} className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <PersonaLocalizedField
          id={`${baseId}-greeting-${i}`}
          label={t(lang, "love_persona_f_greeting_n", { n: i + 1 })}
          value={g}
          onChange={(v) => {
            const next = [...(persona.greetings ?? [])];
            next[i] = v;
            onChange({ greetings: next });
          }}
          multiline
          rows={2}
        />
      </div>
      <button
        type="button"
        aria-label={t(lang, "love_persona_f_greeting_remove")}
        title={t(lang, "love_persona_f_greeting_remove")}
        onClick={() => onChange({ greetings: (persona.greetings ?? []).filter((_, j) => j !== i) })}
        className="press mt-6 h-11 w-11 shrink-0 rounded-full border border-line text-[13px] text-ink-3 hover:border-line-strong"
      >
        ✕
      </button>
    </div>
  ));

  const pickRefImage = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") onRefImage(result);
      else onRefImageError?.();
    };
    reader.onerror = () => onRefImageError?.();
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-5">
      {fields.map((key) => {
        if (isLocKey(key)) return locField(key);

        if (key === "language") {
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <label htmlFor={`${baseId}-language`} className="text-[12px] text-ink-3">
                {t(lang, FIELD_LABEL.language)}
              </label>
              <select
                id={`${baseId}-language`}
                value={persona.language ?? "none"}
                onChange={(e) => {
                  const value = e.target.value;
                  onChange({ language: value === "none" ? undefined : (value as PersonaLanguage) });
                }}
                className={inputClass}
              >
                {LANGUAGES.map((value) => (
                  <option key={value} value={value}>
                    {t(lang, `love_persona_lang_${value}` as TKey)}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        if (key === "appearance") {
          return (
            <fieldset key={key} className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-line p-4">
              <legend className="px-1 text-[12px] text-ink-3">{t(lang, FIELD_LABEL.appearance)}</legend>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${baseId}-appearance-text`} className="text-[12px] text-ink-3">
                  {t(lang, "love_persona_f_appearance_text")}
                </label>
                <textarea
                  id={`${baseId}-appearance-text`}
                  rows={2}
                  value={persona.appearance?.text ?? ""}
                  onChange={(e) => onChange({ appearance: { ...persona.appearance, text: e.target.value } })}
                  className={`${inputClass} resize-none`}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Avatar name={persona.name.zh || persona.name.en || "?"} hue={hue} seed={persona.id} size={40} imageData={refImage ?? undefined} />
                <div className="flex-1 min-w-[12rem] flex flex-col gap-1.5">
                  <label htmlFor={`${baseId}-hue`} className="text-[12px] text-ink-3">
                    {t(lang, "love_persona_f_hue")}
                  </label>
                  <input
                    id={`${baseId}-hue`}
                    type="range"
                    min={0}
                    max={360}
                    step={1}
                    value={hue}
                    onChange={(e) => onChange({ appearance: { ...persona.appearance, hue: Number(e.target.value) } })}
                    className="w-full"
                  />
                </div>
                <span className="num text-[11px] text-ink-3">{hue}°</span>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-[12px] text-ink-3">{t(lang, "love_persona_f_ref_image")}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={refInput}
                    id={`${baseId}-ref`}
                    type="file"
                    accept="image/*"
                    aria-label={t(lang, "love_persona_f_ref_image")}
                    className="sr-only"
                    onChange={(e) => pickRefImage(e.target.files?.[0])}
                  />
                  <Button size="sm" variant="secondary" onClick={() => refInput.current?.click()}>
                    {t(lang, "love_persona_f_ref_pick")}
                  </Button>
                  {refImage && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- local raster data only */}
                      <img src={refImage} alt={t(lang, "love_persona_f_ref_alt")} className="h-11 w-11 rounded-[var(--radius-sm)] object-cover" />
                      <Button size="sm" variant="ghost" onClick={() => onRefImage(null)}>
                        {t(lang, "love_persona_f_ref_clear")}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </fieldset>
          );
        }

        if (key === "voice") {
          return (
            <fieldset key={key} className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-line p-4">
              <legend className="px-1 text-[12px] text-ink-3">{t(lang, FIELD_LABEL.voice)}</legend>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${baseId}-voice-provider`} className="text-[12px] text-ink-3">
                  {t(lang, "love_persona_f_voice_provider")}
                </label>
                <select
                  id={`${baseId}-voice-provider`}
                  value={persona.voice?.provider ?? "none"}
                  onChange={(e) => {
                    const value = e.target.value;
                    onChange({ voice: { ...persona.voice, provider: value === "none" ? undefined : (value as NonNullable<Persona["voice"]>["provider"]) } });
                  }}
                  className={inputClass}
                >
                  {PROVIDERS.map((value) => (
                    <option key={value} value={value}>
                      {t(lang, `love_persona_provider_${value}` as TKey)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${baseId}-voice-profile`} className="text-[12px] text-ink-3">
                  {t(lang, "love_persona_f_voice_profile")}
                </label>
                <input
                  id={`${baseId}-voice-profile`}
                  value={persona.voice?.profileId ?? ""}
                  onChange={(e) => onChange({ voice: { ...persona.voice, profileId: e.target.value } })}
                  className={inputClass}
                />
              </div>
            </fieldset>
          );
        }

        if (key === "greetings") {
          return (
            <fieldset key={key} className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-line p-4">
              <legend className="px-1 text-[12px] text-ink-3">{t(lang, FIELD_LABEL.greetings)}</legend>
              {greetingRows}
              {greetingRows.length === 0 && <p className="text-[12px] text-ink-3">{t(lang, "love_persona_preview_no_greetings")}</p>}
              <div>
                <Button size="sm" variant="secondary" onClick={() => onChange({ greetings: [...(persona.greetings ?? []), localizedFromSingle("")] })}>
                  {t(lang, "love_persona_f_greeting_add")}
                </Button>
              </div>
            </fieldset>
          );
        }

        // storyConstraints：半教练专用，默认不进 Tavern 原文
        return (
          <fieldset key={key} className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-dashed border-line-strong p-4">
            <legend className="px-1 text-[12px] text-ink-3">{t(lang, FIELD_LABEL.storyConstraints)}</legend>
            <p className="text-[11px] leading-relaxed text-ink-3">{t(lang, "love_persona_f_constraints_note")}</p>
            <PersonaLocalizedField
              id={`${baseId}-sc-goal`}
              label={t(lang, "love_persona_f_goal")}
              value={persona.storyConstraints?.goal ?? localizedFromSingle("")}
              onChange={(v) => onChange({ storyConstraints: { ...persona.storyConstraints, goal: v } })}
              multiline
              rows={2}
            />
            <PersonaLocalizedField
              id={`${baseId}-sc-redline`}
              label={t(lang, "love_persona_f_redline")}
              value={persona.storyConstraints?.redLine ?? localizedFromSingle("")}
              onChange={(v) => onChange({ storyConstraints: { ...persona.storyConstraints, redLine: v } })}
              multiline
              rows={2}
            />
            <PersonaLocalizedField
              id={`${baseId}-sc-secret`}
              label={t(lang, "love_persona_f_secret")}
              value={persona.storyConstraints?.secret ?? localizedFromSingle("")}
              onChange={(v) => onChange({ storyConstraints: { ...persona.storyConstraints, secret: v } })}
              multiline
              rows={2}
            />
          </fieldset>
        );
      })}
    </div>
  );
}