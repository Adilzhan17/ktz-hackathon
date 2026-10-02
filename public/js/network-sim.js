// Движение поездов по всей сети КТЖ. Чистые функции без состояния: положение каждого поезда определяется
// только временем, поэтому после перезапуска сервера «вся сеть» продолжает жить без сохранения.
// Маршруты — реальные пути по OpenStreetMap (public/data/kz-routes.json); расписание синтетическое.
const TZ = 300; // Asia/Almaty, минут от UTC

function hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

export const CATEGORIES = {
  passenger: { label: 'Пассажирский', short: 'пасс.', holdPct: 8, hold: [8, 35], dwell: [5, 12], stopEvery: 140 },
  container: { label: 'Контейнерный', short: 'конт.', holdPct: 14, hold: [15, 60], dwell: [20, 45], stopEvery: 230 },
  freight: { label: 'Грузовой', short: 'груз.', holdPct: 22, hold: [20, 95], dwell: [30, 75], stopEvery: 170 },
};
const HOLD_REASONS = ['пропуск встречного поезда', 'ожидание свободного пути', 'смена локомотивной бригады', 'ожидание подачи на станцию', 'устранение неисправности'];
const CARGO = ['уголь', 'зерно', 'нефтепродукты', 'руда', 'металл', 'химические грузы', 'строительные грузы'];

// Частота рейсов (в сутки на направление) — настроена так, чтобы на сети одновременно было около 700 поездов.
const trips = {
  passenger: r => (r.km >= 150 ? Math.max(1, Math.round(r.weight / 2.2)) : 1),
  container: r => (r.km >= 200 ? Math.max(1, Math.round(r.weight * 1.35)) : 1),
  freight: r => Math.max(2, Math.round(r.weight * 3.3 * Math.min(1.3, r.km / 520))),
};
const averageKmh = (cat, r) => (cat === 'passenger' ? (r.electrified > 0.5 ? 92 : 76) : cat === 'container' ? 60 : 44);

/** Подготовка маршрутов и расписания (один раз при загрузке данных). */
export function prepare(data) {
  const routes = data.routes.map(r => ({ ...r, cum: r.points.map(p => p[2]) }));
  const next = { passenger: [2, 1], container: [2002, 2001], freight: [3000, 3001] };
  const services = [];
  for (const route of routes) {
    for (const cat of Object.keys(CATEGORIES)) {
      for (const dir of ['fwd', 'rev']) {
        const spec = CATEGORIES[cat];
        const n = trips[cat](route);
        const period = 1440 / n;
        const stops = pickStops(route, spec, dir);
        const dwellSum = stops.reduce((s, x) => s + x.dwell, 0);
        const avg = averageKmh(cat, route);
        const plan = route.km / avg * 60;
        const run = Math.max(plan - dwellSum, plan * 0.55);
        const id = `${route.id}:${dir}:${cat}`;
        const maxHold = spec.hold[1];
        const tMax = run + dwellSum + maxHold;
        const parity = dir === 'fwd' ? 0 : 1;
        const copies = Math.ceil(tMax / period) + 1;
        const base = next[cat][parity];
        next[cat][parity] += 2 * copies;
        services.push({ id, route, dir, cat, n, period, phase: hash(id) % 1440, stops, run, avg, tMax, copies, base });
      }
    }
  }
  return { routes, services, byId: new Map(routes.map(r => [r.id, r])) };
}

function pickStops(route, spec, dir) {
  const out = [];
  let target = spec.stopEvery;
  const L = route.km;
  const list = route.stops.filter(([, km]) => km > 25 && km < L - 25);
  while (target < L - 40 && list.length) {
    let best = null, bd = 45;
    for (const [name, km] of list) { const d = Math.abs(km - target); if (d < bd) { bd = d; best = [name, km]; } }
    if (best && !out.some(s => s.name === best[0])) out.push({ name: best[0], km: best[1], dwell: Math.round((spec.dwell[0] + spec.dwell[1]) / 2) });
    target += spec.stopEvery;
  }
  if (dir === 'rev') return out.map(s => ({ ...s, km: route.km - s.km })).sort((a, b) => a.km - b.km);
  return out;
}

const profiles = new Map();
/** Расписание одного рейса: остановки с временем прибытия и стоянкой, с учётом случайной задержки. */
function profileOf(service, uid) {
  const cached = profiles.get(uid);
  if (cached) return cached;
  const spec = CATEGORIES[service.cat];
  const h = hash(uid);
  const stops = service.stops.map(s => ({ ...s, planned: true, reason: 'плановая стоянка' }));
  let extra = 0, holdAt = -1;
  if (h % 100 < spec.holdPct) {
    extra = spec.hold[0] + ((h >>> 8) % (spec.hold[1] - spec.hold[0] + 1));
    holdAt = stops.length ? (h >>> 16) % stops.length : -1;
    if (holdAt >= 0) { stops[holdAt].dwell += extra; stops[holdAt].planned = false; stops[holdAt].reason = HOLD_REASONS[(h >>> 4) % (service.cat === 'passenger' ? 3 : HOLD_REASONS.length)]; }
  }
  const legs = []; // [tArrive, km, dwell, reason, planned]
  let t = 0, km = 0;
  const speed = service.route.km / service.run * 60; // км/ч в движении
  for (const s of stops) {
    t += (s.km - km) / speed * 60; km = s.km;
    legs.push({ t, km, dwell: s.dwell, reason: s.reason, planned: s.planned });
    t += s.dwell;
  }
  t += (service.route.km - km) / speed * 60;
  const profile = { legs, total: t, speed, extra: holdAt >= 0 ? extra : 0, holdAt };
  if (profiles.size > 8000) profiles.clear();
  profiles.set(uid, profile);
  return profile;
}

