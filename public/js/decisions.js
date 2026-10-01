import { useState } from 'preact/hooks';
import { html, Icon, count, delayText, clockAt, time } from './lib.js';
import { app, act, updateUi } from './store.js';
import { Button, Badge, Empty } from './ui.js';

const SPEEDS = [25, 40, 60];

function Metric({ label, value, bad }) {
  return html`<div class=${`metric ${bad ? 'bad' : ''}`}><span>${label}</span><strong>${value}</strong></div>`;
}

function Variants({ data }) {
  const { dispatch } = data;
  const approved = data.planApproved;
  return html`<div class="variants" role="radiogroup" aria-label="Варианты пропуска поездов">
    ${dispatch.variants.map(v => {
      const on = dispatch.selected === v.id;
      return html`<label class=${`variant ${on ? 'on' : ''} ${approved ? 'locked' : ''}`} key=${v.id}>
        <input type="radio" name="variant" class="sr-only" checked=${on} disabled=${approved || app.busy || !app.online}
          onChange=${() => act({ type: 'variant', variantId: v.id })} />
        <span class="variant-head"><strong>${v.name}</strong>${v.recommended && html`<${Badge} tone="accent" icon="zap">Рекомендуется</${Badge}>`}</span>
        <span class="variant-metrics">
          <${Metric} label="Пассажирские" value=${v.metrics.passenger ? `+${v.metrics.passenger} мин` : '0'} bad=${v.metrics.passenger > 0} />
          <${Metric} label="Все поезда" value=${`+${v.metrics.total} мин`} />
          <${Metric} label="Задержано" value=${`${v.metrics.delayedTrains} из ${data.trains.length}`} />
        </span>
        <span class="variant-desc">${v.description}</span>
        ${on && html`<span class="order" aria-label="Очерёдность проследования перегона">
          <small>Очерёдность:</small>
          ${v.order.slice(0, 8).map(o => html`<span key=${o.train} class=${`chip p${o.priority}`} title=${`${o.label}, ${o.dir === 'even' ? 'чётное' : 'нечётное'} направление, ${delayText(o.delay)}`}>${o.train}</span>`)}
          ${v.order.length > 8 && html`<small>+${v.order.length - 8}</small>`}
        </span>`}
      </label>`;
    })}
  </div>`;
}

function Conflicts({ data }) {
  const list = data.dispatch.conflicts;
  return html`<details class="conflicts">
    <summary><${Icon} name="triangle-alert" size=${16} />${count(list.length, ['встречный конфликт', 'встречных конфликта', 'встречных конфликтов'])} на одном пути<${Icon} name="chevron-down" size=${15} class="chev" /></summary>
    <ul>
      ${list.slice(0, 8).map((c, i) => html`<li key=${i}>
        <button type="button" class="link" onClick=${() => updateUi({ selectedTrain: c.a.priority <= c.b.priority ? c.a.train : c.b.train })}>
          <strong>№${c.a.train}</strong> (${c.a.label}) × <strong>№${c.b.train}</strong> (${c.b.label})</button>
        <small>оба на перегоне около ${clockAt(data, Math.max(c.a.enter, c.b.enter))}</small>
      </li>`)}
      ${list.length > 8 && html`<li><small>…и ещё ${list.length - 8}. Все они учтены в расчёте вариантов.</small></li>`}
    </ul>
  </details>`;
}

function Scenarios({ data }) {
  const [segment, setSegment] = useState(String(data.dispatch.closedSegment + 1));
  const [kmh, setKmh] = useState('25');
  const segs = data.stations.slice(0, -1).map((s, i) => ({ i, label: `${s.id}–${data.stations[i + 1].id} · ${s.name} — ${data.stations[i + 1].name}` }));
  return html`<div class="scenarios">
    <h3>Ввести событие</h3>
    <${Button} variant="danger-outline" icon="siren" onClick=${() => act({ type: 'block' })}>Закрыть перегон D–E (сход)</${Button}>
    <div class="field-row">
      <label>Ограничение скорости
        <select value=${segment} onChange=${e => setSegment(e.target.value)} aria-label="Перегон">
          ${segs.map(s => html`<option key=${s.i} value=${s.i}>${s.label}</option>`)}
        </select>
      </label>
      <label>км/ч
        <select value=${kmh} onChange=${e => setKmh(e.target.value)} aria-label="Скорость, км/ч">
          ${SPEEDS.map(v => html`<option key=${v} value=${v}>${v}</option>`)}
        </select>
      </label>
      <${Button} variant="secondary" icon="gauge" onClick=${() => act({ type: 'restrict', segment: Number(segment), kmh: Number(kmh) })}>Ввести</${Button}>
    </div>
  </div>`;
}

