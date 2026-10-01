const app = document.querySelector('#app');
let state;
let stationId = 'D';
let tab = 'tracks';
let chartMode = 'graph';
let trainCategory = 'all';
let selectedTrain = '153';
const visibleTrains = () => state.trains.filter(t => trainCategory === 'all' || t.category === trainCategory);
let filter = 'all';
let search = '';
let online = false;
let busy = false;
let toastTimer;
const time = n => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' }).format(n);
const date = n => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: 'long', year: 'numeric' }).format(n);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  train: '<rect x="5" y="3" width="14" height="15" rx="4"/><path d="M5 10h14M12 3v7M8 18l-2 3m10-3 2 3"/><path d="M8 14h1m6 0h1"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  route: '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 5h9a4 4 0 0 1 0 8H8a3 3 0 0 0 0 6h9"/>',
  box: '<path d="m3 7 9-4 9 4v10l-9 4-9-4V7zm0 0 9 4 9-4m-9 4v10M7 5l10 4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  alert: '<path d="m12 3 10 17H2L12 3zM12 9v4m0 3v1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-8l1-7z"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  reset: '<path d="M4 9a8 8 0 1 1 0 7M4 3v6h6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
const pill = (text, tone = '') => `<span class="pill ${tone}">${text}</span>`;
const hours = mins => !Number.isFinite(mins) ? '—' : `${mins < 0 ? '−' : ''}${Math.floor(Math.abs(mins) / 60)} ч ${Math.floor(Math.abs(mins) % 60)} мин`;
const deadline = g => hours((g.deadlineAt - state.now) / 60000);

function graph() {
  const base = Date.parse('2026-10-01T09:00:00+05:00');
  const start = Math.max(base, state.now - 60 * 60000);
  const x = mins => 152 + ((base + mins * 60000 - start) / 60000) * (680 / 720);
  const currentX = 152 + ((state.now - start) / 60000) * (680 / 720);
  const rowHeight = 32;
  const y = i => 40 + i * rowHeight;
  const plotBottom = y(state.stations.length - 1) + 12;
  const routes = visibleTrains().map(t => ({ n: t.number, color: t.color,
    p: t.route.map(([m, index], point) => [m + (state.blocked && t.affectedFrom !== null && point >= t.affectedFrom ? 40 : 0), index]),
  }));
  return `<svg class="timetable" viewBox="0 0 885 ${plotBottom + 32}" role="img" aria-label="Учебная поездограмма: время по горизонтали, станции по вертикали. Выберите станцию для просмотра грузовой работы.">
    <defs><clipPath id="plotClip"><rect x="152" y="18" width="680" height="${plotBottom - 18}"/></clipPath><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#e9a69a" stroke-width="2"/></pattern></defs>
    ${state.stations.map((s, i) => `<g class="svg-station" data-station="${s.id}" role="button" tabindex="0" aria-label="Открыть станцию ${s.name}" aria-pressed="${s.id === stationId}"><rect x="4" y="${y(i) - 15}" width="137" height="30" rx="5" fill="${s.id === stationId ? '#e7eef1' : 'transparent'}"/><text x="15" y="${y(i) + 4}" fill="${s.id === stationId ? '#225d74' : '#5c6976'}" font-size="11" font-weight="${s.id === stationId ? 650 : 500}">${s.name}</text><text x="131" y="${y(i) + 4}" text-anchor="end" font-size="10" fill="#929ba2">${s.id}</text><line x1="152" y1="${y(i)}" x2="832" y2="${y(i)}" stroke="${s.id === stationId ? '#a2bfcb' : '#e5e9ec'}"/><circle cx="152" cy="${y(i)}" r="${s.id === stationId ? 4 : 2}" fill="${s.id === stationId ? '#35748d' : '#b9c2ca'}"/></g>`).join('')}
    ${Array.from({ length: 25 }, (_, i) => `<line x1="${152 + i * 28.3}" x2="${152 + i * 28.3}" y1="20" y2="${plotBottom}" stroke="${i % 3 ? '#f1f3f5' : '#e5e9ec'}"/>${i % 3 === 0 ? `<text x="${152 + i * 28.3}" y="${plotBottom + 23}" text-anchor="middle" fill="#8c969f" font-size="10">${time(start + i * 30 * 60000)}</text>` : ''}`).join('')}
    <g clip-path="url(#plotClip)">
    ${state.blocked ? `<rect x="152" y="${y(3)}" width="680" height="${rowHeight}" fill="#fdf2ef"/><rect x="152" y="${y(3)}" width="680" height="${rowHeight}" fill="url(#hatch)" opacity=".35"/><text x="590" y="${y(3) + 21}" fill="#b65b4c" font-size="10">D–E · нечётный путь закрыт</text>` : ''}
    ${routes.map(r => `<polyline class="train-route" data-train="${r.n}" opacity="${selectedTrain && selectedTrain !== r.n ? .18 : .85}" points="${r.p.map(([m, s]) => `${x(m)},${y(s)}`).join(' ')}" fill="none" stroke="${r.color}" stroke-width="${selectedTrain === r.n ? 3 : 1.5}" stroke-dasharray="${state.blocked && !state.planApproved ? '5 4' : '0'}"/><text opacity="${selectedTrain && selectedTrain !== r.n ? 0 : 1}" x="${x(r.p[1][0]) + 6}" y="${y(r.p[1][1]) - 6}" font-size="10" font-weight="600" fill="${r.color}">${r.n}</text>`).join('')}
    <line x1="${currentX}" x2="${currentX}" y1="20" y2="${plotBottom}" stroke="#24434f" stroke-width="1.5" stroke-dasharray="4 4"/>
    </g><rect x="${currentX - 23}" y="1" width="46" height="19" rx="4" fill="#24434f"/><text x="${currentX}" y="14" font-size="10" text-anchor="middle" fill="white">${time(state.now)}</text>
  </svg>`;
}

