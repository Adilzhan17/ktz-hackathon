// Решения модели: что она выбирает, по какому правилу и почему это выгоднее. По сети и по детальному участку.
import { useMemo, useState } from 'preact/hooks';
import { html, Icon, count, clockAt } from './lib.js';
import { app, go, updateUi } from './store.js';
import { Badge, Button, Empty, Kpi, PageHeader, Segmented, Tabs } from './ui.js';
import { useNetworkTrains } from './network-data.js';
import { networkDecisions } from './network-sim.js';
import { RouteSelect } from './network-lists.js';

const VERDICT = {
  justified: { label: 'Задержка оправдана', tone: 'accent', icon: 'circle-check' },
  shorten: { label: 'Можно сократить стоянку', tone: 'danger', icon: 'timer-reset' },
  technical: { label: 'Техническая причина', tone: 'neutral', icon: 'wrench' },
};
const fmt = n => n.toLocaleString('ru-RU');

function Options({ options, chosen }) {
  const max = Math.max(...options.map(o => o.cost), 1);
  return html`<table class="opt-table"><thead><tr><th scope="col">Вариант</th><th scope="col">Расчёт</th><th scope="col" class="num">Потеря</th><th scope="col"><span class="sr-only">Шкала</span></th></tr></thead>
    <tbody>${options.map(o => html`<tr key=${o.id} class=${o.id === chosen ? 'pick' : ''}><td>${o.id === chosen && html`<${Icon} name="check" size=${14} class="inline" />`} ${o.name}</td><td>${o.detail}</td>
      <td class="num"><strong>${o.cost}</strong></td><td style="width:90px"><i class="cost-bar" style=${`width:${Math.max(4, o.cost / max * 100)}%`}></i></td></tr>`)}</tbody></table>`;
}

function NetworkDecisions() {
  const { sim, trains, loading } = useNetworkTrains(5);
  const [route, setRoute] = useState('all');
  const [verdict, setVerdict] = useState('all');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(20);
  const all = useMemo(() => networkDecisions(trains), [trains]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(d => (route === 'all' || d.train.routeId === route) && (verdict === 'all' || d.verdict === verdict) && (category === 'all' || d.train.category === category)
      && (!q || `${d.train.number} ${d.station} ${d.train.route} ${d.train.reason} ${d.who?.number || ''}`.toLowerCase().includes(q)));
  }, [all, route, verdict, category, query]);
  const reset = fn => v => { fn(v); setLimit(20); };
  const count_ = v => all.filter(d => d.verdict === v).length;
  const saved = all.filter(d => d.verdict === 'shorten').reduce((n, d) => n + (d.ownCost - d.options[1].cost), 0);
  const show = d => { updateUi({ selectedNetTrain: d.train.uid }); go('/'); };
  return html`
    <section class="kpis" aria-label="Решения модели по сети">
      <${Kpi} label="Вынужденных стоянок сейчас" icon="octagon-alert" value=${fmt(all.length)} note="каждую разбирает модель" />
      <${Kpi} label="Задержка оправдана" icon="circle-check" value=${count_('justified')} note="приоритетный поезд не теряет ход" />
      <${Kpi} label="Можно сократить" icon="timer-reset" tone=${count_('shorten') ? 'danger' : 'neutral'} value=${count_('shorten')} note=${saved ? `экономия ${saved} ед. взвешенной задержки` : 'потерь сверх необходимого нет'} />
      <${Kpi} label="Технические причины" icon="wrench" value=${count_('technical')} note="смена бригады, неисправность и т. п." />
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Что решила модель и почему</h2><small>Для каждой вынужденной стоянки модель ищет поезд, ради которого она могла возникнуть, и сравнивает потери: держать этот поезд или отправить его и задержать приоритетный. Вес потери: пассажирский ×10, контейнерный ×2, грузовой ×1 (как в модели участка).</small></div></div>
      <div class="toolbar"><label class="search"><${Icon} name="search" size=${16} /><span class="sr-only">Поиск по решениям</span>
        <input type="search" placeholder="Город, станция, номер поезда, причина" value=${query} onInput=${e => reset(setQuery)(e.target.value)} /></label></div>
      <div class="filter-row">
        <${Segmented} label="Вывод модели" value=${verdict} onChange=${reset(setVerdict)} options=${[{ value: 'all', label: 'Все' }, { value: 'justified', label: 'Оправдано' }, { value: 'shorten', label: 'Сократить' }, { value: 'technical', label: 'Техническая' }]} />
        <${Segmented} label="Тип задержанного поезда" value=${category} onChange=${reset(setCategory)} options=${[{ value: 'all', label: 'Любой' }, { value: 'passenger', label: 'Пассажирский' }, { value: 'container', label: 'Контейнерный' }, { value: 'freight', label: 'Грузовой' }]} />
        <${RouteSelect} sim=${sim} value=${route} onChange=${reset(setRoute)} />
      </div>
      ${loading ? html`<p class="muted pad">Расчёт решений…</p>` : rows.length ? html`<div class="model-list">${rows.slice(0, limit).map(d => {
        const v = VERDICT[d.verdict];
        return html`<article class="model-card" key=${d.id}>
          <header><strong>№${d.train.number}</strong><${Badge} tone="muted">${d.train.label}</${Badge}><span>${d.station} · ${d.train.route}</span>
            <${Badge} tone=${v.tone} icon=${v.icon}>${v.label}</${Badge}><${Button} size="sm" variant="ghost" icon="map-pin" onClick=${() => show(d)}>На карте</${Button}></header>
          <p class="muted">Причина стоянки: ${d.train.reason}. ${d.who ? `Рядом приоритетный поезд №${d.who.number} (${d.who.label.toLowerCase()}), до него ${d.gap} км.` : ''}</p>
          <${Options} options=${d.options} chosen=${d.chosen} />
          <p class="model-why"><${Icon} name="lightbulb" size=${16} /><span><strong>Почему так:</strong> ${d.why}</span></p>
        </article>`; })}</div>
        <div class="table-foot">Показано ${Math.min(limit, rows.length)} из ${rows.length}
          ${rows.length > limit && html`<${Button} size="sm" onClick=${() => setLimit(limit + 20)}>Показать ещё</${Button}>`}</div>`
        : html`<${Empty} icon="circle-check" title="Решений по этим фильтрам нет">Сейчас нет вынужденных стоянок, подходящих под выбор.</${Empty}>`}
    </section>`;
}

