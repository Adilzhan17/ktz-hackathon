export const BASE_TIME = Date.parse('2026-10-01T09:00:00+05:00');
const minute = 60_000;
const definitions = [
  ['A', 'Кокшетау-2', 'Участковая', 0],
  ['B', 'Кызылсая', 'Промежуточная', 36],
  ['C', 'Ащылы', 'Промежуточная', 72],
  ['D', 'Казан', 'Грузовая', 108],
  ['E', 'Талшик', 'Промежуточная', 144],
  ['F', 'Кзыл-ту', 'Сортировочная', 180],
];
const trackSpecs = [
  ['Зерновой терминал', 'grain', 10, 10, 2, 8, 0, 30],
  ['Контейнерная площадка', 'container', 60, 40, 24, 8, 0, 90],
  ['Угольный склад', 'coal', 30, 20, 12, 6, 0, 60],
  ['Нефтебаза', 'oil', 24, 16, 8, 4, 0, 120],
  ['Элеватор № 2', 'grain', 40, 40, 22, 8, 0, 75],
  ['Склад металлопроката', 'metal', 20, 16, 6, 4, 0, 100],
  ['Контейнерный терминал', 'container', 40, 30, 10, 8, 0, 60],
  ['Угольный терминал', 'coal', 30, 24, 8, 6, 0, 80],
  ['Зерновая площадка', 'grain', 20, 16, 6, 4, 0, 60],
  ['Склад металла', 'metal', 16, 12, 4, 2, 0, 90],
];
export const cargoNames = { grain: 'Зерно', container: 'Контейнеры', coal: 'Уголь', oil: 'Нефтепродукты', metal: 'Металл' };

export function createState() {
  const stations = definitions.map(([id, name, type, km], si) => ({
    id, name, type, km,
    tracks: trackSpecs.slice(0, si === 3 ? 10 : 4 + si % 3).map(([name, cargo, capacity, front, processing, done, waiting, duration], i) => ({
      id: `${id}-${i + 1}`, number: i + 1, name, cargo, capacity, front,
      processing, done, waiting, duration,
      finishAt: BASE_TIME + duration * minute,
      // Throughput is a separate illustrative nominal value, in wagons per hour.
      productivity: Math.max(2, Math.round(front * 60 / duration)),
    })),
  }));
  const seeds = [
    ['3402', 'Майтак', 'grain', 10, 165, 5, 24],
    ['3014', 'Караганда', 'grain', 20, 620, 16, 96],
    ['2086', 'Достык', 'container', 24, 920, 22, 48],
    ['3120', 'Экибастуз', 'coal', 14, 340, 8, 36],
    ['3022', 'Павлодар', 'oil', 16, 440, 11, 18],
    ['3048', 'Астана', 'metal', 10, 280, 7, 72],
  ];
  const groups = stations.flatMap((station, si) => seeds.map(([train, origin, cargo, count, km, etaHours, deadlineHours], i) => ({
    id: `${station.id}-G${i + 1}`, stationId: station.id,
    train: String(Number(train) + si * 100), origin, cargo, count,
    km, etaAt: BASE_TIME + etaHours * 60 * minute,
    deadlineAt: BASE_TIME + deadlineHours * 60 * minute,
    status: 'approaching', trackId: null,
  })));
  return {
    now: BASE_TIME, revision: 0, stations, groups, blocked: false, planApproved: false,
    log: [{ at: BASE_TIME, text: 'Демонстрационная смена открыта. Данные участка и грузов — учебные.' }],
  };
}

