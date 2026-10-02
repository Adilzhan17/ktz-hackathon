// Списки всей сети: поезда и станции с фильтрами. Участок Караганда — Мойынты остаётся на отдельных вкладках.
import { useMemo, useState } from 'preact/hooks';
import { html, Icon, time, downloadCsv } from './lib.js';
import { go, updateUi } from './store.js';
import { Badge, Button, Kpi, Segmented, Empty } from './ui.js';
import { useNetworkTrains, useStationIndex, routeOptions } from './network-data.js';
import { networkStats } from './network-sim.js';

const PAGE = 100;
const fmt = n => n.toLocaleString('ru-RU');
const TONE = { passenger: 'accent', container: 'ink', freight: 'muted' };
const absKm = t => (t.dir === 'fwd' ? t.km : t.totalKm - t.km);

export function RouteSelect({ sim, value, onChange, label = 'Участок', all = 'Все участки' }) {
  return html`<label class="filter-select"><span class="sr-only">${label}</span>
    <select value=${value} onChange=${e => onChange(e.target.value)} aria-label=${label}><option value="all">${all}</option>
      ${routeOptions(sim).map(o => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}</select></label>`;
}

const SORTS = {
  number: t => Number(t.number), progress: t => t.progress, speed: t => -t.speedKmh, stop: t => -(t.stopped && !t.planned ? t.delayMin + t.restMin : 0), arrival: t => t.arrivesMs,
};

