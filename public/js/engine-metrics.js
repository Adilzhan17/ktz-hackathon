// Живые измерения модели: раз в секунду пересчитываем сеть, замеряем время и собираем сводку для страницы «Модель».
import { useEffect, useState } from 'preact/hooks';
import { networkTrains, networkEvents, networkStats, networkDecisions, incidentVariants, networkIncidents } from './network-sim.js';
import { liveNow } from './store.js';

export const HISTORY = 120;
const store = { samples: [], lines: [], seen: new Set(), counters: { cycles: 0, trains: 0, events: 0, variants: 0, ms: 0 }, startedAt: Date.now() };
const listeners = new Set();
const clip = (arr, n) => (arr.length > n ? arr.slice(arr.length - n) : arr);
export const hhmmss = ms => new Date(ms).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Almaty', hour12: false });
const timed = fn => { const t0 = performance.now(); const value = fn(); return [value, performance.now() - t0]; };
const snapshot = () => ({ samples: store.samples, lines: store.lines, counters: { ...store.counters }, startedAt: store.startedAt });

/** Один цикл модели: вход → расчёт → результат. Возвращает сводку и добавляет строки в ленту потока. */
export function runCycle(sim) {
  const now = liveNow();
  const [trains, trainsMs] = timed(() => networkTrains(sim, now));
  const [events, eventsMs] = timed(() => networkEvents(sim, now, 60));
  const stats = networkStats(trains);
  const incidents = networkIncidents().filter(i => (i.until ?? Infinity) > now);
  const [variants, variantsMs] = timed(() => incidents.map(i => incidentVariants(sim, i)).filter(Boolean));
  const queue = variants.reduce((n, v) => n + (v.variants[0]?.rows.length || 0), 0);
  const bestLoss = variants.reduce((n, v) => n + Math.min(...v.variants.map(x => x.metrics.weighted)), 0);
  const decisions = networkDecisions(trains);
  const byKind = {};
  for (const e of events) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  const fresh = events.filter(e => !store.seen.has(e.id)).slice(0, 4);
  for (const e of events) store.seen.add(e.id);
  if (store.seen.size > 6000) store.seen = new Set(events.map(e => e.id));
  const sample = {
    t: Date.now(), now, trains: trains.length, trainsMs, eventsMs, variantsMs, ms: trainsMs + eventsMs + variantsMs,
    moving: stats.moving, stopped: stats.stopped, forced: stats.forced, avgSpeed: stats.avgSpeed, passenger: stats.passenger, container: stats.container, freight: stats.freight,
    crewSoon: trains.filter(t => t.crew.leftMin < 45).length, toSoon: trains.filter(t => t.loco.toInH < 8).length,
    incidents: incidents.length, queue, bestLoss: Math.round(bestLoss), variantsCount: variants.length * 3,
    eventsHour: events.length, byKind, recommendations: decisions.length, passengerForced: trains.filter(t => t.category === 'passenger' && t.stopped && !t.planned).length,
    heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  };
  const c = store.counters;
  c.cycles++; c.trains += sample.trains; c.events += events.length; c.variants += sample.variantsCount; c.ms += sample.ms;
  const lines = [
    { id: `in${sample.t}`, at: now, tag: 'вход', text: `положения ${sample.trains} поездов · событий диспетчера ${sample.incidents} · бригад на пределе ${sample.crewSoon}` },
    { id: `calc${sample.t}`, at: now, tag: 'расчёт', text: `профили и позиции ${sample.trains} · очередей ${sample.queue} · вариантов ${sample.variantsCount} · ${sample.ms.toFixed(1)} мс` },
    { id: `out${sample.t}`, at: now, tag: 'выход', text: `в пути ${sample.moving}, вынужденно стоят ${sample.forced}, средняя скорость ${sample.avgSpeed} км/ч · подсказок ${sample.recommendations}` },
    ...fresh.map(e => ({ id: `ev${e.id}`, at: e.at, tag: 'решение', text: e.text, kind: e.kind })),
  ];
  store.lines = clip([...store.lines, ...lines], 60);
  store.samples = clip([...store.samples, sample], HISTORY);
  for (const fn of listeners) fn({ sample, ...snapshot() });
  return { sample, trains };
}

/** Подписка страницы: запускает цикл раз в секунду, пока она открыта. */
export function useEngine(sim) {
  const [state, setState] = useState(() => ({ sample: store.samples.at(-1) || null, ...snapshot() }));
  useEffect(() => {
    if (!sim || sim.error) return undefined;
    listeners.add(setState);
    runCycle(sim);
    const id = setInterval(() => runCycle(sim), 1000);
    return () => { clearInterval(id); listeners.delete(setState); };
  }, [sim]);
  return state;
}
