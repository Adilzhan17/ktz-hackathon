import { useMemo, useState } from 'preact/hooks';
import { html, Icon, count, delayText, clockAt, duration, PRIORITY, DIRECTION, downloadCsv, time, dateLong } from './lib.js';
import { app, go, href, updateUi } from './store.js';
import { Button, Badge, Kpi, PageHeader, Segmented, Empty } from './ui.js';
import { Gantt } from './gantt.js';
import { DecisionPanel, PassengerNotices } from './decisions.js';

const stationName = (data, i) => data.stations[i].name;

export function Overview({ data }) {
  const late = data.trains.filter(t => t.delay > 0);
  const passengerLate = data.trains.filter(t => t.priority === 1 && t.delay > 0);
  const worst = passengerLate.reduce((m, t) => Math.max(m, t.delay), 0);
  const totalDelay = late.reduce((n, t) => n + t.delay, 0);
  const incident = data.blocked;
  return html`<${PageHeader} title="Оперативная обстановка"
      subtitle=${`${stationName(data, 0)} ↔ ${stationName(data, data.stations.length - 1)} · ${data.stations.length} станций · двухпутный участок с автоблокировкой`} />
    <section class="kpis" aria-label="Показатели участка">
      <${Kpi} label="Состояние участка" icon="activity" tone=${incident ? 'danger' : 'neutral'}
        value=${incident ? 'Инцидент' : data.restrictions.length ? 'Ограничения' : 'Норма'}
        note=${incident ? 'Закрыт нечётный путь D–E' : data.restrictions.length ? count(data.restrictions.length, ['ограничение скорости', 'ограничения скорости', 'ограничений скорости']) : 'Движение по графику'} />
      <${Kpi} label="Конфликты" icon="triangle-alert" tone=${data.dispatch.conflicts.length ? 'danger' : 'neutral'}
        value=${data.dispatch.conflicts.length} note=${data.dispatch.conflicts.length ? 'встречных поездов на одном пути' : 'встречных поездов нет'} />
      <${Kpi} label="Опоздание пассажирских" icon="train-front" tone=${worst ? 'danger' : 'neutral'}
        value=${worst ? `+${worst}` : '0'} unit="мин"
        note=${passengerLate.length ? `${count(passengerLate.length, ['поезд задерживается', 'поезда задерживаются', 'поездов задерживается'])} из ${data.trains.filter(t => t.priority === 1).length}` : 'все пассажирские по графику'} />
      <${Kpi} label="Задержано поездов" icon="hourglass" value=${late.length} unit=${`из ${data.trains.length}`}
        note=${late.length ? `суммарно ${duration(totalDelay)}` : 'задержек нет'} />
    </section>
    <div class="grid-main">
      <section class="panel" aria-labelledby="gid-title">
        <div class="panel-head"><div><h2 id="gid-title">График исполненного движения (ГИД)</h2>
          <small>Сплошная линия — прогноз, пунктир — нитка по графику. Нажмите на линию, чтобы выделить поезд.</small></div></div>
        <${Gantt} data=${data} />
      </section>
      <aside class="aside" aria-label="Решения и уведомления">
        <${DecisionPanel} data=${data} />
        <${PassengerNotices} data=${data} />
      </aside>
    </div>
    <section class="panel" aria-labelledby="st-title">
      <div class="panel-head"><h2 id="st-title">Станции</h2><a href=${href('/stations')}>Все станции</a></div>
      <div class="station-strip">
        ${data.stations.map(s => {
          const load = Math.round(s.occupied / s.capacity * 100);
          return html`<a key=${s.id} class="station-chip" href=${href(`/station/${s.id}`)}>
            <span class="code">${s.id}</span><strong>${s.name}</strong>
            <span class="meter" role="img" aria-label=${`Занятость ${load}%`}><i style=${`width:${load}%`}></i></span>
            <small>${load}% · ${s.available} мест</small></a>`;
        })}
      </div>
    </section>`;
}

const SORTS = {
  number: t => Number(t.number), priority: t => t.priority, dir: t => t.direction,
  wagons: t => t.wagons, plan: t => t.route.at(-1)[0], forecast: t => t.forecast.at(-1)[0], delay: t => t.delay,
};

