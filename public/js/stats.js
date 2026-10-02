// Статистика работы модели: решения, экономия, движение, бригады, ТО, участки.
import { useMemo, useState } from 'preact/hooks';
import { html, Icon, count, downloadCsv, time } from './lib.js';
import { Badge, Button, Kpi, PageHeader, Segmented, Empty } from './ui.js';
import { useNetworkTrains } from './network-data.js';
import { networkEvents, networkStats } from './network-sim.js';
import { DECISION } from './log.js';

const fmt = n => Math.round(n).toLocaleString('ru-RU');
const hm = min => `${Math.floor(min / 60)} ч ${String(Math.round(min % 60)).padStart(2, '0')} мин`;
const WINDOWS = [{ value: 360, label: '6 часов' }, { value: 720, label: '12 часов' }, { value: 1440, label: 'Сутки' }];
const KIND_ORDER = ['send', 'accept', 'crew', 'yield', 'hold', 'repair', 'resolved'];
const MEANING = {
  send: 'поезд выпущен на перегон, путь свободен', accept: 'поезд принят на станцию и поставлен на путь', crew: 'плановая смена бригады до выхода за предел работы',
  yield: 'неприоритетный поезд пропустил приоритетный', hold: 'поезд задержан: занят путь, ждёт подачу или встречный', repair: 'остановка из-за неисправности, вызваны осмотрщики',
  resolved: 'проблема устранена, поезд отправлен дальше',
};
const CATS = [{ id: 'passenger', label: 'Пассажирские' }, { id: 'container', label: 'Контейнерные' }, { id: 'freight', label: 'Грузовые' }];

function Bar({ value, max, tone = 'accent' }) {
  return html`<i class=${`cost-bar bar-${tone}`} style=${`width:${Math.max(2, max ? value / max * 100 : 0)}%`}></i>`;
}

function Histogram({ title, rows, unit = '', note }) {
  const max = Math.max(...rows.map(r => r.value), 1);
  return html`<div class="hist" role="group" aria-label=${title}><h3>${title}</h3>
    ${rows.map(r => html`<div class="hist-row" key=${r.label}><span>${r.label}</span><span class="hist-bar"><${Bar} value=${r.value} max=${max} tone=${r.tone} /></span><strong class="num">${fmt(r.value)}${unit}</strong></div>`)}
    ${note && html`<small class="muted">${note}</small>`}</div>`;
}

/** Решения по часам: накопленные столбцы «рабочие» и «проблемные». */
function HourChart({ buckets }) {
  const W = 720, H = 170, pad = 24, bw = (W - pad) / buckets.length;
  const max = Math.max(...buckets.map(b => b.work + b.problem), 1);
  return html`<svg class="hour-chart" viewBox=${`0 0 ${W} ${H + 22}`} role="img" aria-label="Число решений по часам: рабочие и связанные с задержками">
    ${[0, 0.5, 1].map(f => html`<g key=${f}><line x1=${pad} x2=${W} y1=${H - f * (H - 10)} y2=${H - f * (H - 10)} class="grid" /><text x="0" y=${H - f * (H - 10) + 4} class="axis">${fmt(max * f)}</text></g>`)}
    ${buckets.map((b, i) => {
      const hw = Math.max(2, bw - 3), x = pad + i * bw, hw1 = b.work / max * (H - 10), hp = b.problem / max * (H - 10);
      return html`<g key=${i}><title>${b.label}: ${b.work} рабочих, ${b.problem} с задержками</title>
        <rect x=${x} y=${H - hw1} width=${hw} height=${hw1} class="b-work" /><rect x=${x} y=${H - hw1 - hp} width=${hw} height=${hp} class="b-problem" />
        ${(buckets.length <= 12 || i % 3 === 0) && html`<text x=${x + hw / 2} y=${H + 15} class="axis" text-anchor="middle">${b.label}</text>`}</g>`;
    })}
  </svg>`;
}

