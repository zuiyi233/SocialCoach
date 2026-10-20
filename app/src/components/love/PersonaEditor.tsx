"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "@/data/taxonomy";
import type { TKey } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { uid } from "@/lib/format";
import {
  LOVE_PERSONA_ERROR,
  createEmptyPersona,
  parsePersona,
  type Persona,
  type PersonaKind,
} from "@/lib/love-persona";
import type { PersonaPackAssets } from "@/lib/love-persona-pack";
import {
  buildCoachProfilePatch,
  clearPersonaDraft,
  copyLovePersonaToCoachProfile,
  deleteLovePersona,
  findPersonaLinkReport,
  listLovePersonas,
  readLovePersonaStore,
  readPersonaDraft,
  savePersonaDraft,
  setActivePlayer,
  upsertLovePersona,
  type LovePersonaLinkReport,
} from "@/lib/love-persona-store";
import { Button } from "@/components/ui";
import { useApp } from "@/store/useApp";
import {
  coachCopyRows,
  mergePersona,
  personaSaveBlocked,
  previewName,
  resolveConflict,
  sameNameCollisions,
  type ConflictContext,
  type ConflictDecision,
} from "./persona-editor-logic";
import { PersonaExportPanel } from "./PersonaExportPanel";
import { PersonaForm } from "./PersonaForm";
import { PersonaImportPanel } from "./PersonaImportPanel";
import { PersonaLibrary } from "./PersonaLibrary";
import { PersonaPreview } from "./PersonaPreview";
import { CoachCopySheet, ConflictSheet, DeleteSheet } from "./PersonaSheets";

/**
 * 聚焦人设编辑器（spec-love-persona §4.2 的全部，不多不少）。
 *
 * 状态纪律：
 * - 所有设备读取都在挂载后（`localStorage` 服务端没有，同步读会 hydration 不一致）；
 * - 写入带 `expectedRevision`，磁盘被别的标签页改动就报冲突、刷新，不静默覆盖；
 * - 草稿落 sessionStorage，刷新可续（§9）；
 * - 唯一跨表动作是用户确认的「复制到教练档案」——本组件不自动同步任何方向（§7）。
 */

type Notice = { key: TKey; kind: "info" | "error"; vars?: Record<string, string | number> };

type StoreStatus = "ok" | "empty" | "corrupt" | "incompatible" | "unavailable";

