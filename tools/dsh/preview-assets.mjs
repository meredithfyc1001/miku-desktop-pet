/** Locate reviewed clips and select one asset for each desktop action. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const previews = [
  { action:'flow-idle', name:'Flow待机样片', target:'待机眨眼' },
  { action:'flow-hat', name:'Flow整理帽子样片', target:'整理帽子' },
  { action:'hat', name:'Gemini整理帽子样片', target:'整理帽子' },
  { action:'flow-gaze', name:'Flow张望样片', target:'左右张望' },
  { action:'gaze', name:'Gemini张望样片', target:'左右张望' },
  { action:'flow-shy', name:'Flow害羞样片', target:'害羞一下' },
  { action:'shy', name:'Gemini害羞样片', target:'害羞一下' },
  { action:'flow-nod', name:'Flow点头样片', target:'打个招呼' },
  { action:'nod', name:'Gemini点头样片', target:'打个招呼' },
  { action:'flow-step-short', name:'Flow短版踏步样片', target:'原地踏步', menuOnly:true },
  { action:'flow-step', name:'Flow踏步样片', target:'原地踏步', menuOnly:true },
  { action:'flow-wave', name:'Flow挥手样片', target:'挥挥手' },
  { action:'flow-pat', name:'Flow开心回应样片', target:'开心回应' },
  { action:'flow-sleep', name:'Flow打个盹样片', target:'打个盹' },
  { action:'flow-wake', name:'Flow慢慢醒来样片', target:'慢慢醒来' },
  { action:'flow-lift', name:'Flow提起晃腿样片', target:'提起晃腿' },
  { action:'flow-land', name:'Flow落地站稳样片', target:'落地站稳' },
  { action:'flow-salute', name:'Flow撑伞致意样片', target:'撑伞致意' },
  { action:'flow-dance', name:'Flow轻快舞步样片', target:'轻快舞步' },
  { action:'flow-sway', name:'Flow开心摇摆样片', target:'开心摇摆' },
  { action:'flow-dream', name:'Flow睡梦中样片', target:'睡梦中' },
  { action:'flow-walk', name:'Flow散步样片', target:'散步一下' },
  { action:'flow-hang', name:'Flow悬空轻晃样片', target:'悬空轻晃' },
  { action:'flow-fan', name:'Flow摇扇纳凉样片', target:'摇扇纳凉', lifeAction:true },
  { action:'flow-tanghulu', name:'Flow吃糖葫芦样片', target:'吃糖葫芦', lifeAction:true },
  { action:'flow-flower', name:'Flow凭空生花样片', target:'凭空生花', lifeAction:true },
  { action:'flow-hum', name:'Flow悠闲哼歌样片', target:'悠闲哼歌', lifeAction:true },
  { action:'flow-cube', name:'Flow玩魔方样片', target:'玩魔方', lifeAction:true },
  { action:'flow-mirror', name:'Flow照镜子样片', target:'照镜子', lifeAction:true },
  { action:'flow-stretch', name:'Flow伸懒腰样片', target:'伸个懒腰', lifeAction:true },
  { action:'flow-yawn', name:'Flow打哈欠样片', target:'打个哈欠', lifeAction:true },
  { action:'flow-balloon', name:'Flow吹气球样片', target:'吹气球', lifeAction:true },
  { action:'flow-bell', name:'Flow摇铃铛样片', target:'摇铃铛', lifeAction:true },
  { action:'flow-tea', name:'Flow喝茶样片', target:'喝口茶', lifeAction:true },
  { action:'flow-book', name:'Flow翻书样片', target:'翻翻书', lifeAction:true },
  { action:'flow-onigiri', name:'Flow饭团样片', target:'吃个饭团', lifeAction:true },
  { action:'flow-microphone', name:'Flow麦克风样片', target:'唱一小段', lifeAction:true },
  { action:'flow-magnifier', name:'Flow举放大镜样片', target:'举放大镜', lifeAction:true },
  { action:'flow-cookie', name:'Flow吃小饼干样片', target:'吃小饼干', lifeAction:true },
  { action:'flow-maraca', name:'Flow摇沙锤样片', target:'摇沙锤', lifeAction:true },
  { action:'flow-paper-crane', name:'Flow看看纸鹤样片', target:'看看纸鹤', lifeAction:true },
  { action:'flow-pocket-watch', name:'Flow看看怀表样片', target:'看看怀表', lifeAction:true },
  { action:'flow-lantern', name:'Flow点亮小灯样片', target:'点亮小灯', lifeAction:true },
  { action:'flow-map', name:'Flow看看地图样片', target:'看看地图', lifeAction:true },
  { action:'flow-wind-chime', name:'Flow摇摇风铃样片', target:'摇摇风铃', lifeAction:true },
  { action:'flow-flower-card', name:'Flow展示花印卡样片', target:'展示花印卡', lifeAction:true },
  { action:'flow-head-shake', name:'Flow扭头抿嘴样片', target:'扭头抿嘴', clickAction:true },
  { action:'flow-shush', name:'Flow嘘一下样片', target:'嘘一下', clickAction:true },
  { action:'flow-thumbs-up', name:'Flow给你点赞样片', target:'给你点赞', clickAction:true },
  { action:'flow-victory-sign', name:'Flow比个耶样片', target:'比个耶', clickAction:true },
  { action:'flow-wrist-stretch', name:'Flow转转手腕样片', target:'转转手腕', clickAction:true },
  { action:'flow-lean-in', name:'Flow凑近看看样片', target:'凑近看看', clickAction:true },
  { action:'flow-smooth-skirt', name:'Flow理理裙摆样片', target:'理理裙摆', lifeAction:true },
  { action:'flow-shrug', name:'Flow摊手耸肩样片', target:'摊手耸肩', clickAction:true },
  { action:'flow-think', name:'Flow想一想样片', target:'想一想', clickAction:true },
  { action:'flow-pocket-notebook', name:'Flow看看袖珍本样片', target:'看看袖珍本', lifeAction:true },
  { action:'flow-music-box', name:'Flow打开音乐盒样片', target:'打开音乐盒', lifeAction:true },
  { action:'flow-tea-tin', name:'Flow闻茶香样片', target:'闻茶香', lifeAction:true },
  { action:'flow-ribbon-spool', name:'Flow看丝带样片', target:'看丝带', lifeAction:true },
  { action:'flow-startle', name:'Flow小跳样片', target:'吓一小跳', clickAction:true },
  { action:'flow-finger-heart', name:'Flow比心样片', target:'眨眼比心', clickAction:true },
  { action:'flow-thanks', name:'Flow鞠躬谢谢样片', target:'鞠躬谢谢', clickAction:true },
  { action:'flow-pout', name:'Flow鼓鼓脸颊样片', target:'鼓鼓脸颊', clickAction:true },
  { action:'flow-ear-cup', name:'Flow侧耳听听样片', target:'侧耳听听', clickAction:true },
  { action:'flow-umbrella-peek', name:'Flow伞后探头样片', target:'伞后探头', clickAction:true },
  { action:'flow-quota-full-five', name:'Flow五秒钱袋样片', target:'举起钱袋', quotaTier:'full' },
  { action:'flow-quota-normal', name:'Flow数零钱样片', target:'低头数零钱', quotaTier:'normal' },
  { action:'flow-quota-low', name:'Flow数最后两枚样片', target:'数最后两枚', quotaTier:'low' },
  { action:'flow-quota-empty', name:'Flow抖空袋样片', target:'抖抖空袋', quotaTier:'empty' }
];

export function verifyPreviewReport(report, candidateDigest, referenceDigest, review) {
  if (report.candidateSha256 !== candidateDigest || report.referenceSha256 !== referenceDigest ||
      !Number.isSafeInteger(report.frames) || report.frames < 1 || report.width !== 640 || report.height !== 360) {
    throw new Error('The preview does not match its verified candidate report or the current idle reference.');
  }
  if (review?.status !== 'passed' || review.candidateSha256 !== candidateDigest) {
    throw new Error('The preview has not passed visual review for this exact video.');
  }
}

export function collectReadyPreviews(root) {
  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
  const reference = join(root,'integrations/dsh/pack/miku-animation/待机眨眼.png');
  const referenceDigest = hash(reference);
  const ready = [];
  for (const preview of previews) {
    const folder = join(root,'assets/video-production/revised',preview.action);
    const source = join(folder,'aligned-candidate.webm');
    const reportFile = join(folder,'alignment-report.json');
    const reviewFile = join(folder,'preview-review.json');
    const hasSource = existsSync(source), hasReport = existsSync(reportFile);
    // A candidate stays out of the menu until someone records a visual review.
    if (!existsSync(reviewFile)) continue;
    if (!hasSource || !hasReport) throw new Error(`Incomplete preview: ${preview.name}`);
    const report = JSON.parse(readFileSync(reportFile,'utf8'));
    const review = JSON.parse(readFileSync(reviewFile,'utf8'));
    verifyPreviewReport(report,hash(source),referenceDigest,review);
    ready.push({...preview,source,frames:report.frames});
  }
  return ready;
}

export function selectActiveClips(ready) {
  // The first reviewed clip for a target takes precedence.
  const selected = new Map();
  for (const clip of ready) {
    if (!selected.has(clip.target)) selected.set(clip.target, clip);
  }
  return [...selected.values()];
}
