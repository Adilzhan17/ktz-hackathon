// Расчёт прогноза движения: закрытие перегона, ограничения скорости, варианты пропуска.
// Чистые функции без побочных эффектов: на входе состояние, на выходе план.
//
// Модель намеренно простая и объяснимая:
//  * у каждого поезда есть нормативная нитка — точки [минуты от начала смены, индекс станции];
//  * ограничение скорости растягивает время хода по перегону пропорционально 80 км/ч / ограничение;
//  * при закрытии перегона один путь занят, и оба направления идут по оставшемуся, а на нём
//    встречные поезда не могут находиться одновременно;
//  * варианты пропуска — разные правила очерёдности занятия такого перегона.
// Это не проверенный график и не замена СЦБ: интервальное регулирование и стрелочные маршруты не моделируются.

export const NOMINAL_KMH = 80;
export const WRONG_TRACK_FACTOR = 1.25; // ход по неправильному пути медленнее из-за стрелок
export const CLOSED_SEGMENT = 3; // перегон D–E: между станциями с индексами 3 и 4
export const HEADWAY = 6; // минимальный интервал попутного следования, мин
export const MARGIN = 3; // зазор между встречными поездами, мин
export const MAX_HOLD = 45; // дольше этого поезд на станции не удерживают ради приоритетного, мин
export const BATCH_LOOKAHEAD = 25; // окно сбора попутных поездов в колонну, мин
export const BATCH_LIMIT = 4; // сколько поездов подряд одного направления в колонне
export const NOTIFY_THRESHOLD = 5; // с какой задержки пассажирам уходит уведомление, мин

export const PRIORITY_NAMES = { 1: 'Пассажирские', 2: 'Контейнерные и транзитные', 3: 'Сборные и прочие грузовые' };
const WEIGHT = { 1: 10, 2: 2, 3: 1 };

export const directionOf = train => (train.route[0][1] < train.route.at(-1)[1] ? 'even' : 'odd');

const VARIANTS = [
  {
    id: 'priority', name: 'По приоритету',
    description: 'Пассажирские идут первыми, затем контейнерные и транзитные, затем сборные. Грузовой поезд ждёт на станции, если встречный приоритетный подойдёт, пока он ещё будет на перегоне.',
  },
  {
    id: 'batch', name: 'Пакетами по направлениям',
    description: 'Перегон занимается колонной до четырёх поездов одного направления. Направление меняется реже, но пассажирский может подождать.',
  },
  {
    id: 'fifo', name: 'По очерёдности подхода',
    description: 'Кто раньше подошёл по графику, тот и идёт. Приоритеты не учитываются.',
  },
];

function restrictionFor(state, segment) {
  return (state.restrictions || []).find(r => r.segment === segment);
}

// Нитка с учётом ограничений скорости и хода по неправильному пути (без очерёдности на закрытом перегоне).
function naturalTimeline(state, train) {
  const closed = state.blocked;
  const dir = directionOf(train);
  const points = [[train.route[0][0], train.route[0][1]]];
  let t = train.route[0][0];
  for (let k = 1; k < train.route.length; k++) {
    const segment = Math.min(train.route[k - 1][1], train.route[k][1]);
    let factor = 1;
    const restriction = restrictionFor(state, segment);
    if (restriction) factor *= NOMINAL_KMH / restriction.kmh;
    if (closed && segment === CLOSED_SEGMENT && dir === 'odd') factor *= WRONG_TRACK_FACTOR;
    t += Math.round((train.route[k][0] - train.route[k - 1][0]) * factor);
    points.push([t, train.route[k][1]]);
  }
  return points;
}

function crossing(points) {
  for (let k = 1; k < points.length; k++) {
    if (Math.min(points[k - 1][1], points[k][1]) === CLOSED_SEGMENT) {
      return { k, enter: points[k - 1][0], exit: points[k][0] };
    }
  }
  return null;
}

