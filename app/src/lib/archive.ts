import {z} from 'zod';
import {ScenarioSchema,SkillSchema,ContextSchema,AdaptationSchema,LoveTopicSchema} from './runtime-contracts';
import {SceneContextSchema} from './scene-context';
import type {CarryPromiseClass} from '@/data/corpus/love-carry-lines';
import {LOVE_CARRY_CAP, LOVE_CARRY_KEY, LOVE_CARRY_TEXT_MAX, LOVE_PLAY_PREFIX, type LoveCarryState} from './love-carry-store';
import {LOVE_MEMORY_KEY, LOVE_MEMORY_SCOPE_MAX, LOVE_MEMORY_TEXT_MAX, LOVE_MEMORY_TOTAL_MAX} from './love-memory';
import {LOVE_STORY_KEY, LoveStoryStoreSchema} from './love-story';
import {LOVE_READ_KEY} from './love-read';
import {LOVE_READER_KEY} from './love-reader-settings';

const text=z.string(),strings=z.array(text),num=z.number().finite();
// 枚举值写死在这里，但用 satisfies 扣回真正的类型：语料或 store 改了取值，这一行就编译不过
// （`origin` 少一个 'love-play' 曾让整个档案解析失败，见 wiki/80-known-pitfalls.md）。
const carryClasses={call:true,visit:true,ritual:true} satisfies Record<CarryPromiseClass,true>;
const carryStates={pending:true,kept:true,open:true,dropped:true} satisfies Record<LoveCarryState,true>;
export const ProficiencySchema=z.partialRecord(SkillSchema,num.min(1).max(5));
export const LoveProficiencySchema=z.partialRecord(LoveTopicSchema,num.min(1).max(5));
export const ProfileSchema=z.object({name:text,bio:text,goals:z.array(SkillSchema),contexts:z.array(ContextSchema),lang:z.enum(['zh','en']),createdAt:num});
const evidence=z.object({behavior:text,evidence:text,skill:SkillSchema});
export const ReportSchema=z.object({
 scoringVersion:z.literal(2).optional(),ratings:z.array(z.object({skill:SkillSchema,level:z.number().int().min(0).max(3),evidence:text,reason:text})).optional(),
 stars:z.number().int().min(0).max(3),outcome:z.enum(['success','partial','failure']),verdictEvidence:text.optional(),verdict:text,summary:text,
 strengths:z.array(evidence),weaknesses:z.array(evidence.extend({deficit:z.enum(['acquisition','performance']),whyItMatters:text})),
 alternatives:z.array(z.object({original:text,better:text,why:text})),knowledge:z.object({theoryIds:strings,caseIds:strings,whyThis:text}),reflectionQuestions:strings,nextStep:text,deltas:z.partialRecord(SkillSchema,num),
 objectiveResults:z.array(z.object({index:z.number().int().nonnegative(),status:z.enum(['met','unmet','unknown']),evidence:text,npcEvidence:text.optional(),reason:text})).optional(),
 sceneNotes:z.array(z.object({evidence:text,observationId:text,note:text})).optional(),
});
const closure=z.object({kind:z.enum(['agreement','boundary','deferred','withdrawal']),learnerQuote:text.optional(),npcQuote:text});
export const MetaSchema=z.object({objectiveEvidence:z.array(z.object({index:z.number().int().nonnegative(),learnerQuote:text,npcQuote:text.optional()})).optional(),objectives:z.array(z.boolean()),ended:z.boolean(),closure:closure.optional(),outcome:z.enum(['success','partial','failure']).nullable().optional(),note:text.optional(),stance:num.min(0).max(100).optional(),revealed:z.boolean().optional(),disclosures:z.array(z.object({characterId:text,quote:text})).optional()});
export const MessageSchema=z.object({id:text.min(1),role:z.enum(['learner','npc','coach','event']),characterId:text.optional(),text,ts:num,kind:z.enum(['hint','silence']).optional(),seconds:num.optional(),meta:MetaSchema.optional()});
const reply=z.object({evidence:text,answer:text,example:text,sources:z.array(z.object({kind:z.enum(['theory','case']),id:text}))});
const SessionSchema=z.object({
 id:text.min(1),scenario:ScenarioSchema,learnerCharacterId:text,messages:z.array(MessageSchema),objectiveDone:z.array(z.boolean()),status:z.enum(['briefing','active','ended','assessed']),startedAt:num,endedAt:num.optional(),reflections:z.array(z.object({question:text,answer:text,coachReply:text.optional(),revision:text.optional()})),origin:z.enum(['scheduled','arena','rehearse','love-play']),
 adaptation:AdaptationSchema.extend({briefing:text,objectives:strings,focus:text}).optional(),prescription:z.object({query:text,core_constraints:z.object({target_skills:z.array(SkillSchema),contexts:strings.optional()}),optional_constraints:z.object({related_skills:z.array(SkillSchema).optional(),relationship_types:strings.optional(),difficulty:z.number().int().min(1).max(3).optional()}).optional(),rationale:text}).optional(),
 retrieval:z.object({relaxed:strings,candidates:num,chosen:text,roleFit:z.object({characterId:text,fit:z.enum(['compatible','uncertain']),reason:text}).optional()}).optional(),
 sceneContext:SceneContextSchema.optional(),report:ReportSchema.optional(),outcome:z.enum(['success','partial','failure']).optional(),outcomeNote:text.optional(),closure:closure.optional(),turnLimit:num.optional(),continuedFrom:text.optional(),stanceTrail:z.array(num).optional(),revealedAtTurn:num.optional(),revealSeen:z.boolean().optional(),timed:z.boolean().optional(),debriefChat:z.array(z.object({id:text,question:text,reply,at:num})).optional(),
 disclosures:z.array(z.object({characterId:text,messageId:text,quote:text,turn:num})).optional(),
}).superRefine((s,ctx)=>{if(!s.scenario.characters.some(c=>c.id===s.learnerCharacterId))ctx.addIssue({code:'custom',path:['learnerCharacterId'],message:'Learner must belong to the saved cast'});});
export const ArchiveSchema=z.object({
 profile:ProfileSchema.nullable().default(null),onboardingLang:z.enum(['zh','en']).optional(),proficiency:ProficiencySchema.default({}),loveProficiency:LoveProficiencySchema.default({}),sessions:z.array(SessionSchema).default([]),customScenarios:z.array(ScenarioSchema).default([]),bookmarks:strings.default([]),practiceDays:strings.default([]),todaySessionId:text.nullable().default(null),todayDate:text.nullable().default(null),
 settings:z.object({tts:z.boolean(),voiceEngine:z.enum(['natural','system']).optional(),theme:z.enum(['system','light','dark']).optional(),voiceNoticeSeen:z.boolean().optional(),avatarSeed:num.optional(),avatarPortrait:text.optional(),avatarImage:text.optional(),timed:z.boolean().optional(),patience:z.union([z.literal(10),z.literal(15),z.literal(20)]).optional(),telemetry:z.boolean().optional(),loveCarry:z.boolean().optional()}).default({tts:true}),
 // Old cached conclusions lack verified identity pointers. Recompute, never
 // erase the practice transcripts on which they were based.
 patternInsight:z.object({result:z.object({found:z.boolean(),pattern:text,why:text,evidence:z.array(z.object({sessionId:text,messageId:text,title:text,quote:text})),skill:SkillSchema.optional(),nextStep:text}),from:strings,at:num}).nullable().catch(null).default(null),
}).superRefine((s,ctx)=>{if(new Set(s.sessions.map(x=>x.id)).size!==s.sessions.length)ctx.addIssue({code:'custom',path:['sessions'],message:'Duplicate session IDs'});});
export function parseArchive(value:unknown){
 const result=ArchiveSchema.safeParse(value);
 if(!result.success)throw new SyntaxError('The saved archive structure is invalid');
 return result.data;
}
// Reject unknown future envelope versions without modifying the bytes.
export function checkArchiveEnvelope(raw:string){
 const envelope=z.object({version:z.literal(0).optional(),state:ArchiveSchema}).safeParse(JSON.parse(raw));
 if(!envelope.success)throw new SyntaxError('The archive version or structure is invalid');
 return envelope.data;
}
/**
 * 恋爱玩法的设备端 slot：`socialcoach.love-play.carry`、`socialcoach.love-play.story`
 * 与 `socialcoach.love-play.series.<id>`。
 * 它们按设计不进 persist archive（避开版本迁移），但必须跟着导出走，否则「状态留在设备上、可导出」
 * 这条红线只覆盖了半个应用。键名与前缀都由各自的 store 持有，这里只写校验；
 * 任何一处再私自补一份字符串，都会被 `love-play-archive.test.ts` 的前缀断言抓出来。
 */
