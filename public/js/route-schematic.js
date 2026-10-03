// Линейная схема маршрута в масштабе километров: пути, станции, электрификация, инциденты и поезда.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, Icon } from './lib.js';
import { routeStations, routeSegments, electrifiedRanges, routeCharacter, niceStep } from './route-profile.js';

const COLORS = { passenger: '#007aa5', container: '#1f4a63', freight: '#6d8290' };
const PAD = 78, H = 372;
const ZOOMS = [{ value: 'fit', label: 'Весь маршрут' }, { value: 3, label: '3 пикс/км' }, { value: 8, label: '8 пикс/км' }, { value: 20, label: '20 пикс/км' }];
const absKm = t => (t.dir === 'fwd' ? t.km : t.totalKm - t.km);
const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function RouteSchematic({ route, trains, incidents, now, selected, onSelect, onSegment, focusSegment }) {
  const wrap = useRef(null);
  const [box, setBox] = useState(900);
  const [chosen, setZoom] = useState(null);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setBox(el.clientWidth || 900));
    ro.observe(el); setBox(el.clientWidth || 900);
    return () => ro.disconnect();
  }, []);
  const ch = routeCharacter(route);
  const stations = useMemo(() => routeStations(route), [route.id]);
  const segments = useMemo(() => routeSegments(route), [route.id]);
  const wires = useMemo(() => electrifiedRanges(route), [route.id]);
  const fitPpk = Math.max(0.5, (box - 2 * PAD) / route.km);
  const zoom = chosen ?? (fitPpk >= 2.4 ? 'fit' : 3);
  const ppk = zoom === 'fit' ? fitPpk : Number(zoom);
  const W = Math.max(box, route.km * ppk + 2 * PAD);
  const x = km => PAD + km * ppk;
  const Y_FWD = ch.single ? 170 : 150, Y_REV = ch.single ? 170 : 188, Y_BASE = Y_REV + 8;
  const yOf = t => (ch.single ? (t.dir === 'fwd' ? Y_FWD - 9 : Y_FWD + 9) : (t.dir === 'fwd' ? Y_FWD : Y_REV));
  const tickStep = niceStep(route.km, Math.max(4, Math.round((W - 2 * PAD) / 110)));
  // подписи станций без наложений: главные и конечные — в приоритете
  const labels = useMemo(() => {
    const placed = [], out = new Map();
    const order = [...stations].sort((a, b) => (b.end - a.end) || (a.minor - b.minor) || (a.i - b.i));
    for (const s of order) {
      if (s.minor && ppk < 6) continue;
      const w = Math.min(130, 14 + s.name.length * 7.2), cx = x(s.km);
      const row = [0, 1, 2].find(r => !placed.some(p => p.row === r && Math.abs(p.cx - cx) < (p.w + w) / 2 + 8));
      if (row == null) continue;
      placed.push({ cx, w, row }); out.set(s.i, row);
    }
    return out;
  }, [stations, ppk, W]);
  const placedTrains = useMemo(() => {
    const slots = new Map();
    return trains.map(t => {
      const km = absKm(t), atStation = t.stopped && t.station && stations.find(s => Math.abs(s.km - km) < 1.5);
      let y = yOf(t), stack = 0, yard = false;
      if (t.stopped && atStation) { const key = `${atStation.i}`; stack = slots.get(key) || 0; slots.set(key, stack + 1); y = Y_BASE + 56 + stack * 20; yard = true; }
      return { t, x: x(km), y, yard, forced: t.stopped && !t.planned };
    });
  }, [trains, stations, ppk, W]);
  const active = incidents.filter(i => (i.until ?? Infinity) > now - 60000);
  useEffect(() => {
    const el = wrap.current, sel = placedTrains.find(p => p.t.uid === selected);
    if (el && sel && zoom !== 'fit') el.scrollTo({ left: Math.max(0, sel.x - el.clientWidth / 2), behavior: 'smooth' });
  }, [selected, zoom]);
  const ticks = []; for (let km = 0; km <= route.km + 0.1; km += tickStep) ticks.push(km);
  const jump = km => wrap.current?.scrollTo({ left: Math.max(0, x(km) - box / 2), behavior: 'smooth' });
  return html`<div class="rs">
    <div class="rs-bar">
      <div class="rs-chars"><span><${Icon} name="route" size=${14} /> ${ch.cls}</span><span><${Icon} name="git-merge" size=${14} /> ${ch.tracks}</span><span><${Icon} name=${route.electrified > 0.04 ? 'zap' : 'fuel'} size=${14} /> ${ch.traction}</span></div>
      <div class="segmented" role="radiogroup" aria-label="Масштаб схемы">${ZOOMS.map(z => html`<button type="button" role="radio" key=${z.value} aria-checked=${zoom === z.value} class=${zoom === z.value ? 'on' : ''} onClick=${() => setZoom(z.value)}>${z.label}</button>`)}</div>
    </div>
    <div class="rs-strip" role="img" aria-label="Обзор маршрута: положение поездов и событий" onClick=${e => { const r = e.currentTarget.getBoundingClientRect(); jump((e.clientX - r.left) / r.width * route.km); }}>
      ${active.map(i => html`<i key=${i.id} class=${`rs-strip-inc ${i.kind}`} style=${`left:${i.a / route.km * 100}%;width:${Math.max(0.6, (i.b - i.a) / route.km * 100)}%`}></i>`)}
      ${trains.map(t => html`<i key=${t.uid} class=${`rs-dot ${t.category} ${t.stopped && !t.planned ? 'bad' : ''} ${t.uid === selected ? 'sel' : ''}`} style=${`left:${absKm(t) / route.km * 100}%`}></i>`)}
    </div>
    <div class="rs-scroll" ref=${wrap}>
      <svg width=${W} height=${H} viewBox=${`0 0 ${W} ${H}`} role="group" aria-label=${`Схема маршрута ${route.name}`} class="rs-svg">
        ${ticks.map(km => html`<g key=${km}><line x1=${x(km)} x2=${x(km)} y1="18" y2=${Y_BASE + 18} class="rs-grid"/><text x=${x(km)} y="12" text-anchor="middle" class="rs-km">${Math.round(km)} км</text></g>`)}
        ${wires.length ? wires.map(([a, b], k) => html`<g key=${k} class="rs-wire"><line x1=${x(a)} x2=${x(b)} y1="72" y2="72"/>${Array.from({ length: Math.max(1, Math.floor((b - a) * ppk / 48)) + 1 }, (_, m) => html`<line key=${m} x1=${x(a) + m * 48} x2=${x(a) + m * 48} y1="72" y2="86" class="mast"/>`)}</g>`) : ''}
        <text x=${PAD} y="58" class="rs-note">${wires.length ? 'Контактная сеть (оценка)' : 'Без контактной сети: тепловозная тяга'}</text>
        <text x=${PAD - 10} y=${Y_FWD + 4} text-anchor="end" class="rs-track-t">${ch.single ? '' : '→ чётный'}</text>
        <text x=${PAD - 10} y=${Y_REV + 4} text-anchor="end" class="rs-track-t">${ch.single ? 'единственный путь' : '← нечётный'}</text>
        ${ch.single ? '' : html`<line x1=${PAD} x2=${W - PAD} y1=${Y_FWD} y2=${Y_FWD} class="rs-track fwd"/>`}
        <line x1=${PAD} x2=${W - PAD} y1=${Y_REV} y2=${Y_REV} class=${`rs-track ${ch.single ? 'single' : 'rev'}`}/>
        ${segments.map(seg => html`<rect key=${seg.i} x=${x(seg.a)} y="96" width=${Math.max(2, (seg.b - seg.a) * ppk)} height=${Y_BASE - 78} class=${`rs-seg ${focusSegment === seg.i ? 'on' : ''}`} role="button" tabindex="-1" aria-label=${`Перегон ${seg.label}`} onClick=${() => onSegment?.(seg)}><title>${`${seg.label} · ${Math.round(seg.len)} км · нажмите, чтобы выбрать для события`}</title></rect>`)}
        ${stations.map(s => {
          const cx = x(s.km), row = labels.get(s.i), loop = Math.min(60, Math.max(14, ppk * 6));
          return html`<g key=${s.i} class=${`rs-st ${s.minor ? 'minor' : ''}`}>
            ${ch.single ? html`<path d=${`M${cx - loop} ${Y_REV} L${cx - loop + 10} ${Y_REV + 14} H${cx + loop - 10} L${cx + loop} ${Y_REV}`} class="rs-loop"/>`
              : html`<line x1=${cx - loop} x2=${cx + loop} y1=${Y_BASE + 18} y2=${Y_BASE + 18} class="rs-loop"/><line x1=${cx - loop + 8} x2=${cx - loop + 8} y1=${Y_REV} y2=${Y_BASE + 18} class="rs-loop"/><line x1=${cx + loop - 8} x2=${cx + loop - 8} y1=${Y_REV} y2=${Y_BASE + 18} class="rs-loop"/>`}
            <rect x=${cx - (s.minor ? 3 : 7)} y=${ch.single ? Y_REV - 28 : Y_FWD - 30} width=${s.minor ? 6 : 14} height=${s.minor ? 6 : 14} rx="2" class=${`rs-bld ${s.end ? 'end' : ''}`}/>
            ${row != null ? html`<text x=${cx} y=${Y_BASE + 100 + row * 30} text-anchor="middle" class=${`rs-name ${s.end ? 'end' : ''}`}>${trunc(s.name, 18)}</text><text x=${cx} y=${Y_BASE + 112 + row * 30} text-anchor="middle" class="rs-skm">${Math.round(s.km)} км</text>` : ''}
            <title>${`${s.name}, ${Math.round(s.km)} км`}</title></g>`;
        })}
        ${active.map(i => {
          const planned = i.from > now, xa = x(i.a), xb = x(i.b), w = Math.max(6, xb - xa), cls = planned ? 'planned' : '';
          const both = i.track === 'both' || ch.single, y1 = ch.single ? Y_REV : i.track === 'odd' ? Y_REV : Y_FWD;
          return html`<g key=${i.id} class=${`rs-inc ${i.kind} ${cls}`}>
            ${i.kind === 'restriction' ? html`<rect x=${xa} y=${Y_FWD - 22} width=${w} height=${Y_REV - Y_FWD + 44} class="slow"/><g transform=${`translate(${xa + w / 2} ${Y_FWD - 38})`}><circle r="14" class="sign"/><text y="4" text-anchor="middle" class="sign-t">${i.kmh}</text></g>`
              : html`<rect x=${xa} y=${(both ? Y_FWD : y1) - 13} width=${w} height=${both ? Y_REV - Y_FWD + 26 : 26} rx="4" class="closed"/>${(both && !ch.single ? [Y_FWD, Y_REV] : [y1]).map(yy => html`<line key=${yy} x1=${xa} x2=${xa + w} y1=${yy} y2=${yy} class="closed-line"/>`)}
                <g transform=${`translate(${xa + w / 2} ${Y_FWD - 40})`}><polygon points="-13,-6 -6,-13 6,-13 13,-6 13,6 6,13 -6,13 -13,6" class="oct"/><text y="4" text-anchor="middle" class="oct-t">${i.kind === 'breakdown' ? i.level : '✕'}</text></g>`}
            <title>${`${i.kind === 'closure' ? 'Закрыт путь' : i.kind === 'restriction' ? `Ограничение ${i.kmh} км/ч` : `Поломка, уровень ${i.level}`} · ${i.segName || ''}${planned ? ' · запланировано' : ''}`}</title></g>`;
        })}
        ${placedTrains.map(({ t, x: px, y, yard, forced }) => {
          const sel = t.uid === selected, hov = t.uid === hover, dir = t.dir === 'fwd' ? 1 : -1;
          const broken = incidents.some(i => i.kind === 'breakdown' && i.trainUid === t.uid && i.from <= now && (i.until ?? Infinity) > now);
          return html`<g key=${t.uid} class=${`rs-train ${t.category} ${forced ? 'forced' : ''} ${broken ? 'broken' : ''} ${sel ? 'sel' : ''}`} style=${`transform: translate(${px.toFixed(1)}px, ${y}px)`} tabindex="0" role="button" aria-pressed=${sel}
            aria-label=${`Поезд ${t.number}, ${t.label}. ${t.stopped ? `Стоит: ${t.station || 'на перегоне'}. ${t.reason}` : `${t.speedKmh} км/ч`}`} onClick=${() => onSelect?.(sel ? null : t.uid)}
            onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(sel ? null : t.uid); } }} onMouseEnter=${() => setHover(t.uid)} onMouseLeave=${() => setHover(null)}>
            ${forced && html`<circle r="20" class="pulse"/>`}
            <path d=${dir > 0 ? 'M-19 -8 H12 L21 0 L12 8 H-19 Z' : 'M19 -8 H-12 L-21 0 L-12 8 H19 Z'} fill=${broken ? '#b42318' : COLORS[t.category]} class="body"/>
            <text y="4" text-anchor="middle" class="num">${t.number}</text>
            ${(sel || hov || ppk >= 8) && html`<text y="-13" text-anchor="middle" class="sub">${t.loco.series} · ${t.stopped ? 'стоит' : `${t.speedKmh} км/ч`}</text>`}
            <title>${`№${t.number} · ${t.label} · ${t.from} → ${t.to}${t.stopped ? ` · ${t.reason}` : ` · ${t.speedKmh} км/ч`}`}</title></g>`;
        })}
        <text x=${PAD} y=${H - 8} class="rs-note">Стрелки — направление движения · красный контур — вынужденная стоянка · штриховка — закрытый путь · станционные пути условные</text>
      </svg>
    </div>
  </div>`;
}
