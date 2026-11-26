import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const idle = '交响乐待机';
export const standingBreak = '站久了，放松一下';
const curtsy = '提裙致意';
const wave = '挥手问好';
const hairClip = '整理金发夹';
const heart = '双手比心';
const stretch = '伸伸懒腰';
const wink = '俏皮眨眼';
const giggle = '掩嘴轻笑';
const clap = '轻轻鼓掌';
const listen = '侧耳听声';
const hop = '脚尖小跳';
const tea = '暖手喝茶';
const kiss = '送个飞吻';
const fan = '折扇轻摇';
const swish = '轻甩双马尾';
const rest = '坐下歇歇';
const watch = '举起金怀表';
const star = '送你小星星';
const surprised = '惊讶后仰';
const daydream = '托腮发呆';
const yawn = '困到打哈欠';
const shrug = '摊手问号';
const mirror = '照照手镜';
const pout = '抱臂嘟嘴';
const letter = '拆开小信封';
const cheer = '攥拳打气';
const flower = '捡起小白花';
const bow = '整理金领结';
const cookie = '尝一口小饼干';
const pinwheel = '拨转小风车';
const tiptoe = '踮脚探头';
const eyeRub = '揉揉睡眼';
const cushion = '抱住音符枕';
const cube = '拧动小魔方';
const hourglass = '翻转小沙漏';
const butterfly = '蝴蝶落指尖';
const turn = '八音盒旋转';
const conducting = '挥棒指挥';
const triangle = '提起三角铁';
const trumpet = '吹响小号';
const violin = '小提琴独奏';
const glockenspiel = '轻敲钟琴';
const harp = '拨响小竖琴';
const tambourine = '轻摇铃鼓';
const waltz = '两步小华尔兹';
const kalimba = '轻弹拇指琴';
const ribbon = '画一圈缎带';
const metronome = '跟着节拍';
const bouquet = '捧花谢礼';
const windUp = '发条开场';
const walk = '交响乐散步';
const drag = '悬空轻摆';
const land = '轻轻落地';
const working = '专心读谱';
const sleep = { start: '轻轻合眼', loop: '闭眼小憩', end: '缓缓醒来' };
const quotaActions = {
  full: '交响乐·举起钱袋',
  normal: '交响乐·数数零钱',
  low: '交响乐·只剩两枚',
  empty: '交响乐·抖抖空袋',
};

export function loadSymphony(root) {
  const folder = join(root, 'assets/video-production/symphony-2020/v2');
  const approved = JSON.parse(readFileSync(join(folder, 'desktop-clips.json'), 'utf8'));
  const clips = approved.map(({ file, name, frames, sha256 }) => {
    const source = join(folder, file);
    const digest = createHash('sha256').update(readFileSync(source)).digest('hex');
    if (digest.toUpperCase() !== sha256) throw new Error('Symphony clip changed after review: ' + name);
    return { source, target: name, frames };
  });
  const names = clips.map(clip => clip.target);
  const available = (...candidates) => candidates.filter(name => names.includes(name));
  if (!names.includes(idle) || !names.includes(standingBreak)) throw new Error('Missing the Symphony idle or standing break');
  const sleepNames = Object.values(sleep);
  const hasSleep = available(...sleepNames).length === sleepNames.length;
  const quota = Object.fromEntries(Object.entries(quotaActions).filter(([, name]) => names.includes(name)));
  const dailyActions = available(
    standingBreak, hairClip, stretch, listen, tea, fan, swish, rest, watch, daydream, yawn, mirror,
    letter, flower, bow, cookie, pinwheel, tiptoe, eyeRub, cushion, cube, hourglass, butterfly,
  );
  const clickActions = available(curtsy, wave, heart, wink, giggle, clap, hop, kiss, star, surprised, shrug, pout, cheer);
  const stageActions = available(
    conducting, triangle, trumpet, violin, glockenspiel, harp, tambourine, kalimba, metronome, bouquet, waltz, ribbon,
  );
  const animations = {
    idle: [idle],
    turn: available(turn),
    clicks: clickActions,
    drag: available(drag),
    moves: {
      default: { minDist: 36, maxDist: 78, margin: 20, leadSec: .42, tailSec: .52 },
      actions: available(walk).map(name => ({ name })),
    },
    categories: [
      { id: '日常', noMirror: true, weight: 2, actions: [...dailyActions, ...available(curtsy)] },
      { id: '舞台', noMirror: true, weight: 1, actions: stageActions },
    ].filter(category => category.actions.length),
    events: { balance: Object.values(quota) },
    sleep: hasSleep ? [Object.fromEntries(Object.entries(sleep).map(([phase, name]) => [phase, [name]]))] : [],
  };
  return {
    clips,
    names,
    animations,
    sleep: hasSleep ? sleep : null,
    quota,
    landing: available(land)[0] ?? null,
    groups: [
      { label: '日常', names: [idle, ...dailyActions] },
      { label: '点击互动', names: clickActions },
      { label: '舞台', names: [...available(turn), ...stageActions, ...available(windUp)] },
      { label: '移动与拖拽', names: available(walk, drag, land) },
      { label: '睡眠', names: available(...sleepNames) },
      { label: 'Codex 联动', names: available(working) },
      { label: '额度动作', names: Object.values(quota) },
    ],
    codex: { working: available(working)[0] ?? idle, completed: available(curtsy)[0] ?? idle },
  };
}
