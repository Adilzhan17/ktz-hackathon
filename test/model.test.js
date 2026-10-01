import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, act, snapshot, trackView, groupView } from '../server/model.js';

test('completion preserves physical occupancy; removal releases the wagons', () => {
  const state = createState();
  const track = state.stations.find(s => s.id === 'D').tracks[0];
  assert.equal(trackView(state, track).available, 0);
  assert.equal(track.done, 8);
  act(state, { type: 'complete', trackId: track.id });
  assert.equal(track.processing, 0);
  assert.equal(track.done, 10);
  assert.equal(trackView(state, track).available, 0);
  act(state, { type: 'clear', trackId: track.id });
  assert.equal(trackView(state, track).available, 10);
});

test('removing eight finished wagons preserves two still under processing', () => {
  const state = createState();
  act(state, { type: 'clear', trackId: 'D-1' });
  const track = snapshot(state).stations.find(s => s.id === 'D').tracks[0];
  assert.equal(track.processing, 2);
  assert.equal(track.occupied, 2);
  assert.equal(track.available, 8);
});

test('reservation uses a matching track and reduces available capacity', () => {
  const state = createState();
  const group = state.groups.find(g => g.id === 'D-G1');
  const before = groupView(state, group);
  act(state, { type: 'reserve', groupId: group.id });
  const station = snapshot(state).stations.find(s => s.id === 'D');
  const track = station.tracks.find(t => t.id === group.trackId);
  assert.equal(track.cargo, 'grain');
  assert.equal(track.reserved, 10);
  assert.equal(track.available, 0);
  assert.equal(group.trackId, before.suggestedTrack);
  assert.throws(() => act(state, { type: 'reserve', groupId: group.id }), /уже/);
});

test('a group cannot use combined capacity spread across several tracks', () => {
  const state = createState();
  const group = state.groups.find(g => g.id === 'D-G2');
  const view = groupView(state, group);
  assert.equal(view.available, 20);
  assert.equal(view.maxBatch, 10);
  assert.equal(view.eligible, false);
  assert.throws(() => act(state, { type: 'reserve', groupId: group.id }), /Недостаточно/);
});

test('earliest urgent group is not admitted when its specialization has no room', () => {
  const state = createState();
  const groups = snapshot(state).groups.filter(g => g.stationId === 'D');
  assert.equal(groups[0].cargo, 'oil');
  assert.equal(groups[0].eligible, false);
  assert.equal(groups.find(g => g.eligible).origin, 'Майтак');
});

test('cancel restores exactly the capacity reserved', () => {
  const state = createState();
  const before = snapshot(state).stations.find(s => s.id === 'D').available;
  act(state, { type: 'reserve', groupId: 'D-G1' });
  assert.equal(snapshot(state).stations.find(s => s.id === 'D').available, before - 10);
  act(state, { type: 'cancel', groupId: 'D-G1' });
  assert.equal(snapshot(state).stations.find(s => s.id === 'D').available, before);
});

test('arrival requires a reservation and reaching ETA', () => {
  const state = createState();
  assert.throws(() => act(state, { type: 'arrive', groupId: 'D-G1' }), /Сначала/);
  act(state, { type: 'reserve', groupId: 'D-G1' });
  assert.throws(() => act(state, { type: 'arrive', groupId: 'D-G1' }), /ещё в пути/);
  for (let i = 0; i < 5; i++) act(state, { type: 'advance', minutes: 60 });
  act(state, { type: 'arrive', groupId: 'D-G1' });
  const g = state.groups.find(g => g.id === 'D-G1');
  const t = snapshot(state).stations.find(s => s.id === 'D').tracks.find(t => t.id === g.trackId);
  assert.equal(g.status, 'arrived');
  assert.equal(t.reserved, 0);
  assert.equal(t.occupied, 20);
  assert.equal(t.processing + t.done, t.front);
  assert.equal(t.waiting, 4);
  act(state, { type: 'clear', trackId: t.id });
  const after = snapshot(state).stations.find(s => s.id === 'D').tracks.find(track => track.id === t.id);
  assert.equal(after.waiting, 0);
  assert.equal(after.processing, 10);
});

test('time advance completes operations without releasing capacity', () => {
  const state = createState();
  const before = snapshot(state).stations.find(s => s.id === 'D').available;
  act(state, { type: 'advance', minutes: 60 });
  assert.equal(snapshot(state).stations.find(s => s.id === 'D').available, before);
  assert.equal(state.stations.find(s => s.id === 'D').tracks[0].done, 10);
});

test('reserve and admit never overfill a track or its cargo front', () => {
  const state = createState();
  for (let i = 0; i < 30; i++) {
    for (const g of snapshot(state).groups) {
      if (g.eligible) act(state, { type: 'reserve', groupId: g.id });
    }
    act(state, { type: 'advance', minutes: 60 });
    for (const g of snapshot(state).groups) {
      if (g.status === 'reserved' && g.etaAt <= state.now) act(state, { type: 'arrive', groupId: g.id });
    }
    for (const station of snapshot(state).stations) for (const t of station.tracks) {
      assert.ok(t.available >= 0);
      assert.ok(t.occupied + t.reserved <= t.capacity);
      assert.ok(t.processing + t.done <= t.front);
      if (t.done) act(state, { type: 'clear', trackId: t.id });
    }
  }
});

test('closure changes forecast once and requires explicit plan confirmation', () => {
  const state = createState();
  const before = snapshot(state).groups.find(g => g.id === 'D-G1').etaAt;
  assert.throws(() => act(state, { type: 'approve' }), /Нет нового/);
  act(state, { type: 'block' });
  assert.equal(state.planApproved, false);
  assert.equal(snapshot(state).groups.find(g => g.id === 'D-G1').etaAt, before + 40 * 60_000);
  act(state, { type: 'approve' });
  assert.equal(state.planApproved, true);
  act(state, { type: 'block' });
  assert.equal(snapshot(state).groups.find(g => g.id === 'D-G1').etaAt, before);
});

test('invalid requests do not change state', () => {
  const state = createState();
  const before = JSON.stringify(state);
  for (const action of [null, { type: 'unknown' }, { type: 'advance', minutes: -1 }, { type: 'clear', trackId: 'missing' }, { type: 'reserve', groupId: 'missing' }]) {
    assert.throws(() => act(state, action));
    assert.equal(JSON.stringify(state), before);
  }
});

test('missing cargo specialization has no fabricated delivery slack', () => {
  const state = createState();
  const g = groupView(state, state.groups.find(g => g.id === 'A-G6'));
  assert.equal(g.processingMinutes, null);
  assert.equal(g.slackMinutes, null);
  assert.equal(g.eligible, false);
  assert.equal(g.maxBatch, 0);
});
