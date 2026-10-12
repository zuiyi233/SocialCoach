/** Disposable UI fixtures: no real learner records, telemetry or model requests. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SCENARIOS} from '../src/data/corpus';
import {buildSession} from '../src/lib/session-utils';
import {parseArchive} from '../src/lib/archive';
import type {Report,Session} from '../src/lib/types';

const base=process.env.UX_BASE_URL??'http://localhost:4318';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname)||process.env.UX_ALLOW_PUBLIC==='1');
const name=`socialcoach-comparison-${process.pid}`;
const artifacts=process.env.UX_ARTIFACTS??join(tmpdir(),name);
mkdirSync(artifacts,{recursive:true});
const scenario=SCENARIOS.find(s=>s.skills.includes('communication'))!;
const before='我觉得我这两年挺努力的，您能不能帮我看看加薪？';
const after='我希望调整到这个区间，依据是项目提前交付的结果。我们能约定回复日期吗？';
function record(id:string,at:number,text:string,level:0|1|2|3):Session{
 const report:Report={scoringVersion:2,ratings:[{skill:'communication',level,evidence:text,reason:level===1?'提出了诉求，但没有给出具体依据。':'给出依据，并提出回复时间。'}],stars:level,outcome:'partial',verdictEvidence:text,verdict:'这次回应提出了明确的诉求。',summary:'这是一份浏览器验证用的虚构复盘。',strengths:[],weaknesses:[],alternatives:[],knowledge:{theoryIds:[],caseIds:[],whyThis:''},reflectionQuestions:[],nextStep:'再次练习提出依据与回复日期。',deltas:{}};
 return {...buildSession(scenario,'arena','zh'),id,startedAt:at,status:'assessed',report,messages:[{id:id+'-line',role:'learner',text,ts:at}],revealSeen:true};
}
const previous=record('comparison-previous',1791648000000,before,1),current=record('comparison-current',1791734400000,after,2);
function browser(args:string[],input?:string){
 const result=JSON.parse(execFileSync('agent-browser',['--session',name,'--json',...args],{input,encoding:'utf8',timeout:45000}));
 assert(result.success,JSON.stringify(result.error));return result.data;
}
const evaluate=(code:string)=>browser(['eval','--stdin'],code).result;
const checks:unknown[]=[];
function fixture(lang:'zh'|'en',theme:'light'|'dark',records:Session[]){return {version:0,state:parseArchive({profile:{name:'Browser fixture',bio:'',goals:['communication'],contexts:[],lang,createdAt:1},sessions:records,settings:{tts:false,telemetry:false,theme}})};}
function openFixture(lang:'zh'|'en',theme:'light'|'dark',records:Session[],id=current.id){
 const value=JSON.stringify(fixture(lang,theme,records));
 evaluate(`localStorage.setItem('socialcoach.v1',${JSON.stringify(value)});true`);
 browser(['open',`${base}/practice/${id}`]);
 browser(['wait','--fn',"document.querySelector('#review-comparison')!==null"]);
 browser(['wait','--fn',`document.documentElement.dataset.theme===${JSON.stringify(theme)}&&getComputedStyle(document.querySelector('#review-comparison').parentElement).opacity==='1'`]);
}
try{
 browser(['open','about:blank']);
 browser(['network','route','**/api/**','--body',JSON.stringify({state:'available',serverKey:true,requireByok:false})]);
 browser(['open',base+'/onboarding']);
 for(const lang of ['zh','en'] as const)for(const theme of ['light','dark'] as const)for(const width of [375,1440]){
  browser(['set','viewport',String(width),'900']);openFixture(lang,theme,[current,previous]);
  assert.equal(evaluate("document.querySelectorAll('#review-comparison article').length"),1);
  assert(evaluate(`document.querySelector('#review-comparison').innerText.includes(${JSON.stringify(before)})&&document.querySelector('#review-comparison').innerText.includes(${JSON.stringify(after)})`));
  assert(evaluate("document.documentElement.scrollWidth<=innerWidth"),'comparison should fit the viewport');
  const source=lang==='zh'?'查看这句话的完整对话 · 上次':'Read this line in its conversation · Previous';
  evaluate("document.querySelector('#review-comparison button').scrollIntoView({block:'center',behavior:'instant'});true");
  browser(['find','role','button','click','--name',source,'--exact']);
  browser(['wait','--fn',"!!document.querySelector('dialog[open]')"]);
  assert(evaluate(`document.querySelector('dialog[open]').innerText.includes(${JSON.stringify(before)})&&!document.querySelector('dialog[open]').innerText.includes(${JSON.stringify(after)})`),'previous quote opens only its own transcript');
  browser(['press','Escape']);browser(['wait','--fn',"!document.querySelector('dialog[open]')"]);
  evaluate("document.querySelectorAll('#review-comparison button')[1].scrollIntoView({block:'center',behavior:'instant'});true");
  browser(['find','role','button','click','--name',lang==='zh'?'查看这句话的完整对话 · 这次':'Read this line in its conversation · This time','--exact']);
  assert(evaluate(`document.querySelector('dialog[open]').innerText.includes(${JSON.stringify(after)})`));browser(['press','Escape']);
  const stored=evaluate("JSON.parse(localStorage.getItem('socialcoach.v1')).state.sessions");
  assert.equal(stored.length,2);assert.equal(stored.find((s:Session)=>s.id===previous.id).messages[0].text,before);
  browser(['find','role','link','click','--name',lang==='zh'?'打开上次复盘':'Open the previous review','--exact']);
  browser(['wait','--fn',`location.pathname==='/practice/${previous.id}'`]);
  browser(['wait','--fn',"!!document.querySelector('#review-comparison')"]);
  assert.equal(evaluate("document.querySelectorAll('#review-comparison article').length"),0,'old reports must not use a future practice');
  openFixture(lang,theme,[current,previous]);browser(['reload']);browser(['wait','--fn',"document.querySelectorAll('#review-comparison article').length===1"]);
  browser(['wait','--fn',"getComputedStyle(document.querySelector('#review-comparison').parentElement).opacity==='1'"]);
  browser(['scrollintoview','#review-comparison']);browser(['screenshot',join(artifacts,`comparison-${lang}-${theme}-${width}.png`)]);
  const scan=browser(['a11y','--selector','#review-comparison','--tags','wcag2a,wcag2aa']);
  assert.equal(scan.counts.violations,0,JSON.stringify(scan.violations));
  checks.push({lang,theme,width,quotations:true,sourceTranscripts:true,previousReview:true,refresh:true,preservedArchive:true,noOverflow:true,a11y:scan.counts});
  console.log(`PASS ${lang}/${theme}/${width}`);
 }
 const context={kind:'3d' as const,sceneId:'work' as const,openingId:'work-toast',observations:[]};
 const old3d={...previous,sceneContext:{...context,practiceId:'0ad5b82d-9d7f-4d13-a428-107239a72d4c'}},now3d={...current,sceneContext:{...context,practiceId:'a7085c4a-23c6-4333-8cb7-8043871429c0'}};
 openFixture('zh','light',[now3d,old3d]);assert.equal(evaluate("document.querySelectorAll('#review-comparison article').length"),1);
 openFixture('zh','light',[now3d,{...old3d,sceneContext:now3d.sceneContext}]);assert.equal(evaluate("document.querySelectorAll('#review-comparison article').length"),0);
 openFixture('en','dark',[{...current,report:{...current.report!,ratings:[{...current.report!.ratings![0],level:0}]}},previous]);
 assert(evaluate("document.querySelector('#review-comparison').innerText.includes('Lower estimate this time')"));
 checks.push({threeDComparison:true,continuationExcluded:true,lowerEstimateVisible:true});
 writeFileSync(join(artifacts,'browser-checks.json'),JSON.stringify(checks,null,2)+'\n');
 console.log(`Passed ${checks.length} browser cases. Artifacts: ${artifacts}`);
}catch(error){
 browser(['screenshot',join(artifacts,'failure.png')]);
 writeFileSync(join(artifacts,'failure.json'),JSON.stringify({message:String(error),page:evaluate("({url:location.href,text:document.body.innerText.slice(0,2500)})")},null,2));
 throw error;
}finally{browser(['close']);}