const loveId=text.min(1).max(100);
const loveOutcome=z.enum(['success','partial','failure']);
/** 承诺原话逐字保存，但导出不是无底洞；上限与采集/存储共用 `LOVE_CARRY_TEXT_MAX` 一个数——
 *  两边各写一份的话，玩家自己打的一句话就会因为「比校验多一个字」把整个承诺槽拖进隔离。 */
const loveCarryText=text.min(1).max(LOVE_CARRY_TEXT_MAX);
export const LoveCarrySchema=z.object({
 id:loveId,text:loveCarryText,lang:z.enum(['zh','en']),cls:z.enum(Object.keys(carryClasses) as [CarryPromiseClass,...CarryPromiseClass[]]).nullable(),
 npcId:loveId,npcName:z.object({zh:text,en:text}),scenarioId:loveId,seriesId:loveId.nullable(),
 // 新承诺按 `scenarioId:characterId` 归属（两个同名 Tess 不能共用一条承诺）；旧备份没有这个字段，照常恢复。
 characterKey:z.string().optional(),
 createdAt:num,updatedAt:num,askCount:z.number().int().nonnegative(),lastAskedAt:num.optional(),
 state:z.enum(Object.keys(carryStates) as [LoveCarryState,...LoveCarryState[]]),
});
/** 恢复不允许 mint 出一个 store 自己写不出来的形状：上限直接取 `LOVE_CARRY_CAP`。
 *  否则一份 21–100 条的外来/改档备份落盘后，每一次新增承诺都会被「已经带了 20 句」挡掉——
 *  那个数字在此刻是假话，而玩家没有任何办法删掉多余的那几条。 */
