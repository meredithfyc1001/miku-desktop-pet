'use strict';

const MIKU_WHISPER_INTERVALS = [0, 5, 15, 30];
const MIKU_WHISPER_KEY = 'miku.whisperMinutes';
const MIKU_WHISPER_LINES = [
  { text: '今天的风，借你一点 ♪', action: '摇扇纳凉' },
  { text: '要不要来一串糖葫芦？酸酸甜甜的。', action: '吃糖葫芦' },
  { text: '这朵花给你，放在桌角就好。', action: '凭空生花' },
  { text: '刚想到一小段旋律，我先哼给自己听 ♪', action: '悠闲哼歌' },
  { text: '我这边有伞，你可以往里面站一点。' },
  { text: '雨要是下起来，听伞面响也挺好。' },
  { text: '帽子上的花还在吧？我刚才摸了一下。', action: '整理帽子' },
  { text: '慢慢来呀，我在桌角等你。' },
  { text: '把今天喜欢的一句话留下来吧。' },
  { text: '忙完这一小段，要不要喝口水？' },
  { text: '我没走远，就在这里。' },
  { text: '好像听到雨声了，我看看。', action: '左右张望' },
];
const SYMPHONY_WHISPER_LINES = [
  { text: '准备好了？我给你打个拍子 ♪', action: '挥手问好' },
  { text: '乐谱翻到这里，刚好可以歇一小会儿。', action: '专心读谱' },
  { text: '发夹有点歪，等我摆正一下。', action: '整理金发夹' },
  { text: '这一段先轻轻地弹，下一段再热闹一点。' },
  { text: '八音盒还留着最后一个音，听见了吗？' },
  { text: '今天的谢幕礼，先送给你。', action: '提裙致意' },
];

Object.assign(PetSprite.prototype, {
  initMikuWhisper() {
    this.mikuWhisper = { minutes: 0, timer: null, pending: null, lastLine: null };
    try {
      const saved = Number(localStorage.getItem(MIKU_WHISPER_KEY));
      if (MIKU_WHISPER_INTERVALS.includes(saved)) this.mikuWhisper.minutes = saved;
    } catch { /* The manual action still works if storage is unavailable. */ }
    if (MIKU_WHISPER_INTERVALS.includes(this.pet.mikuWhisperInterval)) this.mikuWhisper.minutes = this.pet.mikuWhisperInterval;
    this.scheduleMikuWhisper();
  },

  disposeMikuWhisper() {
    const state = this.mikuWhisper;
    if (!state) return;
    window.clearTimeout(state.timer);
    state.pending?.abort();
    this.mikuWhisper = null;
  },

  mikuWhisperMenu() {
    const minutes = this.mikuWhisper?.minutes ?? 0;
    return { label: '碎碎念', children: [
      { label: '说一句', action: 'miku-whisper' },
      { label: minutes ? `自动碎碎念（${minutes} 分钟）` : '自动碎碎念（关闭）',
        children: MIKU_WHISPER_INTERVALS.map(value => ({
          label: `${value === minutes ? '✓ ' : ''}${value ? `每 ${value} 分钟` : '关闭'}`,
          action: 'miku-whisper-interval', value,
        })) },
      { label: '模型设置', action: 'open-site' },
    ] };
  },

  setMikuWhisperInterval(minutes) {
    const state = this.mikuWhisper;
    if (!state || !MIKU_WHISPER_INTERVALS.includes(minutes)) return;
    state.minutes = minutes;
    try { localStorage.setItem(MIKU_WHISPER_KEY, String(minutes)); } catch { /* Session setting still applies. */ }
    window.petBridge?.saveMikuWhisperInterval?.(minutes).catch(() => {});
    this.scheduleMikuWhisper();
  },

  scheduleMikuWhisper(delay) {
    const state = this.mikuWhisper;
    window.clearTimeout(state.timer);
    state.timer = state.minutes ? window.setTimeout(async () => {
      state.timer = null;
      const shown = await this.sayMikuWhisper(true);
      if (this.mikuWhisper === state && state.timer === null) this.scheduleMikuWhisper(shown ? undefined : 30000);
    }, delay ?? state.minutes * 60000) : null;
  },

  canMikuWhisper(automatic) {
    if (this.sleeping || this.frozen || this.dragState.active || this.throwState || this.todoOpen || this.chatOpen) return false;
    return !automatic || (this.mikuWhisper.minutes > 0 && !this.menuOpen && !this.whisperOn &&
      !this.pending && this.animations.idle.includes(this.anim));
  },

  async sayMikuWhisper(automatic = false) {
    const state = this.mikuWhisper;
    if (!state || state.pending || !this.canMikuWhisper(automatic)) return false;
    const request = new AbortController();
    state.pending = request;
    const timer = window.setTimeout(() => request.abort(), 8000);
    let text = '';
    const symphony = this.pet.mikuAppearance === 'symphony';
    try {
      const delivery = automatic ? 'miku-auto' : 'miku';
      const appearance = symphony ? '&appearance=symphony' : '';
      const response = await fetch(`${BASE}/whisper?pet=${encodeURIComponent(this.pet.id)}&surface=desktop&delivery=${delivery}${appearance}`, {
        method: 'POST', signal: request.signal,
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.ok && typeof data.text === 'string') text = Array.from(data.text.replace(/\s+/g, ' ').trim()).slice(0, 60).join('');
      }
    } catch { /* Use a local line if the service is unavailable. */ }
    finally {
      window.clearTimeout(timer);
      state.pending = null;
    }
    if (this.mikuWhisper !== state || !this.canMikuWhisper(automatic)) return false;
    let action;
    if (!text) {
      const line = S.pick(symphony ? SYMPHONY_WHISPER_LINES : MIKU_WHISPER_LINES, state.lastLine);
      state.lastLine = line;
      ({ text, action } = line);
    }
    this.showWhisper(text, undefined, undefined, 6500, false);
    if (action && !this.pending && this.animations.idle.includes(this.anim) &&
        (!symphony || this.pet.mikuActionNames.has(action))) this.playOnce(action);
    return true;
  },
});
