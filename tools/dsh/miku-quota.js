'use strict';

const MIKU_QUOTA_VIDEOS = {};
const MIKU_QUOTA_REACTIONS = {
  full: { action: '挥挥手', coins: 0 },
  normal: { action: '打个招呼', coins: 4 },
  low: { action: '打个招呼', coins: 2 },
  empty: { action: '撑伞致意', coins: 0 },
};

function mikuQuotaWindowName(minutes) {
  if (minutes % 1440 === 0) return minutes / 1440 + ' 天';
  if (minutes % 60 === 0) return minutes / 60 + ' 小时';
  return minutes + ' 分钟';
}

function mikuQuotaView(windows) {
  const minimum = Math.min(...windows.map(window => window.remaining));
  const tier = minimum >= 70 ? 'full' : minimum >= 30 ? 'normal' : minimum >= 10 ? 'low' : 'empty';
  const formatTime = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const rows = windows.map(window => {
    const remaining = Number(window.remaining.toFixed(2));
    const percent = remaining === 0 && window.remaining > 0 ? '<0.01%' : remaining + '%';
    const reset = window.resetsAt ? formatTime.format(new Date(window.resetsAt * 1000)) + ' 重置' : '重置时间未知';
    return mikuQuotaWindowName(window.minutes) + ' 剩 ' + percent + ' · ' + reset;
  });
  const exhausted = windows.filter(window => window.remaining === 0);
  const nearlyEmpty = windows.filter(window => window.remaining > 0 && window.remaining < 10);
  const title = exhausted.length ? exhausted.map(window => mikuQuotaWindowName(window.minutes)).join('、') + '额度已用完'
    : nearlyEmpty.length ? nearlyEmpty.map(window => mikuQuotaWindowName(window.minutes)).join('、') + '额度快用完了'
    : 'Codex 剩余额度';
  return { tier, text: [title, ...rows].join('\n') };
}

Object.assign(PetSprite.prototype, {
  async showMikuCodexQuota(read = () => window.petBridge.readCodexQuota()) {
    if (this.mikuQuotaPending || !this.canMikuWhisper(false)) return false;
    const canShow = () => this.el.isConnected && this.canMikuWhisper(false);
    this.mikuQuotaPending = true;
    this.showWhisper('在看 Codex 额度…', undefined, undefined, 11000, false, true);
    try {
      const result = await read();
      if (!canShow()) return false;
      if (result?.status !== 'ok' || !result.windows?.length) {
        this.showWhisper(result?.status === 'cli-missing'
          ? '找不到本机的 Codex CLI。'
          : '暂时查不到 Codex 额度，请检查登录和网络后重试。', undefined, undefined, 7500, false, true);
        return false;
      }
      const { tier, text } = mikuQuotaView(result.windows);
      this.showWhisper(text, undefined, undefined, 10000, false, true);
      this.stopMove();
      this.playMikuQuotaReaction(tier);
      return true;
    } catch {
      if (canShow()) this.showWhisper('暂时查不到 Codex 额度，请稍后再试。', undefined, undefined, 7500, false, true);
      return false;
    } finally {
      this.mikuQuotaPending = false;
    }
  },

  playMikuQuotaReaction(tier) {
    this.clearMikuQuotaProp();
    const videoAction = MIKU_QUOTA_VIDEOS[tier];
    if (videoAction) {
      this.playOnce(videoAction);
      return;
    }
    const { action, coins } = MIKU_QUOTA_REACTIONS[tier];
    const prop = document.createElement('div');
    prop.className = 'miku-quota-prop';
    prop.dataset.tier = tier;
    prop.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < coins; i++) {
      const coin = document.createElement('i');
      coin.style.setProperty('--coin', i);
      prop.appendChild(coin);
    }
    this.mikuQuotaProp = prop;
    this.playOnce(action);
    const startedAt = performance.now();
    const followPlayback = () => {
      if (this.mikuQuotaProp !== prop) return;
      if (!this.el.isConnected || !this.canMikuWhisper(false) || this.anim !== action ||
          performance.now() - startedAt > 8000) {
        this.clearMikuQuotaProp();
        return;
      }
      const video = this.front === 0 ? this.videoA : this.videoB;
      if (!prop.isConnected && !this.pending && !video.paused && video.readyState >= 2) {
        this.el.querySelector('.pet-stage').appendChild(prop);
      }
      this.mikuQuotaFrame = requestAnimationFrame(followPlayback);
    };
    this.mikuQuotaFrame = requestAnimationFrame(followPlayback);
  },

  clearMikuQuotaProp() {
    if (!this.mikuQuotaProp) return;
    cancelAnimationFrame(this.mikuQuotaFrame);
    this.mikuQuotaProp.remove();
    this.mikuQuotaProp = null;
  },
});