// Назначение времён входа на закрытый перегон по правилу очерёдности.
function scheduleClosure(items, variantId) {
  const pending = [...items];
  const last = { even: { enter: -Infinity, exit: -Infinity }, odd: { enter: -Infinity, exit: -Infinity } };
  let lastEnter = -Infinity;
  let currentDir = null;
  const result = new Map();
  const order = [];
  const earliest = item => {
    const opposite = item.dir === 'even' ? 'odd' : 'even';
    return Math.max(item.enter, last[item.dir].enter + HEADWAY, last[opposite].exit + MARGIN, lastEnter);
  };
  let run = 0;
  while (pending.length) {
    const now = Math.min(...pending.map(earliest));
    const ready = pending.filter(i => earliest(i) <= now);
    let pick;
    if (variantId === 'priority') {
      // Поезд не выпускается на перегон, если встречный более приоритетный подойдёт, пока он ещё в пути.
      const free = ready.filter(c => now - c.enter >= MAX_HOLD || !pending.some(h => h.priority < c.priority && h.dir !== c.dir && h.enter < now + c.duration + MARGIN));
      const pool = free.length ? free : pending;
      pick = [...pool].sort((a, b) => a.priority - b.priority || earliest(a) - earliest(b) || a.enter - b.enter)[0];
    } else if (variantId === 'batch') {
      const gathering = pending.filter(i => i.dir === currentDir && i.enter <= now + BATCH_LOOKAHEAD);
      const starving = ready.some(i => i.dir !== currentDir && now - i.enter >= MAX_HOLD);
      const pool = gathering.length && run < BATCH_LIMIT && !starving ? gathering : ready;
      pick = [...pool].sort((a, b) => a.enter - b.enter)[0];
    } else {
      pick = [...ready].sort((a, b) => a.enter - b.enter)[0];
    }
    run = pick.dir === currentDir ? run + 1 : 1;
    const enter = earliest(pick);
    result.set(pick.train.number, enter);
    order.push(pick.train.number);
    last[pick.dir] = { enter, exit: Math.max(last[pick.dir].exit, enter + pick.duration) };
    lastEnter = enter;
    currentDir = pick.dir;
    pending.splice(pending.indexOf(pick), 1);
  }
  return { result, order };
}

function applyDelay(points, k, delay) {
  if (!delay) return points;
  // Поезд ждёт на станции перед перегоном: две точки на одной станции.
  const out = points.slice(0, k);
  out.push([points[k - 1][0] + delay, points[k - 1][1]]);
  for (let j = k; j < points.length; j++) out.push([points[j][0] + delay, points[j][1]]);
  return out;
}

function evaluate(state, variantId) {
  const trains = state.trains;
  const natural = new Map(trains.map(t => [t.number, naturalTimeline(state, t)]));
  const delays = new Map();
  const forecast = new Map();
  let order = [];
  if (state.blocked) {
    const items = [];
    for (const train of trains) {
      const c = crossing(natural.get(train.number));
      if (c) items.push({ train, dir: directionOf(train), priority: train.priority, enter: c.enter, duration: c.exit - c.enter, k: c.k });
    }
    const { result, order: o } = scheduleClosure(items, variantId);
    order = o.map(number => {
      const item = items.find(i => i.train.number === number);
      return { train: number, label: item.train.label, priority: item.priority, dir: item.dir, enter: result.get(number), delay: result.get(number) - item.enter };
    });
    for (const item of items) forecast.set(item.train.number, applyDelay(natural.get(item.train.number), item.k, result.get(item.train.number) - item.enter));
  }
  for (const train of trains) {
    const points = forecast.get(train.number) || natural.get(train.number);
    forecast.set(train.number, points);
    delays.set(train.number, points.at(-1)[0] - train.route.at(-1)[0]);
  }
  return { forecast, delays, order };
}

