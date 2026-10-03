// Adapter for the existing dispatch schematic. National routes do not expose
// physical signal aspects or siding capacity, so those fields stay unknown.
export function networkTrackData(base, route, trains, now) {
  const stops = [[route.from, 0], ...route.stops.filter(([, km]) => km > 0 && km < route.km), [route.to, route.km]]
    .sort((a, b) => a[1] - b[1]).filter((s, i, all) => !i || s[1] > all[i - 1][1]);
  const stations = stops.map(([name, km], i) => ({ id: String(i + 1), name, km, type: 'Маршрутная', tracks: [], capacity: null, occupied: null, network: true }));
  const position = km => {
    let i = 0;
    while (i < stops.length - 2 && stops[i + 1][1] < km) i++;
    return i + Math.max(0, Math.min(1, (km - stops[i][1]) / (stops[i + 1][1] - stops[i][1])));
  };
  const mapped = trains.map(t => ({ ...t, network: t, number: String(t.number), direction: t.dir === 'rev' ? 'odd' : 'even', priority: t.category === 'passenger' ? 1 : t.category === 'container' ? 2 : 3,
    diagramPosition: position(t.dir === 'rev' ? route.km - t.km : t.km), delay: t.extraMin,
    grossT: t.consist.grossT, loadPct: t.consist.loadPct, techState: { status: t.reason || 'в рейсе' },
    forecast: [[(t.departedMs - base.baseTime) / 60000, t.dir === 'rev' ? stations.length - 1 : 0], [(t.arrivesMs - base.baseTime) / 60000, t.dir === 'rev' ? 0 : stations.length - 1]] }));
  return { ...base, network: true, now, stations, trains: mapped, groups: [], holds: [], restrictions: [], dispatch: { closures: [], conflicts: [] },
    sections: stations.slice(1).map((_, i) => ({ trains: mapped.filter(t => !t.network.stopped && Math.floor(t.diagramPosition) === i).length, load: null })) };
}