function map() {
  return `<div class="network-map"><div class="map-title">Двухпутный участок · ${state.stations.at(-1).km} км <span>Учебная топология</span></div><div class="station-line">${state.stations.map(s => `<button class="map-station ${stationId === s.id ? 'selected' : ''}" data-station="${s.id}"><span class="station-code">${s.id}</span><strong>${s.name}</strong><small>${s.km} км</small><span class="map-load">${s.occupied}/${s.capacity} ваг.</span></button>`).join('')}</div><div class="map-note">${icon(state.blocked ? 'alert' : 'check')}${state.blocked ? (state.planApproved ? 'На перегоне D–E закрыт нечётный путь. Учебный вариант подтверждён.' : 'На перегоне D–E закрыт нечётный путь. Решение по пропуску ожидает диспетчера.') : 'Оба главных пути открыты. Нажмите на станцию, чтобы увидеть её грузовую работу.'}</div></div>`;
}

function recommendation(station) {
  const groups = state.groups.filter(g => g.stationId === station.id && g.status === 'approaching');
  const candidate = groups.find(g => g.eligible);
  const blocked = groups.find(g => !g.eligible);
  if (state.blocked && !state.planApproved) return `<div class="recommendation incident"><div class="eyebrow">${icon('bolt')} ВАРИАНТ ПРОПУСКА</div><h3>Пассажирский — первым</h3><p>№153 следует E → D по соседнему пути. Грузовые №3401 и №2085 получают задержку 40 минут.</p><div class="recommendation-metrics"><span>Прогноз подхода</span><strong>+40 мин</strong></div><p class="fine">Заданный учебный сценарий. Проверка СЦБ и расчёт бесконфликтности не выполняются.</p><button class="primary" data-action="approve">${icon('check')} Подтвердить вариант</button></div>`;
  return `<div class="recommendation"><div class="eyebrow">${icon('bolt')} РЕКОМЕНДАЦИЯ ПО ПРИЁМУ</div><h3>${candidate ? `Продвинуть группу №${candidate.train}` : 'Ожидать освобождения путей'}</h3><p>${candidate ? `${candidate.origin} → ${station.name} · ${candidate.count} вагонов<br>${state.cargoNames[candidate.cargo]}. Группа помещается на подходящий путь.` : 'Для оставшихся групп сейчас нет подходящей ёмкости либо все группы уже запланированы.'}</p>${candidate ? `<div class="recommendation-metrics"><span>Остаток срока доставки</span><strong>${deadline(candidate)}</strong></div><div class="recommendation-metrics"><span>Запас после обработки</span><strong class="${candidate.slackMinutes < 0 ? 'red-text' : ''}">${hours(candidate.slackMinutes)}</strong></div><button class="primary" data-action="reserve" data-group="${candidate.id}">${icon('check')} Зарезервировать приём</button>` : ''}${blocked ? `<div class="recommendation-foot">${icon('info')}<span>№${blocked.train}: ${deadline(blocked)} до срока, но группа не помещается на подходящий путь.</span></div>` : ''}</div>`;
}