export function NetworkTrains({ scopeTabs }) {
  const { sim, trains, loading, failed } = useNetworkTrains(5);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [route, setRoute] = useState('all');
  const [loco, setLoco] = useState('all');
  const [sort, setSort] = useState('number');
  const [limit, setLimit] = useState(PAGE);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trains.filter(t => (category === 'all' || t.category === category) && (route === 'all' || t.routeId === route) && (loco === 'all' || t.loco.type === loco)
      && (status === 'all' || (status === 'moving' ? !t.stopped : status === 'stopped' ? t.stopped : t.stopped && !t.planned))
      && (!q || `${t.number} ${t.label} ${t.route} ${t.from} ${t.to} ${t.station} ${t.loco.series} ${t.cargo || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => SORTS[sort](a) - SORTS[sort](b) || Number(a.number) - Number(b.number));
  }, [trains, query, category, status, route, loco, sort]);
  const stats = networkStats(rows);
  const reset = fn => v => { fn(v); setLimit(PAGE); };
  const show = t => { updateUi({ selectedNetTrain: t.uid }); go('/'); };
  const exportCsv = () => downloadCsv('network-trains.csv', [['Номер', 'Тип', 'Маршрут', 'Откуда', 'Куда', 'Локомотив', 'Вагонов', 'Груз', 'Км', 'Всего км', 'Скорость', 'Состояние', 'Прибытие'],
    ...rows.map(t => [t.number, t.label, t.route, t.from, t.to, t.loco.series, t.wagons, t.cargo || '', Math.round(t.km), Math.round(t.totalKm), t.speedKmh, t.stopped ? t.reason : 'в пути', time(t.arrivesMs)])]);
  return html`<section class="panel">
    ${scopeTabs}
    <div class="toolbar">
      <label class="search"><${Icon} name="search" size=${16} /><span class="sr-only">Поиск поезда сети</span>
        <input type="search" placeholder="Номер, город, станция, участок, локомотив" value=${query} onInput=${e => reset(setQuery)(e.target.value)} /></label>
      <${Button} icon="download" onClick=${exportCsv}>CSV</${Button}>
    </div>
    <div class="filter-row">
      <${Segmented} label="Категория" value=${category} onChange=${reset(setCategory)} options=${[{ value: 'all', label: 'Все' }, { value: 'passenger', label: 'Пассажирские' }, { value: 'container', label: 'Контейнерные' }, { value: 'freight', label: 'Грузовые' }]} />
      <${Segmented} label="Состояние" value=${status} onChange=${reset(setStatus)} options=${[{ value: 'all', label: 'Любое' }, { value: 'moving', label: 'В пути' }, { value: 'stopped', label: 'Стоят' }, { value: 'forced', label: 'Вынужденно' }]} />
      <${Segmented} label="Тяга" value=${loco} onChange=${reset(setLoco)} options=${[{ value: 'all', label: 'Любая' }, { value: 'электровоз', label: 'Электровоз' }, { value: 'тепловоз', label: 'Тепловоз' }]} />
      <${RouteSelect} sim=${sim} value=${route} onChange=${reset(setRoute)} />
      <label class="filter-select"><span class="sr-only">Сортировка</span><select value=${sort} onChange=${e => setSort(e.target.value)} aria-label="Сортировка">
        <option value="number">По номеру</option><option value="progress">По пройденному пути</option><option value="speed">По скорости</option><option value="stop">По длине простоя</option><option value="arrival">По времени прибытия</option></select></label>
    </div>
    <div class="mini-kpis" aria-label="Сводка по выбранным поездам">
      <span><strong>${fmt(stats.total)}</strong> поездов</span><span><strong>${fmt(stats.electric)}</strong> электровозов</span><span><strong>${fmt(stats.diesel)}</strong> тепловозов</span>
      <span><strong>${fmt(stats.wagons)}</strong> вагонов</span><span><strong>${stats.forced}</strong> вынужденно стоят</span><span>ср. скорость <strong>${stats.avgSpeed}</strong> км/ч</span>
    </div>
    ${failed ? html`<${Empty} icon="circle-alert" title="Не удалось загрузить маршруты сети">Обновите страницу.</${Empty}>`
      : loading ? html`<p class="muted pad">Загрузка поездов сети…</p>`
      : html`<div class="table-wrap"><table class="table responsive">
        <thead><tr><th scope="col">№</th><th scope="col">Тип</th><th scope="col">Маршрут</th><th scope="col">Локомотив</th><th scope="col">Состав</th><th scope="col">Положение</th><th scope="col">Состояние</th><th scope="col">Прибытие</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
        <tbody>${rows.slice(0, limit).map(t => html`<tr key=${t.uid}>
          <td data-label="№"><strong>${t.number}</strong></td>
          <td data-label="Тип"><${Badge} tone=${TONE[t.category]}>${t.label}</${Badge}></td>
          <td data-label="Маршрут"><div class="two"><span>${t.from} <${Icon} name="arrow-right" size=${13} class="inline" /> ${t.to}</span><small>${t.route}</small></div></td>
          <td data-label="Локомотив"><div class="two"><span>${t.loco.series}</span><small>${t.loco.type}</small></div></td>
          <td data-label="Состав"><div class="two"><span>${t.wagons} ваг.</span><small>${t.cargo ? `${t.cargo}, ${t.loaded ? 'гружёный' : 'порожний'}` : `≈ ${t.wagons * 52} мест`}</small></div></td>
          <td data-label="Положение" class="num"><div class="two"><span>${Math.round(t.km)} из ${Math.round(t.totalKm)} км</span><small>${Math.round(t.progress * 100)}%</small></div></td>
          <td data-label="Состояние"><div class="two"><span class=${t.stopped && !t.planned ? 'bad' : ''}>${t.stopped ? `Стоит: ${t.station}` : `${t.speedKmh} км/ч`}</span><small>${t.stopped ? `${t.reason}${t.planned ? '' : `, ещё ${t.restMin} мин`}` : 'в пути'}</small></div></td>
          <td data-label="Прибытие" class="num">${time(t.arrivesMs)}</td>
          <td class="actions-cell"><${Button} size="sm" variant="ghost" icon="map-pin" onClick=${() => show(t)}>На карте</${Button}></td></tr>`)}
          ${!rows.length && html`<tr><td colspan="9"><${Empty} icon="search" title="Ничего не найдено">Измените фильтры или поиск.</${Empty}></td></tr>`}</tbody></table></div>
        <div class="table-foot">Показано ${Math.min(limit, rows.length)} из ${fmt(rows.length)} (всего на сети ${fmt(trains.length)})
          ${rows.length > limit && html`<${Button} size="sm" onClick=${() => setLimit(limit + PAGE)}>Показать ещё ${Math.min(PAGE, rows.length - limit)}</${Button}>`}</div>`}
  </section>`;
}

export function NetworkStations({ scopeTabs }) {
  const index = useStationIndex();
  const { sim, trains } = useNetworkTrains(10);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [route, setRoute] = useState('all');
  const [named, setNamed] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (index || []).filter(r => (kind === 'all' || r.kind === kind) && (route === 'all' || r.routeId === route) && (!named || !/^\d+\s*км/i.test(r.name))
      && (!q || `${r.name} ${r.route}`.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [index, query, kind, route, named]);
  const byRoute = useMemo(() => { const m = new Map(); for (const t of trains) { if (!m.has(t.routeId)) m.set(t.routeId, []); m.get(t.routeId).push(t); } return m; }, [trains]);
  const nearest = r => {
    let best = null;
    for (const t of byRoute.get(r.routeId) || []) { const d = Math.abs(absKm(t) - r.km); if (d <= 60 && (!best || d < best.d)) best = { t, d: Math.round(d) }; }
    return best;
  };
  const reset = fn => v => { fn(v); setLimit(PAGE); };
  const show = r => { updateUi({ mapFocus: { kind: r.kind, rec: r.rec } }); go('/'); };
  const total = index?.length || 0, stationsN = (index || []).filter(r => r.kind === 'station').length;
  return html`<section class="panel">
    ${scopeTabs}
    <div class="toolbar">
      <label class="search"><${Icon} name="search" size=${16} /><span class="sr-only">Поиск станции сети</span>
        <input type="search" placeholder="Город, станция или участок" value=${query} onInput=${e => reset(setQuery)(e.target.value)} /></label>
      <label class="check"><input type="checkbox" checked=${named} onChange=${e => reset(setNamed)(e.target.checked)} /> Только с названием (без «102 км»)</label>
    </div>
    <div class="filter-row">
      <${Segmented} label="Вид" value=${kind} onChange=${reset(setKind)} options=${[{ value: 'all', label: 'Все' }, { value: 'station', label: 'Станции' }, { value: 'halt', label: 'Остановочные пункты' }]} />
      <${RouteSelect} sim=${sim} value=${route} onChange=${reset(setRoute)} />
    </div>
    <div class="mini-kpis"><span><strong>${fmt(stationsN)}</strong> станций</span><span><strong>${fmt(total - stationsN)}</strong> остановочных пунктов</span><span>в списке <strong>${fmt(rows.length)}</strong></span></div>
    ${!index ? html`<p class="muted pad">Загрузка станций сети…</p>` : html`<div class="table-wrap"><table class="table responsive">
      <thead><tr><th scope="col">Название</th><th scope="col">Вид</th><th scope="col">Участок</th><th scope="col">Км на участке</th><th scope="col">Поездов на участке</th><th scope="col">Ближайший поезд</th><th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
      <tbody>${rows.slice(0, limit).map(r => { const n = nearest(r); return html`<tr key=${r.id}>
        <td data-label="Название"><strong>${r.name}</strong></td>
        <td data-label="Вид">${r.kind === 'station' ? 'Станция' : 'Остановочный пункт'}</td>
        <td data-label="Участок">${r.route}${r.offKm > 15 ? html`<small class="muted"> · в ${r.offKm} км от линии</small>` : ''}</td>
        <td data-label="Км" class="num">${r.km}</td>
        <td data-label="Поездов" class="num">${(byRoute.get(r.routeId) || []).length}</td>
        <td data-label="Ближайший">${n ? html`<div class="two"><span>№${n.t.number} · ${n.t.label.toLowerCase()}</span><small>${n.d} км · ${n.t.stopped ? 'стоит' : `${n.t.speedKmh} км/ч`}</small></div>` : html`<span class="muted">в радиусе 60 км нет</span>`}</td>
        <td class="actions-cell"><${Button} size="sm" variant="ghost" icon="map-pin" onClick=${() => show(r)}>На карте</${Button}></td></tr>`; })}
        ${!rows.length && html`<tr><td colspan="7"><${Empty} icon="search" title="Ничего не найдено">Измените фильтры или поиск.</${Empty}></td></tr>`}</tbody></table></div>
      <div class="table-foot">Показано ${Math.min(limit, rows.length)} из ${fmt(rows.length)}
        ${rows.length > limit && html`<${Button} size="sm" onClick=${() => setLimit(limit + PAGE)}>Показать ещё ${Math.min(PAGE, rows.length - limit)}</${Button}>`}</div>`}
  </section>`;
}
