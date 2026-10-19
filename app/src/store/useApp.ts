"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ContextId, Lang, SkillId } from "@/data/taxonomy";
import type { LoveTopicId } from "@/data/corpus/love-topics";
import type { Scenario } from "@/data/corpus/types";
import type { ChatMessage, Profile, Proficiency, Reflection, Report, Session } from "@/lib/types";
import type { PatternResult } from "@/lib/tasks/types";
import { DEVICE_KEY, OPEN_DAY_KEY } from "@/lib/analytics/keys";
import {parseArchive} from '@/lib/archive';
import {estimateProficiency} from '@/lib/proficiency';
import {appendLovePlayRecord, readLoveStoryStore, type LovePlayRecord} from '@/lib/love-story';
import {clearLovePlaySlots} from '@/lib/love-carry-store';
import {createArchiveStorage,type SaveIssue} from './archive-storage';

export type Theme = "system" | "light" | "dark";

/**
 * 「记入统计」的输入。`startedAt` 由开局方给出：剧情模式一局可能跨刷新，
 * 只有它知道这一局真正从哪一刻开始，store 不能再拿 `now` 伪造。
 */
export interface LovePlayCompletion {
  scenario: Scenario;
  outcome: "success" | "partial" | "failure";
  startedAt: number;
  endedAt?: number;
  lang: Lang;
  endingId?: string | null;
}

/**
 * 一条恋爱记录的确定性投影。id 只由场景与开局时间决定，所以双击或重进收尾页
 * 再点一次「记入统计」都会落到同一条上（`appendLovePlayRecord` 按 id 去重）。
 */
export function lovePlayRecordFor(input: LovePlayCompletion): LovePlayRecord {
  return {
    id: `${input.scenario.id}@${input.startedAt}`,
    scenarioId: input.scenario.id,
    seriesId: input.scenario.series?.id ?? null,
    outcome: input.outcome,
    endingId: input.endingId ?? null,
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? Date.now(),
    lang: input.lang,
  };
}

/**
 * 已经在内存里计入过增益的记录 id。落盘失败时 `records` 里没有这条，
 * 但玩家不该因为一次配额错误在重试时拿到第二份主题增益；这份名单不持久化，
 * 刷新后以磁盘上的 `records` 为准。
 */
const lovePlayApplied = new Set<string>();
const LOVE_PLAY_APPLIED_MAX = 200;

export interface Settings {
  tts: boolean;
  /** Natural streaming voice with a bounded wait; system voice needs no speech service. */
  voiceEngine?: "natural" | "system";
  /** "system" follows the OS; the other two pin it. */
  theme?: Theme;
  /** The learner has been told that voice input uploads audio to their browser's vendor. */
  voiceNoticeSeen?: boolean;
  /**
   * Which figure the learner's own avatar draws. Everyone plays a character
   * called 「你」, so seeding from the name alone would hand every user the
   * same one; this makes it theirs, and re-rollable.
   */
  avatarSeed?: number;
  /** Validated versioned portrait; independent of the learner’s display name. */
  avatarPortrait?: string;
  /** Cropped, re-encoded raster data; stays on this device and out of model inputs. */
  avatarImage?:string;
  /**
   * Default for new scenes: replies on the clock. Real conversations do not
   * wait fifteen seconds for an answer, and neither, with this on, does the
   * simulation. Off unless the learner asks for it — it is a harder mode.
   */
  timed?: boolean;
  /** How long the other side waits before they carry on, in seconds. */
  patience?: Patience;
  /**
   * Anonymous usage events (which scenario, how long, how it ended; never
   * what was said) to the team's table. Undefined means on; the switch in
   * Settings is the way out, and About says what leaves the device.
   */
  telemetry?: boolean;
  /**
   * Love follow-up cards on /love. Undefined means on; off only stops the asking —
   * the carries themselves stay on the device untouched.
   */
  loveCarry?: boolean;
}

export type Patience = 10 | 15 | 20;
export const DEFAULT_PATIENCE: Patience = 15;
export const PATIENCE_OPTIONS: readonly Patience[] = [10, 15, 20];

