import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applyReasoningTier, reasoningTimeoutFactor, tierOf} from '../../src/lib/reasoning-policy';
import {anthropicArgs, openaiArgs, type ChatOpts} from '../../src/lib/llm-core';
import {taskLLM} from '../../src/lib/task-runtime';
import {makeByokLLM} from '../../src/lib/llm-client';
import {reservedTokens} from '../../src/lib/shared-budget';
import type {ByokConfig} from '../../src/lib/byok';
import type {LLM} from '../../src/lib/llm-core';

// A reply someone is waiting for, and a debrief that is read after the fact.
const turn:ChatOpts={system:'s',messages:[{role:'user',content:'hi'}],maxTokens:1800,thinking:false};
const analysis:ChatOpts={system:'s',messages:[{role:'user',content:'hi'}],maxTokens:8000,effort:'low'};

test('an unset or unknown tier reads as fast',()=>{
  for(const value of [undefined,'',null,'turbo','FAST'])assert.equal(tierOf(value),'fast');
  assert.equal(tierOf('balanced'),'balanced');
  assert.equal(tierOf('deep'),'deep');
});

test('fast leaves every request exactly as it is today',()=>{
  assert.equal(applyReasoningTier(turn,'fast'),turn);
  assert.equal(applyReasoningTier(analysis,'fast'),analysis);
});

test('a higher tier adds thinking room instead of cutting into the answer',()=>{
  const capped={canCapThinking:true};
  const balanced=applyReasoningTier(turn,'balanced',capped);
  assert.equal(balanced.thinking,true);
  assert.equal(balanced.thinkingBudget,2048);
  assert.equal(balanced.maxTokens,1800+2048);
  assert.equal(balanced.effort,'low');
  const deep=applyReasoningTier(analysis,'deep',capped);
  assert.equal(deep.thinkingBudget,32768);
  assert.equal(deep.maxTokens,8000+32768);
  assert.equal(deep.effort,'high');
  // A turn is still a turn at the top tier: nobody watches a spinner for 32K.
  assert.equal(applyReasoningTier(turn,'deep',capped).thinkingBudget,8192);
  assert.ok(applyReasoningTier(analysis,'deep').maxTokens<=16000+32768);
});

test('an endpoint that cannot cap the spend keeps the steps that declined to think',()=>{
  // Measured on a live OpenAI-compatible endpoint without budget_tokens:
  // 13 of 35 role-match replies came back with an empty `content` channel,
  // because the thinking ate the whole output allowance.
  assert.equal(applyReasoningTier(turn,'deep',{canCapThinking:false}),turn);
  assert.equal(applyReasoningTier(turn,'balanced',{canCapThinking:false}),turn);
  const deeper=applyReasoningTier(analysis,'deep',{canCapThinking:false});
  assert.equal(deeper.thinkingBudget,32768,'a step that already reasons still gets the deeper budget');
  assert.equal(deeper.maxTokens,8000+32768);
  const uncapped=openaiArgs(deeper,'test-chat','max_tokens',true,false) as unknown as OpenAIBody;
  assert.equal('thinking' in uncapped,false,'no ceiling to send means no thinking object to send');
  assert.equal(uncapped.reasoning_effort,'high');
});

test('the shared pool reserves against the raised ceiling',()=>{
  const fast=reservedTokens(analysis),deep=reservedTokens(applyReasoningTier(analysis,'deep'));
  assert.ok(deep>fast,'a thinking call cannot be reserved at the non-thinking ceiling');
  assert.equal(deep-fast,3*32768,'the reservation grows by the three SDK attempts of the added budget');
});

type AnthropicBody={max_tokens:number;thinking?:{type:string;budget_tokens:number};output_config?:{effort:string}};
test('Anthropic gets a numeric budget with room left for the text',()=>{
  for(const tier of ['balanced','deep'] as const){
    for(const step of [turn,analysis]){
      const body=anthropicArgs(applyReasoningTier(step,tier,{canCapThinking:true}),'test-chat') as unknown as AnthropicBody;
      const budget=step===turn?(tier==='balanced'?2048:8192):(tier==='balanced'?4096:32768);
      assert.deepEqual(body.thinking,{type:'enabled',budget_tokens:budget});
      assert.ok(body.max_tokens>body.thinking!.budget_tokens,'max_tokens must exceed the thinking budget');
      assert.equal(body.max_tokens,step.maxTokens+budget,'the answer keeps its own room on top of the thinking');
      assert.equal(body.output_config?.effort,tier==='deep'?'high':'low');
    }
  }
  const off=anthropicArgs({...turn,thinking:false},'test-chat') as unknown as AnthropicBody;
  assert.deepEqual(off.thinking,{type:'disabled'});
});

