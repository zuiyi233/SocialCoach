import {pick} from './i18n';
import {LLMError,systemParts,type LLM,type ChatOpts} from './llm-core';

import { reasoningTimeoutFactor } from './reasoning-policy';
export const TASK_LIMITS={schedule:[110000,6],roleplay:[55000,3],assess:[165000,8],reflect:[55000,4],hint:[25000,1],rehearse:[110000,4],pattern:[55000,2],'debrief-chat':[55000,4],dinner:[110000,4],'love-play':[55000,2]} as const;
export type ModelTask=keyof typeof TASK_LIMITS;
/** One deadline and call budget, including repairs, on server and BYOK. */
export function taskLLM(llm:LLM,task:ModelTask,signal?:AbortSignal,onCall?:(event:{task:ModelTask;call:number;durationMs:number;ok:boolean;inputBytes:number;maxOutput:number})=>void,lang:"zh"|"en"="zh"):LLM{
 const [timeout,maxCalls]=TASK_LIMITS[task];
 // A thinking tier is slower by design; the deadline has to move with it, or the
 // person who asked for a better answer only ever gets a timeout. The tier comes
 // off the client: the learner's own choice is invisible to the server. On a
 // serverless deployment the route's own `maxDuration` still caps this, so a
 // hosted pool running a higher tier has to raise those numbers too.
 const deadline=AbortSignal.timeout(Math.round(timeout*reasoningTimeoutFactor(llm.thinkingTier??'fast'))),combined=signal?AbortSignal.any([signal,deadline]):deadline;
 let calls=0;
 const prepare=(o:ChatOpts)=>{
  combined.throwIfAborted();o.signal?.throwIfAborted();
  if(++calls>maxCalls)throw new LLMError(pick({zh:'这次模型处理已到调用上限，记录已保留，请重试。',en:'The model task reached its call budget. Your record is kept; please retry.'},lang),502);
  const inputBytes=new TextEncoder().encode([...systemParts(o.system).map(p=>p.text),...o.messages.map(m=>m.content)].join('\n')).length;
  if(inputBytes>256000||!Number.isFinite(o.maxTokens)||o.maxTokens<1||o.maxTokens>16000)throw new LLMError(pick({zh:'这段资料超过本次处理上限，本地记录已保留。请先完成当前复盘。',en:'This context exceeds the model budget. Your local record is retained. Finish the current debrief first.'},lang),413);
  return {options:{...o,lang,signal:o.signal?AbortSignal.any([combined,o.signal]):combined},call:calls,inputBytes,start:Date.now()};
 };
 return {
  async chatText(o){const ctx=prepare(o);let ok=false;try{const value=await llm.chatText(ctx.options);ctx.options.signal.throwIfAborted();ok=true;return value;}finally{onCall?.({task,call:ctx.call,durationMs:Date.now()-ctx.start,ok,inputBytes:ctx.inputBytes,maxOutput:o.maxTokens});}},
  chatStream(o){let text='',refused=false;async function* deltas(){const ctx=prepare(o);let ok=false;try{const run=llm.chatStream(ctx.options);for await(const d of run.deltas){ctx.options.signal.throwIfAborted();text+=d;yield d;}ctx.options.signal.throwIfAborted();refused=run.refused();ok=true;}finally{onCall?.({task,call:ctx.call,durationMs:Date.now()-ctx.start,ok,inputBytes:ctx.inputBytes,maxOutput:o.maxTokens});}}return {deltas:deltas(),text:()=>text,refused:()=>refused};},
 };
}
