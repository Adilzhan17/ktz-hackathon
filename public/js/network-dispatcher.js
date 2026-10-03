import { useMemo, useState } from 'preact/hooks';
import { html, time } from './lib.js';
import { Button, Badge, Dialog, Kpi, Segmented } from './ui.js';
import { useNetworkTrains } from './network-data.js';
import { useLiveSchedule } from './schedule-live.js';
import { useNetworkArchive } from './network-archive.js';
import { networkItinerary } from './network-sim.js';
import { TrainDetails } from './network-details.js';
import { ScheduleExplanation } from './schedule-explanation.js';
import { go, updateUi } from './store.js';

function RouteDiagram({ route, trains, selected, station, onTrain, onStation }) {
  const W = 1440, x = km => 100 + km / route.km * 1240;
  const stations = route.stops.filter((s, i) => i === 0 || i === route.stops.length - 1 || i % Math.max(1, Math.ceil(route.stops.length / 12)) === 0 || s[0] === station);
  const placed = { fwd: [], rev: [] };
  const marks = [...trains].sort((a, b) => a.km - b.km).map(t => {
    const xx = x(t.dir === 'fwd' ? t.km : route.km - t.km), slots = placed[t.dir];
    let lane = 0;
    while (slots.some(p => p.lane === lane && Math.abs(p.x - xx) < 76)) lane++;
    slots.push({ lane, x: xx });
    return { t, xx, lane };
  });
  const depth = Math.max(2, ...marks.map(m => m.lane + 1)), top = 105 + depth * 27, bottom = top + 110, H = bottom + depth * 27 + 80;
  return html`<div class="dispatch-diagram-scroll" tabindex="0" aria-label="Прокручиваемая схема направлений">
    <svg class="dispatch-diagram" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${`Схема маршрута ${route.name}: ${trains.length} поездов`}>
      <defs><marker id="dispatch-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" /></marker></defs>
      <rect x="0" y="0" width=${W} height=${H} rx="18" fill="var(--surface)" />
      <text x="24" y="30" class="dispatch-label">${route.from} ↔ ${route.to} · ${Math.round(route.km)} км</text>
      <text x="24" y=${top - 12} class="dispatch-axis">← Обратное направление</text><text x="24" y=${bottom + 24} class="dispatch-axis">Прямое направление →</text>
      <line x1="1340" x2="100" y1=${top} y2=${top} stroke="var(--accent)" stroke-width="5" marker-end="url(#dispatch-arrow)" />
      <line x1="100" x2="1340" y1=${bottom} y2=${bottom} stroke="var(--accent)" stroke-width="5" marker-end="url(#dispatch-arrow)" />
      ${stations.map(([name, km], i) => html`<g key=${name} role="button" tabindex="0" aria-label=${`Операции станции ${name}`} onClick=${() => onStation(name)} onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStation(name); } }}>
        <title>${name} · ${km} км</title><line x1=${x(km)} x2=${x(km)} y1=${top - 8} y2=${bottom + 8} stroke=${station === name ? 'var(--accent)' : 'var(--line-strong)'} stroke-dasharray="4 4" />
        <rect x=${x(km) - 10} y=${top + 38} width="20" height="34" rx="5" fill=${station === name ? 'var(--accent)' : 'var(--surface-2)'} stroke="var(--accent)" />
        <text x=${x(km)} y=${top + 25 + (i % 2) * 63} text-anchor="middle" class="dispatch-axis">${name.length > 15 ? name.slice(0, 13) + '…' : name}</text>
      </g>`)}
      ${marks.map(({ t, xx, lane }) => {
        const y0 = t.dir === 'rev' ? top : bottom, yy = t.dir === 'rev' ? top - 40 - lane * 27 : bottom + 42 + lane * 27;
        return html`<g key=${t.uid} role="button" tabindex="0" aria-label=${`Открыть поезд ${t.number}`} class="dispatch-train" onClick=${() => onTrain(t.uid)} onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTrain(t.uid); } }}>
          <title>№${t.number} · ${t.stopped ? `${t.station}: ${t.reason}` : `${t.speedKmh} км/ч`} · ${t.loco.series}</title>
          <line x1=${xx} x2=${xx} y1=${y0} y2=${yy} stroke="var(--line-strong)" /><circle cx=${xx} cy=${y0} r="6" fill=${t.stopped && !t.planned ? 'var(--danger)' : 'var(--accent)'} />
          <rect x=${xx - 33} y=${yy - 11} width="66" height="23" rx="7" fill=${selected === t.uid ? 'var(--accent-ink)' : t.stopped && !t.planned ? 'var(--danger)' : 'var(--accent)'} />
          <text x=${xx} y=${yy + 5} text-anchor="middle" fill="white" font-size="12" font-weight="600">${t.dir === 'rev' ? '‹ ' : ''}${t.number}${t.dir === 'fwd' ? ' ›' : ''}</text>
        </g>`;
      })}
    </svg></div>`;
}