/** Положение вдоль маршрута: {km, stopped, reason, planned, speed}. */
function stateAt(profile, e, L) {
  let prevT = 0, prevKm = 0;
  for (const leg of profile.legs) {
    if (e < leg.t) return { km: prevKm + (leg.km - prevKm) * ((e - prevT) / (leg.t - prevT)), stopped: false, speed: profile.speed };
    if (e <= leg.t + leg.dwell) return { km: leg.km, stopped: true, reason: leg.reason, planned: leg.planned, speed: 0, restMin: leg.t + leg.dwell - e, waitedMin: e - leg.t };
    prevT = leg.t + leg.dwell; prevKm = leg.km;
  }
  return { km: Math.min(L, prevKm + (L - prevKm) * ((e - prevT) / Math.max(1e-6, profile.total - prevT))), stopped: false, speed: profile.speed };
}

function locate(route, km) {
  const cum = route.cum, pts = route.points;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= km) lo = mid; else hi = mid; }
  const span = cum[hi] - cum[lo] || 1e-9;
  const f = Math.max(0, Math.min(1, (km - cum[lo]) / span));
  const lat = pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, lon = pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f;
  const dy = pts[hi][0] - pts[lo][0], dx = (pts[hi][1] - pts[lo][1]) * Math.cos(lat * Math.PI / 180);
  return { lat, lon, heading: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 };
}

const locoOf = (cat, route, h) => {
  const electric = route.electrified > 0.5;
  if (cat === 'passenger') return electric ? { series: 'KZ4AT', type: 'электровоз' } : { series: 'ТЭП33А', type: 'тепловоз' };
  if (electric) return h % 10 < 7 ? { series: 'KZ8A', type: 'электровоз' } : { series: 'ВЛ80С', type: 'электровоз' };
  return h % 20 < 15 ? { series: 'ТЭ33А', type: 'тепловоз' } : h % 20 < 18 ? { series: '2ТЭ25КМ', type: 'тепловоз' } : { series: '2ТЭ10МК', type: 'тепловоз' };
};

/** Все поезда сети в момент nowMs. */
export function networkTrains(sim, nowMs, { exclude } = {}) {
  const t = nowMs / 60000 + TZ;
  const out = [];
  for (const s of sim.services) {
    const mFrom = Math.floor((t - s.tMax - s.phase) / s.period), mTo = Math.floor((t - s.phase) / s.period);
    for (let m = mFrom; m <= mTo; m++) {
      const dep = s.phase + m * s.period;
      const uid = `${s.id}@${m}`;
      const profile = profileOf(s, uid);
      const e = t - dep;
      if (e < 0 || e > profile.total) continue;
      const st = stateAt(profile, e, s.route.km);
      const km = s.dir === 'fwd' ? st.km : s.route.km - st.km;
      const pos = locate(s.route, km);
      if (exclude?.(pos.lat, pos.lon)) continue;
      const h = hash(uid);
      const number = s.base + 2 * (((m % s.copies) + s.copies) % s.copies);
      const heading = s.dir === 'fwd' ? pos.heading : (pos.heading + 180) % 360;
      const from = s.dir === 'fwd' ? s.route.from : s.route.to, to = s.dir === 'fwd' ? s.route.to : s.route.from;
      const loaded = s.cat !== 'passenger' && h % 100 < (s.dir === 'fwd' ? 74 : 36);
      const delayNow = st.stopped && !st.planned ? Math.round(st.waitedMin) : 0;
      out.push({
        uid, number, category: s.cat, label: CATEGORIES[s.cat].label, routeId: s.route.id, route: s.route.name, from, to, dir: s.dir,
        km: Math.round(st.km * 10) / 10, totalKm: s.route.km, progress: st.km / s.route.km, lat: pos.lat, lon: pos.lon, heading,
        speedKmh: Math.round(st.speed), stopped: st.stopped, planned: Boolean(st.stopped && st.planned), reason: st.stopped ? st.reason : '',
        restMin: st.stopped ? Math.round(st.restMin) : 0, delayMin: delayNow, extraMin: profile.extra,
        departedMs: (dep - TZ) * 60000, arrivesMs: Math.round((dep - TZ + profile.total) * 60000),
        loco: locoOf(s.cat, s.route, h), wagons: s.cat === 'passenger' ? 8 + (h % 9) : 45 + (h % 25),
        cargo: s.cat === 'container' ? 'контейнеры' : s.cat === 'freight' ? CARGO[h % CARGO.length] : null, loaded,
      });
    }
  }
  return out;
}

/** Сводка по сети. */
export function networkStats(trains) {
  const by = c => trains.filter(t => t.category === c).length;
  const moving = trains.filter(t => !t.stopped);
  const stopped = trains.filter(t => t.stopped);
  const forced = stopped.filter(t => !t.planned);
  return {
    total: trains.length, passenger: by('passenger'), container: by('container'), freight: by('freight'),
    electric: trains.filter(t => t.loco.type === 'электровоз').length, diesel: trains.filter(t => t.loco.type === 'тепловоз').length,
    moving: moving.length, stopped: stopped.length, forced: forced.length, delayed: trains.filter(t => t.delayMin >= 15).length,
    avgSpeed: moving.length ? Math.round(moving.reduce((n, t) => n + t.speedKmh, 0) / moving.length) : 0,
    wagons: trains.reduce((n, t) => n + t.wagons, 0),
    passengers: trains.filter(t => t.category === 'passenger').reduce((n, t) => n + t.wagons * 52, 0),
  };
}
