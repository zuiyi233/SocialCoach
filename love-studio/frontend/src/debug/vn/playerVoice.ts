/**
 * 玩家模式语音设置面板(PlayerVoiceSheet)的纯逻辑:空状态提示、绑定请求体、入口去向、
 * 连接测试的一行字。UI 不掺在这里,测试也只测这里。
 */

import type { CardVoices, TtsConnection, VoiceProfile } from '../lib/api';
import { switchMainVoice } from '../plugins/voice';

/** 空状态给玩家看的一句人话 */
export const PVS_EMPTY = {
  noCard: '先选一个角色,再绑声音',
  noConnections: '还没有语音服务。先在下边填一个服务地址',
  noProfiles: '还没有声音档案:声音要在创作者模式里建。建好之后回来,就能把声音绑到这张卡',
} as const;

/** 音色列表上方的提示:按「有没有当前卡 / 连接 / 声音」给一句空状态;还在读时给 null(不提示) */
export function voiceListNote(opts: {
  cardId: string | null;
  connections: TtsConnection[] | null;
  profiles: VoiceProfile[] | null;
}): string | null {
  if (!opts.cardId) return PVS_EMPTY.noCard;
  if (opts.connections === null || opts.profiles === null) return null;
  if (opts.connections.length === 0) return PVS_EMPTY.noConnections;
  if (opts.profiles.length === 0) return PVS_EMPTY.noProfiles;
  return null;
}

/** 把某个声音设成当前卡的主声音:旧主声音降成备用(和创作者模式插件页同一套 switchMainVoice) */
export function bindMainRequest(binding: CardVoices, voiceId: string): CardVoices {
  return switchMainVoice(binding, voiceId);
}

/** 解除某个声音:从主声音和备用里都摘掉 */
export function unbindRequest(binding: CardVoices, voiceId: string): CardVoices {
  return {
    main: binding.main === voiceId ? null : binding.main,
    extras: binding.extras.filter((id) => id !== voiceId),
  };
}

/** 语音设置的入口去向:创作者模式进插件抽屉的完整语音页,玩家模式进这个面板 */
export function voiceSettingsTarget(creator: boolean): 'plugin' | 'sheet' {
  return creator ? 'plugin' : 'sheet';
}

export type ConnTest =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; ms: number }
  | { state: 'fail'; error: string };

/** 连接测试结果的一行字;没测过显示空 */
export function describeConnTest(t: ConnTest): string {
  switch (t.state) {
    case 'idle':
      return '';
    case 'testing':
      return '测试中…';
    case 'ok':
      return `通 ${t.ms} ms`;
    case 'fail':
      return t.error;
  }
}