interface AppState {
  hydrated: boolean;
  /** Read failures are shown before practice; the unreadable bytes stay intact. */
  storageIssue: "unreadable" | "unavailable" | null;
  /** In-memory onboarding choice, shared with global dialogs. */
  saveIssue:SaveIssue|null;
  retrySave:()=>void;
  restoreArchive:(archive:ReturnType<typeof parseArchive>,replace:boolean)=>Promise<boolean>;
  onboardingLang: Lang | undefined;
  profile: Profile | null;
  /**
   * The cross-session habit, cached with the session ids it was read from so it
   * only re-runs when there is genuinely new material. It is a model call over
   * the whole history, and it should not fire on every visit to Growth.
   */
  patternInsight: { result: PatternResult; from: string[]; at: number } | null;
  proficiency: Proficiency;
  /**
   * Love-track proficiency, keyed by LoveTopicId. Practicing a romantic
   * scenario also moves the generic `proficiency` skills; this is an
   * additional view so the love module can show progress on its own topics.
   */
  loveProficiency: Partial<Record<LoveTopicId, number>>;
  sessions: Session[];
  customScenarios: Scenario[];
  bookmarks: string[];
  /** ISO dates (YYYY-MM-DD) with at least one completed practice */
  practiceDays: string[];
  /** Today's scheduled session id */
  todaySessionId: string | null;
  todayDate: string | null;
  settings: Settings;

  setHydrated: () => void;
  setProfile: (p: Profile) => void;
  updateProfile: (p: Partial<Profile>) => void;
  setLang: (l: Lang) => void;
  setProficiency: (p: Proficiency) => void;
  addSession: (s: Session) => void;
  removeSession: (id: string) => void;
  /** Drop briefing-stage sessions older than a day and active sessions the learner never spoke in. */
  pruneSessions: () => void;
  updateSession: (id: string, patch: Partial<Session> | ((s: Session) => Partial<Session>)) => void;
  appendMessage: (id: string, m: ChatMessage) => void;
  updateLastNpc: (id: string, text: string, characterId: string, messageId: string) => void;
  applyReport: (id: string, report: Report) => void;
  /**
   * 恋爱 Galgame 模式的收尾：把这一局写成设备端 `LovePlayRecord`，更新练习
   * 日历与恋爱主题熟练度。不创建练习 `Session`、不触发 applyReport / assess，
   * 剧情模式没有教练引语的复盘（G14/G15/G21）。
   *
   * 返回 true 仅当记录已在设备上（本次写入成功，或同一 id 先前已落盘）。
   * 落盘失败返回 false，但内存里的主题增益与 practiceDays 照常更新，让剧情
   * 能继续；调用方据此提示「这次没记上」，不要把失败吞掉。
   */
  completeLovePlay: (input: LovePlayCompletion) => boolean;
  addReflection: (id: string, r: Reflection) => void;
  updateReflection: (id: string, idx: number, patch: Partial<Reflection>) => void;
  addCustomScenario: (s: Scenario) => void;
  toggleBookmark: (id: string) => void;
  setToday: (sessionId: string | null) => void;
  setSettings: (s: Partial<Settings>) => void;
  setPatternInsight: (result: PatternResult, from: string[]) => void;
  reset: () => void;
}

export const todayKey = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const initial = {
  hydrated: false,
  storageIssue: null,
  saveIssue:null,
  onboardingLang: undefined as Lang | undefined,
  profile: null,
  proficiency: {},
  loveProficiency: {},
  sessions: [],
  customScenarios: [],
  bookmarks: [],
  practiceDays: [],
  todaySessionId: null,
  todayDate: null,
  patternInsight: null,
  // Voice on by default: an NPC that speaks changes the felt stakes of a scene
  // more than any visual does, and a setting nobody finds is a setting nobody uses.
  settings: { tts: true },
};

const archiveStorage=createArchiveStorage(issue=>{
 queueMicrotask(()=>{if(useApp.getState().saveIssue!==issue)useApp.setState({saveIssue:issue});});
});
const appStorage=createJSONStorage(()=>{
 if(typeof window==='undefined')throw new Error('Browser storage is not available during server rendering.');
 return archiveStorage;
});

