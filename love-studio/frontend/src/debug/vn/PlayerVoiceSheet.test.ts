import { describe, expect, it } from 'vitest';
import type { TtsConnection, VoiceProfile } from '../lib/api';
import {
  bindMainRequest,
  describeConnTest,
  PVS_EMPTY,
  unbindRequest,
  voiceListNote,
  voiceSettingsTarget,
} from './playerVoice';

const conn = (over: Partial<TtsConnection> = {}): TtsConnection => ({
  id: 'c1',
  name: '本地',
  api_type: 'gpt_sovits',
  base_url: 'http://127.0.0.1:9880',
  sample_steps: 64,
  emo_alpha: 1,
  profile_count: 0,
  model: '',
  voice: '',
  format: 'wav',
  has_key: false,
  ...over,
});

const profile = (over: Partial<VoiceProfile> = {}): VoiceProfile => ({
  id: 'p1',
  name: '琴柳',
  aliases: [],
  connection_id: 'c1',
  gpt_weights: '',
  sovits_weights: '',
  ref_path: '',
  text_lang: 'zh',
  speed: 1,
  params: {},
  emotions: [],
  card_count: 0,
  ...over,
});

describe('voiceSettingsTarget', () => {
  it('玩家模式进语音设置面板,创作者模式进插件页', () => {
    expect(voiceSettingsTarget(false)).toBe('sheet');
    expect(voiceSettingsTarget(true)).toBe('plugin');
  });
});

describe('bindMainRequest', () => {
  it('设为主声音:旧主声音降成备用', () => {
    expect(bindMainRequest({ main: 'v1', extras: ['v3'] }, 'v2')).toEqual({
      main: 'v2',
      extras: ['v3', 'v1'],
    });
  });

  it('没绑过时设主声音,备用不动', () => {
    expect(bindMainRequest({ main: null, extras: [] }, 'v1')).toEqual({ main: 'v1', extras: [] });
  });

  it('把备用升成主声音:自己从备用里摘掉,旧主声音排到备用末尾', () => {
    expect(bindMainRequest({ main: 'v1', extras: ['v2', 'v3'] }, 'v2')).toEqual({
      main: 'v2',
      extras: ['v3', 'v1'],
    });
  });
});

describe('unbindRequest', () => {
  it('解除主声音:主声音和备用里都摘掉', () => {
    expect(unbindRequest({ main: 'v1', extras: ['v1', 'v2'] }, 'v1')).toEqual({
      main: null,
      extras: ['v2'],
    });
  });

  it('解除备用声音,主声音不动', () => {
    expect(unbindRequest({ main: 'v1', extras: ['v2', 'v3'] }, 'v2')).toEqual({
      main: 'v1',
      extras: ['v3'],
    });
  });
});

describe('voiceListNote', () => {
  it('没选角色:先选角色', () => {
    expect(voiceListNote({ cardId: null, connections: [], profiles: [] })).toBe(PVS_EMPTY.noCard);
    expect(voiceListNote({ cardId: null, connections: null, profiles: null })).toBe(PVS_EMPTY.noCard);
  });

  it('有卡没连接:先去填服务地址', () => {
    expect(voiceListNote({ cardId: 'c1', connections: [], profiles: [] })).toBe(PVS_EMPTY.noConnections);
  });

  it('有连接没声音:声音要在创作者模式里建', () => {
    expect(voiceListNote({ cardId: 'c1', connections: [conn()], profiles: [] })).toBe(PVS_EMPTY.noProfiles);
  });

  it('还在读不提示;都齐了不提示', () => {
    expect(voiceListNote({ cardId: 'c1', connections: null, profiles: null })).toBeNull();
    expect(voiceListNote({ cardId: 'c1', connections: [conn()], profiles: [profile()] })).toBeNull();
  });
});

describe('describeConnTest', () => {
  it('没测过显示空', () => {
    expect(describeConnTest({ state: 'idle' })).toBe('');
  });

  it('测试中和通 xx ms', () => {
    expect(describeConnTest({ state: 'testing' })).toBe('测试中…');
    expect(describeConnTest({ state: 'ok', ms: 42 })).toBe('通 42 ms');
  });

  it('失败显示原因', () => {
    expect(describeConnTest({ state: 'fail', error: '连不上语音服务' })).toBe('连不上语音服务');
  });
});
