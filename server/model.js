export const BASE_TIME = Date.parse('2026-10-01T09:00:00+05:00');
const minute = 60_000;
// Names and distances describe a fictional demonstration corridor, not a real route.
const definitions = [
  ['A', 'Караганда', 'Участковая', 0],
  ['B', 'Сарыбел', 'Промежуточная', 24],
  ['C', 'Акдала', 'Промежуточная', 48],
  ['D', 'Казан', 'Грузовая', 76],
  ['E', 'Майтак', 'Промежуточная', 102],
  ['F', 'Бастау', 'Промежуточная', 128],
  ['G', 'Береке', 'Промежуточная', 153],
  ['H', 'Дала', 'Промежуточная', 177],
  ['I', 'Жайык', 'Промежуточная', 202],
  ['J', 'Кзыл-ту', 'Сортировочная', 230],
];
export const cargoNames = { grain: 'Зерно', container: 'Контейнеры', coal: 'Уголь', oil: 'Нефтепродукты', metal: 'Металл' };

export function createState() {
  const stations = definitions.map(([id, name, type, km]) => ({
    id, name, type, km,
    tracks: (id === 'D' ? [
      ['Зерновой терминал', 'grain', 10, 10, 2, 8, 30],
      ['Элеватор', 'grain', 10, 6, 0, 0, 60],
      ['Контейнерная площадка', 'container', 10, 6, 0, 0, 90],
    ] : [
      ['Грузовая площадка', 'grain', 40, 20, 0, 0, 60],
      ['Контейнерный путь', 'container', 40, 20, 0, 0, 90],
    ]).map(([name, cargo, capacity, front, processing, done, duration], i) => ({
      id: `${id}-${i + 1}`, number: i + 1, name, cargo, capacity, front,
      processing, done, waiting: 0, duration, finishAt: BASE_TIME + duration * minute,
      productivity: Math.max(2, Math.round(front * 60 / duration)),
    })),
  }));
  // One record per train, shared by the graph, manifest and inbound cargo model.
  // Route points are illustrative timetable entries: [minute from shift start, station index].
  const trains = [
    { number: '153', category: 'passenger', label: 'Пассажирский', color: '#8263c4', wagons: 8,
      route: [[0,9],[28,8],[56,7],[84,6],[112,5],[140,4],[168,3],[196,2],[224,1],[252,0]],
      affectedFrom: 6 },
    { number: '3401', category: 'freight', label: 'Срочный грузовой', color: '#3485b2', wagons: 10, cargo: 'grain',
      route: [[0,4],[60,3]], affectedFrom: 1, deadlineHours: 24 },
    { number: '3014', category: 'freight', label: 'Грузовой', color: '#d79b42', wagons: 10, cargo: 'grain',
      route: [[0,0],[60,1],[120,2],[180,3]], affectedFrom: null, deadlineHours: 96 },
    { number: '2085', category: 'container', label: 'Контейнерный', color: '#229481', wagons: 10, cargo: 'container',
      route: [[0,9],[40,8],[80,7],[120,6],[160,5],[200,4],[240,3]], affectedFrom: 6, deadlineHours: 48 },
  ];
  for (let i = 0; i < 26; i++) {
    const category = i < 5 ? 'passenger' : i < 18 ? 'freight' : 'container';
    const forward = i % 2 === 0;
    const from = forward ? i % 3 : 9 - i % 3;
    const to = forward ? 7 + i % 3 : i % 3;
    const step = forward ? 1 : -1;
    const departure = 20 + i * 12;
    const hop = category === 'passenger' ? 24 : 36;
    const route = [];
    for (let index = from; forward ? index <= to : index >= to; index += step) {
      route.push([departure + route.length * hop, index]);
    }
    const crossing = route.findIndex((point, j) => j > 0 &&
      Math.min(point[1], route[j - 1][1]) === 3 && Math.max(point[1], route[j - 1][1]) === 4);
    trains.push({
      number: String((category === 'passenger' ? 160 : category === 'container' ? 2100 : 3100) + i * 2 + (forward ? 0 : 1)),
      category, label: category === 'passenger' ? 'Пассажирский' : category === 'container' ? 'Контейнерный' : 'Грузовой',
      color: category === 'passenger' ? '#8263c4' : category === 'container' ? '#229481' : '#3485b2',
      wagons: category === 'passenger' ? 8 + i % 3 * 2 : 20 + i % 3 * 10,
      ...(category === 'passenger' ? {} : { cargo: category === 'container' ? 'container' : 'grain', deadlineHours: 36 + i % 4 * 12 }),
      route, affectedFrom: crossing < 0 ? null : crossing,
    });
  }
  const groups = trains.filter(t => t.cargo).map((train, i) => {
    const origin = stations[train.route[0][1]];
    const [etaMinutes, destinationIndex] = train.route.at(-1);
    const destination = stations[destinationIndex];
    return {
      id: `${destination.id}-G${i + 1}`, stationId: destination.id, train: train.number,
      origin: origin.name, cargo: train.cargo, count: train.wagons,
      km: Math.abs(destination.km - origin.km), etaAt: BASE_TIME + etaMinutes * minute,
      deadlineAt: BASE_TIME + train.deadlineHours * 60 * minute,
      status: 'approaching', trackId: null,
    };
  });
  return {
    now: BASE_TIME, revision: 0, stations, trains, groups, blocked: false, planApproved: false,
    log: [{ at: BASE_TIME, text: 'Учебная смена: 10 станций, 30 поездов (6 пассажирских, 15 грузовых, 9 контейнерных). Число вагонов задано отдельно для каждого состава.' }],
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
  const affected = state.trains.find(t => t.number === group.train)?.affectedFrom != null;
  const etaAt = group.etaAt + (state.blocked && affected ? 40 * minute : 0);
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
    event(state, state.blocked ? 'Учебное закрытие нечётного пути D–E. Подготовлена схема пропуска; прогноз поездов через D–E +40 мин.' : 'Ограничение D–E снято. Восстановлен исходный прогноз подхода.');
  } else if (action.type === 'approve') {
    assert(state.blocked && !state.planApproved, 'Нет нового варианта для подтверждения');
    state.planApproved = true;
    event(state, 'Диспетчер подтвердил учебный вариант: №153 первым по соседнему пути; грузовые №3401 и №2085 получают задержку 40 минут.');
  } else {
    throw new Error('Неизвестное действие');
  }
  return snapshot(state);
}
