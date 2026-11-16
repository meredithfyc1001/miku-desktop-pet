'use strict';

const MIKU_CODEX_ACTIONS = {
  working: '翻翻书',
  completed: '比个耶',
};

PetSprite.prototype.onMikuCodexStatus = function (event) {
  const action = Object.hasOwn(MIKU_CODEX_ACTIONS, event.kind) && MIKU_CODEX_ACTIONS[event.kind];
  if (!action ||
      (event.expires && Date.now() >= event.expires) ||
      this.menuOpen || this.mikuQuotaPending || this.whisperOn || this.pending ||
      this.mikuActionClick != null || !this.animations.idle.includes(this.anim)) return;
  if (!this.playMikuCatalogAction(action)) return false;
  if (event.kind === 'completed') this.showWhisper('Codex 做完这一轮啦 ♪', undefined, undefined, 4500, false);
  return true;
};
