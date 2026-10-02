import { stationTraffic } from './station-metrics.js';
import { useMemo, useState } from 'preact/hooks';
import { html, Icon, count, delayText, clockAt, duration, PRIORITY, DIRECTION, downloadCsv, time, dateLong } from './lib.js';
import { app, go, href, updateUi, useLiveNow } from './store.js';
import { Button, Badge, Kpi, PageHeader, Segmented, Empty } from './ui.js';
import { Gantt } from './gantt.js';
import { TrackMap } from './trackmap.js';
import { DispatcherPanel } from './panel.js';
import { IncidentPanel, Scenarios, PassengerNotices, AttentionCard, LateList } from './decisions.js';

const stationName = (data, i) => data.stations[i].name;

export function Overview({ data }) {
  const late = data.trains.filter(t => t.delay > 0);
  const passengerLate = data.trains.filter(t => t.category === 'passenger' && t.delay > 0);
  const worst = passengerLate.reduce((m, t) => Math.max(m, t.delay), 0);
  const totalDelay = late.reduce((n, t) => n + t.delay, 0);
  const incident = data.blocked;
  const avgLoad = Math.round(data.sections.reduce((n, x) => n + x.load, 0) / data.sections.length);
  const busiest = data.sections.reduce((m, x) => (x.load > m.load ? x : m), data.sections[0]);
  const serviced = data.trains.filter(t => t.techState.status === 'на ТО').length;
  const soon = data.trains.filter(t => t.techState.status === 'скоро ТО').length;
  const broken = data.trains.filter(t => t.broken).length;
  return html`<${PageHeader} title="Оперативная обстановка"
      subtitle=${`${stationName(data, 0)} ↔ ${stationName(data, data.stations.length - 1)} · ${data.stations.length} станций · двухпутный участок с автоблокировкой`}
      actions=${html`<a class="btn btn-secondary" href=${href('/map')}><${Icon} name="map-pin" size=${17} />Карта участка</a><a class="btn btn-secondary" href=${href('/trains')}><${Icon} name="train-front" size=${17} />${data.trains.length} на участке</a><${Button} variant="primary" icon="construction" onClick=${() => go('/decisions')}>Ввести событие</${Button}>`} />
    <section class="panel map-panel" aria-labelledby="map-title">
      <div class="panel-head"><div><h2 id="map-title">Схема участка в реальном времени</h2>
        <small>Время идёт в реальном ходе; поезда, ТО, вагоны и происшествия создаются сами. Сверху нечётный путь (←), снизу чётный (→).</small></div></div>
      <${TrackMap} data=${data} />
    </section>
    <${DispatcherPanel} data=${data} />
    <section class="kpis" aria-label="Показатели участка">
      <${Kpi} label="Состояние участка" icon="activity" tone=${incident ? 'danger' : 'neutral'}
        value=${incident ? 'Инцидент' : data.restrictions.length ? 'Ограничения' : 'Норма'}
        note=${incident ? count(data.dispatch.closures.length, ['закрытие пути', 'закрытия пути', 'закрытий пути']) : data.restrictions.length ? count(data.restrictions.length, ['ограничение скорости', 'ограничения скорости', 'ограничений скорости']) : 'Движение по графику'} />
      <${Kpi} label="Конфликты" icon="triangle-alert" tone=${data.dispatch.conflicts.length ? 'danger' : 'neutral'}
        value=${data.dispatch.conflicts.length} note=${data.dispatch.conflicts.length ? 'встречных поездов на одном пути' : 'встречных поездов нет'} />
      <${Kpi} label="Загрузка участка" icon="gauge" tone=${avgLoad >= 70 ? 'danger' : 'neutral'} value=${avgLoad} unit="%"
        note=${`самый загруженный перегон ${data.stations[busiest.segment].id}–${data.stations[busiest.segment + 1].id}: ${busiest.load}%`} />
      <${Kpi} label="Опоздание пассажирских" icon="train-front" tone=${worst ? 'danger' : 'neutral'}
        value=${worst ? `+${worst}` : '0'} unit="мин"
        note=${passengerLate.length ? `${count(passengerLate.length, ['поезд задерживается', 'поезда задерживаются', 'поездов задерживается'])} из ${data.trains.filter(t => t.category === 'passenger').length}` : 'все пассажирские по графику'} />
      <${Kpi} label="Задержано поездов" icon="hourglass" value=${late.length} unit=${`из ${data.trains.length}`}
        note=${late.length ? `суммарно ${duration(totalDelay)}` : 'задержек нет'} />
      <${Kpi} label="ТО и поломки" icon="wrench" tone=${broken ? 'danger' : 'neutral'} value=${serviced} unit="на ТО"
        note=${`${soon} скоро ТО · ${broken ? `${broken} с поломкой` : 'поломок нет'}`} />
    </section>
    <div class="grid-main">
      <section class="panel gid-panel" aria-labelledby="gid-title">
        <div class="panel-head"><div><h2 id="gid-title">График движения <span class="gid-tag">ГИД</span></h2>
          <small>План и прогноз движения по участку</small></div></div>
        <${Gantt} data=${data} />
      </section>
      <aside class="aside" aria-label="Что требует внимания">
        <${AttentionCard} data=${data} />
        <${LateList} data=${data} />
      </aside>
    </div>`;
}