export function StatsPage() {
  const [windowMin, setWindowMin] = useState(1440);
  const [sortKey, setSortKey] = useState('decisions');
  const { sim, trains, now, loading } = useNetworkTrains(10);
  const slot = Math.floor(now / 10000);
  const calc = useMemo(() => {
    if (!sim || sim.error) return null;
    const t0 = performance.now();
    const events = networkEvents(sim, now, windowMin);
    return { events, ms: Math.round(performance.now() - t0) };
  }, [sim, slot, windowMin]);
  const stats = useMemo(() => networkStats(trains), [trains]);

  const m = useMemo(() => {
    if (!calc) return null;
    const ev = calc.events;
    const byKind = Object.fromEntries(KIND_ORDER.map(k => [k, { n: 0, dwell: 0, dwellN: 0, savedMin: 0, savedW: 0 }]));
    const byRoute = new Map(), byCat = Object.fromEntries(CATS.map(c => [c.id, { decisions: 0, problems: 0, crew: 0, yield: 0, savedMin: 0, savedW: 0, dwell: 0, dwellN: 0 }]));
    const hours = Math.max(1, Math.round(windowMin / 60)), hourStart = now - windowMin * 60000;
    const buckets = Array.from({ length: hours }, (_, i) => ({ label: time(hourStart + i * 3600000).slice(0, 2) + ':00', work: 0, problem: 0 }));
    const hold = [], crewWorked = [];
    for (const e of ev) {
      const k = byKind[e.kind], r = byRoute.get(e.routeId) || { id: e.routeId, route: e.route, decisions: 0, problems: 0, crew: 0, savedMin: 0, savedW: 0, dwell: 0, dwellN: 0 };
      byRoute.set(e.routeId, r);
      k.n++; r.decisions++; byCat[e.category].decisions++;
      if (e.savedMin) { k.savedMin += e.savedMin; k.savedW += e.savedWeighted; r.savedMin += e.savedMin; r.savedW += e.savedWeighted; byCat[e.category].savedMin += e.savedMin; byCat[e.category].savedW += e.savedWeighted; }
      if (e.forced) { r.problems++; byCat[e.category].problems++; }
      if (e.kind === 'crew') { r.crew++; byCat[e.category].crew++; if (e.workedMin) crewWorked.push(e.workedMin); }
      if (e.kind === 'yield') byCat[e.category].yield++;
      if (e.kind === 'resolved') { k.dwell += e.dwell; k.dwellN++; r.dwell += e.dwell; r.dwellN++; byCat[e.category].dwell += e.dwell; byCat[e.category].dwellN++; hold.push(e.dwell); }
      const idx = Math.min(hours - 1, Math.max(0, Math.floor((e.at - hourStart) / 3600000)));
      buckets[idx][e.forced || e.kind === 'resolved' ? 'problem' : 'work']++;
    }
    const savedMin = ev.reduce((n, e) => n + (e.savedMin || 0), 0), savedW = ev.reduce((n, e) => n + (e.savedWeighted || 0), 0);
    const problems = ev.filter(e => e.forced).length, resolved = byKind.resolved.n;
    const live = new Map();
    for (const t of trains) {
      const r = live.get(t.routeId) || { n: 0, speed: 0, moving: 0, forced: 0, wagons: 0 };
      r.n++; r.wagons += t.wagons; if (t.stopped) { if (!t.planned) r.forced++; } else { r.speed += t.speedKmh; r.moving++; } live.set(t.routeId, r);
    }
    const routes = [...byRoute.values()].map(r => { const l = live.get(r.id) || { n: 0, speed: 0, moving: 0, forced: 0 }; return { ...r, trains: l.n, avgSpeed: l.moving ? Math.round(l.speed / l.moving) : 0, forced: l.forced, avgDwell: r.dwellN ? Math.round(r.dwell / r.dwellN) : 0 }; });
    return { byKind, byCat, buckets, routes, savedMin, savedW, problems, resolved, total: ev.length, hold, crewWorked, hours };
  }, [calc, trains, windowMin]);

  const fleet = useMemo(() => {
    const left = [['до 30 мин', 0, 30], ['30 мин – 1 ч', 30, 60], ['1–2 ч', 60, 120], ['2–4 ч', 120, 240], ['более 4 ч', 240, 1e9]]
      .map(([label, a, b]) => ({ label, value: trains.filter(t => t.crew.leftMin >= a && t.crew.leftMin < b).length, tone: a < 60 ? 'danger' : 'accent' }));
    const to = [['до 8 ч', 0, 8], ['8–24 ч', 8, 24], ['1–2 суток', 24, 48], ['более 2 суток', 48, 1e9]]
      .map(([label, a, b]) => ({ label, value: trains.filter(t => t.loco.toInH >= a && t.loco.toInH < b).length, tone: a < 8 ? 'danger' : 'accent' }));
    const speed = [['0 (стоят)', 0, 1], ['1–40', 1, 41], ['41–60', 41, 61], ['61–80', 61, 81], ['более 80', 81, 1e9]].map(([label, a, b]) => ({ label, value: trains.filter(t => t.speedKmh >= a && t.speedKmh < b).length }));
    const diesel = trains.filter(t => t.loco.type === 'тепловоз');
    const avg = (arr, f) => (arr.length ? Math.round(arr.reduce((n, t) => n + f(t), 0) / arr.length) : 0);
    return { left, to, speed, lowFuel: diesel.filter(t => t.loco.resource.pct < 25).length, condition: avg(trains, t => t.loco.conditionPct), netT: trains.reduce((n, t) => n + t.consist.netT, 0), grossT: trains.reduce((n, t) => n + t.consist.grossT, 0),
      avgLoad: avg(trains.filter(t => t.category === 'passenger'), t => t.consist.loadPct), crewSoon: trains.filter(t => t.crew.leftMin < 45).length, toSoon: trains.filter(t => t.loco.toInH < 8).length };
  }, [trains]);

  const routes = useMemo(() => (m ? [...m.routes].sort((a, b) => (sortKey === 'route' ? a.route.localeCompare(b.route, 'ru') : b[sortKey] - a[sortKey])) : []), [m, sortKey]);
  const exportCsv = () => downloadCsv('model-statistics.csv', [['Участок', 'Поездов сейчас', 'Ср. скорость, км/ч', 'Стоят вынужденно', 'Решений', 'Задержек и неисправностей', 'Смен бригад', 'Сэкономлено, мин', 'Сэкономлено, взвеш. мин', 'Ср. простой, мин'],
    ...routes.map(r => [r.route, r.trains, r.avgSpeed, r.forced, r.decisions, r.problems, r.crew, r.savedMin, r.savedW, r.avgDwell])]);
  const avgHold = m?.hold.length ? m.hold.reduce((a, b) => a + b, 0) / m.hold.length : 0;
  const maxK = m ? Math.max(...KIND_ORDER.map(k => m.byKind[k].n), 1) : 1;

  return html`<${PageHeader} title="Статистика работы модели" subtitle="Сколько решений принято, что и где сэкономлено, как идёт движение, бригады, ТО и участки. Обновляется в реальном времени"
      actions=${html`<${Button} icon="download" onClick=${exportCsv}>CSV по участкам</${Button}>`} />
    <div class="filter-row"><${Segmented} label="Период статистики" value=${windowMin} onChange=${setWindowMin} options=${WINDOWS} />
      <span class="muted">Расчёт за период занял ${calc?.ms ?? '…'} мс · ${fmt(trains.length)} поездов на линии · обновление каждые 10 секунд</span></div>
    ${loading || !m ? html`<p class="muted pad">Расчёт статистики…</p>` : html`
    <section class="kpis" aria-label="Решения модели за период">
      <${Kpi} label="Решений за период" icon="list-checks" value=${fmt(m.total)} note=${`≈ ${fmt(m.total / m.hours)} в час`} />
      <${Kpi} label="Сэкономлено поездам" icon="timer-reset" tone="accent" value=${fmt(m.savedMin)} unit=" мин" note=${`взвешенная экономия ${fmt(m.savedW)}`} />
      <${Kpi} label="Проблем решено" icon="badge-check" value=${`${m.problems ? Math.min(100, Math.round(m.resolved / m.problems * 100)) : 100}%`} note=${`${fmt(m.resolved)} решено из ${fmt(m.problems)} задержек и неисправностей`} />
      <${Kpi} label="Средний простой" icon="hourglass" value=${Math.round(avgHold)} unit=" мин" note=${m.hold.length ? `самый долгий ${Math.max(...m.hold)} мин` : 'простоев нет'} />
      <${Kpi} label="Смен бригад" icon="user-round" value=${fmt(m.byKind.crew.n)} note=${m.crewWorked.length ? `в среднем после ${hm(m.crewWorked.reduce((a, b) => a + b, 0) / m.crewWorked.length)} работы` : 'нет'} />
      <${Kpi} label="Пропущено приоритетных" icon="shuffle" value=${fmt(m.byKind.yield.n)} note=${`экономия ${fmt(m.byKind.yield.savedMin)} мин приоритетным`} />
    </section>
    <section class="panel"><div class="panel-head"><div><h2>Решения по часам</h2><small>Серый столбец — рабочие решения (отправка, приём, смена бригады). Красный — решения при задержках и неисправностях.</small></div>
      <div class="legend"><span><i class="sw sw-work"></i>Рабочие</span><span><i class="sw sw-problem"></i>С задержками</span></div></div>
      <${HourChart} buckets=${m.buckets} /></section>
    <section class="panel"><div class="panel-head"><div><h2>Решения по типам</h2><small>Что именно решила модель и сколько это сэкономило.</small></div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Решение</th><th scope="col" class="num">Количество</th><th scope="col">Доля</th><th scope="col">Что это</th><th scope="col" class="num">Сэкономлено, мин</th><th scope="col" class="num">Взвешенно</th><th scope="col" class="num">Ср. простой</th></tr></thead>
        <tbody>${KIND_ORDER.map(k => { const r = m.byKind[k]; return html`<tr key=${k}>
          <td><${Badge} tone=${DECISION[k].tone} icon=${DECISION[k].icon}>${DECISION[k].label}</${Badge}></td><td class="num"><strong>${fmt(r.n)}</strong></td>
          <td style="width:140px"><${Bar} value=${r.n} max=${maxK} tone=${['hold', 'repair'].includes(k) ? 'danger' : 'accent'} /> <small>${m.total ? Math.round(r.n / m.total * 100) : 0}%</small></td>
          <td class="muted">${MEANING[k]}</td><td class="num">${r.savedMin ? fmt(r.savedMin) : '—'}</td><td class="num">${r.savedW ? fmt(r.savedW) : '—'}</td><td class="num">${r.dwellN ? `${Math.round(r.dwell / r.dwellN)} мин` : '—'}</td></tr>`; })}</tbody></table></div></section>
    <section class="panel"><div class="panel-head"><div><h2>По типам поездов</h2></div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Тип</th><th scope="col" class="num">Сейчас на линии</th><th scope="col" class="num">Решений</th><th scope="col" class="num">С задержками</th><th scope="col" class="num">Пропустили приоритетных</th><th scope="col" class="num">Смен бригад</th><th scope="col" class="num">Ср. простой</th><th scope="col" class="num">Сэкономлено, мин</th></tr></thead>
        <tbody>${CATS.map(c => { const r = m.byCat[c.id]; return html`<tr key=${c.id}><th scope="row">${c.label}</th><td class="num">${fmt(stats[c.id])}</td><td class="num">${fmt(r.decisions)}</td><td class="num">${fmt(r.problems)}</td><td class="num">${fmt(r.yield)}</td><td class="num">${fmt(r.crew)}</td><td class="num">${r.dwellN ? `${Math.round(r.dwell / r.dwellN)} мин` : '—'}</td><td class="num">${r.savedMin ? fmt(r.savedMin) : '—'}</td></tr>`; })}</tbody></table></div></section>
    <section class="panel"><div class="panel-head"><div><h2>По участкам</h2><small>Движение сейчас и работа модели за период.</small></div>
      <label class="filter-select"><span class="sr-only">Сортировка участков</span><select value=${sortKey} onChange=${e => setSortKey(e.target.value)} aria-label="Сортировка участков">
        <option value="decisions">По числу решений</option><option value="savedMin">По экономии</option><option value="problems">По задержкам</option><option value="trains">По числу поездов</option><option value="forced">По вынужденным стоянкам</option><option value="route">По названию</option></select></label></div>
      <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Участок</th><th scope="col" class="num">Поездов</th><th scope="col" class="num">Ср. скорость</th><th scope="col" class="num">Стоят вынужд.</th><th scope="col" class="num">Решений</th><th scope="col" class="num">Задержек</th><th scope="col" class="num">Смен бригад</th><th scope="col" class="num">Ср. простой</th><th scope="col" class="num">Сэкономлено, мин</th></tr></thead>
        <tbody>${routes.map(r => html`<tr key=${r.id}><th scope="row">${r.route}</th><td class="num">${r.trains}</td><td class="num">${r.avgSpeed} км/ч</td><td class=${`num ${r.forced ? 'bad' : ''}`}>${r.forced}</td><td class="num">${fmt(r.decisions)}</td><td class="num">${r.problems}</td><td class="num">${r.crew}</td><td class="num">${r.avgDwell ? `${r.avgDwell} мин` : '—'}</td><td class="num">${r.savedMin ? fmt(r.savedMin) : '—'}</td></tr>`)}</tbody></table></div></section>
    <section class="panel"><div class="panel-head"><div><h2>Состояние сети сейчас</h2><small>Срез по ${fmt(trains.length)} поездам на линии.</small></div></div>
      <div class="kpis kpis-tight"><${Kpi} label="Средняя скорость" icon="gauge" value=${stats.avgSpeed} unit=" км/ч" note=${`${fmt(stats.moving)} в пути, ${fmt(stats.stopped)} стоят`} />
        <${Kpi} label="Вагонов в пути" icon="package" value=${fmt(stats.wagons)} note=${`груза нетто ≈ ${fmt(fleet.netT / 1000)} тыс. т`} />
        <${Kpi} label="Пассажиров в пути" icon="users" value=${fmt(stats.passengers)} note=${`заполнение составов ${fleet.avgLoad}%`} />
        <${Kpi} label="Тех. состояние локомотивов" icon="heart-pulse" value=${`${fleet.condition}%`} note=${`${fleet.toSoon} до ТО менее 8 ч`} />
        <${Kpi} label="Бригады на пределе" icon="user-round" tone=${fleet.crewSoon ? 'danger' : 'neutral'} value=${fleet.crewSoon} note="до смены менее 45 мин" />
        <${Kpi} label="Мало топлива" icon="fuel" value=${fleet.lowFuel} note="тепловозы с запасом менее 25%" /></div>
      <div class="hist-grid"><${Histogram} title="Скорость, км/ч" rows=${fleet.speed} note="число поездов" />
        <${Histogram} title="Время до смены бригады" rows=${fleet.left} note="красным — смена в ближайший час" />
        <${Histogram} title="Время до ТО локомотива" rows=${fleet.to} note="красным — ТО менее чем через 8 часов" />
        <${Histogram} title="Длительность простоев (решённые)" rows=${[['до 15 мин', 0, 15], ['15–30', 15, 30], ['30–60', 30, 60], ['более часа', 60, 1e9]].map(([label, a, b]) => ({ label, value: m.hold.filter(x => x >= a && x < b).length }))} note="за выбранный период" /></div></section>
    <section class="panel"><div class="panel-head"><div><h2>Как работала модель</h2></div></div>
      <ul class="plain-list">
        <li>Модель обработала <strong>${fmt(trains.length)}</strong> поездов сети и сформировала <strong>${fmt(m.total)}</strong> записей за ${windowMin / 60} ч; расчёт ленты занял ${calc.ms} мс.</li>
        <li>Расписание строится по <strong>${fmt(sim.services.length)}</strong> регулярным службам на <strong>${sim.routes.length}</strong> маршрутах; положение каждого поезда определяется только временем, поэтому сеть не сбрасывается и продолжает работу после перезапуска.</li>
        <li>Решение о смене бригады принимается заранее: если бригада не успеет дойти до следующей станции в пределах 5,5–7 ч работы, смена назначается на текущей.</li>
        <li><strong>Как считается экономия.</strong> Пропуск приоритетного: избежанная задержка приоритетного поезда (12–25 мин) × вес его типа минус собственный простой × вес своего типа. Плановая смена бригады: 31 мин против вынужденной замены (в среднем 45 мин ожидания вместо 14 мин планово) × вес типа. Вес: пассажирский 10, контейнерный 2, грузовой 1. Это оценка модели, а не измерение на реальной сети.</li>
      </ul></section>`}`;
}
