// Страница «Модель»: как работает расчёт прямо сейчас — данные, вычисления, результат и характеристики.
import { useMemo, useState } from 'preact/hooks';
import { html, Icon, time } from './lib.js';
import { Badge, Kpi, PageHeader, Empty } from './ui.js';
import { useSim } from './network-data.js';
import { useNetwork } from './geo-network.js';
import { NODES } from './engine-graph.js';
import { useEngine, HISTORY, CYCLES_PER_SECOND } from './engine-metrics.js';
import { CoreView } from './engine-core-view.js';
import { StreamFeed, Sparkline, Heatmap, Characteristics, fmt } from './engine-views.js';
import { DECISION } from './log.js';

const KINDS = ['send', 'accept', 'crew', 'yield', 'hold', 'repair', 'resolved'];

function Bars({ rows, unit = '' }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return html`<div class="hist">${rows.map(r => html`<div class="hist-row" key=${r.label}><span>${r.label}</span><span class="hist-bar"><i class=${`cost-bar ${r.tone === 'danger' ? 'bar-danger' : ''}`} style=${`width:${Math.max(2, r.value / max * 100)}%`}></i></span><strong class="num">${fmt(r.value)}${unit}</strong></div>`)}</div>`;
}

export function EnginePage() {
  const sim = useSim();
  const net = useNetwork();
  const { sample, samples, lines, counters, startedAt } = useEngine(sim);
  const [selected, setSelected] = useState(null);
  if (!sim) return html`<${PageHeader} title="Модель" subtitle="Загрузка маршрутов…" />`;
  if (sim.error) return html`<${PageHeader} title="Модель" /><${Empty} icon="circle-alert" title="Не удалось загрузить маршруты">Обновите страницу.</${Empty}>`;
  if (!sample) return html`<${PageHeader} title="Модель" subtitle="Первый цикл расчёта…" />`;
  const ctx = { dailyTrips: sim.services.reduce((n, s) => n + s.n, 0), clock: time(sample.now) };
  const series = key => samples.map(s => s[key]);
  const node = NODES.find(n => n.id === selected);
  const kindRows = KINDS.map(k => ({ label: DECISION[k].label, value: sample.byKind[k] || 0, tone: ['hold', 'repair'].includes(k) ? 'danger' : undefined }));
  const throughput = sample.ms > 0 ? Math.round(sample.trains / (sample.ms / 1000)) : 0;
  return html`<${PageHeader} title="Модель" subtitle="Как работает расчёт прямо сейчас: какие данные приходят, что считается и что получается. Расчёт идёт непрерывно, 4 цикла в секунду"
      actions=${html`<${Badge} tone="accent" icon="radio">цикл ${fmt(counters.cycles)} · ${time(sample.now)}</${Badge}>`} />
    <section class="kpis" aria-label="Работа модели">
      <${Kpi} label="Цикл расчёта" icon="cpu" value=${sample.ms.toFixed(1)} unit=" мс" note=${`поезда ${sample.trainsMs.toFixed(1)} · события ${sample.eventsMs.toFixed(1)} · варианты ${sample.variantsMs.toFixed(1)}`} />
      <${Kpi} label="Производительность" icon="activity" value=${fmt(throughput)} unit=" поездов/с" note=${`${fmt(sample.trains)} поездов за цикл`} />
      <${Kpi} label="Решений за час" icon="list-checks" value=${fmt(sample.eventsHour)} note=${`вынужденных ${(sample.byKind.hold || 0) + (sample.byKind.repair || 0) + (sample.byKind.yield || 0)}`} />
      <${Kpi} label="Подсказок диспетчеру" icon="lightbulb" value=${sample.recommendations} note="разбор вынужденных стоянок" />
      <${Kpi} label="События на линии" icon="siren" tone=${sample.incidents ? 'danger' : 'neutral'} value=${sample.incidents} note=${sample.incidents ? `вариантов пропуска: ${sample.variantsCount}` : 'движение по графику'} />
      <${Kpi} label="Память страницы" icon="database" value=${sample.heapMb ?? '—'} unit=${sample.heapMb ? ' МБ' : ''} note=${sample.heapMb ? 'JS-куча браузера' : 'браузер не сообщает'} />
    </section>
    <section class="panel" aria-labelledby="nn-h"><div class="panel-head"><div><h2 id="nn-h">Ядро модели в работе</h2><small>Блоки данных летят к ядру, внутри идёт расчёт, результат разлетается по выходам. Каждая пачка — настоящий цикл расчёта (4 раза в секунду) или настоящее решение из журнала. Нажмите на узел, чтобы увидеть, что он считает.</small></div></div>
      <${CoreView} sample=${sample} ctx=${ctx} selected=${selected} onSelect=${setSelected} cycle=${counters.cycles} />
      ${node ? html`<div class="nn-detail"><div><strong>${node.label}</strong><p>${node.hint}</p><code>${node.formula}</code></div>
        <div class="nn-spark"><b class="num">${node.id === 'clock' ? ctx.clock : `${fmt(node.value(sample, ctx))} ${node.unit}`}</b><${Sparkline} values=${samples.map(s => node.value(s, ctx)).filter(v => typeof v === 'number')} width=${220} height=${44} label=${`Динамика: ${node.label}`} /><small>последние ${Math.round(Math.min(HISTORY, samples.length) / CYCLES_PER_SECOND)} с</small></div></div>`
        : html`<p class="muted pad"><${Icon} name="mouse-pointer-click" size=${15} class="inline" /> Выберите узел, чтобы увидеть, что он считает и по какой формуле.</p>`}
    </section>
    <div class="engine-two">
      <section class="panel" aria-labelledby="st-h"><div class="panel-head"><div><h2 id="st-h">Поток данных</h2><small>Вход → расчёт → выход и новые решения по мере появления</small></div></div><${StreamFeed} lines=${lines} /></section>
      <section class="panel" aria-labelledby="mt-h"><div class="panel-head"><div><h2 id="mt-h">Метрики в реальном времени</h2><small>Последние ${Math.round(Math.min(HISTORY, samples.length) / CYCLES_PER_SECOND)} секунд</small></div></div>
        <div class="spark-grid">
          ${[['Время цикла, мс', 'ms', 1], ['Поездов на линии', 'trains', 0], ['Вынужденные стоянки', 'forced', 0], ['Средняя скорость, км/ч', 'avgSpeed', 0], ['Решений за час', 'eventsHour', 0], ['Бригад на пределе', 'crewSoon', 0]].map(([label, key, d]) => html`<div key=${key} class="spark-card"><span>${label}</span><strong class="num">${d ? sample[key].toFixed(d) : fmt(sample[key])}</strong><${Sparkline} values=${series(key)} width=${190} height=${40} label=${label} /></div>`)}
        </div></section>
    </div>
    <div class="engine-two">
      <section class="panel" aria-labelledby="rs-h"><div class="panel-head"><div><h2 id="rs-h">Что получается</h2><small>Результат последнего цикла</small></div></div>
        <h3>Решения за час по типам</h3><${Bars} rows=${kindRows} />
        <h3>Поезда по категориям</h3><${Bars} rows=${[{ label: 'Пассажирские', value: sample.passenger }, { label: 'Контейнерные', value: sample.container }, { label: 'Грузовые', value: sample.freight }]} />
        <h3>Состояние</h3><${Bars} rows=${[{ label: 'В пути', value: sample.moving }, { label: 'Плановая стоянка', value: sample.stopped - sample.forced }, { label: 'Вынужденная стоянка', value: sample.forced, tone: 'danger' }]} /></section>
      <section class="panel" aria-labelledby="hm-h"><div class="panel-head"><div><h2 id="hm-h">Нагрузка на ближайшие 24 часа</h2><small>Отправления по 20 самым загруженным маршрутам, время Алматы</small></div></div><${Heatmap} sim=${sim} now=${sample.now} /></section>
    </div>
    <section class="panel" aria-labelledby="ch-h"><div class="panel-head"><div><h2 id="ch-h">Характеристики модели</h2><small>Параметры, масштаб, правила и границы применимости</small></div></div>
      <${Characteristics} sim=${sim} stations=${net && !net.error ? net.net.stations.length + net.net.halts.length : 0} counters=${counters} startedAt=${startedAt} /></section>`;
}