type OpenAIBody={max_tokens:number;reasoning_effort?:string;thinking?:unknown};
test('a compatible endpoint gets the effort label and the raised output ceiling',()=>{
  for(const [tier,effort] of [['balanced','low'],['deep','high']] as const){
    const body=openaiArgs(applyReasoningTier(turn,tier,{canCapThinking:true}),'test-chat','max_tokens',true) as unknown as OpenAIBody;
    assert.equal(body.reasoning_effort,effort);
    assert.equal('thinking' in body,false,'a tier that asks for thinking never also disables it');
  }
  const ceiling=openaiArgs(applyReasoningTier(turn,'deep',{canCapThinking:true}),'test-chat','max_tokens') as unknown as OpenAIBody;
  assert.equal(ceiling.max_tokens,1800+8192);
});

test('an endpoint that declares a numeric budget is given the number instead of the label',()=>{
  const capped={canCapThinking:true};
  for(const [tier,budget] of [['balanced',2048],['deep',8192]] as const){
    const body=openaiArgs(applyReasoningTier(turn,tier,capped),'test-chat','max_tokens',true,true) as unknown as OpenAIBody;
    assert.deepEqual(body.thinking,{type:'enabled',budget_tokens:budget});
    assert.equal('reasoning_effort' in body,false,'a number the endpoint honours must not be undercut by a label');
    assert.ok(body.max_tokens>budget,'the answer keeps its own room on top of the thinking');
  }
  const noNumber=openaiArgs({system:'s',messages:[{role:'user',content:'hi'}],maxTokens:1800,effort:'low'},'test-chat','max_tokens',true,true) as unknown as OpenAIBody;
  assert.equal('thinking' in noNumber,false,'without a budget there is nothing numeric to ask for');
  assert.equal(noNumber.reasoning_effort,'low');
});

test('the learner’s choice reaches the wire',async()=>{
  const original=globalThis.fetch,bodies:Record<string,unknown>[]=[];
  globalThis.fetch=async(_input,init)=>{
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({id:'m',type:'message',role:'assistant',model:'test-chat',content:[{type:'text',text:'ok'}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}});
  };
  try{
    const config:ByokConfig={enabled:true,provider:'anthropic',baseUrl:'',apiKey:'synthetic-test-key',fastModel:'test-chat',smartModel:'test-chat',tokenParam:'max_tokens',reasoningTier:'deep'};
    const llm=makeByokLLM(config);
    assert.equal(llm.thinkingTier,'deep');
    assert.equal(await llm.chatText({system:'s',messages:[{role:'user',content:'hi'}],maxTokens:1000,thinking:false}),'ok');
    assert.deepEqual(bodies[0].thinking,{type:'enabled',budget_tokens:8192});
    assert.equal(bodies[0].max_tokens,1000+8192);
    const untouched=makeByokLLM({...config,reasoningTier:'fast'});
    assert.equal(untouched.thinkingTier,'fast');
    await untouched.chatText({system:'s',messages:[{role:'user',content:'hi'}],maxTokens:1000});
    assert.equal(bodies[1].max_tokens,1000);
    assert.equal('thinking' in bodies[1],false);
  }finally{globalThis.fetch=original;}
});

test('a stored record normalises the tier: legacy configs and garbage both read as fast',async()=>{
  const entries=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{value:{getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>entries.set(key,value),removeItem:(key:string)=>{entries.delete(key);}},configurable:true});
  const {useByok}=await import('../../src/lib/byok');
  const write=(extra?:Record<string,unknown>)=>entries.set('socialcoach.llm.v1',JSON.stringify({version:0,revision:'synthetic',state:{enabled:true,provider:'openai',baseUrl:'',apiKey:'synthetic-test-key',fastModel:'test-chat',smartModel:'test-chat',tokenParam:'max_tokens',...(extra??{})}}));
  for(const [value,expected] of [[undefined,'fast'],['deep','deep'],['maximum-power','fast']] as const){
    write({reasoningTier:value});
    useByok.getState().synchronize();
    assert.equal(useByok.getState().reasoningTier,expected);
  }
  // A stored record that never declared the capability must not gain it: the
  // higher tiers only re-open the suppressed steps once the learner confirms
  // this endpoint accepts a ceiling.
  for(const [value,expected] of [[undefined,false],['yes',false],[true,true]] as const){
    write({thinkingCap:value});
    useByok.getState().synchronize();
    assert.equal(useByok.getState().thinkingCap,expected);
  }
});

test('the task deadline moves with the client that will spend it',async()=>{
  assert.equal(reasoningTimeoutFactor('fast'),1);
  assert.equal(reasoningTimeoutFactor('balanced'),2);
  assert.equal(reasoningTimeoutFactor('deep'),4);
  const real=AbortSignal.timeout,seen:number[]=[];
  const opts:ChatOpts={system:'s',messages:[{role:'user',content:'hi'}],maxTokens:100};
  const idle:LLM={chatText:async()=>'{}',chatStream:()=>{throw Error('unused');}};
  try{
    AbortSignal.timeout=(ms:number)=>{seen.push(ms);return real.call(AbortSignal,ms);};
    await taskLLM({...idle,thinkingTier:'deep'},'hint').chatText(opts);
    await taskLLM(idle,'hint').chatText(opts);
    // hint is 25s; a deep answer is allowed four of them, an unset tier keeps 25s.
    assert.deepEqual(seen,[100_000,25_000]);
  }finally{AbortSignal.timeout=real;}
});