export function DecisionsPage({ data }) {
  const incident = data.blocked;
  const first = data.dispatch.conflicts.length ? Math.min(...data.dispatch.conflicts.map(c => Math.min(c.a.enter, c.b.enter))) : null;
  const start = first === null ? 0 : Math.max(0, Math.floor((first - 30) / 30) * 30);
  return html`<${PageHeader} title="Решения диспетчера"
      subtitle="Введите событие, сравните варианты пропуска и подтвердите лучший. Решение остаётся за диспетчером." />
    <div class="grid-main">
      <div class="stack">
        ${incident ? html`<${IncidentPanel} data=${data} />` : html`<section class="panel"><${Empty} icon="circle-check" title="Конфликтов нет">Движение идёт по графику. Введите событие справа, и система рассчитает варианты пропуска.</${Empty}></section>`}
        <section class="panel" aria-labelledby="prev-title">
          <div class="panel-head"><div><h2 id="prev-title">Прогноз для выбранного варианта</h2><small>Окно 4 часа вокруг закрытого перегона. Красный отрезок — ожидание на станции.</small></div><a href=${href('/overview')}>Открыть полный ГИД</a></div>
          <${Gantt} data=${data} zoom=${4} start=${start} compact />
        </section>
      </div>
      <aside class="aside" aria-label="События и уведомления">
        <${Scenarios} data=${data} />
        <${PassengerNotices} data=${data} />
      </aside>
    </div>`;
}

const SORTS = {
  number: t => Number(t.number), priority: t => t.priority, load: t => t.loadPct, cond: t => t.techState.conditionPct,
  plan: t => t.route.at(-1)[0], forecast: t => t.forecast.at(-1)[0], delay: t => (t.delay === null ? 1e9 : t.delay),
};
const FILTERS = [{ value: 'all', label: 'Все' }, { value: 'late', label: 'Опаздывают' }, { value: 'service', label: 'ТО' }, { value: 'broken', label: 'Поломки' }];

