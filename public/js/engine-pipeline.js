// Конвейер модели в языке схемы пути: этапы — станции, пачки данных — мини-поезда, светофоры показывают нагрузку этапа.
import { useEffect, useRef, useState } from 'preact/hooks';
import { html, Icon } from './lib.js';
import { Signal } from './track-signals.js';
import { STAGES } from './engine-graph.js';
import { Sparkline, fmt } from './engine-widgets.js';
import { DECISION } from './log.js';
import { CYCLES_PER_SECOND } from './engine-metrics.js';

const W = 1000, H = 228, RAIL_Y = 132, GAP = W / STAGES.length, CX = i => GAP * (i + 0.5);
const FILL = { data: 'var(--accent)', plan: '#2c5770', mute: '#667f90', danger: 'var(--danger)' };
const TONE_FILL = { accent: FILL.data, danger: FILL.danger, ink: FILL.plan, neutral: FILL.mute, muted: FILL.mute };
const BUDGET = { green: 30, yellow: 80 };          // мс на этап
const aspectOf = ms => (ms < BUDGET.green ? 'green' : ms < BUDGET.yellow ? 'yellow' : 'red');
const LIFE = 1900;

/** Мини-поезд из пачки данных: локомотив, вагоны по размеру пачки, номер — число записей. */
function Packet({ p }) {
  const wagons = Array.from({ length: p.wagons }, (_, w) => html`<rect key=${w} x=${-30 - 14 * (w + 1)} y="-6" width="11" height="12" rx="2.5" fill=${p.fill} class="pk-wagon"/>`);
  return html`<g class="pk" style=${`--x0:${p.x0}px;--x1:${p.x1}px;--y:${RAIL_Y}px;--dur:${p.dur}ms;--delay:${p.delay}ms`}>
    ${wagons}<path d="M-30 -9 H12 L22 0 L12 9 H-30 Z" fill=${p.fill} class="pk-body"/><text x="-4" y="3.5" text-anchor="middle" class="pk-num">${p.label}</text></g>`;
}

/** Лента этапов с бегущими пачками. Каждый настоящий цикл расчёта и каждое решение запускают свои пачки. */
export function PipelineStrip({ sample, cycle }) {
  const [packets, setPackets] = useState([]);
  const seq = useRef(0);
  useEffect(() => {
    if (!sample) return;
    const born = performance.now(), hop = (k, over) => ({ id: seq.current++, born, x0: CX(k) + 44, x1: CX(k + 1) - 74, dur: 1100, delay: k * 280, wagons: 2, fill: FILL.data, label: '', ...over });
    // положения идут каждые полсекунды, остальные этапы — раз в секунду: пачки не слипаются
    const fresh = [];
    if (cycle % 2 === 0) fresh.push(hop(0, { label: sample.trains, wagons: Math.min(4, 1 + Math.round(sample.trains / 220)), dur: 1300 }));
    if (cycle % CYCLES_PER_SECOND === 0) fresh.push(hop(1, { label: sample.queue || sample.forced, fill: FILL.plan, wagons: 1 }), hop(2, { label: sample.recommendations, fill: FILL.mute, wagons: 1 }));
    if (sample.incidents) fresh.push(hop(0, { label: sample.incidents, fill: FILL.danger, wagons: 1, delay: 140, dur: 1300 }));
    if (sample.newInputs) fresh.push(hop(0, { label: `+${sample.newInputs}`, fill: FILL.mute, wagons: 0, delay: 80, dur: 1250 }));
    (sample.fresh || []).slice(0, 3).forEach((e, i) => fresh.push(hop(2, { label: DECISION[e.kind].label.slice(0, 8), fill: TONE_FILL[DECISION[e.kind].tone], wagons: 1, delay: 560 + i * 150, x0: CX(2) + 44, x1: CX(3) - 74 })));
    setPackets(prev => [...prev.filter(p => born - p.born < LIFE), ...fresh]);
  }, [cycle]);
  return html`<div class="pipeline-wrap"><svg class="pipeline" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Конвейер модели: вход, расчёт, оценка, результат. Пачки данных движутся между этапами, светофор показывает нагрузку этапа">
    <line x1="20" x2=${W - 20} y1=${RAIL_Y} y2=${RAIL_Y} class="pl-rail"/>
    ${STAGES.slice(0, -1).map((_, k) => [0.2, 0.5, 0.8].map(f => { const x = CX(k) + (CX(k + 1) - CX(k)) * f; return html`<path key=${`${k}${f}`} d=${`M${x - 4} ${RAIL_Y - 5} L${x + 4} ${RAIL_Y} L${x - 4} ${RAIL_Y + 5}`} class="pl-chev"/>`; }))}
    ${STAGES.map((st, i) => html`<g key=${st.id} class="pl-stage">
      <text x=${CX(i)} y="24" text-anchor="middle" class="pl-title">${st.title}</text>
      <rect x=${CX(i) - 30} y="38" width="60" height="46" rx="10" class="pl-bld"/><text x=${CX(i)} y="69" text-anchor="middle" class="pl-id">${i + 1}</text>
      <path d=${`M${CX(i) - 54} ${RAIL_Y} L${CX(i) - 38} ${RAIL_Y + 22} H${CX(i) + 38} L${CX(i) + 54} ${RAIL_Y}`} class="pl-loop"/>
      <${Signal} x=${CX(i) + 66} y=${RAIL_Y - 44} trackY=${RAIL_Y - 4} aspect=${aspectOf(sample ? st.ms(sample) : 0)} label=${`${st.title}: ${sample ? st.ms(sample).toFixed(1) : 0} мс из бюджета ${BUDGET.green} мс`} />
      <text x=${CX(i)} y="188" text-anchor="middle" class="pl-value">${sample ? st.summary(sample) : '…'}</text>
      <text x=${CX(i)} y="208" text-anchor="middle" class="pl-caption">${st.caption}</text></g>`)}
    ${packets.map(p => html`<${Packet} key=${p.id} p=${p} />`)}
  </svg></div>`;
}

