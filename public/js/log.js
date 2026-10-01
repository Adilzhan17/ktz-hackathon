import { useState } from 'preact/hooks';
import { html, Icon, time, dateShort } from './lib.js';
import { PageHeader, Tabs, Empty } from './ui.js';

export function LogPage({ data }) {
  const [tab, setTab] = useState('events');
  return html`<${PageHeader} title="Журнал" subtitle="События смены и сообщения пассажирам" />
    <section class="panel">
      <${Tabs} label="Журнал" value=${tab} idPrefix="lg" onChange=${setTab}
        tabs=${[{ value: 'events', label: 'События', count: data.log.length }, { value: 'notices', label: 'Уведомления пассажирам', count: data.notifications.length }]} />
      <div id="lg-panel" role="tabpanel" aria-labelledby=${`lg-${tab}`} class="tab-panel">
        ${tab === 'events' ? html`<ol class="timeline">${data.log.map((e, i) => html`<li key=${i}><time>${time(e.at)}<small>${dateShort(e.at)}</small></time><p>${e.text}</p></li>`)}</ol>`
          : data.notifications.length ? html`<ol class="timeline">${data.notifications.map((n, i) => html`<li key=${i}><time>${time(n.at)}<small>${dateShort(n.at)}</small></time>
              <p><${Icon} name=${n.delay > 0 ? 'bell-ring' : 'circle-check'} size=${15} class="inline" /> ${n.text}</p></li>`)}</ol>`
          : html`<${Empty} icon="bell" title="Уведомлений пока нет">Они появляются, когда прогноз опоздания пассажирского поезда меняется на 5 минут и больше.</${Empty}>`}
      </div>
    </section>`;
}
