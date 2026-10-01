import { useEffect, useRef, useState } from 'preact/hooks';
import { html, Icon, clockAt, time, delayText, duration, PRIORITY, DIRECTION } from './lib.js';
import { app, act, go, href, updateUi, useLiveNow, liveNow, clock } from './store.js';
import { Button, Badge, Segmented } from './ui.js';

// ---- геометрия схемы (условные единицы; SVG масштабируется по ширине) ----
const MARGIN = 80, STEP = 130, H = 372;
const Y_ODD = 152, Y_EVEN = 214;           // главные пути: сверху нечётный (←), снизу чётный (→)
const SIDE = 26;                             // вынос боковых путей станции
const TRAIN_W = 58, TRAIN_H = 20;
const stationX = i => MARGIN + i * STEP;
const SPEEDS = [{ value: 1, label: '1' }, { value: 3, label: '3' }, { value: 10, label: '10' }, { value: 30, label: '30' }];
const FILL = { 1: 'var(--accent)', 2: '#2c5770', 3: '#667f90' };

/** Где поезд в момент tMin (минуты смены): движется по перегону, ждёт на станции или уже прибыл. */
export function locate(train, tMin) {
  const pts = train.forecast;
  if (tMin < pts[0][0] || tMin > pts.at(-1)[0] + 8) return null;
  for (let k = 1; k < pts.length; k++) {
    if (tMin <= pts[k][0]) {
      const [t0, i0] = pts[k - 1], [t1, i1] = pts[k];
      if (i0 === i1) return { kind: 'wait', idx: i0, since: t0, until: t1 };
      return { kind: 'move', from: i0, to: i1, f: (tMin - t0) / (t1 - t0), t0, t1 };
    }
  }
  return { kind: 'arrived', idx: pts.at(-1)[1] };
}

/** Кто занимает закрытый перегон в момент tMin (для объяснения, почему другой стоит). */
function blockerOf(data, tMin, seg, exceptNumber) {
  for (const t of data.trains) {
    if (t.number === exceptNumber) continue;
    const loc = locate(t, tMin);
    if (loc?.kind === 'move' && Math.min(loc.from, loc.to) === seg) return t;
  }
  return null;
}

/** Положения всех поездов на схеме и их состояние. */
export function placeTrains(data, tMin) {
  const out = [];
  const seg = data.dispatch.closedSegment;
  const slots = new Map();
  for (const t of data.trains) {
    const loc = locate(t, tMin);
    if (!loc) continue;
    const odd = t.direction === 'odd';
    const rec = { t, loc, odd, stopped: false, wrong: false, x: 0, y: odd ? Y_ODD : Y_EVEN, reason: '', segment: null };
    if (loc.kind === 'move') {
      const a = Math.min(loc.from, loc.to);
      rec.segment = a;
      rec.x = stationX(loc.from) + (stationX(loc.to) - stationX(loc.from)) * loc.f;
      if (data.blocked && odd && a === seg) { rec.wrong = true; rec.y = Y_EVEN; }
    } else {
      // стоит на боковом пути станции (ожидание) или прибыл на конечную
      const key = `${loc.idx}:${odd}`;
      const n = slots.get(key) || 0;
      slots.set(key, n + 1);
      const cx = stationX(loc.idx);
      const yard = loc.kind === 'arrived' && (loc.idx === 0 || loc.idx === data.stations.length - 1);
      rec.x = yard ? cx + (loc.idx === 0 ? -64 : 64) : cx + [-2, 62, -66, 126][n % 4] * (odd ? -1 : 1);
      rec.y = yard ? (odd ? Y_ODD - 14 * (n + 1) : Y_EVEN + 14 * (n + 1)) : odd ? Y_ODD - SIDE : Y_EVEN + SIDE;
      rec.stopped = loc.kind === 'wait';
      if (rec.stopped) {
        const side = odd ? loc.idx - 1 : loc.idx;      // перегон, который ждут
        const blocker = data.blocked ? blockerOf(data, tMin, seg, t.number) : null;
        const toSeg = data.blocked && (odd ? loc.idx - 1 : loc.idx) === seg;
        rec.reason = toSeg
          ? `ждёт очереди на закрытый перегон ${data.stations[seg].id}–${data.stations[seg + 1].id}${blocker ? `: сейчас идёт №${blocker.number}` : ''}`
          : 'ждёт на станции';
        rec.waitedMin = Math.max(0, Math.round(tMin - loc.since));
        rec.restMin = Math.max(0, Math.round(loc.until - tMin));
      }
    }
    out.push(rec);
  }
  // Поезда в колонне иначе наезжают друг на друга: разводим по «дорожкам» над/под главным путём.
  for (const line of [Y_ODD, Y_EVEN]) {
    const lanes = [];
    for (const rec of out.filter(r => r.loc.kind === 'move' && r.y === line).sort((a, b) => a.x - b.x)) {
      let k = lanes.findIndex(x => rec.x - x >= TRAIN_W + 8);
      if (k < 0) { k = lanes.length; lanes.push(-Infinity); }
      lanes[k] = rec.x;
      rec.lane = Math.min(k, 3);
      rec.y += (line === Y_ODD ? -1 : 1) * rec.lane * 24;
    }
  }
  return out;
}

