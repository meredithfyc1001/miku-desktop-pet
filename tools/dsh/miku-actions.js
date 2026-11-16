'use strict';

const find = id => document.getElementById(id);
const search = find('search');
const category = find('category');
const onlyFavorites = find('only-favorites');
const cards = find('cards');
const video = find('video');
const previewPlay = find('preview-play');
const play = find('play');
const favorite = find('favorite');
const status = find('status');
let catalog = [];
let favorites = new Set();
let selected;
let showingFavorites = false;
let savingFavorite = false;
let requestingPlay = false;
const posterUrl = action => './miku-action-posters/' + action.poster;

function refreshSelection() {
  for (const card of cards.children) {
    card.setAttribute('aria-pressed', String(card.dataset.name === selected?.name));
    card.querySelector('.star').textContent = favorites.has(card.dataset.name) ? '★' : '';
  }
  const saved = favorites.has(selected?.name);
  favorite.setAttribute('aria-pressed', String(saved));
  favorite.textContent = saved ? '★ 已收藏' : '☆ 收藏';
  favorite.disabled = !selected || savingFavorite;
  previewPlay.disabled = !selected;
  play.disabled = !selected || requestingPlay;
}

function selectAction(action, autoplay) {
  selected = action;
  video.controls = false;
  video.poster = posterUrl(action);
  video.src = action.video;
  find('title').textContent = action.name;
  find('meta').textContent = action.category + ' · ' +
    new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(action.seconds) + ' 秒';
  status.textContent = '';
  refreshSelection();
  if (autoplay && !matchMedia('(prefers-reduced-motion: reduce)').matches) void video.play().catch(() => {});
}

function render() {
  const query = search.value.trim().toLowerCase();
  const visible = catalog.filter(action =>
    (!category.value || action.category === category.value) &&
    (!showingFavorites || favorites.has(action.name)) &&
    (action.name.toLowerCase().includes(query) || action.category.includes(query)));
  const list = document.createDocumentFragment();
  const focusedAction = cards.contains(document.activeElement) ? document.activeElement.dataset.name : null;
  let nextFocus;
  for (const action of visible) {
    const card = find('card').content.firstElementChild.cloneNode(true);
    card.dataset.name = action.name;
    card.querySelector('img').src = posterUrl(action);
    card.querySelector('.name').textContent = action.name;
    card.addEventListener('click', () => selectAction(action, true));
    if (action.name === focusedAction) nextFocus = card;
    list.append(card);
  }
  cards.replaceChildren(list);
  nextFocus?.focus({ preventScroll: true });
  find('results').textContent = visible.length
    ? visible.length + ' 个动作'
    : showingFavorites && !favorites.size ? '收藏喜欢的动作后，就能在这里找到。' : '没有符合条件的动作。';
  onlyFavorites.textContent = (showingFavorites ? '★' : '☆') + ' 只看收藏' +
    (favorites.size ? ' · ' + favorites.size : '');
  onlyFavorites.setAttribute('aria-pressed', String(showingFavorites));
  refreshSelection();
}

search.addEventListener('input', render);
category.addEventListener('change', render);
onlyFavorites.addEventListener('click', () => { showingFavorites = !showingFavorites; render(); });
video.addEventListener('playing', () => { video.controls = true; });
video.addEventListener('error', () => { status.textContent = '预览载入失败。'; });
previewPlay.addEventListener('click', () => {
  video.currentTime = 0;
  void video.play().catch(() => { status.textContent = '预览播放失败，请重试。'; });
});
favorite.addEventListener('click', async () => {
  const action = selected;
  const add = !favorites.has(action.name);
  savingFavorite = true;
  refreshSelection();
  try {
    const saved = await window.mikuActions.favorite(action.name, add);
    if (!Array.isArray(saved)) throw new Error();
    favorites = new Set(saved);
    render();
    if (selected === action) status.textContent = add ? '已收藏' : '已取消收藏';
  } catch {
    if (selected === action) status.textContent = '收藏保存失败，请重试。';
  } finally {
    savingFavorite = false;
    refreshSelection();
  }
});
play.addEventListener('click', async () => {
  const action = selected;
  const messages = { playing: '已在桌面播放', busy: 'Miku 正忙，请稍后再试。', hidden: '请从托盘显示 Miku 后再试。' };
  requestingPlay = true;
  refreshSelection();
  let result;
  try { result = await window.mikuActions.play(action.name); } catch {}
  if (selected === action) status.textContent = messages[result] ?? '暂时无法播放，请重试。';
  requestingPlay = false;
  refreshSelection();
});

void (async () => {
  try {
    const data = await window.mikuActions.list();
    catalog = data.catalog;
    favorites = new Set(data.favorites);
    find('total').textContent = 'Miku · ' + catalog.length + ' 个动作';
    for (const name of new Set(catalog.map(action => action.category))) category.add(new Option(name, name));
    render();
    if (catalog.length) selectAction(catalog[0], false);
  } catch {
    find('results').textContent = '动作图鉴暂时读不到，请关闭后重试。';
  }
})();