/** Строка метрики этапа: значение, доля времени цикла, график за минуту и раскрывающееся описание. */
export function MetricRow({ row, sample, ctx, samples, open, onToggle }) {
  const v = row.value(sample, ctx), ms = row.ms ? row.ms(sample) : null;
  const series = row.numeric === false ? [] : samples.map(s => row.value(s, ctx)).filter(x => typeof x === 'number');
  return html`<li class=${`mrow ${open ? 'open' : ''}`}>
    <button type="button" class="mrow-head" aria-expanded=${open} onClick=${onToggle}>
      <span class="mrow-label">${row.label}</span>
      <span class="mrow-value num">${fmt(v)}${row.unit ? html`<small> ${row.unit}</small>` : ''}</span>
      <span class="mrow-meta">${ms != null ? html`<span class="num" title="Время расчёта в последнем цикле">${ms.toFixed(1)} мс</span>` : ''}
        <${Sparkline} values=${series.slice(-60)} width=${96} height=${20} fill=${false} label=${`Динамика: ${row.label}`} /><${Icon} name=${open ? 'chevron-up' : 'chevron-down'} size=${14} class="mrow-chev" /></span>
    </button>
    ${open && html`<div class="mrow-detail"><p>${row.hint}</p><code>${row.formula}</code></div>`}</li>`;
}

/** Карточка этапа: заголовок, суммарное время и список метрик. */
export function StageCard({ stage, index, sample, ctx, samples, openId, onToggle }) {
  const ms = stage.ms(sample);
  return html`<section class="stage-card" aria-labelledby=${`stg-${stage.id}`}>
    <header><span class="stage-num">${index + 1}</span><div><h3 id=${`stg-${stage.id}`}>${stage.title}</h3><small>${stage.caption}</small></div>
      ${ms > 0 ? html`<span class=${`stage-ms ${aspectOf(ms)}`}><b class="num">${ms.toFixed(1)}</b> мс</span>` : ''}</header>
    <ul class="mrows">${stage.rows.map(r => html`<${MetricRow} key=${r.id} row=${r} sample=${sample} ctx=${ctx} samples=${samples} open=${openId === r.id} onToggle=${() => onToggle(openId === r.id ? null : r.id)} />`)}</ul>
  </section>`;
}
