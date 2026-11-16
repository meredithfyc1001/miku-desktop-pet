'use strict';

Object.assign(PetSprite.prototype, {
  cancelMikuActionClick() {
    if (this.mikuActionClick == null) return;
    window.clearTimeout(this.mikuActionClick);
    this.mikuActionClick = null;
  },

  playMikuCatalogAction(name) {
    if (!name || this.frozen || this.sleeping || this.dragState.active || this.justDragged ||
        this.throwState || this.todoOpen || this.chatOpen) return false;
    this.cancelMikuActionClick();
    this.stopMove();
    this.playOnce(name);
    this.mikuCatalogPlaying = name;
    return true;
  },

  playMikuClick(detail, respond) {
    if (!this.pet.mikuFavorites?.length) {
      respond();
      return;
    }
    if (detail === 2 && this.mikuActionClick != null) {
      this.cancelMikuActionClick();
      const action = S.pick(this.pet.mikuFavorites, this.anim);
      if (!this.playMikuCatalogAction(action)) respond();
      return;
    }
    if (detail > 2) return;
    this.cancelMikuActionClick();
    this.mikuActionClick = window.setTimeout(() => {
      this.mikuActionClick = null;
      if (!this.sleeping && !this.frozen && !this.dragState.active && !this.justDragged &&
          !this.menuOpen && !this.todoOpen && !this.chatOpen) respond();
    }, 400);
  },
});
