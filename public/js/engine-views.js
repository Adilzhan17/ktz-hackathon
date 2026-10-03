// Визуализации страницы «Модель»: нейросетевой граф, ленты потока, спарклайны, тепловая карта, характеристики.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, time } from './lib.js';
import { Badge } from './ui.js';
import { LAYERS, NODES, EDGES, layout } from './engine-graph.js';
import { scheduledTrips, MODEL_PARAMS } from './network-sim.js';
import { DECISION } from './log.js';

export const fmt = n => (typeof n === 'number' ? Math.round(n).toLocaleString('ru-RU') : n);

export function Sparkline({ values, width = 160, height = 38, label, color = 'var(--accent)', fill = true }) {
  if (!values.length) return html`<svg width=${width} height=${height} aria-hidden="true"></svg>`;
  const max = Math.max(...values, 1e-9), min = Math.min(...values, 0), span = max - min || 1;
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * width, height - 3 - ((v - min) / span) * (height - 8)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return html`<svg class="spark" width=${width} height=${height} viewBox=${`0 0 ${width} ${height}`} role="img" aria-label=${label || 'график'}>
    ${fill && html`<path d=${`${d} L${width} ${height} L0 ${height} Z`} fill=${color} opacity=".12"/>`}
    <path d=${d} fill="none" stroke=${color} stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx=${pts.at(-1)[0]} cy=${pts.at(-1)[1]} r="3" fill=${color}/></svg>`;
}

/** Нейросетевой граф: слои данных → расчёт → оценка → результат, частицы бегут по связям. */
export function NeuralView({ samples, ctx, selected, onSelect, tick }) {
  const box = useRef(null);
  const [W, setW] = useState(1000);
  useEffect(() => {
    const el = box.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(Math.max(980, el.clientWidth)));
    ro.observe(el); setW(Math.max(980, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  const H = 520;
  const pos = useMemo(() => layout(W, H), [W]);
  const last = samples.at(-1);
  const values = useMemo(() => new Map(NODES.map(n => {
    const series = samples.map(s => n.value(s, ctx)).filter(v => typeof v === 'number');
    const v = last ? n.value(last, ctx) : 0;
    const max = Math.max(1, ...series);
    return [n.id, { v, act: typeof v === 'number' ? Math.min(1, v / max) * 0.85 + 0.15 : 0.7 }];
  })), [samples, ctx]);
  const related = useMemo(() => {
    if (!selected) return null;
    const set = new Set([selected]);
    for (const [a, b] of EDGES) { if (a === selected) set.add(b); if (b === selected) set.add(a); }
    return set;
  }, [selected]);
  const curve = (a, b) => { const mx = (a.x + b.x) / 2; return `M${a.x} ${a.y} C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`; };
  return html`<div class="neural" ref=${box}>
    <svg width=${W} height=${H} viewBox=${`0 0 ${W} ${H}`} role="group" aria-label="Схема работы модели: данные на входе, расчёт, оценка и результат">
      ${LAYERS.map((l, i) => { const x = pos.get(NODES.find(n => n.layer === l.id).id).x; return html`<text key=${l.id} x=${x} y="22" text-anchor="middle" class="nn-layer">${l.title}</text>`; })}
      ${EDGES.map(([a, b, w], i) => {
        const pa = pos.get(a), pb = pos.get(b), d = curve(pa, pb), act = (values.get(a).act + values.get(b).act) / 2;
        const on = !related || (related.has(a) && related.has(b));
        return html`<g key=${`${a}-${b}`} class=${`nn-edge ${on ? '' : 'dim'}`}>
          <path d=${d} fill="none" stroke="var(--accent)" stroke-width=${0.6 + w * act * 2.2} opacity=${on ? 0.12 + act * 0.4 : 0.05}/>
          ${[0, 1].map(k => html`<circle key=${k} r=${1.6 + w * 1.4} class="nn-particle"><animateMotion dur=${`${2.6 + (i % 5) * 0.45}s`} begin=${`${-((i * 0.37 + k * 1.3) % 3)}s`} repeatCount="indefinite" path=${d}/></circle>`)}</g>`;
      })}
      ${NODES.map(n => {
        const p = pos.get(n.id), val = values.get(n.id), r = 10 + val.act * 9, sel = selected === n.id, dim = related && !related.has(n.id);
        const text = n.id === 'clock' ? ctx.clock : `${fmt(val.v)}${n.unit ? ` ${n.unit}` : ''}`;
        const left = n.layer === 'in';
        return html`<g key=${n.id} class=${`nn-node ${sel ? 'sel' : ''} ${dim ? 'dim' : ''}`} transform=${`translate(${p.x} ${p.y})`} tabindex="0" role="button" aria-pressed=${sel}
          aria-label=${`${n.label}: ${text}`} onClick=${() => onSelect(sel ? null : n.id)} onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(sel ? null : n.id); } }}>
          <circle key=${tick} r=${r} class="nn-ring"/>
          <circle r=${r} class=${`nn-core ${n.layer}`} opacity=${0.35 + val.act * 0.65}/>
          <text y=${left ? 4 : 4} text-anchor="middle" class="nn-val">${n.id === 'clock' ? '⏱' : ''}</text>
          <text x=${left ? -r - 8 : r + 8} y="-2" text-anchor=${left ? 'end' : 'start'} class="nn-label">${n.label}</text>
          <text x=${left ? -r - 8 : r + 8} y="12" text-anchor=${left ? 'end' : 'start'} class="nn-num">${text}</text></g>`;
      })}
    </svg></div>`;
}

