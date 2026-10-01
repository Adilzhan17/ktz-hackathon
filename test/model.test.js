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
  group.count = 15;
  act(state, { type: 'clear', trackId: 'D-1' });
  const view = groupView(state, group);
  assert.equal(view.available, 18);
  assert.equal(view.maxBatch, 10);
  assert.equal(view.eligible, false);
  assert.throws(() => act(state, { type: 'reserve', groupId: group.id }), /Недостаточно/);
});

test('earliest urgent group is not admitted when its specialization has no room', () => {
  const state = createState();
  state.stations.find(s => s.id === 'D').tracks[1].waiting = 10;
  const groups = snapshot(state).groups.filter(g => g.stationId === 'D');
  assert.equal(groups[0].cargo, 'grain');
  assert.equal(groups[0].eligible, false);
  assert.equal(groups.find(g => g.eligible).cargo, 'container');
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
  assert.equal(t.occupied, 10);
  assert.equal(t.processing + t.done, t.front);
  assert.equal(t.waiting, 4);
  act(state, { type: 'advance', minutes: 60 });
  act(state, { type: 'clear', trackId: t.id });
  const after = snapshot(state).stations.find(s => s.id === 'D').tracks.find(track => track.id === t.id);
  assert.equal(after.waiting, 0);
  assert.equal(after.processing, 4);
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
      if (groupView(state, state.groups.find(group => group.id === g.id)).eligible) act(state, { type: 'reserve', groupId: g.id });
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

test('closure produces conflicts and variants; plan needs explicit confirmation', () => {
  const state = createState();
  const before = snapshot(state).groups.find(g => g.id === 'D-G1').etaAt;
  assert.throws(() => act(state, { type: 'approve' }), /Нет нового/);
  const snap = act(state, { type: 'block' });
  assert.equal(state.planApproved, false);
  assert.ok(snap.dispatch.conflicts.length > 0);
  assert.equal(snap.dispatch.variants.length, 3);
  assert.equal(snap.dispatch.variants.filter(v => v.recommended).length, 1);
  assert.equal(snap.dispatch.selected, snap.dispatch.recommendedId);
  assert.ok(snap.groups.find(g => g.id === 'D-G1').etaAt >= before);
  act(state, { type: 'approve' });
  assert.equal(state.planApproved, true);
  assert.throws(() => act(state, { type: 'variant', variantId: 'fifo' }), /Нет варианта/);
  act(state, { type: 'block' });
  assert.equal(snapshot(state).groups.find(g => g.id === 'D-G1').etaAt, before);
  assert.equal(state.planApproved, false);
});

test('every variant keeps opposite trains off the shared segment at the same time', () => {
  const state = createState();
  act(state, { type: 'block' });
  for (const variant of snapshot(state).dispatch.variants) {
    state.variant = variant.id;
    const crossings = snapshot(state).trains.flatMap(t => {
      for (let k = 1; k < t.forecast.length; k++) {
        const [t0, i0] = t.forecast[k - 1], [t1, i1] = t.forecast[k];
        if (i0 !== i1 && Math.min(i0, i1) === 3) return [{ dir: t.direction, enter: t0, exit: t1, n: t.number }];
      }
      return [];
    });
    for (const a of crossings) for (const b of crossings) {
      if (a.dir === b.dir || a.n >= b.n) continue;
      assert.ok(a.exit <= b.enter || b.exit <= a.enter, `${variant.id}: №${a.n} и №${b.n} на перегоне одновременно`);
    }
  }
});

test('speed restriction lengthens only trains crossing that segment and notifies passengers', () => {
  const state = createState();
  const base = snapshot(state);
  assert.ok(base.trains.every(t => t.delay === 0));
  const snap = act(state, { type: 'restrict', segment: 5, kmh: 25 });
  const crossing = snap.trains.filter(t => t.route.some(([, i], k) => k && Math.min(i, t.route[k - 1][1]) === 5));
  assert.ok(crossing.length > 0 && crossing.every(t => t.delay > 0));
  assert.ok(snap.trains.filter(t => !crossing.includes(t)).every(t => t.delay === 0));
  assert.ok(snap.notifications.length > 0 && snap.notifications.every(n => n.delay >= 5));
  const lifted = act(state, { type: 'unrestrict', segment: 5 });
  assert.ok(lifted.trains.every(t => t.delay === 0));
  assert.ok(lifted.notifications[0].text.includes('восстановлено'));
  for (const bad of [{ segment: 99, kmh: 25 }, { segment: 1, kmh: 5 }, { segment: 1, kmh: 80 }, { segment: 1.5, kmh: 40 }]) {
    assert.throws(() => act(state, { type: 'restrict', ...bad }));
  }
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
  const g = groupView(state, { ...state.groups[0], stationId: 'A', cargo: 'oil' });
  assert.equal(g.processingMinutes, null);
  assert.equal(g.slackMinutes, null);
  assert.equal(g.eligible, false);
  assert.equal(g.maxBatch, 0);
});


test('scenario has ten stations and thirty unique trains with one inbound group per freight train', () => {
  const state = createState();
  assert.equal(state.stations.length, 10);
  assert.equal(state.trains.length, 30);
  assert.equal(new Set(state.trains.map(t => t.number)).size, 30);
  assert.equal(state.trains.filter(t => t.category === 'passenger').length, 6);
  assert.equal(state.groups.length, 24);
  assert.equal(new Set(state.groups.map(g => g.train)).size, 24);
  assert.ok(state.stations.every(s => s.tracks.length >= 2 && s.tracks.length <= 3));
  for (const g of state.groups) {
    const t = state.trains.find(t => t.number === g.train);
    assert.equal(g.count, t.wagons);
    assert.equal(g.stationId, state.stations[t.route.at(-1)[1]].id);
    assert.equal(g.origin, state.stations[t.route[0][1]].name);
  }
  for (const t of state.trains) {
    assert.ok(t.route.every(([m, index], i) => index >= 0 && index < 10 && (i === 0 || m > t.route[i - 1][0])));
    const forward = t.route[0][1] < t.route.at(-1)[1];
    assert.equal(Number(t.number) % 2, forward ? 0 : 1);
  }
});

test('closure leaves trains not crossing D–E unchanged', () => {
  const state = createState();
  const group = state.groups.find(g => g.id === 'D-G2');
  const before = groupView(state, group).etaAt;
  act(state, { type: 'block' });
  assert.equal(groupView(state, group).etaAt, before);
});