export function DecisionPanel({ data }) {
  const { dispatch } = data;
  const incident = data.blocked;
  return html`<section class="panel decisions" aria-labelledby="dec-title">
    <div class="panel-head"><h2 id="dec-title">Решения диспетчера</h2>
      ${incident ? html`<${Badge} tone="danger" icon="siren">Инцидент</${Badge}>` : dispatch.active ? html`<${Badge} tone="accent" icon="gauge">Ограничения</${Badge}>` : html`<${Badge} icon="circle-check">Норма</${Badge}>`}
    </div>
    ${incident ? html`
      <p class="incident-line"><strong>Перегон D–E: закрыт нечётный путь.</strong> Поезда обоих направлений идут по оставшемуся, встречные не могут быть на нём одновременно. Нечётные идут по неправильному пути с ограничением скорости.</p>
      <${Conflicts} data=${data} />
      <${Variants} data=${data} />
      <p class="why"><${Icon} name="info" size=${15} /> ${dispatch.why}</p>
      ${data.planApproved ? html`<div class="approved" role="status"><${Icon} name="circle-check" size=${18} /><div><strong>План подтверждён</strong><small>Прогноз перестроен, пассажирам отправлены обновлённые времена прибытия.</small></div></div>`
        : html`<${Button} variant="primary" size="lg" icon="check" class="wide" pending=${app.busy} onClick=${() => act({ type: 'approve' })}>Подтвердить вариант</${Button}>`}
      <${Button} variant="ghost" icon="undo-2" onClick=${() => act({ type: 'block' })}>Снять закрытие</${Button}>`
    : html`
      ${!dispatch.active && html`<${Empty} icon="circle-check" title="Конфликтов нет">Движение идёт по графику. Введите событие, чтобы увидеть, как система предложит перестроить пропуск поездов.</${Empty}>`}`}
    ${data.restrictions.length > 0 && html`<div class="restrictions"><h3>Ограничения скорости</h3>
      <ul>${data.restrictions.map(r => html`<li key=${r.segment}><${Icon} name="gauge" size=${16} />
        <span><strong>${data.stations[r.segment].id}–${data.stations[r.segment + 1].id}</strong> · ${r.kmh} км/ч</span>
        <${Button} variant="ghost" size="sm" onClick=${() => act({ type: 'unrestrict', segment: r.segment })}>Снять</${Button}></li>`)}</ul></div>`}
    ${!incident && html`<${Scenarios} data=${data} />`}
  </section>`;
}

export function PassengerNotices({ data, limit = 5 }) {
  const list = data.notifications.slice(0, limit);
  return html`<section class="panel" aria-labelledby="pn-title">
    <div class="panel-head"><h2 id="pn-title">Уведомления пассажирам</h2><${Icon} name="bell" size=${18} /></div>
    ${list.length ? html`<ul class="notices">${list.map((n, i) => html`<li key=${i}>
      <${Icon} name=${n.delay > 0 ? 'bell-ring' : 'circle-check'} size=${16} />
      <div><p>${n.text}</p><small><time>${time(n.at)}</time> · отправлено в пассажирские информационные системы</small></div></li>`)}</ul>`
      : html`<${Empty} icon="bell" title="Пока без уведомлений">Когда прогноз опоздания пассажирского поезда изменится на 5 минут и больше, пассажиры получат сообщение автоматически.</${Empty}>`}
  </section>`;
}
