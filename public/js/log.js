import { useEffect, useMemo, useState } from 'preact/hooks';
import { html, Icon, time, dateShort } from './lib.js';
import { useLiveNow } from './store.js';
import { PageHeader, Tabs, Empty, Segmented, Button, Badge } from './ui.js';
import { useSim } from './network-data.js';
import { networkEvents } from './network-sim.js';
import { RouteSelect } from './network-lists.js';

const PAGE = 120;
export const KINDS = [{ value: 'all', label: 'Все' }, { value: 'send', label: 'Отправлено' }, { value: 'accept', label: 'Принято' }, { value: 'crew', label: 'Смена бригады' }, { value: 'yield', label: 'Пропуск' },
  { value: 'hold', label: 'Задержка' }, { value: 'repair', label: 'Неисправность' }, { value: 'resolved', label: 'Решено' }];
export const DECISION = {
  send: { label: 'Отправлен', icon: 'navigation', tone: 'accent' }, accept: { label: 'Принят', icon: 'check-check', tone: 'neutral' }, crew: { label: 'Смена бригады', icon: 'user-round', tone: 'ink' },
  yield: { label: 'Пропуск', icon: 'shuffle', tone: 'ink' }, hold: { label: 'Задержка', icon: 'octagon-alert', tone: 'danger' }, repair: { label: 'Неисправность', icon: 'wrench', tone: 'danger' },
  resolved: { label: 'Решено', icon: 'badge-check', tone: 'accent' }, section: { label: 'Участок', icon: 'train-front', tone: 'muted' },
};
const WINDOWS = [{ value: 60, label: '1 час' }, { value: 180, label: '3 часа' }, { value: 360, label: '6 часов' }, { value: 720, label: '12 часов' }, { value: 1440, label: 'Сутки' }];

/** Живая лента решений и событий: сеть и участок, фильтры по типу, участку, периоду. */
export function EventFeed({ data, onCount }) {
  const [scope, setScope] = useState('all');
  const [kind, setKind] = useState('all');
  const [route, setRoute] = useState('all');
  const [query, setQuery] = useState('');
  const [windowMin, setWindowMin] = useState(360);
  const [limit, setLimit] = useState(PAGE);
  const sim = useSim();
  const now = useLiveNow(1 / 5);
  const slot = Math.floor(now / 5000);
  const net = useMemo(() => (sim && !sim.error ? networkEvents(sim, now, windowMin) : []), [sim, slot, windowMin]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const section = data.log.filter(e => e.at >= now - windowMin * 60000).map(e => ({ at: e.at, kind: 'section', text: e.text, route: 'Караганда — Мойынты', scope: 'section' }));
    const network = net.map(e => ({ ...e, scope: 'network' }));
    return [...(scope === 'network' ? [] : section), ...(scope === 'section' ? [] : network)]
      .filter(e => (kind === 'all' || e.kind === kind) && (route === 'all' || e.routeId === route) && (!q || `${e.text} ${e.route || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => b.at - a.at);
  }, [net, data.log, scope, kind, route, query, windowMin, slot]);
  useEffect(() => { onCount?.(rows.length); }, [rows.length]);
  const reset = fn => v => { fn(v); setLimit(PAGE); };
  return html`
    <div class="toolbar">
      <label class="search"><${Icon} name="search" size=${16} /><span class="sr-only">Поиск по журналу</span>
        <input type="search" placeholder="Город, станция, номер поезда" value=${query} onInput=${e => reset(setQuery)(e.target.value)} /></label>
      <label class="filter-select"><span class="sr-only">Период</span><select value=${windowMin} onChange=${e => reset(setWindowMin)(Number(e.target.value))} aria-label="Период">
        ${WINDOWS.map(w => html`<option key=${w.value} value=${w.value}>За ${w.label.toLowerCase()}</option>`)}</select></label>
    </div>
    <div class="filter-row">
      <${Segmented} label="Источник" value=${scope} onChange=${reset(setScope)} options=${[{ value: 'all', label: 'Сеть и участок' }, { value: 'network', label: 'Сеть' }, { value: 'section', label: 'Участок' }]} />
      <${Segmented} label="Тип решения" value=${kind} onChange=${reset(setKind)} options=${KINDS} />
      <${RouteSelect} sim=${sim} value=${route} onChange=${reset(setRoute)} />
    </div>
    ${rows.length ? html`<ol class="timeline">${rows.slice(0, limit).map((e, i) => html`<li key=${`${e.uid || 's'}${e.kind}${e.at}${i}`}><time>${time(e.at)}<small>${dateShort(e.at)}</small></time>
      <p><${Badge} tone=${DECISION[e.kind].tone} icon=${DECISION[e.kind].icon}>${DECISION[e.kind].label}</${Badge}> ${e.text}${e.route && e.scope === 'network' ? html` <small class="muted">· ${e.route}</small>` : ''}</p></li>`)}</ol>
      <div class="table-foot">Показано ${Math.min(limit, rows.length)} из ${rows.length.toLocaleString('ru-RU')} · обновляется каждые 5 секунд
        ${rows.length > limit && html`<${Button} size="sm" onClick=${() => setLimit(limit + PAGE)}>Показать ещё</${Button}>`}</div>`
      : html`<${Empty} icon="search" title="Записей нет">Измените период или фильтры.</${Empty}>`}`;
}

export function LogPage({ data }) {
  const [tab, setTab] = useState('events');
  const [total, setTotal] = useState(0);
  return html`<${PageHeader} title="Журнал" subtitle="В реальном времени: отправления, приёмы, смены бригад, пропуск поездов, задержки, неисправности и их решение по всей сети" />
    <section class="panel">
      <${Tabs} label="Журнал" value=${tab} idPrefix="lg" onChange=${setTab}
        tabs=${[{ value: 'events', label: 'События и решения', count: total > 999 ? '999+' : total || null }, { value: 'notices', label: 'Уведомления пассажирам', count: data.notifications.length }]} />
      <div id="lg-panel" role="tabpanel" aria-labelledby=${`lg-${tab}`} class="tab-panel">
        ${tab === 'events' ? html`<${EventFeed} data=${data} onCount=${setTotal} />`
          : data.notifications.length ? html`<ol class="timeline">${data.notifications.map((n, i) => html`<li key=${i}><time>${time(n.at)}<small>${dateShort(n.at)}</small></time>
              <p><${Icon} name=${n.delay > 0 ? 'bell-ring' : 'circle-check'} size=${15} class="inline" /> ${n.text}</p></li>`)}</ol>`
          : html`<${Empty} icon="bell" title="Уведомлений пока нет">Они появляются, когда прогноз опоздания пассажирского поезда меняется на 5 минут и больше.</${Empty}>`}
      </div>
    </section>`;
}