export function PersonaEditor({ lang }: { lang: Lang }) {
  const updateProfile = useApp((s) => s.updateProfile);
  const profile = useApp((s) => s.profile);

  const [ready, setReady] = useState(false);
  const [persona, setPersona] = useState<Persona>(() => createEmptyPersona("npc"));
  const [refImage, setRefImage] = useState<string | null>(null);
  const [library, setLibrary] = useState<Persona[]>([]);
  const [activePlayerId, setActivePlayerId] = useState<string | undefined>(undefined);
  const [storageStatus, setStorageStatus] = useState<StoreStatus | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [links, setLinks] = useState<LovePersonaLinkReport>({ seriesIds: [], scenarioIds: [] });
  const [conflict, setConflict] = useState<ConflictContext | null>(null);
  const [mergeFields, setMergeFields] = useState<string[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ persona: Persona; links: LovePersonaLinkReport } | null>(null);

  const revisionRef = useRef(0);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const touched = useRef(false);
  const draftWarned = useRef(false);
  const pending = useRef<{ ref: string | null; notices: { carries?: string[] } }>({ ref: null, notices: {} });

  const refreshLibrary = useCallback(() => {
    const store = readLovePersonaStore();
    if (store.status === "ok") {
      revisionRef.current = store.store.revision;
      setLibrary(listLovePersonas());
      setActivePlayerId(store.store.activePlayerId);
      setStorageStatus("ok");
    } else if (store.status === "empty") {
      revisionRef.current = 0;
      setLibrary([]);
      setActivePlayerId(undefined);
      setStorageStatus("empty");
    } else {
      setStorageStatus(store.status);
    }
  }, []);

  // 挂载后才读设备：草稿、库、引用报告。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshLibrary();
      const draft = readPersonaDraft();
      if (draft) {
        touched.current = true;
        setPersona(draft.persona);
        setDirty(true);
        const editorRef =
          draft.editor && typeof draft.editor === "object" && typeof (draft.editor as { refImage?: unknown }).refImage === "string"
            ? ((draft.editor as { refImage: string }).refImage)
            : null;
        setRefImage(editorRef);
        setNotice({ key: "love_persona_draft_restored", kind: "info" });
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshLibrary]);

  // 引用报告只在挂载后算（服务端没有存储）。
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => setLinks(findPersonaLinkReport(persona)), 0);
    return () => window.clearTimeout(timer);
  }, [ready, persona]);

  // 草稿：只在动过之后写，避免只是打开页面就留下一份草稿。
  useEffect(() => {
    if (!ready || !touched.current) return;
    const ok = savePersonaDraft({ kind: persona.kind, persona, editor: { refImage }, updatedAt: Date.now() });
    if (!ok && !draftWarned.current) {
      draftWarned.current = true;
      setNotice({ key: "pr_draft_unsaved", kind: "error" });
    }
  }, [ready, persona, refImage]);

  const edit = useCallback((patch: Partial<Persona>) => {
    touched.current = true;
    setDirty(true);
    setPersona((prev) => ({ ...prev, ...patch, updatedAt: Date.now() }));
  }, []);

  const loadIntoEditor = useCallback((next: Persona, ref: string | null, base: string | null) => {
    touched.current = false;
    setPersona(next);
    setRefImage(ref);
    setBaselineId(base);
    setDirty(false);
    clearPersonaDraft();
  }, []);

  const applyFailure = useCallback(
    (reason: "conflict" | "quota" | "unavailable" | "invalid", diskRevision?: number) => {
      if (reason === "conflict") {
        if (typeof diskRevision === "number") revisionRef.current = diskRevision;
        refreshLibrary();
        setNotice({ key: "love_persona_save_conflict", kind: "error" });
        return;
      }
      if (reason === "quota") setNotice({ key: "love_persona_save_quota", kind: "error" });
      else if (reason === "unavailable") setNotice({ key: "love_persona_storage_unavailable", kind: "error" });
      else setNotice({ key: "love_persona_storage_invalid", kind: "error" });
    },
    [refreshLibrary],
  );

  /** 真正落盘。`refFor` 决定这次写进去的参考图；不吃旧状态，避免张冠李戴。 */
  const commit = useCallback(
    (next: Persona, refFor: string | null, carries?: string[]): boolean => {
      const result = upsertLovePersona(next, {
        expectedRevision: revisionRef.current,
        assets: refFor ? { ref: refFor } : undefined,
      });
      if (!result.ok) {
        applyFailure(result.reason, result.diskRevision);
        return false;
      }
      revisionRef.current = result.store.revision;
      setBaselineId(next.id);
      refreshLibrary();
      clearPersonaDraft();
      touched.current = false;
      setDirty(false);
      if (result.warnings.some((w) => w.code === "assets-dropped")) {
        setNotice({ key: "love_persona_assets_dropped", kind: "info" });
      } else if (carries && carries.length) {
        setNotice({ key: "love_persona_import_carries", kind: "info", vars: { what: carries.join(" / ") } });
      } else {
        setNotice({ key: "love_persona_saved", kind: "info" });
      }
      return true;
    },
    [applyFailure, refreshLibrary],
  );

  const save = useCallback(() => {
    if (personaSaveBlocked(persona)) {
      setNotice({ key: "love_persona_name_required", kind: "error" });
      return;
    }
    const parsed = parsePersona(persona);
    if (!parsed.ok) {
      setNotice({ key: parsed.code === LOVE_PERSONA_ERROR.textTooLong ? "love_persona_err_text_too_long" : "love_persona_err_bad_shape", kind: "error" });
      return;
    }
    const stored = parsed.persona;
    if (stored.id !== persona.id) setPersona(stored);
    const existing = library.find((p) => p.id === stored.id) ?? null;
    if (existing && existing.id !== baselineId) {
      setConflict({ current: existing, incoming: stored, sameName: sameNameCollisions(stored, library) });
      setMergeFields(mergePersona(existing, stored).changes.map((change) => change.field));
      pending.current = { ref: refImage, notices: {} };
      return;
    }
    commit(stored, refImage);
  }, [persona, library, refImage, baselineId, commit]);

  const onImported = useCallback(
    (incoming: Persona, notices: { code: string; carries?: string[] }[], assets?: PersonaPackAssets) => {
      const ref = assets?.refs?.ref ?? null;
      const carries = notices.flatMap((n) => n.carries ?? []);
      const existing = library.find((p) => p.id === incoming.id) ?? null;
      const sameName = sameNameCollisions(incoming, library);
      if (existing || sameName.length) {
        pending.current = { ref, notices: { carries } };
        setConflict({ current: existing, incoming, sameName });
        setMergeFields(existing ? mergePersona(existing, incoming).changes.map((change) => change.field) : []);
        return;
      }
      if (commit(incoming, ref, carries)) loadIntoEditor(incoming, ref, incoming.id);
    },
    [library, commit, loadIntoEditor],
  );

  const onConflictDecision = useCallback(
    (decision: ConflictDecision) => {
      const context = conflict;
      setConflict(null);
      if (!context) return;
      const outcome = resolveConflict(context, decision, uid());
      if (!outcome.ok) {
        setNotice({ key: "love_persona_save_failed", kind: "error" });
        return;
      }
      if (!outcome.write) return; // 保留当前：什么都不动
      const ref = pending.current.ref;
      const carries = pending.current.notices.carries ?? [];
      if (commit(outcome.write, ref, carries)) loadIntoEditor(outcome.write, ref, outcome.write.id);
    },
    [conflict, commit, loadIntoEditor],
  );

  const selectPersona = useCallback(
    (next: Persona) => {
      const store = readLovePersonaStore();
      const ref = store.status === "ok" ? (store.store.assets?.[next.id]?.ref ?? null) : null;
      loadIntoEditor(next, ref, next.id);
      setNotice(null);
    },
    [loadIntoEditor],
  );

  const newPersona = useCallback(
    (kind: PersonaKind) => {
      loadIntoEditor(createEmptyPersona(kind), null, null);
      setNotice(null);
    },
    [loadIntoEditor],
  );

  const onSetActive = useCallback(
    (next: Persona) => {
      const result = setActivePlayer(next.id, revisionRef.current);
      if (!result.ok) {
        applyFailure(result.reason, result.diskRevision);
        return;
      }
      revisionRef.current = result.store.revision;
      refreshLibrary();
    },
    [applyFailure, refreshLibrary],
  );

  const requestDelete = useCallback((target: Persona) => {
    setDeleteTarget({ persona: target, links: findPersonaLinkReport(target) });
  }, []);

  const confirmDelete = useCallback(() => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    const result = deleteLovePersona(target.persona.id, revisionRef.current);
    if (!result.ok) {
      applyFailure(result.reason, result.diskRevision);
      return;
    }
    revisionRef.current = result.store.revision;
    refreshLibrary();
    if (persona.id === target.persona.id) loadIntoEditor(createEmptyPersona(target.persona.kind), null, null);
    setNotice({ key: "love_persona_deleted", kind: "info" });
  }, [deleteTarget, persona.id, applyFailure, refreshLibrary, loadIntoEditor]);

  const coachRows = useMemo(() => (persona.kind === "player" ? coachCopyRows(buildCoachProfilePatch(persona)) : []), [persona]);

  const confirmCoachCopy = useCallback(() => {
    setCopyOpen(false);
    const result = copyLovePersonaToCoachProfile(persona, {
      confirmed: true,
      apply: (patch) => updateProfile(patch),
    });
    if (result.ok) setNotice({ key: "love_persona_coach_copy_done", kind: "info" });
    else setNotice({ key: result.code === "empty" ? "love_persona_coach_copy_empty" : "love_persona_save_failed", kind: "error" });
  }, [persona, updateProfile]);

  const writable = storageStatus === null || storageStatus === "ok" || storageStatus === "empty";
  const title = dirty || !baselineId ? t(lang, "love_persona_new_unsaved") : previewName(persona, lang);

  return (
    <div className="flex flex-col gap-7 lg:gap-9">
      {(storageStatus === "corrupt" || storageStatus === "incompatible") && (
        <p role="alert" className="card p-4 text-[13px] text-danger">
          {t(lang, "love_persona_storage_invalid")}
        </p>
      )}
      {storageStatus === "unavailable" && (
        <p role="alert" className="card p-4 text-[13px] text-danger">
          {t(lang, "love_persona_storage_unavailable")}
        </p>
      )}

      <PersonaLibrary
        personas={library}
        activePlayerId={activePlayerId}
        currentId={persona.id}
        lang={lang}
        onSelect={selectPersona}
        onNewPlayer={() => newPersona("player")}
        onNewNpc={() => newPersona("npc")}
        onSetActive={onSetActive}
      />

      {/* 编辑区 */}
      <section aria-label={t(lang, "love_persona_edit")} className="card p-5 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2 pb-4 border-b border-line">
          <h2 className="display text-[18px]">{title}</h2>
          <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3">
            {t(lang, persona.kind === "player" ? "love_persona_kind_player" : "love_persona_kind_npc")}
          </span>
          {dirty && (
            <span className="rounded-full border border-accent-soft px-2 py-0.5 text-[10px] text-accent-deep">{t(lang, "love_persona_unsaved")}</span>
          )}
          <span className="num ml-auto break-all text-[10px] text-ink-3">{t(lang, "love_persona_id_label", { id: persona.id })}</span>
        </div>

        <PersonaForm key={`${persona.id}:${baselineId ?? "new"}`} persona={persona} kind={persona.kind} lang={lang} onChange={edit} refImage={refImage} onRefImage={setRefImage} onRefImageError={() => setNotice({ key: "love_persona_err_unknown", kind: "error" })} />

        {notice && (
          <p role="status" aria-live="polite" className={`text-[12.5px] ${notice.kind === "error" ? "text-danger" : "text-ink-2"}`}>
            {t(lang, notice.key, notice.vars)}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-line">
          <Button onClick={save} disabled={!writable}>
            {t(lang, "love_persona_save")}
          </Button>
          <Button variant="secondary" onClick={() => setCopyOpen(true)} disabled={persona.kind !== "player" || !profile}>
            {t(lang, "love_persona_coach_copy")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              clearPersonaDraft();
              touched.current = false;
              newPersona(persona.kind);
            }}
          >
            {t(lang, "love_persona_discard_draft")}
          </Button>
          <Button variant="danger" className="ml-auto" onClick={() => requestDelete(persona)} disabled={!writable}>
            {t(lang, "love_persona_delete")}
          </Button>
        </div>

        {persona.kind === "player" && !profile && <p className="text-[11px] text-ink-3">{t(lang, "love_persona_coach_no_profile")}</p>}
        {persona.kind === "npc" && <p className="text-[11px] text-ink-3">{t(lang, "love_persona_coach_npc")}</p>}
        <p className="text-[11px] leading-relaxed text-ink-3">{t(lang, "love_persona_coach_copy_note")}</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <PersonaPreview persona={persona} lang={lang} refImage={refImage} links={links} />
        <div className="flex flex-col gap-4">
          <PersonaImportPanel lang={lang} onPersona={onImported} />
          <PersonaExportPanel persona={persona} lang={lang} refImage={refImage} />
        </div>
      </div>

      <ConflictSheet open={!!conflict} onClose={() => setConflict(null)} lang={lang} context={conflict ?? { current: null, incoming: persona, sameName: [] }} mergeFields={mergeFields} onDecision={onConflictDecision} />
      <CoachCopySheet open={copyOpen} onClose={() => setCopyOpen(false)} lang={lang} rows={coachRows} onConfirm={confirmCoachCopy} />
      <DeleteSheet open={!!deleteTarget} onClose={() => setDeleteTarget(null)} lang={lang} persona={deleteTarget?.persona ?? persona} links={deleteTarget?.links ?? { seriesIds: [], scenarioIds: [] }} onConfirm={confirmDelete} />
    </div>
  );
}