export function Trains({ data }) {
  const [sort, setSort] = useState({ key: 'delay', dir: -1 });
  const [query, setQuery] = useState('');
  const { ui } = app;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.trains
      .filter(t => (ui.category === 'all' || t.category === ui.category)
        && (!q || `${t.number} ${t.label} ${stationName(data, t.route[0][1])} ${stationName(data, t.route.at(-1)[1])}`.toLowerCase().includes(q)))
      .sort((a, b) => (SORTS[sort.key](a) > SORTS[sort.key](b) ? 1 : SORTS[sort.key](a) < SORTS[sort.key](b) ? -1 : 0) * sort.dir || Number(a.number) - Number(b.number));
  }, [data, ui.category, query, sort]);
  const th = (key, label) => html`<th scope="col" aria-sort=${sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
    <button type="button" class="th-btn" onClick=${() => setSort(s => ({ key, dir: s.key === key ? -s.dir : (key === 'delay' ? -1 : 1) }))}>${label}
      <${Icon} name=${sort.key === key ? (sort.dir > 0 ? 'chevron-up' : 'chevron-down') : 'arrow-up-down'} size=${13} /></button></th>`;
  const show = t => { updateUi({ selectedTrain: t.number }); go('/'); };
  const exportCsv = () => downloadCsv('trains.csv', [
    ['Номер', 'Тип', 'Приоритет', 'Направление', 'Откуда', 'Куда', 'Вагонов', 'Прибытие по графику', 'Прогноз прибытия', 'Опоздание, мин'],
    ...rows.map(t => [t.number, t.label, t.priority, DIRECTION[t.direction], stationName(data, t.route[0][1]), stationName(data, t.route.at(-1)[1]), t.wagons, clockAt(data, t.route.at(-1)[0]), clockAt(data, t.forecast.at(-1)[0]), t.delay])]);
  return html`<${PageHeader} title="Поезда участка" subtitle=${`${data.trains.length} поездов в сценарии · приоритет определяет очерёдность при конфликтах`}
      actions=${html`<${Button} icon="download" onClick=${exportCsv}>Выгрузить CSV</${Button}>`} />
    <section class="panel">
      <div class="toolbar">
        <label class="search"><${Icon} name="search" size=${16} /><span class="sr-only">Поиск поезда</span>
          <input type="search" placeholder="Номер, тип или станция" value=${query} onInput=${e => setQuery(e.target.value)} /></label>
        <${Segmented} label="Категория" value=${ui.category} onChange=${v => updateUi({ category: v })}
          options=${[{ value: 'all', label: 'Все' }, { value: 'passenger', label: 'Пассажирские' }, { value: 'freight', label: 'Грузовые' }, { value: 'container', label: 'Контейнерные' }]} />
      </div>
      <p class="note"><${Icon} name="info" size=${15} /> Приоритет: ${Object.entries(data.priorityNames).map(([k, v]) => `${k} — ${v.toLowerCase()}`).join('; ')}.</p>
      <div class="table-wrap">
        <table class="table responsive">
          <thead><tr>${th('number', '№')}${th('priority', 'Тип')}${th('dir', 'Направление')}<th scope="col">Маршрут</th>${th('wagons', 'Вагонов')}${th('plan', 'По графику')}${th('forecast', 'Прогноз')}${th('delay', 'Опоздание')}<th scope="col"><span class="sr-only">Действия</span></th></tr></thead>
          <tbody>
            ${rows.map(t => html`<tr key=${t.number} class=${app.ui.selectedTrain === t.number ? 'sel' : ''}>
              <td data-label="№"><strong>${t.number}</strong></td>
              <td data-label="Тип"><${Badge} tone=${PRIORITY[t.priority].tone}>${t.label}</${Badge}></td>
              <td data-label="Направление">${DIRECTION[t.direction]}</td>
              <td data-label="Маршрут">${stationName(data, t.route[0][1])} <${Icon} name="arrow-right" size=${13} class="inline" /> ${stationName(data, t.route.at(-1)[1])}</td>
              <td data-label="Вагонов" class="num">${t.wagons}</td>
              <td data-label="По графику" class="num">${clockAt(data, t.route.at(-1)[0])}</td>
              <td data-label="Прогноз" class="num">${clockAt(data, t.forecast.at(-1)[0])}</td>
              <td data-label="Опоздание" class=${`num ${t.delay > 0 ? 'bad' : ''}`}>${delayText(t.delay)}</td>
              <td class="actions-cell"><${Button} size="sm" variant="ghost" icon="chart-gantt" onClick=${() => show(t)}>На ГИД</${Button}></td>
            </tr>`)}
            ${!rows.length && html`<tr><td colspan="9"><${Empty} icon="search" title="Ничего не найдено">Измените поиск или категорию.</${Empty}></td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="table-foot"><span>Показано ${rows.length} из ${data.trains.length}</span></div>
    </section>`;
}

export function Stations({ data }) {
  return html`<${PageHeader} title="Станции" subtitle="Грузовая работа, подъездные пути и подход вагонов по каждой станции" />
    <div class="station-grid">
      ${data.stations.map(s => {
        const load = Math.round(s.occupied / s.capacity * 100);
        const arrivals = data.groups.filter(g => g.stationId === s.id && g.status !== 'arrived').length;
        return html`<a key=${s.id} class="panel station-card" href=${href(`/station/${s.id}`)}>
          <div class="sc-head"><span class="code lg">${s.id}</span><div><h2>${s.name}</h2><small>${s.type} · ${s.km} км</small></div></div>
          <div class="meter lg" role="img" aria-label=${`Занятость ${load}%`}><i style=${`width:${load}%`}></i></div>
          <dl class="sc-stats">
            <div><dt>Занятость</dt><dd>${load}%</dd></div>
            <div><dt>Свободно</dt><dd>${s.available}</dd></div>
            <div><dt>Подходит</dt><dd>${arrivals}</dd></div>
          </dl></a>`;
      })}
    </div>`;
}