function trainStatus(data, rec, tMin) {
  const { t, loc } = rec;
  const name = i => data.stations[i].name;
  if (loc.kind === 'move') {
    const lim = data.restrictions.find(r => r.segment === rec.segment);
    const nextEta = clockAt(data, loc.t1);
    return `В пути: ${name(loc.from)} → ${name(loc.to)}, пройдено ${Math.round(loc.f * 100)}%${rec.wrong ? ' · по неправильному пути' : ''}${lim ? ` · ограничение ${lim.kmh} км/ч` : ''}. Прибытие на «${name(loc.to)}» в ${nextEta}.`;
  }
  if (loc.kind === 'wait') return `Стоит на станции «${name(loc.idx)}» ${rec.waitedMin} мин, ${rec.reason}. Отправление через ${rec.restMin} мин.`;
  return `Прибыл на станцию «${name(loc.idx)}».`;
}

function Station({ s, i, last, tracks }) {
  const cx = stationX(i);
  const yard = i === 0 || i === last;
  const dir = i === 0 ? -1 : 1;
  const load = Math.round(s.occupied / s.capacity * 100);
  return html`<g class="m-station" key=${s.id}>
    <a href=${href(`/station/${s.id}`)} aria-label=${`Станция ${s.name}, ${s.type}, занятость ${load}%`}>
      <title>${`${s.name}: ${s.type.toLowerCase()} станция`}</title>
      <text x=${cx} y="26" text-anchor="middle" class="m-sname">${s.name}</text>
      <rect x=${cx - 15} y="40" width="30" height="30" rx="6" class="m-bld"/>
      <text x=${cx} y="62" text-anchor="middle" class="m-bld-l">${s.id}</text>
    </a>
    ${yard
      ? html`<g class="m-yard">${[-2, -1, 0, 1, 2].map(k => html`<path key=${k} d=${`M${cx} ${k < 0 ? Y_ODD : Y_EVEN} L${cx + dir * 30} ${(Y_ODD + Y_EVEN) / 2 + k * 24} H${cx + dir * 110}`} class="m-rail thin"/>`)}</g>`
      : html`<g class="m-loop">
          <path d=${`M${cx - 50} ${Y_ODD} L${cx - 34} ${Y_ODD - SIDE} H${cx + 34} L${cx + 50} ${Y_ODD}`} class="m-rail side"/>
          <path d=${`M${cx - 50} ${Y_EVEN} L${cx - 34} ${Y_EVEN + SIDE} H${cx + 34} L${cx + 50} ${Y_EVEN}`} class="m-rail side"/></g>`}
    <g class="m-tracks"><title>${`Подъездные пути: занятость ${load}%`}</title>
      ${tracks.map((t, k) => html`<g key=${t.id} transform=${`translate(${cx - 40} ${288 + k * 15})`}>
        <rect width="80" height="10" rx="5" class="m-tr-bg"/>
        <rect width=${Math.max(0, 80 * t.occupied / t.capacity)} height="10" rx="5" class=${t.done ? 'm-tr-done' : 'm-tr-work'}/></g>`)}
      <text x=${cx} y=${288 + tracks.length * 15 + 10} text-anchor="middle" class="m-load">пути ${load}%</text></g>
  </g>`;
}