function CorridorDecisions({ data }) {
  const { dispatch } = data;
  const [query, setQuery] = useState('');
  const [dir, setDir] = useState('all');
  const [station, setStation] = useState('all');
  const selected = dispatch.variants.find(v => v.id === dispatch.selected);
  const best = Math.max(...dispatch.variants.map(v => v.metrics.weighted), 1);
  const order = (selected?.order || []).filter(o => (dir === 'all' || o.dir === dir) && (!query || `${o.train} ${o.label}`.toLowerCase().includes(query.toLowerCase())));
  const segs = data.stations.slice(0, -1).map((s, i) => ({ i, label: `${s.name} — ${data.stations[i + 1].name}` }));
  const closures = dispatch.closures.filter(c => station === 'all' || c.segment === Number(station));
  return html`
    <section class="panel">
      <div class="panel-head"><div><h2>Выбор варианта пропуска на участке</h2><small>Три правила очерёдности применяются к одним и тем же закрытиям, побеждает вариант с наименьшей взвешенной задержкой (пассажирские ×10, контейнерные ×2, прочие ×1).</small></div>
        <${Button} icon="scale" onClick=${() => go('/decisions')}>Подтвердить на панели</${Button}></div>
      <div class="filter-row"><label class="filter-select"><span class="sr-only">Перегон</span><select value=${station} onChange=${e => setStation(e.target.value)} aria-label="Перегон">
        <option value="all">Все перегоны</option>${segs.map(s => html`<option key=${s.i} value=${s.i}>${s.label}</option>`)}</select></label></div>
      ${dispatch.variants.length ? html`
        <ul class="closure-list">${closures.map(c => html`<li key=${c.id}><${Icon} name="siren" size=${16} /><span><strong>${data.stations[c.segment].name} — ${data.stations[c.segment + 1].name}</strong>: закрыт ${c.track === 'both' ? 'оба пути' : c.track === 'odd' ? 'нечётный путь' : 'чётный путь'}${c.until == null ? ' до отмены' : ` до ${clockAt(data, c.until)}`}</span></li>`)}
          ${!closures.length && html`<li class="muted">На выбранном перегоне закрытий нет.</li>`}</ul>
        <table class="opt-table"><thead><tr><th scope="col">Вариант</th><th scope="col" class="num">Пассажирские, мин</th><th scope="col" class="num">Все поезда, мин</th><th scope="col" class="num">Задержано</th><th scope="col" class="num">Взвешенная</th><th scope="col"><span class="sr-only">Шкала</span></th></tr></thead>
          <tbody>${dispatch.variants.map(v => html`<tr key=${v.id} class=${v.recommended ? 'pick' : ''}>
            <td><strong>${v.name}</strong> ${v.recommended && html`<${Badge} tone="accent" icon="zap">Рекомендует модель</${Badge}>`}${dispatch.selected === v.id && html` <${Badge} icon="check">Выбран</${Badge}>`}<br /><small class="muted">${v.description}</small></td>
            <td class="num">${v.metrics.passenger}</td><td class="num">${v.metrics.total}</td><td class="num">${v.metrics.delayedTrains}</td><td class="num"><strong>${v.metrics.weighted}</strong></td>
            <td style="width:110px"><i class="cost-bar" style=${`width:${Math.max(4, v.metrics.weighted / best * 100)}%`}></i></td></tr>`)}</tbody></table>
        <p class="model-why"><${Icon} name="lightbulb" size=${16} /><span><strong>Почему выбран этот вариант:</strong> ${dispatch.why}</span></p>
        <h3>Очерёдность по выбранному варианту «${selected.name}»</h3>
        <div class="filter-row"><label class="search"><${Icon} name="search" size=${16} /><span class="sr-only">Поиск поезда в очерёдности</span>
          <input type="search" placeholder="Номер поезда" value=${query} onInput=${e => setQuery(e.target.value)} /></label>
          <${Segmented} label="Направление" value=${dir} onChange=${setDir} options=${[{ value: 'all', label: 'Оба' }, { value: 'even', label: 'Чётное' }, { value: 'odd', label: 'Нечётное' }]} /></div>
        <div class="table-wrap"><table class="table"><thead><tr><th scope="col">№ в очереди</th><th scope="col">Поезд</th><th scope="col">Приоритет</th><th scope="col">Направление</th><th scope="col" class="num">Задержка</th><th scope="col">Почему здесь</th></tr></thead>
          <tbody>${order.slice(0, 40).map((o, i) => html`<tr key=${o.train}><td>${i + 1}</td><td><strong>${o.train}</strong> ${o.label}</td><td>${o.priority === 1 ? 'пассажирский' : o.priority === 2 ? 'транзит/контейнер' : 'сборный'}</td>
            <td>${o.dir === 'even' ? 'чётное' : 'нечётное'}</td><td class=${`num ${o.delay > 0 ? 'bad' : ''}`}>${o.delay > 0 ? `+${o.delay} мин` : 'по графику'}</td>
            <td class="muted">${o.priority === 1 ? 'приоритет пассажирского: проходит первым' : o.delay > 0 ? 'уступает более приоритетным на единственном пути' : 'не мешает приоритетным поездам'}</td></tr>`)}
            ${!order.length && html`<tr><td colspan="6"><${Empty} icon="search" title="Ничего не найдено">Измените фильтры.</${Empty}></td></tr>`}</tbody></table></div>`
        : html`<${Empty} icon="circle-check" title="Закрытий путей нет">Пока нет закрытий и поломок, выбирать нечего: поезда идут по графику, очерёдность — по времени подхода. Создайте событие на панели решений, и модель сравнит три варианта пропуска.</${Empty}>
          <${Button} variant="primary" icon="construction" onClick=${() => go('/decisions')}>Ввести событие</${Button}>`}
    </section>`;
}

export function ModelPage({ data }) {
  const [scope, setScope] = useState('network');
  return html`<${PageHeader} title="Решения модели" subtitle="Что модель выбирает, по каким правилам и почему это выгоднее: по всей сети и на детальном участке"
      actions=${html`<${Button} icon="book-open" onClick=${() => go('/how')}>Как это работает</${Button}>`} />
    <${Tabs} label="Охват решений" value=${scope} idPrefix="md" onChange=${setScope}
      tabs=${[{ value: 'network', label: 'Вся сеть' }, { value: 'corridor', label: 'Участок Караганда — Мойынты' }]} />
    <div id="md-panel" role="tabpanel" aria-labelledby=${`md-${scope}`} class="tab-panel">
      ${scope === 'network' ? html`<${NetworkDecisions} />` : html`<${CorridorDecisions} data=${data} />`}
      <p class="note"><${Icon} name="info" size=${15} /> Для сети расчёт упрощённый: расписание синтетическое, положение поездов берётся из модели движения, а решения по очерёдности оценивает та же весовая схема, что и на участке. Полные варианты пропуска с подтверждением работают на участке Караганда — Мойынты.</p>
    </div>`;
}
