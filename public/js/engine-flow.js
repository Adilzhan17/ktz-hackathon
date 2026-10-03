// Граф потока данных: четыре слоя метрик, связи между ними и бегущие по связям точки. Значения узлов — живые.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html } from './lib.js';
import { STAGES, LINKS } from './engine-graph.js';
import { fmt } from './engine-widgets.js';

const W = 1000, COL = W / STAGES.length, PILL_W = 204, PILL_H = 30, ROW = 40, TOP = 78;
const ALERT = new Set(['incidents', 'conflicts', 'shorten']);

/** Положения узлов: слои слева направо, строки по центру слоя. */
function place() {
  const most = Math.max(...STAGES.map(s => s.rows.length)), map = new Map();
  STAGES.forEach((st, si) => st.rows.forEach((row, ri) => map.set(row.id, { x: COL * (si + 0.5), y: TOP + ((most - st.rows.length) * ROW) / 2 + ri * ROW, stage: si, row })));
  return { map, height: TOP + most * ROW + 10 };
}
const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function FlowGraph({ sample, ctx, selected, onSelect, cycle }) {
  const { map, height } = useMemo(place, []);
  const prev = useRef(new Map());
  const [changed, setChanged] = useState(new Set());
  // узлы, чьё значение изменилось с прошлого цикла, коротко подсвечиваются
  useEffect(() => {
    if (!sample) return;
    const next = new Map(), diff = new Set();
    for (const [id, p] of map) { const v = p.row.value(sample, ctx); next.set(id, v); if (prev.current.has(id) && prev.current.get(id) !== v) diff.add(id); }
    prev.current = next; setChanged(diff);
  }, [cycle]);
  const related = useMemo(() => {
    if (!selected) return null;
    const set = new Set([selected]);
    for (const [a, b] of LINKS) { if (a === selected) set.add(b); if (b === selected) set.add(a); }
    return set;
  }, [selected]);
  const curve = (a, b) => { const x1 = a.x + PILL_W / 2, x2 = b.x - PILL_W / 2, dx = Math.max(40, (x2 - x1) * 0.5); return `M${x1} ${a.y} C${x1 + dx} ${a.y} ${x2 - dx} ${b.y} ${x2} ${b.y}`; };
  return html`<div class="flow-wrap"><svg class="flow" viewBox=${`0 0 ${W} ${height}`} role="group" aria-label="Граф потока данных модели: вход, расчёт, оценка, результат">
    ${STAGES.map((st, i) => html`<g key=${st.id}><text x=${COL * (i + 0.5)} y="26" text-anchor="middle" class="flow-title">${st.title}</text>
      <text x=${COL * (i + 0.5)} y="46" text-anchor="middle" class="flow-sub">${sample ? st.summary(sample) : ''}</text></g>`)}
    ${LINKS.map(([a, b], i) => {
      const pa = map.get(a), pb = map.get(b), on = !related || (related.has(a) && related.has(b)), d = curve(pa, pb);
      return html`<g key=${`${a}-${b}`} class=${`flow-link ${on ? 'on' : 'dim'} ${related && on ? 'hot' : ''}`}><path d=${d} />
        <circle r="2.6" class="flow-dot"><animateMotion dur=${`${2.8 + (i % 5) * 0.5}s`} begin=${`${-((i * 0.43) % 3)}s`} repeatCount="indefinite" path=${d} /></circle></g>`;
    })}
    ${[...map].map(([id, p]) => {
      const v = sample ? p.row.value(sample, ctx) : 0, sel = selected === id, dim = related && !related.has(id), alert = ALERT.has(id) && typeof v === 'number' && v > 0;
      return html`<g key=${id} class=${`flow-node ${sel ? 'sel' : ''} ${dim ? 'dim' : ''} ${alert ? 'alert' : ''}`} transform=${`translate(${p.x - PILL_W / 2} ${p.y - PILL_H / 2})`} tabindex="0" role="button" aria-pressed=${sel}
        aria-label=${`${p.row.label}: ${fmt(v)} ${p.row.unit}`} onClick=${() => onSelect(sel ? null : id)} onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(sel ? null : id); } }}>
        <rect key=${changed.has(id) ? `c${cycle}` : 'n'} width=${PILL_W} height=${PILL_H} rx="8" class=${`flow-pill ${changed.has(id) ? 'changed' : ''}`} />
        <rect width="4" height=${PILL_H} rx="2" class="flow-bar" />
        <text x="14" y="19" class="flow-label">${trunc(p.row.label, 24)}</text>
        <text x=${PILL_W - 10} y="19" text-anchor="end" class="flow-value">${p.row.numeric === false ? ctx.clock : fmt(v)}</text></g>`;
    })}
  </svg></div>`;
}
