import { useMemo, useState } from 'preact/hooks';
import { html, Icon, time, dateShort } from './lib.js';
import { useLiveNow } from './store.js';
import { PageHeader, Tabs, Empty, Segmented, Button } from './ui.js';
import { useSim } from './network-data.js';
import { networkEvents } from './network-sim.js';
import { RouteSelect } from './network-lists.js';

const PAGE = 120;
const KINDS = [{ value: 'all', label: 'Все' }, { value: 'depart', label: 'Отправления' }, { value: 'arrive', label: 'Прибытия' }, { value: 'stop', label: 'Стоянки' }, { value: 'forced', label: 'Вынужденные' }];
const ICON = { depart: 'navigation', arrive: 'flag', stop: 'timer', forced: 'octagon-alert', resume: 'play', section: 'train-front' };
const WINDOWS = [{ value: 60, label: '1 час' }, { value: 180, label: '3 часа' }, { value: 360, label: '6 часов' }, { value: 720, label: '12 часов' }, { value: 1440, label: 'Сутки' }];

export function LogPage({ data }) {
  const [tab, setTab] = useState('events');
  const [scope, setScope] = useState('all');
  const [kind, setKind] = useState('all');
  const [route, setRoute] = useState('all');
  const [query, setQuery] = useState('');
  const [windowMin, setWindowMin] = useState(360);
  const [limit, setLimit] = useState(PAGE);
  const sim = useSim();
  const now = useLiveNow(1 / 5);
  const net = useMemo(() => (sim && !sim.error ? networkEvents(sim, now, windowMin) : []), [sim, Math.floor(now / 5000), windowMin]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const section = data.log.filter(e => e.at >= now - windowMin * 60000).map(e => ({ at: e.at, kind: 'section', text: e.text, route: 'Караганда — Мойынты', scope: 'section' }));
    const network = net.map(e => ({ ...e, scope: 'network' }));
    return [...(scope === 'network' ? [] : section), ...(scope === 'section' ? [] : network)]
      .filter(e => (kind === 'all' || (kind === 'depart' ? ['depart', 'resume'].includes(e.kind) : e.kind === kind)) && (route === 'all' || e.routeId === route)
        && (!q || `${e.text} ${e.route || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => b.at - a.at);
  }, [net, data.log, scope, kind, route, query, windowMin, Math.floor(now / 5000)]);
  const reset = fn => v => { fn(v); setLimit(PAGE); };
  const forced = net.filter(e => e.forced).length;
  return html`<${PageHeader} title="Журнал" subtitle=${`В реальном времени, обновляется каждые 5 секунд. События всей сети за выбранный период: ${net.length.toLocaleString('ru-RU')} записей на сети, из них вынужденных остановок ${forced}`} />
    <section class="panel">
      <${Tabs} label="Журнал" value=${tab} idPrefix="lg" onChange=${setTab}
        tabs=${[{ value: 'events', label: 'События', count: rows.length > 999 ? '999+' : rows.length }, { value: 'notices', label: 'Уведомления пассажирам', count: data.notifications.length }]} />
      <div id="lg-panel" role="tabpanel" aria-labelledby=${`lg-${tab}`} class="tab-panel">
        ${tab === 'events' ? html`
          <div class="toolbar">
            <label class="search"><${Icon} name="search" size=${16} /><span class="sr-only">Поиск по журналу</span>
              <input type="search" placeholder="Город, станция, номер поезда" value=${query} onInput=${e => reset(setQuery)(e.target.value)} /></label>
            <label class="filter-select"><span class="sr-only">Период</span><select value=${windowMin} onChange=${e => reset(setWindowMin)(Number(e.target.value))} aria-label="Период">
              ${WINDOWS.map(w => html`<option key=${w.value} value=${w.value}>За ${w.label.toLowerCase()}</option>`)}</select></label>
          </div>
          <div class="filter-row">
            <${Segmented} label="Источник" value=${scope} onChange=${reset(setScope)} options=${[{ value: 'all', label: 'Вся сеть и участок' }, { value: 'network', label: 'Сеть' }, { value: 'section', label: 'Участок' }]} />
            <${Segmented} label="Тип события" value=${kind} onChange=${reset(setKind)} options=${KINDS} />
            <${RouteSelect} sim=${sim} value=${route} onChange=${reset(setRoute)} />
          </div>
          ${rows.length ? html`<ol class="timeline">${rows.slice(0, limit).map((e, i) => html`<li key=${`${e.uid || 's'}${e.at}${i}`}><time>${time(e.at)}<small>${dateShort(e.at)}</small></time>
            <p><${Icon} name=${ICON[e.kind]} size=${15} class="inline" /> ${e.text}${e.route && e.scope === 'network' ? html` <small class="muted">· ${e.route}</small>` : ''}</p></li>`)}</ol>
            <div class="table-foot">Показано ${Math.min(limit, rows.length)} из ${rows.length.toLocaleString('ru-RU')}
              ${rows.length > limit && html`<${Button} size="sm" onClick=${() => setLimit(limit + PAGE)}>Показать ещё</${Button}>`}</div>`
            : html`<${Empty} icon="search" title="Записей нет">Измените период или фильтры.</${Empty}>`}`
          : data.notifications.length ? html`<ol class="timeline">${data.notifications.map((n, i) => html`<li key=${i}><time>${time(n.at)}<small>${dateShort(n.at)}</small></time>
              <p><${Icon} name=${n.delay > 0 ? 'bell-ring' : 'circle-check'} size=${15} class="inline" /> ${n.text}</p></li>`)}</ol>`
          : html`<${Empty} icon="bell" title="Уведомлений пока нет">Они появляются, когда прогноз опоздания пассажирского поезда меняется на 5 минут и больше.</${Empty}>`}
      </div>
    </section>`;
}