function trackRows(station) {
  const tracks = station.tracks.filter(t => (filter === 'all' || (filter === 'ready' ? t.available > 0 : t.done > 0)) && `${t.name} ${t.number} ${state.cargoNames[t.cargo]}`.toLowerCase().includes(search.toLowerCase()));
  return `<div class="table-wrap"><table class="tracks-table"><thead><tr><th>Путь / специализация</th><th>Вместимость<br><small>фронт, ваг.</small></th><th class="occupancy-heading">Фактическая занятость</th><th>Обработано</th><th>Доступно<br><small>за вычетом резерва</small></th><th>Освобождение ≈</th><th>Операции</th></tr></thead><tbody>${tracks.map(t => `<tr><td><div class="track-name"><span class="track-number">${String(t.number).padStart(2, '0')}</span><div><strong>${t.name}</strong><small>${state.cargoNames[t.cargo]} · ${t.productivity} ваг./ч</small></div></div></td><td><strong>${t.capacity}</strong><small>фронт ${t.front}</small></td><td><div class="occupancy-label"><strong>${t.occupied}<span> / ${t.capacity}</span></strong><span>${t.processing} в работе${t.waiting ? ` · ${t.waiting} ждут` : ''}</span></div><div class="occupancy-bar"><span class="done-segment" style="width:${t.done / t.capacity * 100}%"></span><span class="processing-segment" style="width:${t.processing / t.capacity * 100}%"></span><span class="waiting-segment" style="width:${t.waiting / t.capacity * 100}%"></span><span class="reserved-segment" style="width:${t.reserved / t.capacity * 100}%"></span></div></td><td><span class="done-count">${t.done}</span><small>ожидают уборки</small></td><td>${pill(`${t.available} ваг.`, t.available ? 'green' : 'muted')}<small>${t.reserved ? `резерв ${t.reserved} ваг.` : 'без резерва'}</small></td><td><strong>${t.releaseAt ? time(t.releaseAt) : 'Свободен'}</strong><small>${t.releaseAt ? 'при уборке по плану' : 'готов к подаче'}</small></td><td><div class="row-actions"><button class="text-action" data-action="complete" data-track="${t.id}" ${!t.processing ? 'disabled' : ''}>Завершить</button><button class="text-action green-text" data-action="clear" data-track="${t.id}" ${!t.done ? 'disabled' : ''}>Убрать ${t.done || ''}</button></div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Подходящих путей не найдено. Измените поиск или фильтр.</td></tr>'}</tbody></table></div><div class="table-footer"><span>Показано ${tracks.length} из ${station.tracks.length} путей</span><span>${icon('info')} Завершение обработки не освобождает путь. Требуется уборка вагонов.</span></div>`;
}