export const useApp = create<AppState>()(
  persist(
    (set,get) => ({
      ...initial,
      setHydrated: () => set({ hydrated: true, storageIssue: null }),
      retrySave:()=>{archiveStorage.retry();set({saveIssue:null});},
      restoreArchive:async(archive,replace)=>{if(replace)archiveStorage.reset(true);set({...archive,sessions:archive.sessions as Session[],proficiency:estimateProficiency(archive.sessions as Session[],archive.proficiency),hydrated:true,storageIssue:null});await archiveStorage.settled();await Promise.resolve();return get().saveIssue===null;},
      setProfile: (profile) => set({ profile }),
      updateProfile: (p) => set((s) => ({ profile: s.profile ? { ...s.profile, ...p } : s.profile })),
      setLang: (lang) => set((s) => ({ onboardingLang: lang, profile: s.profile ? { ...s.profile, lang } : s.profile })),
      setProficiency: (proficiency) => set({ proficiency }),
      addSession: (session) => set((s) => ({ sessions: [session, ...s.sessions] })),
      removeSession: (id) => set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id), todaySessionId: s.todaySessionId === id ? null : s.todaySessionId })),
      pruneSessions: () =>
        set((s) => {
          const dayAgo = Date.now() - 24 * 3600 * 1000;
          return {
            sessions: s.sessions.filter((x) => {
              if (x.id === s.todaySessionId) return true;
              if (x.status === "briefing" && x.startedAt < dayAgo) return false;
              if (x.status === "active" && x.startedAt < dayAgo && !x.messages.some((m) => m.role === "learner")) return false;
              return true;
            }),
          };
        }),
      updateSession: (id, patch) =>
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...(typeof patch === "function" ? patch(x) : patch) } : x)),
        })),
      appendMessage: (id, m) =>
        set((s) => ({ sessions: s.sessions.map((x) => (x.id === id && !x.messages.some((y) => y.id === m.id) ? { ...x, messages: [...x.messages, m] } : x)) })),
      updateLastNpc: (id, text, characterId, messageId) =>
        set((s) => ({
          sessions: s.sessions.map((x) => {
            if (x.id !== id) return x;
            const msgs = [...x.messages];
            const i = msgs.findIndex((m) => m.id === messageId);
            if (i === -1) msgs.push({ id: messageId, role: "npc", characterId, text, ts: Date.now() });
            else msgs[i] = { ...msgs[i], text, characterId };
            return { ...x, messages: msgs };
          }),
        })),
      applyReport: (id, report) =>
        set((s) => {
const sess = s.sessions.find((x) => x.id === id);
          if (!sess || sess.status !== "ended" || sess.report) return s;
          const creditedReport = { ...report };
          const reviewed = s.sessions.map((x) => (x.id === id ? { ...x, report: creditedReport, status: "assessed" as const } : x));
          const prof = estimateProficiency(reviewed, s.proficiency);
          // Changes are derived from verified recent observations. A model's
          // proposed reward cannot alter ability, including on legacy reports.
          creditedReport.deltas = Object.fromEntries(
            Object.entries(prof)
              .filter(([k, v]) => v !== s.proficiency[k as SkillId])
              .map(([k, v]) => [k, +((v ?? 2.5) - (s.proficiency[k as SkillId] ?? 2.5)).toFixed(2)]),
          );
          const love = { ...s.loveProficiency };
          const topic = sess.scenario.loveTopic;
          if (topic) {
            // Same gate as the generic proficiency: count only deltas for skills
            // this session actually targeted, so the love view and the skill view
            // never drift apart. Cap the per-session gain so one great report
            // nudges the topic instead of filling it.
            const allowed = new Set<SkillId>([...(s.profile?.goals ?? []), ...(sess.scenario.skills ?? [])]);
            const gain = Math.max(
              -0.4,
              Math.min(
                0.4,
                Object.entries(creditedReport.deltas)
                  .filter(([k]) => allowed.has(k as SkillId))
                  .reduce((a, [, v]) => a + (v ?? 0), 0),
              ),
            );
            const cur = love[topic] ?? 2.5;
            love[topic] = Math.min(5, Math.max(1, +(cur + gain).toFixed(2)));
          }
          const day = todayKey();
          return {
            proficiency: prof,
            loveProficiency: love,
            practiceDays: s.practiceDays.includes(day) ? s.practiceDays : [...s.practiceDays, day],
            sessions: s.sessions.map((x) => (x.id === id ? { ...x, report:creditedReport, status: "assessed", outcome: report.outcome } : x)),
          };
        }),
      addReflection: (id, r) => set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, reflections: [...x.reflections, r] } : x)) })),
      updateReflection: (id, idx, patch) =>
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? { ...x, reflections: x.reflections.map((r, i) => (i === idx ? { ...r, ...patch } : r)) } : x)),
        })),
      addCustomScenario: (sc) => set((s) => ({ customScenarios: [sc, ...s.customScenarios.filter((x) => x.id !== sc.id)] })),
      toggleBookmark: (id) => set((s) => ({ bookmarks: s.bookmarks.includes(id) ? s.bookmarks.filter((b) => b !== id) : [...s.bookmarks, id] })),
      setToday: (todaySessionId) => set({ todaySessionId, todayDate: todayKey() }),
      completeLovePlay: (input) => {
        const record = lovePlayRecordFor(input);
        // 先看磁盘：同一 id 已落盘就不再写第二遍，也不再加一次增益。
        const read = readLoveStoryStore();
        const alreadyRecorded = read.status === "ok" && read.store.records.some((r) => r.id === record.id);
        const persisted = alreadyRecorded || appendLovePlayRecord(record).ok;

        if (!alreadyRecorded && !lovePlayApplied.has(record.id)) {
          lovePlayApplied.add(record.id);
          if (lovePlayApplied.size > LOVE_PLAY_APPLIED_MAX) {
            const oldest = lovePlayApplied.values().next().value;
            if (oldest !== undefined) lovePlayApplied.delete(oldest);
          }
          const day = todayKey();
          set((s) => {
            const love = { ...s.loveProficiency };
            const topic = input.scenario.loveTopic;
            if (topic) {
              // 按结局给微增益（沿用 applyReport 的 1-5 夹紧口径，且不被单局填满）。
              const gain = input.outcome === "success" ? 0.3 : input.outcome === "partial" ? 0.15 : 0.05;
              const cur = love[topic] ?? 2.5;
              love[topic] = Math.min(5, Math.max(1, +(cur + gain).toFixed(2)));
            }
            return {
              practiceDays: s.practiceDays.includes(day) ? s.practiceDays : [...s.practiceDays, day],
              loveProficiency: love,
            };
          });
        }
        return persisted;
      },
      setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      setPatternInsight: (result, from) => set({ patternInsight: { result, from, at: Date.now() } }),
      reset: () => {
        // 恋爱 slot 按设计不进 persist archive（避开版本迁移），所以 archiveStorage.reset
        // 碰不到它们；承诺里存的是用户亲手打的一句话，必须在这里显式擦掉（G16）。
        clearLovePlaySlots();
        archiveStorage.reset(true);
        try {
          // Clear only this app's tab state, including unsent practice drafts.
          for (const key of Object.keys(sessionStorage)) {
            if (key === "socialcoach.rehearsal-draft" || key === "socialcoach.rehearsal-brief" || key === "socialcoach.arena.location" || key.startsWith("socialcoach.draft.")) sessionStorage.removeItem(key);
          }
        } catch {}
        // The analytics device id goes with everything else: a reset learner is a new device.
        try { localStorage.removeItem(DEVICE_KEY); localStorage.removeItem(OPEN_DAY_KEY); } catch {}
        set({ ...initial, hydrated: true });
      },
    }),
    {
      name: "socialcoach.v1",
      storage: appStorage,
      partialize: (s) => ({
        profile: s.profile,
        onboardingLang:s.onboardingLang,
        proficiency: s.proficiency,
loveProficiency: s.loveProficiency,
        sessions: s.sessions,
        customScenarios: s.customScenarios,
        bookmarks: s.bookmarks,
        practiceDays: s.practiceDays,
        todaySessionId: s.todaySessionId,
        todayDate: s.todayDate,
        settings: s.settings,
        // This list is an allow-list on purpose — it is why a BYOK key can never
        // end up in here. New state therefore has to be added deliberately, and
        // this one has to be, or the cross-session read re-runs a smart-model
        // call on every visit to Growth, which is what caching it prevents.
        patternInsight: s.patternInsight,
      }),
      merge:(persisted,current)=>{
        if(persisted===undefined)return current;
        const archive=parseArchive(persisted);
        return {...current,...archive,proficiency:estimateProficiency(archive.sessions as Session[],archive.proficiency),loveProficiency:archive.loveProficiency??current.loveProficiency} as AppState;
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          // Initial hydration can fail before the exported store is assigned.
          queueMicrotask(() => useApp.setState({ hydrated: true, storageIssue: error instanceof SyntaxError ? "unreadable" : "unavailable" }));
          return;
        }
        archiveStorage.reset();
        state?.setHydrated();
      },
    },
  ),
);