export function TrackMap({ data }) {
  const now = useLiveNow(clock.running ? 30 : 4);
  const tMin = (now - data.baseTime) / 60000;
  const wrap = useRef(null);
  const [fit, setFit] = useState(true);
  const [boxW, setBoxW] = useState(1200);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = data.stations.length;
  const W = MARGIN * 2 + (n - 1) * STEP;
  const width = fit ? Math.max(boxW, 760) : W;
  const scale = width / W;
  const selected = app.ui.selectedTrain;
  const live = placeTrains(data, tMin);     // точные положения для кадра
  const seg = data.dispatch.closedSegment;

  // занятость блок-участков → сигналы
  const occupied = new Set(live.filter(r => r.loc.kind === 'move').map(r => `${r.y === Y_ODD ? 'o' : 'e'}:${r.segment}:${Math.min(2, Math.floor(r.loc.f * 3))}`));
  const signals = [];
  for (let sgm = 0; sgm < n - 1; sgm++) for (let b = 0; b < 3; b++) {
    const x0 = stationX(sgm), x1 = stationX(sgm + 1), L = x1 - x0;
    const closedOdd = data.blocked && sgm === seg;
    signals.push({ k: `e${sgm}${b}`, x: x0 + (L * b) / 3 + 14, y: Y_EVEN + 12, red: occupied.has(`e:${sgm}:${b}`) });
    signals.push({ k: `o${sgm}${b}`, x: x0 + (L * (b + 1)) / 3 - 14, y: Y_ODD - 12, red: closedOdd || occupied.has(`o:${sgm}:${b}`) });
  }

  const stopped = live.filter(r => r.stopped);
  const onLine = live.length;
  const sel = selected ? live.find(r => r.t.number === selected) : null;
  const selTrain = selected ? data.trains.find(t => t.number === selected) : null;

  // следим за выбранным поездом
  useEffect(() => {
    if (!sel || fit || !clock.running || !wrap.current) return;
    const target = sel.x * scale - wrap.current.clientWidth / 2;
    wrap.current.scrollLeft += (target - wrap.current.scrollLeft) * 0.15;
  });

  const enter = (e, rec) => { const r = wrap.current.getBoundingClientRect(); setHover({ n: rec.t.number, x: e.clientX - r.left + wrap.current.scrollLeft, y: e.clientY - r.top }); };
  const toggleRun = () => act({ type: 'clock', running: !clock.running });
  const label = clock.running ? 'Пауза' : data.ended ? 'Смена окончена' : 'Пуск';
  const hovered = hover && live.find(r => r.t.number === hover.n);

  return html`<div class="trackmap">
    <div class="map-toolbar">
      <div class="map-clock" aria-live="off"><${Icon} name="clock" size=${20} /><strong class="num">${time(now)}</strong></div>
      <${Button} variant=${clock.running ? 'secondary' : 'primary'} icon=${clock.running ? 'pause' : 'play'} onClick=${toggleRun} disabled=${data.ended} reason="Смена закончена: начните её заново (кнопка сброса вверху)">${label}</${Button}>
      <div class="speed" role="group" aria-label="Скорость времени">
        <span class="muted">Скорость, мин/с</span>
        <${Segmented} label="Скорость времени" value=${data.speed} options=${SPEEDS} onChange=${v => act({ type: 'clock', speed: v })} />
      </div>
      <div class="map-stats" role="status" aria-live="polite">
        <span><strong>${onLine}</strong> на линии</span>
        <span class=${stopped.length ? 'bad' : ''}><strong>${stopped.length}</strong> стоят</span>
      </div>
      <div class="map-tools">
        <${Button} variant="ghost" size="sm" icon=${fit ? 'zoom-in' : 'zoom-out'} onClick=${() => setFit(!fit)}>${fit ? 'Крупнее' : 'Вписать'}</${Button}>
      </div>
    </div>
    <div class="map-scroll" ref=${wrap} onPointerLeave=${() => setHover(null)}>
      <svg width=${width} height=${H * scale} viewBox=${`0 0 ${W} ${H}`} role="group"
        aria-label=${`Схема участка: ${onLine} поездов на линии, ${stopped.length} стоят`}>
        <defs><pattern id="mhatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="var(--danger-line)" stroke-width="3"/></pattern></defs>
        <text x=${stationX(0) + 90} y=${Y_ODD - 38} class="m-dir">← нечётное направление</text>
        <text x=${stationX(0) + 90} y=${Y_EVEN + 48} class="m-dir">чётное направление →</text>
        <line x1=${stationX(0)} x2=${stationX(n - 1)} y1=${Y_ODD} y2=${Y_ODD} class="m-rail"/>
        <line x1=${stationX(0)} x2=${stationX(n - 1)} y1=${Y_EVEN} y2=${Y_EVEN} class="m-rail"/>
        ${data.stations.map((s, i) => html`<${Station} key=${s.id} s=${s} i=${i} last=${n - 1} tracks=${s.tracks} />`)}
        ${data.blocked && html`<g class="m-closed">
          <rect x=${stationX(seg) + 50} y=${Y_ODD - 12} width=${STEP - 100} height="24" rx="4" fill="url(#mhatch)" class="m-hatch"/>
          <g transform=${`translate(${stationX(seg) + STEP / 2} ${Y_ODD})`}><circle r="16" class="m-star"/><path d="M-7 -7 L7 7 M7 -7 L-7 7" class="m-x"/></g>
          <text x=${stationX(seg) + STEP / 2} y=${(Y_ODD + Y_EVEN) / 2 + 5} text-anchor="middle" class="m-closed-t">сход: путь закрыт</text></g>`}
        ${data.restrictions.map(r => html`<g key=${r.segment} transform=${`translate(${stationX(r.segment) + STEP / 2} ${Y_EVEN + 74})`}>
          <circle r="17" class="m-sign"/><text y="5" text-anchor="middle" class="m-sign-t">${r.kmh}</text></g>`)}
        ${signals.map(s => html`<circle key=${s.k} cx=${s.x} cy=${s.y} r="5" class=${`m-sig ${s.red ? 'red' : ''}`}/>`)}
        ${live.map(rec => {
          const { t } = rec;
          const isSel = selected === t.number;
          const dim = selected && !isSel;
          const goingLeft = rec.odd;      // нечётные всегда едут влево, даже по неправильному пути
          return html`<g key=${t.number} class=${`mtrain p${t.priority} ${rec.stopped ? 'stopped' : ''} ${rec.wrong ? 'wrong' : ''} ${isSel ? 'sel' : ''}`} opacity=${dim ? 0.3 : 1}
            transform=${`translate(${rec.x.toFixed(1)} ${rec.y})`} tabindex="0" role="button"
            aria-label=${`Поезд ${t.number}, ${t.label}. ${trainStatus(data, rec, tMin)}`} aria-pressed=${isSel}
            onClick=${() => updateUi({ selectedTrain: isSel ? null : t.number })}
            onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); updateUi({ selectedTrain: isSel ? null : t.number }); } }}
            onPointerMove=${e => enter(e, rec)} onPointerEnter=${e => enter(e, rec)}>
            <rect x="-38" y="-16" width="76" height="32" fill="transparent" class="m-hit"/>
            ${rec.stopped && html`<circle r="28" class="m-pulse"/>`}
            <rect x=${-TRAIN_W / 2} y=${-TRAIN_H / 2} width=${TRAIN_W} height=${TRAIN_H} rx="6" fill=${FILL[t.priority]} class="m-body"/>
            <path d=${goingLeft ? `M${-TRAIN_W / 2} -10 L${-TRAIN_W / 2 - 11} 0 L${-TRAIN_W / 2} 10 Z` : `M${TRAIN_W / 2} -10 L${TRAIN_W / 2 + 11} 0 L${TRAIN_W / 2} 10 Z`} fill=${FILL[t.priority]}/>
            <text y="5" text-anchor="middle" class="m-num">${t.number}</text>
            ${rec.stopped && html`<text y=${rec.odd ? -18 : 32} text-anchor="middle" class="m-stop">стоит ${rec.waitedMin} мин</text>`}
          </g>`;
        })}
      </svg>
      ${hovered && html`<div class="tip" style=${`left:${Math.min(hover.x + 14, width - 260)}px;top:${Math.min(hover.y + 18, H * scale - 120)}px`} role="tooltip">
        <strong>№${hovered.t.number} · ${hovered.t.label}</strong>
        <span>${DIRECTION[hovered.t.direction]} направление · приоритет ${hovered.t.priority}</span>
        <span class=${hovered.stopped ? 'bad' : ''}>${hovered.stopped ? `Стоит на «${data.stations[hovered.loc.idx].name}»` : hovered.loc.kind === 'move' ? `${data.stations[hovered.loc.from].name} → ${data.stations[hovered.loc.to].name}` : 'Прибыл'}</span>
        <span class=${hovered.t.delay > 0 ? 'bad' : ''}>Прибытие ${clockAt(data, hovered.t.forecast.at(-1)[0])} · ${delayText(hovered.t.delay)}</span>
      </div>`}
    </div>
    <div class="map-legend" aria-label="Обозначения">
      ${[1, 2, 3].map(p => html`<span key=${p}><i class="lg-train" style=${`background:${FILL[p]}`}></i>${PRIORITY[p].short}</span>`)}
      <span><i class="lg-train stopped"></i>Стоит и ждёт</span>
      <span><i class="lg-sig"></i>Сигнал: путь свободен</span><span><i class="lg-sig red"></i>занят / закрыт</span>
    </div>
    <div class="map-info" role="region" aria-label="Выбранный поезд" aria-live="polite">
      ${selTrain ? (sel ? html`<div class="info-main"><strong>№${selTrain.number}</strong><${Badge} tone=${PRIORITY[selTrain.priority].tone}>${selTrain.label}</${Badge}>
          <span>${trainStatus(data, sel, tMin)}</span></div>
        <div class="info-side"><${Badge} tone=${selTrain.delay > 0 ? 'danger' : 'neutral'}>${delayText(selTrain.delay)}</${Badge}>
          <${Button} variant="ghost" size="sm" icon="x" onClick=${() => updateUi({ selectedTrain: null })}>Снять</${Button}></div>`
        : html`<div class="info-main"><strong>№${selTrain.number}</strong><span>${tMin < selTrain.forecast[0][0] ? `Ещё не вышел: отправление в ${clockAt(data, selTrain.forecast[0][0])} со станции «${data.stations[selTrain.forecast[0][1]].name}».` : 'Уже прибыл и ушёл с линии.'}</span></div>
          <div class="info-side"><${Button} variant="ghost" size="sm" icon="x" onClick=${() => updateUi({ selectedTrain: null })}>Снять</${Button}></div>`)
        : html`<div class="info-main muted"><${Icon} name="mouse-pointer-click" size=${17} /><span>Нажмите на поезд, чтобы увидеть, где он и почему стоит. Нажмите на станцию — откроются её пути.</span></div>`}
    </div>
  </div>`;
}

/** Список стоящих поездов с причинами. */
export function StoppedList({ data }) {
  const now = useLiveNow(1);
  const tMin = (now - data.baseTime) / 60000;
  const stopped = placeTrains(data, tMin).filter(r => r.stopped).sort((a, b) => b.waitedMin - a.waitedMin);
  return html`<section class="panel" aria-labelledby="stop-title">
    <div class="panel-head"><h2 id="stop-title">Стоят и ждут</h2><${Badge} tone=${stopped.length ? 'danger' : 'neutral'}>${stopped.length}</${Badge}></div>
    ${stopped.length ? html`<ul class="late-list">${stopped.map(r => html`<li key=${r.t.number}>
      <button type="button" class="late-row stop-row" aria-pressed=${app.ui.selectedTrain === r.t.number} onClick=${() => updateUi({ selectedTrain: app.ui.selectedTrain === r.t.number ? null : r.t.number })}>
        <strong>№${r.t.number}</strong><span>${data.stations[r.loc.idx].name}: ${r.reason}</span><span class="bad num">${r.waitedMin} мин</span></button></li>`)}</ul>`
      : html`<p class="muted">Сейчас все поезда на линии движутся. Если закрыть перегон, часть поездов будет ждать очереди.</p>`}
  </section>`;
}