export const LoveCarryListSchema=z.array(LoveCarrySchema).max(LOVE_CARRY_CAP);
/** 剧情线进度 v2（并行批次写入）新增 `v` 与 `lastAct`：恢复必须原样带回，不能被 Zod strip 掉。 */
export const LoveSeriesProgressSchema=z.object({
 v:z.literal(2).optional(),
 completed:z.array(loveId).max(200),
 // 空字符串是「还没玩过任何一幕」的合法值，不能按 loveId 的 min(1) 拒掉。
 lastScene:text.max(100),outcome:z.record(loveId,loveOutcome),
 lastAct:z.number().int().min(0).max(6).optional(),
});
/** 采集时读不出来的 slot 原文照存，一个字节都不丢（`dinnerBackup` 同口径）。 */
const LovePlayUnreadableSchema=z.object({unreadable:text});
const LoveCarrySlotSchema=z.union([LoveCarryListSchema,LovePlayUnreadableSchema]);
const LoveStorySlotSchema=z.union([LoveStoryStoreSchema,LovePlayUnreadableSchema]);
const LoveSeriesSlotSchema=z.union([LoveSeriesProgressSchema,LovePlayUnreadableSchema]);
/**
 * 阅读层两个 slot：已读索引与阅读偏好。
 * 它们跟着导出走（换设备后已读与字号不该倒退），但形状与 story 完全不同，
 * 键名与形状必须一一对应，恢复时不得互换。
 */
const LoveReadSlotSchema=z.union([
  z.object({v:z.literal(1),seen:z.record(text.max(200),num),updatedAt:num}),
  LovePlayUnreadableSchema,
]);
const LoveReaderSlotSchema=z.union([
  z.object({
    v:z.literal(1),
    textSize:z.enum(['sm','md','lg']),
    speed:z.enum(['slow','normal','fast']),
    auto:z.boolean(),
    skipRead:z.boolean(),
    reduceMotion:z.boolean(),
  }),
  LovePlayUnreadableSchema,
]);
/** `love-series-progress.ts` 按线拼 key；这里只按同一前缀识别，不复制具体 line id。 */
const LOVE_SERIES_PREFIX=`${LOVE_PLAY_PREFIX}series.`;
/**
 * 陪伴层记忆：原文快照 + 证据指针。恢复不许 mint 出 store 自己写不出的形状：
 * 文本上限与 store 共用 `LOVE_MEMORY_TEXT_MAX`，每作用域/总量上限共用
 * `LOVE_MEMORY_SCOPE_MAX` / `LOVE_MEMORY_TOTAL_MAX`——备份里塞进的超量条目
 * 落盘后会被第一次「整理」的写入校验整份拒绝，那比静默裁剪诚实。
 */