function metrics(state, delays) {
  let total = 0, weighted = 0, passenger = 0, max = 0, delayed = 0;
  for (const train of state.trains) {
    const d = delays.get(train.number);
    if (d <= 0) continue;
    delayed += 1; total += d; weighted += d * WEIGHT[train.priority];
    if (train.priority === 1) passenger += d;
    max = Math.max(max, d);
  }
  return { total, weighted, passenger, max, delayedTrains: delayed };
}

// Встречные поезда, которые по нормативному графику одновременно оказываются на единственном свободном пути.
function conflicts(state) {
  if (!state.blocked) return [];
  const items = [];
  for (const train of state.trains) {
    const c = crossing(naturalTimeline(state, train));
    if (c) items.push({ train, dir: directionOf(train), ...c });
  }
  const out = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.dir === b.dir) continue;
    if (a.enter < b.exit + MARGIN && b.enter < a.exit + MARGIN) {
      out.push({ a: { train: a.train.number, label: a.train.label, priority: a.train.priority, dir: a.dir, enter: a.enter, exit: a.exit },
        b: { train: b.train.number, label: b.train.label, priority: b.train.priority, dir: b.dir, enter: b.enter, exit: b.exit } });
    }
  }
  return out.sort((x, y) => Math.min(x.a.priority, x.b.priority) - Math.min(y.a.priority, y.b.priority) || x.a.enter - y.a.enter);
}

function explain(variants, recommendedId) {
  const best = variants.find(v => v.id === recommendedId);
  const others = variants.filter(v => v.id !== recommendedId);
  const worst = others.sort((a, b) => b.metrics.weighted - a.metrics.weighted)[0];
  if (!worst || worst.metrics.weighted === best.metrics.weighted) {
    return `Вариант «${best.name}» не хуже остальных по взвешенной задержке.`;
  }
  const pass = best.metrics.passenger <= worst.metrics.passenger
    ? `пассажирские теряют ${best.metrics.passenger} мин вместо ${worst.metrics.passenger}`
    : `пассажирские теряют ${best.metrics.passenger} мин (у «${worst.name}» — ${worst.metrics.passenger}), зато общая задержка меньше`;
  return `«${best.name}» даёт наименьшую взвешенную задержку (${best.metrics.weighted} против ${worst.metrics.weighted}): ${pass}.`;
}

// Основной вход: полный план для текущего состояния.
export function computePlan(state) {
  const evaluated = VARIANTS.map(v => {
    const e = evaluate(state, state.blocked ? v.id : 'fifo');
    return { ...v, ...e, metrics: metrics(state, e.delays) };
  });
  const recommended = state.blocked
    ? [...evaluated].sort((a, b) => a.metrics.weighted - b.metrics.weighted || a.metrics.passenger - b.metrics.passenger || (a.id === 'priority' ? -1 : 1))[0]
    : evaluated[2];
  const selectedId = state.blocked ? (evaluated.some(v => v.id === state.variant) ? state.variant : recommended.id) : null;
  const selected = state.blocked ? evaluated.find(v => v.id === selectedId) : evaluated[2];
  const variants = state.blocked ? evaluated.map(v => ({
    id: v.id, name: v.name, description: v.description, recommended: v.id === recommended.id,
    metrics: v.metrics, order: v.order,
  })) : [];
  const byTrain = {};
  for (const train of state.trains) {
    byTrain[train.number] = { delay: selected.delays.get(train.number), forecast: selected.forecast.get(train.number) };
  }
  return {
    active: Boolean(state.blocked || (state.restrictions || []).length),
    variants, selectedId, recommendedId: state.blocked ? recommended.id : null,
    why: state.blocked ? explain(variants, recommended.id) : null,
    conflicts: conflicts(state), byTrain, metrics: selected.metrics, order: selected.order,
  };
}

const memo = new WeakMap();
export function getPlan(state) {
  const key = JSON.stringify([state.blocked, state.variant, state.restrictions]);
  const cached = memo.get(state);
  if (cached?.key === key) return cached.plan;
  const plan = computePlan(state);
  memo.set(state, { key, plan });
  return plan;
}