export function occupied(track) { return track.processing + track.done + track.waiting; }
export function reservedFor(state, trackId) {
  return state.groups.filter(g => g.status === 'reserved' && g.trackId === trackId).reduce((sum, g) => sum + g.count, 0);
}
export function trackView(state, track) {
  const occupiedCount = occupied(track);
  const reserved = reservedFor(state, track.id);
  return { ...track, occupied: occupiedCount, reserved, free: track.capacity - occupiedCount,
    available: Math.max(0, track.capacity - occupiedCount - reserved),
    releaseAt: occupiedCount ? Math.max(state.now, track.processing ? track.finishAt : state.now) + (30 + Math.ceil(track.waiting / track.front) * (track.duration + 30)) * minute : null,
  };
}
export function groupView(state, group) {
  const station = state.stations.find(s => s.id === group.stationId);
  const tracks = station.tracks.filter(t => t.cargo === group.cargo).map(t => trackView(state, t));
  const operationMinutes = t => Math.ceil(group.count / t.front) * (t.duration + 30);
  const matching = tracks.filter(t => t.available >= group.count).sort((a, b) => operationMinutes(a) - operationMinutes(b) || a.number - b.number);
  const best = matching[0];
  const assigned = tracks.find(t => t.id === group.trackId);
  const processingMinutes = assigned ? operationMinutes(assigned) : best ? operationMinutes(best) : tracks.length ? Math.min(...tracks.map(operationMinutes)) : null;
  const etaAt = group.etaAt + (state.blocked ? 40 * minute : 0);
  const slackMinutes = processingMinutes === null ? null : Math.floor((group.deadlineAt - Math.max(state.now, etaAt)) / minute - processingMinutes);
  const eligible = group.status === 'approaching' && Boolean(best);
  return { ...group, etaAt, slackMinutes, processingMinutes, eligible,
    suggestedTrack: best?.id ?? null,
    available: tracks.reduce((n, t) => n + t.available, 0),
    maxBatch: Math.max(0, ...tracks.map(t => t.available)),
    reason: group.status === 'reserved' ? `Зарезервирован путь ${group.trackId.split('-')[1]}`
      : group.status === 'arrived' ? 'Группа принята на подъездной путь'
      : best ? `Путь ${best.number}: доступно ${best.available} ваг. · обработка ≈ ${processingMinutes} мин`
      : 'Нет пути для всей группы. Ожидать освобождения; группу не делим.',
  };
}
export function snapshot(state) {
  const stations = state.stations.map(station => {
    const tracks = station.tracks.map(t => trackView(state, t));
    const sums = ['capacity', 'front', 'processing', 'done', 'waiting', 'occupied', 'reserved', 'available'].reduce((a, key) => {
      a[key] = tracks.reduce((sum, t) => sum + t[key], 0); return a;
    }, {});
    return { ...station, tracks, ...sums };
  });
  const groups = state.groups.map(g => groupView(state, g)).sort((a, b) => (a.slackMinutes ?? Infinity) - (b.slackMinutes ?? Infinity) || a.id.localeCompare(b.id));
  return { ...state, stations, groups, cargoNames };
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function event(state, text) {
  state.revision += 1;
  state.log.unshift({ at: state.now, text });
  state.log = state.log.slice(0, 100);
}
export function act(state, action) {
  assert(action && typeof action === 'object', 'Некорректное действие');
  if (action.type === 'advance') {
    assert([15, 30, 60].includes(action.minutes), 'Допустим шаг 15, 30 или 60 минут');
    state.now += action.minutes * minute;
    for (const station of state.stations) for (const t of station.tracks) {
      if (t.processing && t.finishAt <= state.now) {
        t.done += t.processing; t.processing = 0;
      }
    }
    event(state, `Время модели: +${action.minutes} мин. Завершённые операции учтены; вагоны ожидают уборки.`);
  } else if (action.type === 'complete' || action.type === 'clear') {
    const station = state.stations.find(s => s.tracks.some(t => t.id === action.trackId));
    const t = station?.tracks.find(t => t.id === action.trackId);
    assert(t, 'Путь не найден');
    if (action.type === 'complete') {
      assert(t.processing > 0, 'Нет вагонов под грузовыми операциями');
      const count = t.processing; t.done += count; t.processing = 0;
      event(state, `${station.name}, путь ${t.number}: обработано ${count} ваг. Для освобождения пути требуется уборка.`);
    } else {
      assert(t.done > 0, 'Нет обработанных вагонов для уборки');
      const count = t.done; t.done = 0;
      const start = Math.min(t.waiting, t.front - t.processing);
      t.waiting -= start; t.processing += start;
      if (start) t.finishAt = state.now + t.duration * minute;
      event(state, `${station.name}, путь ${t.number}: убрано ${count} ваг., физическая ёмкость освобождена.`);
    }
  } else if (['reserve', 'cancel', 'arrive'].includes(action.type)) {
    const g = state.groups.find(g => g.id === action.groupId);
    assert(g, 'Группа вагонов не найдена');
    const station = state.stations.find(s => s.id === g.stationId);
    if (action.type === 'reserve') {
      assert(g.status === 'approaching', 'Группа уже запланирована');
      const suggestion = groupView(state, g);
      assert(suggestion.eligible, 'Недостаточно свободной ёмкости на подходящем пути');
      g.trackId = suggestion.suggestedTrack; g.status = 'reserved';
      event(state, `${station.name}: диспетчер зарезервировал ${g.count} мест на пути ${g.trackId.split('-')[1]} для группы №${g.train}.`);
    } else if (action.type === 'cancel') {
      assert(g.status === 'reserved', 'Можно отменить только резерв');
      g.status = 'approaching'; g.trackId = null;
      event(state, `${station.name}: резерв группы №${g.train} отменён.`);
    } else {
      assert(g.status === 'reserved', 'Сначала зарезервируйте путь');
      assert(groupView(state, g).etaAt <= state.now, 'Группа ещё в пути: ожидайте прогнозного прибытия');
      const t = station.tracks.find(t => t.id === g.trackId);
      assert(t.capacity - occupied(t) >= g.count, 'Путь занят, приём невозможен');
      const start = Math.min(g.count, Math.max(0, t.front - t.processing - t.done));
      if (start && !t.processing) t.finishAt = state.now + t.duration * minute;
      else if (start) t.finishAt = Math.max(t.finishAt, state.now + t.duration * minute);
      t.processing += start; t.waiting += g.count - start; g.status = 'arrived';
      event(state, `${station.name}: принято ${g.count} ваг. группы №${g.train} на путь ${t.number}; ${start} подано на грузовой фронт.`);
    }
  } else if (action.type === 'block') {
    state.blocked = !state.blocked; state.planApproved = false;
    event(state, state.blocked ? 'Учебное закрытие нечётного пути D–E. Подготовлена схема пропуска; прогноз подхода +40 мин.' : 'Ограничение D–E снято. Восстановлен исходный прогноз подхода.');
  } else if (action.type === 'approve') {
    assert(state.blocked && !state.planApproved, 'Нет нового варианта для подтверждения');
    state.planApproved = true;
    event(state, 'Диспетчер подтвердил учебный вариант: №153 первым по соседнему пути; сборный удерживается на D.');
  } else {
    throw new Error('Неизвестное действие');
  }
  return snapshot(state);
}
