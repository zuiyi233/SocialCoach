import {dinnerBackup} from '@/features/dinner/storage';
import {LovePlaySchema,parseArchive,parseLovePlaySlot} from './archive';
import {LOVE_PLAY_PREFIX} from './love-carry-store';
import {loveCardBackup,parseLoveCardsBackup} from './love-card-store';
import {validAvatarImage} from './avatar-image';
import {estimateProficiency} from './proficiency';
import type {Session} from './types';
export type Archive=ReturnType<typeof parseArchive>;
/**
 * 按前缀采集，将来新增的 love-play slot 不用回来改这里。
 * 读不出 JSON 的原样留 `{unreadable}`：那是学习者唯一的副本，不能因为解析失败就当它不存在。
 */
export function lovePlayBackup():Record<string,unknown>|null{
 const slots:Record<string,unknown>={};
 try{
  for(let i=0;i<localStorage.length;i++){
   const key=localStorage.key(i);
   if(!key||!key.startsWith(LOVE_PLAY_PREFIX))continue;
   const raw=localStorage.getItem(key);
   if(raw===null)continue;
   try{slots[key]=JSON.parse(raw);}catch{slots[key]={unreadable:raw};}
  }
 }catch{return null;}
 return Object.keys(slots).length?slots:null;
}
/**
 * 正常路径就一次整表校验（键名前缀 + 每个 slot 的形状都由 `LovePlaySchema` 说了算）。
 * 被拒才逐 slot 复验：一条坏掉的线不该让其余进度一起不能恢复。
 * `invalid` 优先于 `unreadable`——原文没存住是意料之中，形状对不上才是要查的。
 */
export type LovePlayDecode={lovePlay?:Record<string,string>;lovePlayOriginal?:string;lovePlayIssue?:'unreadable'|'invalid'};
function decodeLovePlay(value:unknown):LovePlayDecode{
 // 旧备份没有这个字段：一个键都不加，解码结果与引入本字段之前逐字一致。
 if(value===undefined||value===null)return {};
 const restored:Record<string,string>={};
 const entries=value&&typeof value==='object'&&!Array.isArray(value)?Object.entries(value as Record<string,unknown>):null;
 let invalid=entries===null,unreadable=false;
 if(entries){
  const whole=LovePlaySchema.safeParse(value);
  if(whole.success)for(const [key,slot] of Object.entries(whole.data)){
   if('unreadable' in slot){unreadable=true;continue;}
   restored[key]=JSON.stringify(slot);
  }
  else for(const [key,slot] of entries){
   const parsed=parseLovePlaySlot(key,slot);
   if(!parsed.success){invalid=true;continue;}
   if('unreadable' in parsed.data){unreadable=true;continue;}
   restored[key]=JSON.stringify(parsed.data);
  }
 }
 return {
  lovePlay:Object.keys(restored).length?restored:undefined,
  lovePlayOriginal:invalid||unreadable?JSON.stringify(value):undefined,
  lovePlayIssue:invalid?'invalid':unreadable?'unreadable':undefined,
 };
}
export async function decodeBackup(text:string){
 if(text.length>20*1024*1024)throw new Error('backup-size');
 const raw=JSON.parse(text) as Record<string,unknown>;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('backup-shape');
 if('state' in raw&&raw.version!==undefined&&raw.version!==0)throw new Error('backup-version');
 const source=('state' in raw?raw.state:raw) as Record<string,unknown>;
 if(!source||!Array.isArray(source.sessions))throw new Error('backup-shape');
 const avatar=raw.avatar as {seed?:unknown;portrait?:unknown;image?:unknown}|undefined;
 const settings=source.settings??(avatar?{tts:true,avatarSeed:avatar.seed,avatarPortrait:avatar.portrait,avatarImage:validAvatarImage(avatar.image)?avatar.image:undefined}:undefined);
 const archive=parseArchive({...source,settings});
 let dinner:string|undefined,dinnerOriginal:string|undefined,dinnerIssue:'unreadable'|'invalid'|undefined;
 if(raw.dinner3d!==undefined&&raw.dinner3d!==null){
  const {SaveSchema}=await import('@/features/dinner/lib/engine');
  const parsed=SaveSchema.safeParse(raw.dinner3d);
  if(parsed.success)dinner=JSON.stringify(parsed.data);
  else{
   const preserved=raw.dinner3d as {unreadable?:unknown};
   const unreadable=typeof preserved?.unreadable==='string';
   dinnerOriginal=unreadable?preserved.unreadable as string:JSON.stringify(raw.dinner3d);
   dinnerIssue=unreadable?'unreadable':'invalid';
  }
 }
 return {archive,dinner,dinnerOriginal,dinnerIssue,...decodeLovePlay(raw.lovePlay),...decodeLoveCards(raw.loveCards)};
}
/**
 * 用户卡槽（spec-love-user-cards §2.2）：备份里带着就还原成可写回 localStorage 的 JSON。
 * 形状不对时保留原文供导出，不让一份坏卡槽把整个备份判失败——与 lovePlay 同口径。
 */
function decodeLoveCards(value:unknown){
 if(value===undefined||value===null)return {};
 const json=parseLoveCardsBackup(value);
 if(json)return {loveCards:json};
 return {loveCardsOriginal:JSON.stringify(value),loveCardsIssue:'invalid' as const};
}
/** Different records sharing an ID are ambiguous. Preserve both input files
 * and require explicit replacement rather than silently choosing a branch. */
export function mergeArchives(current:Archive,incoming:Archive):Archive{
 const combine=<T extends {id:string}>(a:T[],b:T[])=>{
  const result=[...a];for(const value of b){const old=result.find(v=>v.id===value.id);if(old){if(JSON.stringify(old)!==JSON.stringify(value))throw new Error('backup-conflict');}else result.push(value);}return result;
 };
 const sessions=combine(current.sessions,incoming.sessions).sort((a,b)=>b.startedAt-a.startedAt);
 return {...current,profile:current.profile??incoming.profile,sessions,customScenarios:combine(current.customScenarios,incoming.customScenarios),bookmarks:[...new Set([...current.bookmarks,...incoming.bookmarks])],practiceDays:[...new Set([...current.practiceDays,...incoming.practiceDays])],proficiency:estimateProficiency(sessions as Session[],{...incoming.proficiency,...current.proficiency}),patternInsight:null};
}
/**
 * 导出信封只有这一个构造点：设置页「导出数据」与恢复前自动下载必须逐字同形，
 * 顶层键与 archive 字段（settings / loveProficiency / onboardingLang / patternInsight…）
 * 都跟着 `parseArchive` 的结果走，页面不得再手拼一份（G03）。
 */
export function buildBackupPayload(archive:Archive){
 return {state:archive,version:0 as const,dinner3d:dinnerBackup(),lovePlay:lovePlayBackup(),loveCards:loveCardBackup()};
}
export function downloadArchive(archive:Archive){
 const url=URL.createObjectURL(new Blob([JSON.stringify(buildBackupPayload(archive),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`socialcoach-before-restore-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
