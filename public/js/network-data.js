// Данные сети для списков и карты: маршруты, поезда сейчас, привязка станций к участкам.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useLiveNow } from './store.js';
import { useNetwork } from './geo-network.js';
import { prepare, networkTrains, networkStats } from './network-sim.js';

let simLoading;
export function useSim() {
  const [sim, setSim] = useState(null);
  useEffect(() => { simLoading ||= fetch('/data/kz-routes.json').then(r => r.json()).then(prepare); simLoading.then(setSim).catch(() => setSim({ error: true })); }, []);
  return sim;
}

/** Сколько поездов сейчас на сети (для строки состояния в шапке). */
export function useNetworkTotals() {
  const sim = useSim();
  const now = useLiveNow(0.2);
  return useMemo(() => (sim && !sim.error ? networkStats(networkTrains(sim, now)) : null), [sim, Math.floor(now / 5000)]);
}

/** Все поезда сети; пересчитываются раз в refreshSec секунд. */
export function useNetworkTrains(refreshSec = 5) {
  const sim = useSim();
  const now = useLiveNow(1 / refreshSec);
  const slot = Math.floor(now / (refreshSec * 1000));
  const trains = useMemo(() => (sim && !sim.error ? networkTrains(sim, now) : []), [sim, slot]);
  return { sim, trains, now, loading: !sim, failed: Boolean(sim?.error) };
}

/** Участки для выбора в фильтрах. */
export const routeOptions = sim => (sim?.routes || []).map(r => ({ value: r.id, label: r.name })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));

let indexCache = null;
/** Станции и остановочные пункты сети с привязкой к ближайшему маршруту (участку) и километру на нём. */
export function useStationIndex() {
  const sim = useSim();
  const net = useNetwork();
  return useMemo(() => {
    if (!sim || sim.error || !net || net.error) return null;
    if (indexCache?.sim === sim) return indexCache.rows;
    const pts = [];
    for (const r of sim.routes) for (const p of r.points) pts.push([p[0], p[1], p[2], r]);
    const rows = [];
    const add = (rec, kind) => {
      const [, , lat, lon] = rec, k = Math.cos(lat * Math.PI / 180);
      let best = null, bd = Infinity;
      for (const p of pts) { const dy = p[0] - lat, dx = (p[1] - lon) * k, d = dy * dy + dx * dx; if (d < bd) { bd = d; best = p; } }
      rows.push({ kind, rec, id: rec[0], name: rec[1], lat, lon, routeId: best[3].id, route: best[3].name, km: Math.round(best[2]), offKm: Math.round(Math.sqrt(bd) * 111) });
    };
    net.net.stations.forEach(r => add(r, 'station'));
    net.net.halts.forEach(r => add(r, 'halt'));
    indexCache = { sim, rows };
    return rows;
  }, [sim, net]);
}