const TAG_TONE = { вход: 'neutral', расчёт: 'accent', выход: 'ink', решение: 'muted' };
/** Лента потока данных: что пришло, что посчитано, что получилось. */
export function StreamFeed({ lines }) {
  return html`<ol class="stream" aria-live="off">${[...lines].reverse().slice(0, 18).map(l => html`<li key=${l.id} class=${`stream-line ${l.tag}`}>
    <time>${new Date(l.at).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Almaty', hour12: false })}</time>
    ${l.kind ? html`<${Badge} tone=${DECISION[l.kind].tone} icon=${DECISION[l.kind].icon}>${DECISION[l.kind].label}</${Badge}>` : html`<${Badge} tone=${TAG_TONE[l.tag]}>${l.tag}</${Badge}>`}
    <span>${l.text}</span></li>`)}</ol>`;
}

/** Тепловая карта: отправления по маршрутам на ближайшие 24 часа (из расписания модели). */
export function Heatmap({ sim, now }) {
  const hour = Math.floor(now / 3600000);
  const grid = useMemo(() => {
    const from = hour * 3600000, trips = scheduledTrips(sim, from, from + 24 * 3600000);
    const byRoute = new Map(sim.routes.map(r => [r.id, { route: r, cells: new Array(24).fill(0), total: 0 }]));
    for (const t of trips) { const e = byRoute.get(t.routeId); if (!e) continue; const h = Math.min(23, Math.floor((t.departedMs - from) / 3600000)); e.cells[h]++; e.total++; }
    return [...byRoute.values()].sort((a, b) => b.total - a.total).slice(0, 20);
  }, [sim, hour]);
  const max = Math.max(1, ...grid.flatMap(g => g.cells));
  return html`<div class="heat" role="table" aria-label="Отправления по маршрутам на 24 часа">
    <div class="heat-row head" role="row"><span></span>${Array.from({ length: 24 }, (_, h) => html`<span key=${h} class="heat-h">${h % 3 === 0 ? `${String((hour + h + 5) % 24).padStart(2, '0')}` : ''}</span>`)}<span class="heat-t">всего</span></div>
    ${grid.map(g => html`<div class="heat-row" role="row" key=${g.route.id}><span class="heat-name">${g.route.name}</span>
      ${g.cells.map((c, h) => html`<i key=${h} class="heat-c" style=${`opacity:${c ? 0.18 + (c / max) * 0.82 : 0.05}`} title=${`${g.route.name}, +${h} ч: ${c} отправлений`}></i>`)}
      <span class="heat-t num">${g.total}</span></div>`)}</div>`;
}

const row = (k, v) => html`<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`;
/** Характеристики модели: параметры, масштаб, допущения. */
export function Characteristics({ sim, stations, counters, startedAt }) {
  const P = MODEL_PARAMS, cats = Object.entries(P.categories);
  const daily = sim.services.reduce((n, s) => n + s.n, 0);
  const uptime = Math.round((Date.now() - startedAt) / 1000);
  return html`<div class="spec">
    <section><h3>Тип модели</h3><dl>${row('Принцип', 'детерминированная функция времени: положение любого поезда вычисляется, а не хранится')}${row('Состояние', 'нет: после перезапуска сеть продолжает работу с того же места')}
      ${row('Обновление', 'раз в секунду на клиенте, архив событий — на сервере')}${row('Расписание', 'синтетическое, настроено под ≈ 700 поездов одновременно')}</dl></section>
    <section><h3>Масштаб</h3><dl>${row('Маршрутов', sim.routes.length)}${row('Регулярных служб', sim.services.length)}${row('Рейсов в сутки', fmt(daily))}${row('Станций и пунктов (OSM)', stations ? fmt(stations) : '…')}
      ${row('Циклов расчёта за сеанс', fmt(counters.cycles))}${row('Поездов обработано', fmt(counters.trains))}${row('Среднее время цикла', `${counters.cycles ? (counters.ms / counters.cycles).toFixed(1) : '—'} мс`)}${row('Сеанс', `${Math.floor(uptime / 60)} мин ${uptime % 60} с`)}</dl></section>
    <section><h3>Правила оценки</h3><dl>${row('Вес задержки', `пассажирский ×${P.weights.passenger}, контейнерный ×${P.weights.container}, грузовой ×${P.weights.freight}`)}
      ${row('Интервал между поездами', `в одном направлении ${P.headwayMin.same} мин, при смене направления ${P.headwayMin.opposite} мин`)}${row('По неправильному пути', `${P.wrongTrackKmh} км/ч, по одному поезду`)}
      ${row('Предел работы бригады', `${P.crewLimitMin} мин до плановой смены`)}${row('Неисправностей в сутки', `не более ${P.repairsPerDay} на сеть`)}${row('Варианты пропуска', P.variants.map(v => v.name).join('; '))}</dl></section>
    <section class="wide"><h3>Скорости и стоянки по категориям</h3><div class="table-wrap"><table class="table"><thead><tr><th scope="col">Категория</th><th scope="col" class="num">Ср. скорость</th><th scope="col" class="num">Вынужд. задержка</th><th scope="col" class="num">Диапазон, мин</th><th scope="col" class="num">Стоянка, мин</th><th scope="col" class="num">Стоянка раз в, км</th></tr></thead>
      <tbody>${cats.map(([id, c]) => html`<tr key=${id}><th scope="row">${c.label}</th><td class="num">${id === 'passenger' ? `${P.averageKmh.passengerElectric} / ${P.averageKmh.passengerDiesel}` : P.averageKmh[id]} км/ч</td><td class="num">${c.holdPct}%</td><td class="num">${c.hold[0]}–${c.hold[1]}</td><td class="num">${c.dwell[0]}–${c.dwell[1]}</td><td class="num">${c.stopEvery}</td></tr>`)}</tbody></table></div>
      <p class="muted">Пассажирские: электротяга / тепловозная. Задержки и параметры бригад и ТО — параметры модели, а не данные КТЖ.</p></section>
    <section><h3>Допущения и границы</h3><ul class="plain-list">
      <li>Маршруты — реальные пути OpenStreetMap, расписание и составы синтетические.</li><li>Электрификация отрезков и число станционных путей — оценка.</li>
      <li>Светофоры считаются по занятости модельных блок-участков, а не по данным СЦБ.</li><li>Экономия — оценка по весовой формуле, не измерение на реальной сети.</li></ul></section>
  </div>`;
}
