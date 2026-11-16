'use strict';

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { createInterface } = require('node:readline');

function normalizeCodexQuota(result) {
  const fallback = result?.rateLimits;
  const bucket = result?.rateLimitsByLimitId?.codex ??
    (fallback?.limitId == null || fallback.limitId === 'codex' ? fallback : null);
  return [bucket?.primary, bucket?.secondary].filter(window =>
    Number.isFinite(window?.usedPercent) && Number.isSafeInteger(window.windowDurationMins) &&
    window.windowDurationMins > 0
  ).map(window => ({
    minutes: window.windowDurationMins,
    remaining: Math.min(100, Math.max(0, 100 - window.usedPercent)),
    resetsAt: Number.isSafeInteger(window.resetsAt) && window.resetsAt > 0 &&
      window.resetsAt < 8640000000000 ? window.resetsAt : null,
  }));
}

function codexExecutable() {
  if (process.platform !== 'win32' || !process.env.APPDATA) return null;
  const target = { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' }[process.arch];
  if (!target) return null;
  const executable = join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex',
    'node_modules', '@openai', 'codex-win32-' + process.arch, 'vendor', target, 'bin', 'codex.exe');
  return existsSync(executable) ? executable : null;
}

function query(executable) {
  return new Promise(resolve => {
    const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    });
    const output = createInterface({ input: child.stdout });
    const timeout = setTimeout(() => finish({ status: 'unavailable' }), 10000);
    let settled = false;
    function finish(reply) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      output.close();
      child.stdin.destroy();
      child.kill();
      resolve(reply);
    }
    const fail = () => finish({ status: 'unavailable' });
    const send = message => child.stdin.write(JSON.stringify(message) + '\n');
    child.once('error', fail);
    child.once('close', fail);
    child.stdin.on('error', fail);
    output.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message?.id === 1) {
        if (message.error || !message.result) return fail();
        send({ method: 'initialized' });
        send({ id: 2, method: 'account/rateLimits/read' });
      }
      if (message?.id === 2) {
        if (message.error) return fail();
        const windows = normalizeCodexQuota(message.result);
        finish(windows.length ? { status: 'ok', windows } : { status: 'unavailable' });
      }
    });
    send({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'miku_quota', title: 'Miku Desktop Pet', version: '0.1.0' },
    } });
  });
}

let pending;
function readCodexQuota() {
  if (pending) return pending;
  const executable = codexExecutable();
  if (!executable) return Promise.resolve({ status: 'cli-missing' });
  pending = query(executable).finally(() => { pending = undefined; });
  return pending;
}

module.exports = { readCodexQuota, normalizeCodexQuota };