function groupRows(station) {
  const groups = state.groups.filter(g => g.stationId === station.id && `${g.train} ${g.origin} ${state.cargoNames[g.cargo]}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || (filter === 'ready' ? g.eligible : g.status === 'reserved')));
  return `<div class="inbound-note">${icon('info')} Очередь — по запасу срока после прибытия и обработки. Резерв учитывает специализацию пути и всю группу вагонов.</div><div class="table-wrap"><table class="groups-table"><thead><tr><th>Группа / груз</th><th>Местоположение</th><th>Прибытие ≈</th><th>До срока доставки</th><th>Запас после обработки</th><th>Возможность приёма</th><th>Решение</th></tr></thead><tbody>${groups.map(g => `<tr><td><strong class="train-number">№${g.train}</strong><small>${state.cargoNames[g.cargo]} · ${g.count} ваг.</small></td><td><strong>${g.status === 'arrived' ? station.name : g.origin}</strong><small>${g.status === 'arrived' ? 'на подъездном пути' : `${g.km} км · исходная позиция`}</small></td><td><strong>${time(g.etaAt)}</strong><small>${new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit' }).format(g.etaAt)}</small></td><td>${pill(deadline(g), (g.deadlineAt - state.now) < 24 * 3600000 ? 'amber' : 'muted')}</td><td><strong class="${g.slackMinutes < 0 ? 'red-text' : ''}">${hours(g.slackMinutes)}</strong><small>${Number.isFinite(g.slackMinutes) ? (g.slackMinutes < 0 ? 'риск просрочки' : 'прогнозный запас') : 'нет грузового фронта'}</small></td><td class="reason-cell">${pill(g.status === 'arrived' ? 'Приняты' : g.status === 'reserved' ? 'Резерв' : g.eligible ? 'Можно принять' : 'Нет ёмкости', g.status === 'reserved' ? 'blue' : g.eligible || g.status === 'arrived' ? 'green' : 'amber')}<small>${g.reason}</small></td><td>${g.status === 'reserved' ? `<div class="row-actions"><button class="text-action green-text" data-action="arrive" data-group="${g.id}" ${g.etaAt > state.now ? 'disabled title="Группа ещё в пути"' : ''}>Принять</button><button class="text-action" data-action="cancel" data-group="${g.id}">Отменить</button></div>` : g.status === 'arrived' ? icon('check', 'green-text') : `<button class="secondary small" data-action="reserve" data-group="${g.id}" ${!g.eligible ? 'disabled' : ''}>В план ${icon('arrow')}</button>`}</td></tr>`).join('') || '<tr><td class="empty" colspan="7">Групп по выбранным условиям нет.</td></tr>'}</tbody></table></div><div class="table-footer"><span>${groups.length} групп · условные данные сети Казахстана</span><span>Прогноз включает обработку и 30 минут на уборку</span></div>`;
}

function render() {
  if (!state) return;
  const station = state.stations.find(s => s.id === stationId);
  const arrivals = state.groups.filter(g => g.stationId === stationId && g.status !== 'arrived');
  const load = Math.round(station.occupied / station.capacity * 100);
  const focus = document.activeElement?.id;
  const selection = focus === 'search' ? document.activeElement.selectionStart : null;
  app.innerHTML = `<aside class="sidebar"><a class="brand" href="/" aria-label="Автодиспетчер">${icon('train')}</a><div class="nav-items"><button class="nav-icon ${tab === 'tracks' ? 'active' : ''}" data-nav="tracks" title="Оперативная обстановка" aria-label="Оперативная обстановка">${icon('grid')}</button><button class="nav-icon ${tab === 'arrivals' ? 'active' : ''}" data-nav="arrivals" title="Подход вагонов" aria-label="Подход вагонов">${icon('route')}</button><button class="nav-icon ${tab === 'log' ? 'active' : ''}" data-nav="log" title="Журнал событий" aria-label="Журнал событий">${icon('clock')}</button></div><div class="sidebar-bottom"><button class="nav-icon" data-action="about" title="О прототипе" aria-label="О прототипе">${icon('info')}</button><div class="avatar" title="Демонстрационный диспетчер">ДН</div></div></aside>
  <div class="workspace"><header class="topbar"><div class="product-name">Автодиспетчер <span class="product-divider"></span><span>Диспетчерский центр</span></div><div class="header-right"><span class="connection ${online ? '' : 'offline'}"><i></i>${online ? 'Сервер подключён' : 'Нет соединения'}</span><span class="header-date">${date(state.now)}</span><span class="demo-label">ДЕМО</span></div></header>
  <main><div class="page-heading"><div><div class="breadcrumb">Движение поездов <span>/</span> Учебный участок</div><h1>Оперативная обстановка</h1><p>${state.stations[0].name} <span class="route-arrow">↔</span> ${state.stations.at(-1).name} <span class="separator">·</span> ${state.stations.length} станций <span class="separator">·</span> Двухпутный участок</p></div><div class="heading-actions"><button class="secondary" data-action="export">${icon('download')} Выгрузить CSV</button><button class="secondary icon-only" data-action="reset-dialog" aria-label="Сбросить демо" title="Сбросить демо">${icon('reset')}</button></div></div>
  <div class="demo-strip"><span>${icon('info')} Учебная модель · данные и расстояния условные · время меняется вручную</span><div><span class="sim-time">${time(state.now)}</span><button data-action="advance" data-minutes="15">+15 мин</button><button data-action="advance" data-minutes="60">+1 час</button></div></div>
  <section class="stats-grid" aria-label="Показатели участка"><article class="stat-card"><div class="stat-top"><span>Станции участка</span>${icon('layers')}</div><div class="stat-value">${state.stations.length}<span>станций</span></div><div class="stat-bottom">${state.stations.length - 1} перегонов · ${state.stations.at(-1).km} км</div></article><article class="stat-card"><div class="stat-top"><span>Поезда в сценарии</span>${icon('train')}</div><div class="stat-value">${state.trains.length}<span>поездов</span></div><div class="stat-bottom">${state.trains.filter(t => t.category === 'passenger').length} пассажирских · ${state.trains.filter(t => t.category !== 'passenger').length} грузовых</div></article><article class="stat-card"><div class="stat-top"><span>Грузовые вагоны на подходе</span>${icon('box')}</div><div class="stat-value green-text">${state.groups.filter(g => g.status !== 'arrived').reduce((n,g) => n + g.count, 0)}<span>вагонов</span></div><div class="stat-bottom">${state.groups.filter(g => g.status !== 'arrived').length} составов · число вагонов зависит от поезда</div></article><article class="stat-card"><div class="stat-top"><span>Вагоны на станциях</span>${icon('route')}</div><div class="stat-value">${state.stations.reduce((n,s) => n + s.occupied, 0)}<span>вагонов</span></div><div class="stat-bottom">${state.stations.reduce((n,s) => n + s.processing, 0)} в работе · ${state.stations.reduce((n,s) => n + s.done, 0)} обработано</div></article></section>
  <div class="overview-grid"><section class="panel graph-panel"><div class="panel-header"><div><h2>График движения <span class="subtle">ГИД</span></h2><span class="panel-subtitle">Выберите станцию на графике для просмотра грузовой работы</span></div><div class="segmented"><button data-chart="graph" class="${chartMode === 'graph' ? 'selected' : ''}">График</button><button data-chart="map" class="${chartMode === 'map' ? 'selected' : ''}">Схема</button></div></div><div class="train-controls"><label>Категория <select id="train-category" aria-label="Категория поездов">${[['all','Все поезда'],['passenger','Пассажирские'],['freight','Грузовые'],['container','Контейнерные']].map(([v,n]) => `<option value="${v}" ${trainCategory === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label>Выделить <select id="train-selection" aria-label="Выделить поезд"><option value="">Все нитки</option>${visibleTrains().map(t => `<option value="${t.number}" ${selectedTrain === t.number ? 'selected' : ''}>№${t.number} · ${t.label}</option>`).join('')}</select></label><span>Показано ${visibleTrains().length} из ${state.trains.length}</span></div><div class="chart-container">${chartMode === 'graph' ? graph() : map()}</div><div class="chart-footer"><div class="legend"><span><i class="line purple"></i>Пассажирский</span><span><i class="line teal"></i>Контейнерный</span><span><i class="line blue"></i>Грузовой</span><span><i class="line gold"></i>Обычный грузовой</span></div><button class="incident-button ${state.blocked ? 'is-blocked' : ''}" data-action="block">${icon('alert')}${state.blocked ? 'Снять закрытие D–E' : 'Сценарий: закрытие D–E'}</button></div><div class="graph-caption">Иллюстративные нитки движения · ${state.blocked ? (state.planApproved ? 'учебный вариант подтверждён' : 'пунктир — предложенный вариант') : 'исходный учебный график'} · не является проверенным планом пропуска</div></section>${recommendation(station)}</div>
  <section class="train-manifest panel" aria-label="Составы учебного сценария"><div class="panel-header"><h2>Поезда участка <span class="subtle">${visibleTrains().length} из ${state.trains.length}</span></h2><span class="panel-subtitle">Нажмите на поезд, чтобы выделить его на графике</span></div><div class="train-list">${visibleTrains().map(t => `<button class="train-card ${selectedTrain === t.number ? 'selected' : ''}" data-select-train="${t.number}" aria-pressed="${selectedTrain === t.number}"><span class="train-color" style="background:${t.color}"></span><span><strong>№${t.number} · ${t.label}</strong><small>${state.stations[t.route[0][1]].name} → ${state.stations[t.route.at(-1)[1]].name} · ${t.wagons} ${t.category === 'passenger' ? 'пасс. вагонов' : 'грузовых вагонов'}</small></span></button>`).join('')}</div></section>
  <section class="panel station-panel" id="station-panel"><div class="station-heading"><div class="station-heading-left"><span class="station-letter">${station.id}</span><div><div class="station-title-row"><h2>Станция ${station.name}</h2>${pill(station.type, 'muted')}</div><p>${station.tracks.length} подъездных пути · ${station.occupied} ваг. на путях · ${station.available} мест доступно · ${station.reserved} в резерве</p></div></div><div class="station-utilization"><span>Занятость станции <strong>${load}%</strong></span><div class="mini-bar"><i style="width:${load}%"></i></div></div></div>
  <div class="tabs" role="tablist" aria-label="Данные станции"><button id="tab-tracks" role="tab" aria-selected="${tab === 'tracks'}" aria-controls="tab-content" data-tab="tracks" class="${tab === 'tracks' ? 'active' : ''}">Подъездные пути <span>${station.tracks.length}</span></button><button id="tab-arrivals" role="tab" aria-selected="${tab === 'arrivals'}" aria-controls="tab-content" data-tab="arrivals" class="${tab === 'arrivals' ? 'active' : ''}">Подход вагонов <span>${arrivals.length}</span></button><button id="tab-log" role="tab" aria-selected="${tab === 'log'}" aria-controls="tab-content" data-tab="log" class="${tab === 'log' ? 'active' : ''}">Журнал событий <span>${state.log.length}</span></button></div>
  <div id="tab-content" role="tabpanel" aria-labelledby="tab-${tab}">${tab !== 'log' ? `<div class="table-tools"><label class="search-field">${icon('search')}<input id="search" type="search" placeholder="${tab === 'tracks' ? 'Найти путь или груз…' : 'Поезд, станция или груз…'}" value="${esc(search)}" aria-label="Поиск ${tab === 'tracks' ? 'путей' : 'групп вагонов'}"></label><div class="table-tools-right">${tab === 'tracks' ? '<div class="legend compact"><span><i class="dot teal-dot"></i>В работе</span><span><i class="dot amber-dot"></i>Обработано</span><span><i class="dot blue-dot"></i>Резерв</span></div>' : ''}<select id="filter" aria-label="Фильтр"><option value="all" ${filter === 'all' ? 'selected' : ''}>${tab === 'tracks' ? 'Все пути' : 'Все группы'}</option><option value="ready" ${filter === 'ready' ? 'selected' : ''}>${tab === 'tracks' ? 'Есть свободная ёмкость' : 'Можно принять'}</option><option value="other" ${filter === 'other' ? 'selected' : ''}>${tab === 'tracks' ? 'Ожидают уборки' : 'В резерве'}</option></select></div></div>${tab === 'tracks' ? trackRows(station) : groupRows(station)}` : `<div class="event-log">${state.log.map(e => `<div class="event"><span>${time(e.at)}</span><i></i><p>${esc(e.text)}</p></div>`).join('')}</div>`}</div></section>
  <footer class="page-footer"><span><span class="footer-mark">КТЖ</span> Автодиспетчер · Прототип 0.1</span><span>Помощник диспетчера · Не заменяет системы безопасности движения</span></footer></main></div><dialog id="modal"></dialog>`;
  if (focus === 'search') {
    const input = document.querySelector('#search');
    if (input) { input.focus(); input.setSelectionRange(selection, selection); }
  }
}

function notify(message, error = false) {
  const toast = document.querySelector('#toast');
  toast.textContent = message; toast.className = `toast visible ${error ? 'error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 5000);
}

async function action(payload) {
  if (busy) return;
  busy = true;
  app.classList.add('pending');
  try {
    const res = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    state = data; render();
    notify(payload.type === 'reset' ? 'Демонстрационная смена восстановлена' : data.log[0].text);
  } catch (e) { notify(e.name === 'TimeoutError' ? 'Сервер не ответил. Проверьте соединение.' : e.message, true); }
  finally { busy = false; app.classList.remove('pending'); }
}

function showDialog(kind) {
  const modal = document.querySelector('#modal');
  modal.innerHTML = `<div class="modal-header"><h2>${kind === 'reset' ? 'Начать смену заново?' : 'О демонстрационной модели'}</h2><button class="icon-only secondary" data-close aria-label="Закрыть">${icon('close')}</button></div>${kind === 'reset' ? '<p>Все операции, резервы и события этой учебной смены будут сброшены.</p><div class="modal-actions"><button class="secondary" data-close>Отмена</button><button class="primary" data-confirm-reset>Сбросить демо</button></div>' : '<p>Первый прототип объединяет грузовую работу станции, подход вагонов и иллюстративный ГИД. Все данные синтетические, названия и расстояния не задают реальную топологию сети.</p><p>Ёмкость освобождается после уборки. Резервы уменьшают доступное число мест. Приоритет грузовых групп определяется запасом срока после прогнозного прибытия, обработки и уборки; грузовая специализация ограничивает выбор пути.</p><p>Прогноз освобождения предполагает уборку через 30 минут после обработки. Приём группы в демо доступен после её ETA. Время продвигается кнопками, движение по сети не моделируется.</p><p>Закрытие D–E — заранее заданный сценарий, а график иллюстративный. Оптимизатор движения, сертифицированная проверка безопасности и реальные интеграции не реализованы.</p>'}`;
  modal.showModal();
}

function exportCsv() {
  const station = state.stations.find(s => s.id === stationId);
  const rows = [
    ['Автодиспетчер — учебный отчёт', date(state.now), time(state.now)],
    ['Станция', station.name],
    ['Путь', 'Специализация', 'Вместимость', 'Фронт', 'В работе', 'Обработано', 'Ожидают фронта', 'Резерв', 'Доступно'],
    ...station.tracks.map(t => [t.number, state.cargoNames[t.cargo], t.capacity, t.front, t.processing, t.done, t.waiting, t.reserved, t.available]),
    [], ['Группа', 'Исходная станция', 'Груз', 'Вагонов', 'Осталось км (исходно)', 'ETA', 'Срок доставки', 'Запас минут', 'Статус', 'Путь'],
    ...state.groups.filter(g => g.stationId === stationId).map(g => [g.train, g.origin, state.cargoNames[g.cargo], g.count, g.km, new Date(g.etaAt).toISOString(), new Date(g.deadlineAt).toISOString(), Number.isFinite(g.slackMinutes) ? g.slackMinutes : '', g.status, g.trackId || '']),
    [], ['Событие, время UTC', 'Описание'], ...state.log.map(e => [new Date(e.at).toISOString(), e.text]),
  ];
  const csv = '\uFEFF' + rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `autodispatch-${stationId}-${state.revision}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('Отчёт по станции выгружен в CSV');
}

document.addEventListener('click', e => {
  const target = e.target.closest('button, [data-station]');
  if (!target || target.disabled) return;
  if (target.hasAttribute('data-close')) { document.querySelector('#modal').close(); return; }
  if (target.hasAttribute('data-confirm-reset')) { document.querySelector('#modal').close(); action({ type: 'reset' }); return; }
  if (target.dataset.selectTrain) { selectedTrain = target.dataset.selectTrain; chartMode = 'graph'; render(); return; }
  if (target.dataset.station) { stationId = target.dataset.station; search = ''; filter = 'all'; render(); return; }
  if (target.dataset.tab || target.dataset.nav) { tab = target.dataset.tab || target.dataset.nav; search = ''; filter = 'all'; render(); if (target.dataset.nav) document.querySelector('#station-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (target.dataset.chart) { chartMode = target.dataset.chart; render(); return; }
  const type = target.dataset.action;
  if (!type) return;
  if (type === 'export') return exportCsv();
  if (type === 'about') return showDialog('about');
  if (type === 'reset-dialog') return showDialog('reset');
  action({ type, trackId: target.dataset.track, groupId: target.dataset.group, minutes: Number(target.dataset.minutes) });
});
document.addEventListener('keydown', e => {
  if (['Enter', ' '].includes(e.key) && e.target.matches('.svg-station')) { e.preventDefault(); stationId = e.target.dataset.station; search = ''; filter = 'all'; render(); }
});
document.addEventListener('input', e => { if (e.target.id === 'search') { search = e.target.value; render(); } });
document.addEventListener('change', e => {
  if (e.target.id === 'train-category') { trainCategory = e.target.value; if (!visibleTrains().some(t => t.number === selectedTrain)) selectedTrain = ''; render(); }
  if (e.target.id === 'train-selection') { selectedTrain = e.target.value; render(); }
  if (e.target.id === 'filter') { filter = e.target.value; render(); } });

const events = new EventSource('/api/events');
events.onopen = () => { online = true; render(); };
events.onmessage = e => { state = JSON.parse(e.data); render(); };
events.onerror = () => {
  online = false;
  if (state) render();
  else app.innerHTML = '<div class="initial-load"><h2>Не удалось подключиться к серверу</h2><p>Запустите проект командой npm start. Соединение восстановится автоматически.</p></div>';
};
