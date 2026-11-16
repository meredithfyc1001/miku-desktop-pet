'use strict';

const form = document.querySelector('#settings');
const fieldset = document.querySelector('#fields');
const save = document.querySelector('#save');
const status = document.querySelector('#status');
const video = document.querySelector('.art video');
const sections = [...document.querySelectorAll('[data-section]')];
const pages = [...document.querySelectorAll('[data-page]')];
const fields = [...form.querySelectorAll('[name]')];
let initial;

function message(text, error = false) {
  status.textContent = text;
  status.toggleAttribute('data-error', error);
}

function values() {
  return Object.fromEntries(fields.map(field => {
    const value = field.type === 'checkbox' ? field.checked
      : field.type === 'number' || field.type === 'range' ? field.valueAsNumber
      : field.name === 'whisper' ? Number(field.value) : field.value.trim();
    return [field.name, value];
  }));
}

function updatePreview() {
  const data = values();
  document.querySelector('#sizeValue').textContent = Math.round(data.size) + ' px';
  video.style.transform = 'scale(' + Math.min(1.25, Math.max(.55, data.size / 420)) + ')';
  const bubble = document.querySelector('#bubble');
  bubble.dataset.family = data.family;
  bubble.style.fontSize = (data.fontSize * (data.followPet ? data.size / 462 : 1)) + 'px';
  const weight = 100 - data.idle - (data.wander ? data.turn + data.move : 0);
  document.querySelector('#randomWeight').textContent = Number.isFinite(weight) && weight >= 0
    ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(weight) + '%'
    : '—';
  save.disabled = !initial || fields.every(field => data[field.name] === initial[field.name]);
}

function showPage(name) {
  sections.forEach(section => { section.hidden = section.dataset.section !== name; });
  pages.forEach(button => {
    if (button.dataset.page === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}
pages.forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
form.addEventListener('input', () => { updatePreview(); message(''); });
form.noValidate = true;
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!initial || save.disabled) return;
  const invalid = fields.find(field => !field.validity.valid);
  if (invalid) {
    showPage(invalid.closest('[data-section]').dataset.section);
    invalid.reportValidity();
    message('请检查这一项的填写范围。', true);
    return;
  }
  const current = values();
  if (!current.name || current.idle + current.turn + current.move > 100) {
    showPage(!current.name ? 'desktop' : 'motion');
    message(!current.name ? '请填写桌宠昵称。' : '三项动作频率加起来不能超过 100%。', true);
    return;
  }
  const changes = Object.fromEntries(Object.entries(current).filter(([key, value]) => value !== initial[key]));
  fieldset.disabled = save.disabled = true;
  try {
    const result = await window.mikuSettings.save(changes);
    if (!result.ok) throw new Error(result.message || '无法保存设置。');
    initial = current;
    message('已保存');
  } catch (error) {
    message(error.message || '保存失败，请重试。', true);
  } finally {
    fieldset.disabled = false;
    updatePreview();
  }
});

document.querySelector('#model').addEventListener('click', async () => {
  try {
    if (!await window.mikuSettings.model()) throw new Error();
  } catch { message('暂时打不开模型设置。', true); }
});
if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  video.removeAttribute('autoplay');
  video.pause();
}
void (async () => {
  try {
    const data = await window.mikuSettings.read();
    if (!data) throw new Error();
    for (const field of fields) {
      if (field.type === 'checkbox') field.checked = data[field.name] === true;
      else field.value = data[field.name] ?? '0';
    }
    initial = values();
    fieldset.disabled = false;
    updatePreview();
    message('');
  } catch {
    message('暂时读不到设置，请关闭窗口后重试。', true);
  }
})();