export function NetworkDispatcher() {
  const { sim, trains, now, loading } = useNetworkTrains(.5), live = useLiveSchedule(), archive = useNetworkArchive();
  const [routeId, setRouteId] = useState(''), [direction, setDirection] = useState('all'), [selected, setSelected] = useState(null), [station, setStation] = useState(''), [minutes, setMinutes] = useState(60), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const route = sim?.routes?.find(r => r.id === routeId) || sim?.routes?.[0];
  const rows = useMemo(() => trains.filter(t => t.routeId === route?.id && (direction === 'all' || t.dir === direction)), [trains, route, direction]);
  const picked = rows.find(t => t.uid === selected);
  const planRows = live.plan?.optimized.rows.filter(r => r.routeId === route?.id && (direction === 'all' || r.dir === direction)) || [];
  const conflicts = planRows.filter(r => r.status !== 'assigned');
  const events = archive.events.filter(e => e.routeId === route?.id && e.at <= now).slice(-10).reverse();
  const stationName = station || route?.from;
  const present = rows.filter(t => t.stopped && t.station === stationName);
  const arrivals = rows.flatMap(t => networkItinerary(sim, t).filter(s => s.name === stationName && s.arrival > now).map(s => ({ t, s }))).sort((a, b) => a.s.arrival - b.s.arrival).slice(0, 8);
  const restrict = async () => {
    setBusy(true); setMessage('');
    try {
      const res = await fetch('/api/schedule-route-incident', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routeId: route.id, dir: direction, minutes }) });
      const body = await res.json(); if (!res.ok) throw new Error(body.error);
      setMessage(`План пересчитан: ${body.plan.changes.at(-1).changes.length} изменённых назначений. Поезда в движении не остановлены этой командой.`);
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  if (loading || !route) return html`<section class="panel pad">Загрузка диспетчерской сети…</section>`;
  return html`<section class="network-dispatcher" aria-label="Диспетчерская всей сети">
    <div class="dispatch-hero"><div><span class="dispatch-eyebrow">ОПЕРАТИВНЫЙ ПУЛЬТ · КАЗАХСТАН</span><h2>Весь маршрут — перед глазами</h2><p>Движение, станции и очередь назначений в одном рабочем пространстве.</p></div><span class="dispatch-clock">${time(now)}<small>Время модели</small></span></div>
    <section class="panel"><div class="panel-head"><label class="schedule-field"><span>Маршрут диспетчера</span><select aria-label="Маршрут диспетчера" value=${route.id} onChange=${e => { setRouteId(e.target.value); setSelected(null); setStation(''); }}>${sim.routes.map(r => html`<option key=${r.id} value=${r.id}>${r.name}</option>`)}</select></label><${Segmented} label="Направление диспетчера" value=${direction} onChange=${setDirection} options=${[{ value: 'all', label: 'Оба направления' }, { value: 'fwd', label: 'Прямое →' }, { value: 'rev', label: '← Обратное' }]} /></div>
      <div class="kpis kpis-tight"><${Kpi} label="Поездов на маршруте" value=${rows.length} /><${Kpi} label="Ожидают на станциях" value=${rows.filter(t => t.stopped).length} /><${Kpi} label="Слотов без тяги в плане" value=${conflicts.length} tone=${conflicts.length ? 'danger' : 'neutral'} /><${Kpi} label="Станций вдоль маршрута" value=${route.stops.length} /></div>
      <${RouteDiagram} route=${route} trains=${rows} selected=${selected} station=${stationName} onTrain=${setSelected} onStation=${setStation} />
      <p class="muted pad">Две линии разделяют направления движения, а не утверждают физическое число путей. Схема построена по километражу маршрута. Голубой — поезд; красный — вынужденное ожидание. Номера раскрывают оперативный паспорт.</p>
    </section>
    <div class="dispatch-workspace"><section class="panel"><div class="panel-head"><div><h3>Станционный пост</h3><small>Фактические остановки профиля и ближайшие прибытия</small></div></div><div class="tab-panel"><label class="schedule-field"><span>Станция маршрута</span><select value=${stationName} onChange=${e => setStation(e.target.value)}>${route.stops.map(([name, km]) => html`<option value=${name}>${name} · ${km} км</option>`)}</select></label>
      <h4>На станции · ${present.length}</h4>${present.length ? present.map(t => html`<button class="dispatch-task" key=${t.uid} onClick=${() => setSelected(t.uid)}><strong>№${t.number} · ${t.loco.series}</strong><span>${t.reason}</span><small>Стоит ${Math.round(t.waitedMin || 0)} мин · осталось ${t.restMin} мин</small></button>`) : html`<p class="muted">Остановившихся поездов нет. Поезда поблизости не считаются принятыми на станцию.</p>`}
      <h4>На подходе</h4>${arrivals.length ? arrivals.map(({ t, s }) => html`<button class="dispatch-task" key=${t.uid} onClick=${() => setSelected(t.uid)}><strong>${time(s.arrival)} · №${t.number}</strong><span>${t.from} → ${t.to}</span><small>${s.reason}</small></button>`) : html`<p class="muted">В активных рейсах ближайших прибытий нет.</p>`}
    </div></section>
    <section class="panel"><div class="panel-head"><div><h3>Очередь диспетчерских задач</h3><small>Не скрываем рейсы, которым не удалось подобрать тягу</small></div></div><div class="tab-panel">
      ${conflicts.length ? conflicts.slice(0, 10).map(r => html`<details class="dispatch-task" key=${r.uid}><summary>№${r.number} · ${time(r.departedMs)} · ${r.from}</summary><p>${r.reason}</p><p>${r.wagons} вагонов · ${r.consist.grossT} т</p><a href="#/schedules">Открыть варианты в расписании</a></details>`) : html`<p>Все слоты выбранного направления обеспечены в текущем плане.</p>`}
      ${conflicts.length > 10 && html`<p>Ещё ${conflicts.length - 10} — в полном расписании.</p>`}
      <h4>Ограничение отправлений в плане</h4><p class="muted">Для выбранного маршрута и направления. Пересчитывает будущие назначения; это не команда светофорам и не остановка уже идущих поездов.</p>
      <div class="filter-row"><label class="schedule-field"><span>Продолжительность, мин</span><select value=${minutes} onChange=${e => setMinutes(Number(e.target.value))}>${[15, 30, 60, 120, 240, 720].map(n => html`<option value=${n}>${n}</option>`)}</select></label><${Button} icon="construction" pending=${busy} onClick=${restrict}>Ввести ограничение плана</${Button}></div><p role="status">${message}</p>
    </div></section></div>
    <section class="panel"><div class="panel-head"><h3>Последние операции этого маршрута</h3><a href="#/log">Весь журнал</a></div><ol class="dispatch-events">${events.map(e => html`<li key=${e.id}><time>${time(e.at)}</time><p>${e.text}</p></li>`)}</ol></section>
    <${Dialog} id="dispatch-network-train" open=${Boolean(picked)} onClose=${() => setSelected(null)} title=${picked ? `Поезд №${picked.number}` : 'Поезд'}>${picked && html`<${TrainDetails} sim=${sim} t=${picked} now=${now} onMap=${() => { updateUi({ selectedNetTrain: picked.uid }); go('/'); }} />`}</${Dialog}>
  </section>`;
}