/** Consecutive-day streak ending today or yesterday. */
export function computeStreak(days: string[]): number {
  if (!days.length) return 0;
  const set = new Set(days);
  const d = new Date();
  let k = todayKey(d);
  if (!set.has(k)) {
    d.setDate(d.getDate() - 1);
    k = todayKey(d);
    if (!set.has(k)) return 0;
  }
  let n = 0;
  while (set.has(todayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export const useLang = (): Lang => useApp((s) => s.profile?.lang ?? s.onboardingLang ?? (typeof navigator !== "undefined" && !navigator.language.startsWith("zh") ? "en" : "zh"));
export const useGoals = (): SkillId[] => useApp((s) => s.profile?.goals ?? []);
export const useContexts = (): ContextId[] => useApp((s) => s.profile?.contexts ?? []);
export const useLoveProficiency = (): Partial<Record<LoveTopicId, number>> => useApp((s) => s.loveProficiency);

/** Other windows may publish new records; retain unsaved local work on conflict. */
export function observeArchiveChanges(){
 const listener=(event:StorageEvent)=>{
  if(event.key!=='socialcoach.v1'||!archiveStorage.changed(event.newValue))return;
  if(archiveStorage.dirty()||useApp.getState().saveIssue||!archiveStorage.acceptsRemote(event.oldValue)){useApp.setState({saveIssue:'conflict'});return;}
  void useApp.persist.rehydrate();
 };
 window.addEventListener('storage',listener);
 return ()=>window.removeEventListener('storage',listener);
}
