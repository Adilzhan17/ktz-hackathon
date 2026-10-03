// «Ядро модели»: блоки данных непрерывно летят от источников к ядру, внутри ядра идёт расчёт, результат разлетается по выходам.
// Каждая пачка привязана к настоящему циклу расчёта или настоящему событию журнала. Рисуем на canvas со скоростью экрана.
import { useEffect, useRef } from 'preact/hooks';
import { html } from './lib.js';
import { NODES } from './engine-graph.js';
import { DECISION } from './log.js';

const SOURCES = ['trains', 'timetable', 'incidents', 'crews', 'fleet', 'clock'];
const OUTPUTS = ['positions', 'eta', 'journal', 'notify', 'advice'];
const ORBIT = ['profile', 'position', 'queue', 'limits', 'blocks', 'conflicts', 'variants', 'weight'];
const STYLE = {
  trains: { color: '#007aa5', shape: 'square' }, timetable: { color: '#1f4a63', shape: 'square' }, incidents: { color: '#b42318', shape: 'diamond' },
  crews: { color: '#007aa5', shape: 'circle' }, fleet: { color: '#6d8290', shape: 'circle' }, clock: { color: '#6d8290', shape: 'dot' },
};
const OUT_COLOR = '#2f9e6e';
const TONE_COLOR = { accent: '#007aa5', danger: '#b42318', ink: '#1f4a63', neutral: '#6d8290', muted: '#6d8290' };
const FEEDS = { trains: ['profile', 'position'], timetable: ['profile', 'queue'], incidents: ['queue', 'position'], crews: ['limits', 'profile'], fleet: ['limits'], clock: ['position', 'profile'] };
const DRAINS = { positions: ['blocks', 'position'], eta: ['conflicts', 'weight'], journal: ['conflicts', 'variants'], notify: ['conflicts'], advice: ['weight', 'conflicts'] };
const LABEL = new Map(NODES.map(n => [n.id, n]));
const fmt = n => (typeof n === 'number' ? Math.round(n).toLocaleString('ru-RU') : n);
const ease = u => (u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2);

function geometry(W, H) {
  const core = { x: W / 2, y: H / 2 + 6, r: 46 }, orbit = new Map(), pos = new Map();
  ORBIT.forEach((id, i) => { const a = -Math.PI / 2 + (i / ORBIT.length) * Math.PI * 2; orbit.set(id, { x: core.x + Math.cos(a) * 128, y: core.y + Math.sin(a) * 128, a }); });
  const lay = (ids, x) => ids.forEach((id, i) => pos.set(id, { x, y: 64 + (i + 0.5) * ((H - 96) / ids.length) }));
  lay(SOURCES, 215); lay(OUTPUTS, W - 215);
  return { core, orbit, pos };
}

function shapePath(ctx, shape, x, y, s) {
  ctx.beginPath();
  if (shape === 'circle' || shape === 'dot') ctx.arc(x, y, shape === 'dot' ? s * 0.55 : s * 0.8, 0, Math.PI * 2);
  else if (shape === 'diamond') { ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); }
  else ctx.roundRect(x - s * 0.8, y - s * 0.8, s * 1.6, s * 1.6, 2);
}

