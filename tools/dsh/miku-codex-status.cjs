'use strict';

const { homedir } = require('node:os');
const { join } = require('node:path');

const pollMs = 3000;
const activeAgeMs = 2 * 60 * 60 * 1000;
const reactionAgeMs = 45_000;

function readTurns(now, file = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'thread_history_1.sqlite')) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true, timeout: 150 });
  try {
    const root = 'root_turn_id = turn_id';
    return db.prepare(`
      SELECT thread_id, turn_id, started_at, completed_at, status
      FROM thread_turns t
      WHERE ${root} AND (
        (status = 'inProgress'
          AND NOT EXISTS (
            SELECT 1 FROM thread_turns newer
            WHERE newer.thread_id = t.thread_id AND newer.root_turn_id = newer.turn_id
              AND newer.rollout_ordinal > t.rollout_ordinal
              AND newer.status IN ('inProgress','completed','failed','interrupted')
          )
          AND (started_at >= ? OR EXISTS (
            SELECT 1 FROM thread_items i WHERE i.thread_id = t.thread_id AND i.turn_id = t.turn_id
              AND max(coalesce(i.created_at_ms, 0), coalesce(i.completed_at_ms, 0)) >= ?
          )))
        OR (status IN ('completed','failed','interrupted') AND completed_at >= ?)
      )
    `).all(Math.floor((now - activeAgeMs) / 1000), now - activeAgeMs, Math.floor((now - reactionAgeMs) / 1000));
  } finally {
    db.close();
  }
}

function createStatusMonitor({ read = readTurns, publish, clock = Date.now }) {
  let timer;
  let previous;
  let event = { kind: 'idle', id: 0 };
  const key = row => row.thread_id + ':' + row.turn_id;
  function tick() {
    const now = clock();
    let rows;
    try { rows = read(now); } catch { return; }
    const active = new Set(rows.filter(row => row.status === 'inProgress').map(key));
    const terminals = rows.filter(row => row.status !== 'inProgress');
    const status = { active, terminals: new Set(terminals.map(key)), time: now };
    if (active.size) {
      if (event.kind !== 'working') event = { kind: 'working', id: event.id + 1 };
    } else {
      const latest = previous && terminals
        .filter(row => !previous.terminals.has(key(row)) &&
          (previous.active.has(key(row)) || row.completed_at * 1000 >= Math.floor(previous.time / 1000) * 1000))
        .sort((a, b) => b.completed_at - a.completed_at || b.started_at - a.started_at)[0];
      if (latest?.status === 'completed' && now - latest.completed_at * 1000 < reactionAgeMs) {
        event = { kind: 'completed', id: event.id + 1, expires: latest.completed_at * 1000 + reactionAgeMs };
      } else if (latest || event.kind !== 'completed' || now >= event.expires) {
        event = { kind: 'idle', id: event.id };
      }
    }
    previous = status;
    publish(event);
  }
  function setEnabled(enabled) {
    if (enabled && !timer) {
      previous = undefined;
      tick();
      timer = setInterval(tick, pollMs);
    } else if (!enabled && timer) {
      clearInterval(timer);
      timer = undefined;
      previous = undefined;
      event = { kind: 'idle', id: event.id };
      publish(event);
    }
  }
  return { setEnabled, tick };
}

module.exports = { createStatusMonitor, readTurns };