export function Trains({ data }) {
  const [sort, setSort] = useState({ key: 'delay', dir: -1 });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const { ui } = app;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.trains
      .filter(t => (ui.category === 'all' || t.category === ui.category)
        && (filter === 'all' || (filter === 'late' && (t.delay > 0 || t.disabled)) || (filter === 'service' && ['на ТО', 'ТО перед рейсом', 'скоро ТО'].includes(t.techState.status)) || (filter === 'broken' && t.broken))
        && (!q || `${t.number} ${t.label} ${t.loco.series} ${stationName(data, t.route[0][1])} ${stationName(data, t.route.at(-1)[1])}`.toLowerCase().includes(q)))
      .sort((a, b) => (SORTS[sort.key](a) > SORTS[sort.key](b) ? 1 : SORTS[sort.key](a) < SORTS[sort.key](b) ? -1 : 0) * sort.dir || Number(a.number) - Number(b.number));
  }, [data, ui.category, query, sort, filter]);
  const th = (key, label) => html`<th scope="col" aria-sort=${sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
    <button type="button" class="th-btn" onClick=${() => setSort(s => ({ key, dir: s.key === key ? -s.dir : (key === 'delay' || key === 'load' ? -1 : 1) }))}>${label}
      <${Icon} name=${sort.key === key ? (sort.dir > 0 ? 'chevron-up' : 'chevron-down') : 'arrow-up-down'} size=${13} /></button></th>`;
  const show = t => { updateUi({ selectedTrain: t.number }); go('/overview'); };
  const exportCsv = () => downloadCsv('trains.csv', [
    ['Номер', 'Тип', 'Приоритет', 'Направление', 'Откуда', 'Куда', 'Вагонов', 'Локомотив', 'Загрузка, %', 'Масса, т', 'Состояние ТО', 'Тех. состояние, %', 'Прибытие по графику', 'Прогноз прибытия', 'Опоздание, мин'],
    ...rows.map(t => [t.number, t.label, t.priority, DIRECTION[t.direction], stationName(data, t.route[0][1]), stationName(data, t.route.at(-1)[1]), t.wagons, `${t.loco.series} №${t.loco.number}`, t.loadPct, t.grossT, t.techState.status, t.techState.conditionPct, clockAt(data, t.route.at(-1)[0]), clockAt(data, t.forecast.at(-1)[0]), t.delay ?? 'снят с рейса'])]);
  return html`<${PageHeader} title="Поезда участка" subtitle=${`${data.trains.length} поездов в расписании на ближайшие сутки · приоритет определяет очерёдность при конфликтах`}
      actions=${html`<${Button} icon="download" onClick=${exportCsv}>Выгрузить CSV</${Button}>`} />
    <section class="panel">
      <div class="toolbar">
        <label class="search"><${Icon} name="search" size=${16} /><span class="sr-only">Поиск поезда</span>
          <input type="search" placeholder="Номер, тип, локомотив или станция" value=${query} onInput=${e => setQuery(e.target.value)} /></label>
        <div class="btn-row"><${Segmented} label="Категория" value=${ui.category} onChange=${v => updateUi({ category: v })}
          options=${[{ value: 'all', label: 'Все' }, { value: 'passenger', label: 'Пассажирские' }, { value: 'freight', label: 'Грузовые' }, { value: 'container', label: 'Контейнерные' }]} />
          <${Segmented} label="Состояние" value=${filter} onChange=${setFilter} options=${FILTERS} /></div>
      </div>
      <p class="note"><${Icon} name="info" size=${15} /> Приоритет: ${Object.entries(data.priorityNames).map(([k, v]) => `${k} — ${v.toLowerCase()}`).join('; ')}.</p>
      <div class="table-wrap">
        <table class="table responsive">
          <thead><tr>${th('number', '№')}${th('priority', 'Тип')}<th scope="col">Маршрут</th><th scope="col">Локомотив</th>${th('load', 'Загрузка')}${th('cond', 'ТО / состояние')}${th('plan', 'По графику')}${th('forecast', 'Прогноз')}${th('delay', 'Опоздание')}<th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
          <tbody>
            ${rows.map(t => html`<tr key=${t.number} class=${app.ui.selectedTrain === t.number ? 'sel' : ''}>
              <td data-label="№"><strong>${t.number}</strong></td>
              <td data-label="Тип"><${Badge} tone=${PRIORITY[t.priority].tone}>${t.label}</${Badge}></td>
              <td data-label="Маршрут">${stationName(data, t.route[0][1])} <${Icon} name="arrow-right" size=${13} class="inline" /> ${stationName(data, t.route.at(-1)[1])}</td>
              <td data-label="Локомотив"><div class="two"><span>${t.loco.series}</span><small>${t.loco.type} · ${t.grossT} т</small></div></td>
              <td data-label="Загрузка" class="num"><div class="two"><span>${t.loadPct}%</span><small>${t.wagons} ваг.${t.cargo ? ` · ${data.cargoNames[t.cargo].toLowerCase()}` : ''}</small></div></td>
              <td data-label="ТО / состояние"><div class="two"><span class=${['скоро ТО'].includes(t.techState.status) ? 'bad' : ''}>${t.techState.status}</span><small>${t.techState.conditionPct}% · с ТО ${t.techState.hoursSince} ч</small></div></td>
              <td data-label="По графику" class="num">${clockAt(data, t.route.at(-1)[0])}</td>
              <td data-label="Прогноз" class="num">${t.disabled ? '—' : clockAt(data, t.forecast.at(-1)[0])}</td>
              <td data-label="Опоздание" class=${`num ${t.delay > 0 || t.disabled ? 'bad' : ''}`}>${t.disabled ? 'снят с рейса' : delayText(t.delay)}</td>
              <td class="actions-cell"><${Button} size="sm" variant="ghost" icon="chart-gantt" onClick=${() => show(t)}>На схеме</${Button}></td>
            </tr>`)}
            ${!rows.length && html`<tr><td colspan="10"><${Empty} icon="search" title="Ничего не найдено">Измените поиск, категорию или состояние.</${Empty}></td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="table-foot"><span>Показано ${rows.length} из ${data.trains.length}</span></div>
    </section>`;
}

export function Stations({ data }) {
  const now = useLiveNow(4);
  return html`<${PageHeader} title="Станции" subtitle="Грузовая работа, подъездные пути и подход вагонов по каждой станции" />
    <p class="note station-explainer">Занятость — вагоны на подъездных путях. Проходящие поезда и группы, ожидающие команды «Принять», в неё не входят. После обработки вагоны занимают путь до уборки.</p>
    <div class="station-grid">
      ${data.stations.map(s => {
        const load = Math.round(s.occupied / s.capacity * 100);
        const traffic = stationTraffic(data, s.id, now);
        return html`<a key=${s.id} class="panel station-card" data-station=${s.id} href=${href(`/station/${s.id}`)}>
          <div class="sc-head"><span class="code lg">${s.id}</span><div><h2>${s.name}</h2><small>${s.type} · ${s.km} км</small></div></div>
          <div class="sc-occupancy"><strong>${s.occupied} / ${s.capacity} ваг.</strong><span>${load}% занято</span></div>
          <div class="occ-bar" role="img" aria-label=${`На подъездных путях ${s.occupied} из ${s.capacity} вагонов, резерв ${s.reserved}`}>
            ${['processing', 'done', 'waiting', 'reserved'].map(key => html`<i key=${key} class=${`seg ${key}`} style=${`width:${s[key] / s.capacity * 100}%`}></i>`)}
          </div>
          <div class="sc-cargo"><span>В работе ${s.processing}</span><span>Обработано ${s.done}</span><span>Ждут фронта ${s.waiting}</span></div>
          <dl class="sc-stats">
            <div><dt>Доступно, ваг.</dt><dd>${s.available}</dd></div>
            <div><dt>Резерв, ваг.</dt><dd>${s.reserved}</dd></div>
            <div><dt>Ждут приёма</dt><dd>${traffic.waiting} гр.</dd><small>${traffic.waitingWagons} ваг.</small></div>
            <div><dt>В пути</dt><dd>${traffic.enRoute} гр.</dd><small>${traffic.enRouteWagons} ваг.</small></div>
          </dl></a>`;
      })}
    </div>`;
}