export function CoreView({ sample, ctx, selected, onSelect, cycle }) {
  const canvas = useRef(null);
  const live = useRef({ sample, ctx, selected });
  const engine = useRef(null);
  live.current = { sample, ctx, selected };

  useEffect(() => {
    const el = canvas.current, g = el.getContext('2d');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const S = { W: 1000, H: 520, geo: null, packets: [], glow: new Map(), energy: 0, angle: 0, disp: new Map(), hover: null, last: performance.now(), raf: 0, flashes: [] };
    const resize = () => {
      const w = Math.max(900, el.parentElement.clientWidth), r = window.devicePixelRatio || 1;
      S.W = w; S.H = 520; S.geo = geometry(w, S.H);
      el.width = w * r; el.height = S.H * r; el.style.width = `${w}px`; el.style.height = `${S.H}px`; g.setTransform(r, 0, 0, r, 0, 0);
    };
    const ro = new ResizeObserver(resize); ro.observe(el.parentElement); resize();

    const edgePoint = (to, from, r) => { const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy) || 1; return { x: to.x - (dx / d) * r, y: to.y - (dy / d) * r }; };
    const spawn = p => S.packets.push({ ...p, t0: performance.now() + (p.delay || 0), dur: p.dur || 1500, bend: p.bend ?? (Math.random() - 0.5) * 70 });
    // пачки привязаны к настоящему циклу расчёта
    S.cycle = () => {
      const { geo } = S, { sample: smp, ctx: c } = live.current;
      if (!smp) return;
      SOURCES.forEach((id, k) => {
        const st = STYLE[id], value = LABEL.get(id).value(smp, c);
        if (id !== 'trains' && id !== 'clock' && !(id === 'incidents' && smp.incidents) && cycleNo % 4 !== k % 4) return;
        spawn({ kind: 'in', id, from: geo.pos.get(id), to: edgePoint(geo.core, geo.pos.get(id), geo.core.r + 3), style: st, size: id === 'trains' ? 6 : 5, delay: k * 35, dur: 1250 + (k % 3) * 160, label: id === 'clock' ? null : fmt(value) });
      });
      OUTPUTS.forEach((id, k) => spawn({ kind: 'out', id, from: edgePoint(geo.pos.get(id), geo.core, -geo.core.r - 3), to: geo.pos.get(id), style: { color: OUT_COLOR, shape: 'square' }, size: 5, delay: 220 + k * 45, dur: 1100, label: null }));
      cycleNo++;
    };
    let cycleNo = 0;
    S.event = e => {
      const { geo } = S, tone = DECISION[e.kind]?.tone || 'neutral', color = TONE_COLOR[tone];
      spawn({ kind: 'in', id: 'timetable', from: geo.pos.get('timetable'), to: edgePoint(geo.core, geo.pos.get('timetable'), geo.core.r + 3), style: { color, shape: 'diamond' }, size: 7, dur: 1300, label: DECISION[e.kind]?.label, tag: true });
      spawn({ kind: 'out', id: 'journal', from: edgePoint(geo.pos.get('journal'), geo.core, -geo.core.r - 3), to: geo.pos.get('journal'), style: { color, shape: 'diamond' }, size: 7, delay: 650, dur: 1200, label: DECISION[e.kind]?.label, tag: true });
    };
    engine.current = S;

    const curve = (a, b, bend, u) => { const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + bend, x = (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * mx + u * u * b.x, y = (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * my + u * u * b.y; return { x, y }; };
    const faint = (a, b, sel) => { g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2, b.x, b.y); g.strokeStyle = sel ? 'rgba(0,122,165,.35)' : 'rgba(0,122,165,.10)'; g.lineWidth = sel ? 2 : 1; g.stroke(); };

    const frame = now => {
      const dt = Math.min(0.1, (now - S.last) / 1000); S.last = now;
      const { sample: smp, ctx: c, selected: sel } = live.current, { geo, W, H } = S;
      g.clearRect(0, 0, W, H);
      // фон: слабая сетка
      g.strokeStyle = 'rgba(11,42,60,.045)'; g.lineWidth = 1;
      for (let x = 0; x < W; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (let y = 0; y < H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      const related = sel ? new Set([sel, ...(FEEDS[sel] || []), ...(DRAINS[sel] || []), ...SOURCES.filter(s => (FEEDS[s] || []).includes(sel)), ...OUTPUTS.filter(o => (DRAINS[o] || []).includes(sel))]) : null;
      SOURCES.forEach(id => faint(geo.pos.get(id), geo.core, sel === id));
      OUTPUTS.forEach(id => faint(geo.core, geo.pos.get(id), sel === id));
      // орбита и ядро
      S.angle += dt * (0.5 + S.energy * 2.6); S.energy *= Math.exp(-dt * 2.4);
      g.strokeStyle = 'rgba(11,42,60,.12)'; g.setLineDash([3, 6]); g.beginPath(); g.arc(geo.core.x, geo.core.y, 128, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      const e = Math.min(1, S.energy / 3);
      for (let i = 0; i < 3; i++) {
        g.beginPath(); g.arc(geo.core.x, geo.core.y, geo.core.r + 8 + i * 9, S.angle * (i % 2 ? -1 : 1) + i, S.angle * (i % 2 ? -1 : 1) + i + 1.7 + e); g.strokeStyle = `rgba(0,122,165,${0.35 + e * 0.5 - i * 0.08})`; g.lineWidth = 3 - i * 0.6; g.stroke();
      }
      const grad = g.createRadialGradient(geo.core.x, geo.core.y, 4, geo.core.x, geo.core.y, geo.core.r + 6 + e * 8);
      grad.addColorStop(0, `rgba(0,169,216,${0.75 + e * 0.25})`); grad.addColorStop(1, 'rgba(11,42,60,.95)');
      g.beginPath(); g.arc(geo.core.x, geo.core.y, geo.core.r + e * 4, 0, Math.PI * 2); g.fillStyle = grad; g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '700 11px Inter, system-ui, sans-serif'; g.fillText('ЯДРО', geo.core.x, geo.core.y - 6);
      g.font = '600 13px Inter, system-ui, sans-serif'; g.fillText(smp ? `${smp.ms.toFixed(1)} мс` : '…', geo.core.x, geo.core.y + 11);
      // узлы орбиты
      for (const id of ORBIT) {
        const p = geo.orbit.get(id), glow = S.glow.get(id) || 0, dim = related && !related.has(id);
        g.globalAlpha = dim ? 0.3 : 1;
        g.beginPath(); g.arc(p.x, p.y, 8 + glow * 6, 0, Math.PI * 2); g.fillStyle = `rgba(0,122,165,${0.2 + glow * 0.6})`; g.fill();
        g.beginPath(); g.arc(p.x, p.y, 6, 0, Math.PI * 2); g.fillStyle = sel === id ? '#0b2a3c' : '#1f6fa3'; g.fill();
        g.fillStyle = '#26333c'; g.font = '600 11px Inter, system-ui, sans-serif'; g.textAlign = Math.cos(p.a) > 0.3 ? 'left' : Math.cos(p.a) < -0.3 ? 'right' : 'center';
        const off = Math.cos(p.a) > 0.3 ? 14 : Math.cos(p.a) < -0.3 ? -14 : 0, oy = Math.abs(Math.cos(p.a)) <= 0.3 ? (Math.sin(p.a) < 0 ? -16 : 24) : 4;
        g.fillText(LABEL.get(id).label, p.x + off, p.y + oy); g.globalAlpha = 1;
        S.glow.set(id, glow * Math.exp(-dt * 3));
      }
      // пачки данных
      S.packets = S.packets.filter(p => {
        const u = (now - p.t0) / p.dur;
        if (u < 0) return true;
        if (u >= 1) {
          if (p.kind === 'in') { S.energy = Math.min(4, S.energy + 0.5); for (const o of FEEDS[p.id] || []) S.glow.set(o, 1); if (p.tag) S.flashes.push({ x: geo.core.x, y: geo.core.y, t: now }); }
          else for (const o of DRAINS[p.id] || []) S.glow.set(o, Math.max(S.glow.get(o) || 0, 0.7));
          S.flashes.push({ x: p.to.x, y: p.to.y, t: now, color: p.style.color });
          return false;
        }
        const pt = curve(p.from, p.to, p.bend, ease(u)), dimmed = related && !related.has(p.id);
        g.globalAlpha = (dimmed ? 0.18 : 1) * Math.min(1, u * 6, (1 - u) * 6 + 0.25);
        g.fillStyle = p.style.color; g.shadowColor = p.style.color; g.shadowBlur = 8; shapePath(g, p.style.shape, pt.x, pt.y, p.size); g.fill(); g.shadowBlur = 0;
        if (p.label && (p.tag || sel === p.id)) { g.fillStyle = '#0b2a3c'; g.font = '600 10px Inter, system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(p.label, pt.x + p.size + 4, pt.y + 3); }
        g.globalAlpha = 1; return true;
      });
      S.flashes = S.flashes.filter(f => now - f.t < 420);
      for (const f of S.flashes) { const k = (now - f.t) / 420; g.beginPath(); g.arc(f.x, f.y, 10 + k * 22, 0, Math.PI * 2); g.strokeStyle = f.color || 'rgba(0,169,216,1)'; g.globalAlpha = (1 - k) * 0.5; g.lineWidth = 2; g.stroke(); g.globalAlpha = 1; }
      // источники и выходы
      for (const id of [...SOURCES, ...OUTPUTS]) {
        const p = geo.pos.get(id), isSrc = SOURCES.includes(id), st = isSrc ? STYLE[id] : { color: OUT_COLOR, shape: 'square' }, dim = related && !related.has(id);
        const target = smp ? LABEL.get(id).value(smp, c) : 0;
        if (typeof target === 'number') S.disp.set(id, (S.disp.get(id) ?? target) + (target - (S.disp.get(id) ?? target)) * Math.min(1, dt * 7));
        const shown = id === 'clock' ? c.clock : `${fmt(S.disp.get(id) ?? 0)} ${LABEL.get(id).unit}`;
        g.globalAlpha = dim ? 0.3 : 1;
        g.beginPath(); g.arc(p.x, p.y, 14, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = sel === id || S.hover === id ? 3 : 2; g.strokeStyle = st.color; g.stroke();
        g.fillStyle = st.color; shapePath(g, st.shape, p.x, p.y, 6); g.fill();
        g.fillStyle = '#26333c'; g.font = '600 12px Inter, system-ui, sans-serif'; g.textAlign = isSrc ? 'right' : 'left';
        g.fillText(LABEL.get(id).label, p.x + (isSrc ? -22 : 22), p.y - 2);
        g.fillStyle = '#6a7d89'; g.font = '11px Inter, system-ui, sans-serif'; g.fillText(shown, p.x + (isSrc ? -22 : 22), p.y + 12); g.globalAlpha = 1;
      }
      g.fillStyle = 'rgba(11,42,60,.5)'; g.font = '700 11px Inter, system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText('ДАННЫЕ НА ВХОДЕ', 215, 28); g.fillText('РАСЧЁТ В ЯДРЕ', geo.core.x, 28); g.fillText('РЕЗУЛЬТАТ', W - 215, 28);
      S.raf = requestAnimationFrame(frame);
    };
    if (reduce) { S.raf = 0; frame(performance.now()); } else S.raf = requestAnimationFrame(frame);

    const hit = e => { const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; const all = [...SOURCES, ...OUTPUTS].map(id => [id, S.geo.pos.get(id)]).concat(ORBIT.map(id => [id, S.geo.orbit.get(id)])); return all.find(([, p]) => Math.hypot(p.x - x, p.y - y) < 17)?.[0] || null; };
    const move = e => { S.hover = hit(e); el.style.cursor = S.hover ? 'pointer' : 'default'; };
    const click = e => { const id = hit(e); if (id) onSelectRef.current(live.current.selected === id ? null : id); };
    el.addEventListener('pointermove', move); el.addEventListener('click', click);
    return () => { cancelAnimationFrame(S.raf); ro.disconnect(); el.removeEventListener('pointermove', move); el.removeEventListener('click', click); engine.current = null; };
  }, []);
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;

  // каждый настоящий цикл расчёта и каждое новое решение запускают свои пачки
  useEffect(() => {
    const S = engine.current; if (!S || !sample) return;
    S.cycle();
    for (const e of sample.fresh || []) S.event(e);
  }, [cycle]);

  return html`<div class="core-view"><canvas ref=${canvas} role="img" aria-label="Ядро модели: блоки данных летят от источников к ядру, результат разлетается по выходам. Нажмите на узел, чтобы увидеть его описание"></canvas></div>`;
}
