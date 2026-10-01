import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, snapshot, act } from '../server/model.js';
import { stationTraffic, blockOccupancy } from '../public/js/station-metrics.js';

test('arrival counts keep reserved groups and change occupancy only on admission', () => {
  const state = createState();
  let data = snapshot(state);
  assert.deepEqual(stationTraffic(data, 'D'), { waiting: 0, waitingWagons: 0, enRoute: 3, enRouteWagons: 30 });
  data = act(state, { type: 'reserve', groupId: 'D-G1' });
  assert.equal(stationTraffic(data, 'D').enRoute, 3);
  data = act(state, { type: 'advance', minutes: 60 });
  assert.equal(stationTraffic(data, 'D').waiting, 1);
  assert.equal(data.stations.find(s => s.id === 'D').occupied, 10);
  data = act(state, { type: 'arrive', groupId: 'D-G1' });
  assert.equal(stationTraffic(data, 'D').waiting, 0);
  assert.equal(data.stations.find(s => s.id === 'D').occupied, 20);
  data = act(state, { type: 'complete', trackId: 'D-2' });
  assert.equal(data.stations.find(s => s.id === 'D').occupied, 20);
  data = act(state, { type: 'clear', trackId: 'D-2' });
  assert.equal(data.stations.find(s => s.id === 'D').occupied, 14);
});

test('offset train labels do not move block occupancy to the opposite track', () => {
  const base = { loc: { kind: 'move', f: .4 }, segment: 3, odd: true, wrong: false, y: 152 };
  assert.deepEqual([...blockOccupancy([base])], ['o:3:1']);
  assert.deepEqual([...blockOccupancy([{ ...base, wrong: true }])], ['e:3:1']);
  assert.equal(blockOccupancy([{ ...base, loc: { kind: 'wait' } }]).size, 0);
});