const LoveMemoryEntrySchema=z.object({
 id:loveId,kind:z.enum(['fact','preference','promise','boundary','event']),
 text:z.string().min(1).max(LOVE_MEMORY_TEXT_MAX),sourceText:z.string().min(1).max(LOVE_MEMORY_TEXT_MAX),
 sourceMessageIds:z.array(loveId).max(8),
 seriesId:loveId,characterKey:loveId,createdAt:num,updatedAt:num,locked:z.boolean(),invalid:z.boolean().optional(),
});
export const LoveMemoryStoreSchema=z.object({
 v:z.literal(1),revision:z.number().int().nonnegative(),
 entries:z.record(text.max(240),z.array(LoveMemoryEntrySchema).max(LOVE_MEMORY_SCOPE_MAX)),updatedAt:num,
}).superRefine((s,ctx)=>{if(Object.values(s.entries).reduce((n,l)=>n+l.length,0)>LOVE_MEMORY_TOTAL_MAX)ctx.addIssue({code:'custom',path:['entries'],message:'Too many memory entries'});});
const LoveMemorySlotSchema=z.union([LoveMemoryStoreSchema,LovePlayUnreadableSchema]);
type LoveSlotShape='carry'|'story'|'series'|'read'|'reader'|'memory';
/** 键名决定形状；其余同前缀键不属于这份闭合联合，导出与恢复都不越界。 */
function loveSlotShape(key:string):LoveSlotShape|null{
 if(key===LOVE_CARRY_KEY)return 'carry';
 if(key===LOVE_STORY_KEY)return 'story';
 if(key===LOVE_READ_KEY)return 'read';
 if(key===LOVE_READER_KEY)return 'reader';
 if(key===LOVE_MEMORY_KEY)return 'memory';
 if(key.startsWith(LOVE_SERIES_PREFIX)&&key.length>LOVE_SERIES_PREFIX.length)return 'series';
 return null;
}
/** 已通过联合校验的值按字段辨认形状：carry 是数组，story 与 series 都是对象，不能只看 Array.isArray。 */
function loveValueShape(value:unknown):LoveSlotShape|null{
 if(Array.isArray(value))return 'carry';
 if(!value||typeof value!=='object')return null;
 if('saves' in value&&'records' in value&&'routes' in value)return 'story';
 if('completed' in value&&'lastScene' in value&&'outcome' in value)return 'series';
 if('seen' in value&&'updatedAt' in value)return 'read';
 if('textSize' in value&&'speed' in value&&'auto' in value)return 'reader';
 if('entries' in value&&'revision' in value)return 'memory';
 return null;
}
export const LovePlaySchema=z.record(text.startsWith(LOVE_PLAY_PREFIX).min(LOVE_PLAY_PREFIX.length+1).max(140),z.union([LoveCarryListSchema,LoveStoryStoreSchema,LoveSeriesProgressSchema,LoveReadSlotSchema,LoveReaderSlotSchema,LoveMemoryStoreSchema,LovePlayUnreadableSchema])).superRefine((slots,ctx)=>{
 for(const [key,slot] of Object.entries(slots)){
  const target=loveSlotShape(key);
  if(!target){ctx.addIssue({code:'custom',path:[key],message:'Love-play slot key is not part of the archive'});continue;}
  // 键名决定形状：线进度放进 carry 键（或反过来）形状各自都合法，写回去只会把用户的承诺清单变成空档。
  if('unreadable' in slot)continue;
  if(loveValueShape(slot)!==target)ctx.addIssue({code:'custom',path:[key],message:'Love-play slot shape does not match its key'});
 }
});
/** 逐 slot 复验用的形状选择器：键名前缀不对就谁都不选——导出与恢复都不越界碰别的命名空间的 slot。 */
export function parseLovePlaySlot(key:string,value:unknown){
 if(!key.startsWith(LOVE_PLAY_PREFIX)||key.length>140)return {success:false as const};
 switch(loveSlotShape(key)){
  case 'carry':return LoveCarrySlotSchema.safeParse(value);
  case 'story':return LoveStorySlotSchema.safeParse(value);
  case 'series':return LoveSeriesSlotSchema.safeParse(value);
  case 'read':return LoveReadSlotSchema.safeParse(value);
  case 'reader':return LoveReaderSlotSchema.safeParse(value);
  case 'memory':return LoveMemorySlotSchema.safeParse(value);
  default:return {success:false as const};
 }
}

