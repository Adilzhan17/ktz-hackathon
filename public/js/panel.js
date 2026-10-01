import { useEffect, useState } from 'preact/hooks';
import { html, Icon, clockAt, time, duration, delayText, count, PRIORITY, DIRECTION } from './lib.js';
import { app, act, go, href, updateUi, useLiveNow } from './store.js';
import { Button, Badge, Tabs, Empty, Segmented } from './ui.js';
import { placeTrains, describeTrain } from './trackmap.js';
import { Scenarios } from './decisions.js';

const HOLDS = [{ value: 5, label: '5' }, { value: 10, label: '10' }, { value: 20, label: '20' }, { value: 30, label: '30' }];
const pick = n => updateUi({ selectedTrain: app.ui.selectedTrain === n ? null : n });

/** Все задачи, требующие внимания диспетчера, по убыванию срочности. */
function buildTasks(data, nowMs) {
  const tMin = (nowMs - data.baseTime) / 60000;
  const tasks = [];
  const d = data.dispatch;
  if (data.blocked && !data.planApproved) {
    const sel = d.variants.find(v => v.id === d.selected);
    tasks.push({ id: 'approve', tone: 'danger', icon: 'siren', title: 'Подтвердите вариант пропуска',
      text: `Закрыт нечётный путь D–E, ${count(d.conflicts.length, ['конфликт', 'конфликта', 'конфликтов'])}. Выбран «${sel.name}»${sel.recommended ? ' (рекомендован)' : ''}: пассажирские +${sel.metrics.passenger} мин, всего +${sel.metrics.total} мин.`,
      actions: [{ label: 'Подтвердить', icon: 'check', variant: 'primary', run: () => act({ type: 'approve' }) }, { label: 'Варианты', icon: 'split', run: () => go('/decisions') }] });
  }
  const stopped = placeTrains(data, tMin).filter(r => r.stopped).sort((a, b) => b.waitedMin - a.waitedMin);
  for (const r of stopped) {
    const t = r.t;
    const acts = [{ label: 'Показать', icon: 'eye', variant: 'ghost', run: () => pick(t.number) }];
    if (r.held) acts.unshift({ label: 'Отпустить', icon: 'play', run: () => act({ type: 'release', train: t.number }) });
    else if (!t.overridden && t.basePriority > 1) acts.unshift({ label: 'Пропустить первым', icon: 'zap', run: () => act({ type: 'expedite', train: t.number }) });
    tasks.push({ id: `stop${t.number}`, tone: 'danger', icon: 'hourglass', title: `№${t.number} стоит на «${data.stations[r.loc.idx].name}» ${r.waitedMin} мин`,
      text: `${t.label}: ${r.reason}. Отправление по плану через ${r.restMin} мин.`, actions: acts });
  }
  for (const g of data.groups.filter(g => g.status === 'approaching' && g.etaAt <= nowMs)) {
    tasks.push({ id: `grp${g.id}`, tone: 'accent', icon: 'package', title: `Вагоны прибыли на «${data.stations.find(s => s.id === g.stationId).name}»: №${g.train}`,
      text: `${data.cargoNames[g.cargo]}, ${g.count} ваг. · остаток срока ${duration((g.deadlineAt - nowMs) / 60000)}${g.eligible ? '' : ` · ${g.reason}`}`,
      actions: [{ label: 'Принять', icon: 'check', variant: 'primary', disabled: !g.eligible, reason: g.reason, run: () => act({ type: 'accept', groupId: g.id }) },
        { label: 'Станция', icon: 'building-2', variant: 'ghost', run: () => updateUi({ selectedStation: g.stationId }) }] });
  }
  for (const g of data.groups.filter(g => g.status !== 'arrived' && g.slackMinutes < 0).slice(0, 4)) {
    tasks.push({ id: `risk${g.id}`, tone: 'danger', icon: 'calendar-clock', title: `Риск просрочки доставки: №${g.train}`,
      text: `${data.cargoNames[g.cargo]}, ${g.count} ваг. на «${data.stations.find(s => s.id === g.stationId).name}»: запас ${duration(g.slackMinutes)}.`,
      actions: [{ label: 'Станция', icon: 'building-2', run: () => updateUi({ selectedStation: g.stationId }) }] });
  }
  for (const t of data.trains.filter(t => t.category === 'passenger' && t.delay >= 5).sort((a, b) => b.delay - a.delay).slice(0, 3)) {
    tasks.push({ id: `pax${t.number}`, tone: 'neutral', icon: 'bell-ring', title: `Пассажирский №${t.number} опаздывает на ${t.delay} мин`,
      text: 'Пассажиры уведомлены автоматически о новом времени прибытия.', info: true, actions: [{ label: 'Показать', icon: 'eye', variant: 'ghost', run: () => pick(t.number) }] });
  }
  return tasks;
}

function Task({ t }) {
  return html`<li class=${`task task-${t.tone}`}>
    <span class="task-icon"><${Icon} name=${t.icon} size=${18} /></span>
    <div class="task-body"><strong>${t.title}</strong><p>${t.text}</p>
      <div class="btn-row">${t.actions.map(a => html`<${Button} key=${a.label} size="sm" variant=${a.variant || 'secondary'} icon=${a.icon} disabled=${a.disabled} reason=${a.reason} onClick=${a.run}>${a.label}</${Button}>`)}</div></div>
  </li>`;
}

function TrainTab({ data, nowMs }) {
  const [mins, setMins] = useState(10);
  const n = app.ui.selectedTrain;
  const t = n && data.trains.find(x => x.number === n);
  if (!t) return html`<${Empty} icon="mouse-pointer-click" title="Выберите поезд">Нажмите на поезд на схеме или в списке задач. Здесь появятся команды: задержать на станции, пропустить первым.</${Empty}>`;
  const tMin = (nowMs - data.baseTime) / 60000;
  const rec = placeTrains(data, tMin).find(r => r.t.number === n);
  const holds = data.holds.filter(h => h.train === n);
  const done = tMin > t.forecast.at(-1)[0] + 8;
  const noStop = tMin >= t.forecast.at(-1)[0];
  return html`<div class="train-ctl">
    <div class="tc-head"><strong class="tc-num">№${t.number}</strong><${Badge} tone=${PRIORITY[t.priority].tone}>${t.label}</${Badge}>
      ${t.overridden && html`<${Badge} tone="accent" icon="zap">пропускается первым</${Badge}>`}
      <${Badge} tone=${t.delay > 0 ? 'danger' : 'neutral'}>${delayText(t.delay)}</${Badge}></div>
    <p class="tc-status">${rec ? describeTrain(data, rec, tMin) : done ? 'Поезд прибыл и ушёл с линии.' : `Ещё не вышел: отправление в ${clockAt(data, t.forecast[0][0])} со станции «${data.stations[t.forecast[0][1]].name}».`}</p>
    <dl class="inline-dl"><div><dt>Направление</dt><dd>${DIRECTION[t.direction]}</dd></div><div><dt>Маршрут</dt><dd>${data.stations[t.route[0][1]].name} → ${data.stations[t.route.at(-1)[1]].name}</dd></div>
      <div><dt>Вагонов</dt><dd>${t.wagons}</dd></div><div><dt>Прибытие: график / прогноз</dt><dd>${clockAt(data, t.route.at(-1)[0])} / ${clockAt(data, t.forecast.at(-1)[0])}</dd></div></dl>
    <div class="tc-block"><h3>Задержать на ближайшей станции</h3>
      <div class="btn-row"><${Segmented} label="Минут" value=${mins} options=${HOLDS} onChange=${setMins} />
        <${Button} icon="hourglass" disabled=${done || noStop} reason=${done ? 'Поезд уже прибыл' : 'Дальше только конечная станция'} onClick=${() => act({ type: 'hold', train: n, minutes: mins })}>Задержать на ${mins} мин</${Button}></div>
      ${holds.length > 0 && html`<ul class="holds">${holds.map(h => html`<li key=${h.station}><${Icon} name="hourglass" size=${15} /><span>«${data.stations[h.station].name}» · ${h.minutes} мин</span></li>`)}
        <li><${Button} size="sm" variant="ghost" icon="x" onClick=${() => act({ type: 'release', train: n })}>Снять задержки</${Button}></li></ul>`}</div>
    <div class="tc-block"><h3>Очерёдность на перегонах</h3>
      ${t.overridden
        ? html`<${Button} icon="undo-2" onClick=${() => act({ type: 'restore', train: n })}>Вернуть исходный приоритет</${Button}>`
        : html`<${Button} icon="zap" disabled=${t.basePriority === 1 || done} reason=${t.basePriority === 1 ? 'Пассажирский уже идёт первым' : 'Поезд уже прибыл'} onClick=${() => act({ type: 'expedite', train: n })}>Пропустить первым</${Button}>`}
      <small>Повышает приоритет до пассажирского: при конфликте на закрытом перегоне поезд пойдёт раньше, остальные подождут.</small></div>
  </div>`;
}

function StationTab({ data, nowMs }) {
  const s = data.stations.find(x => x.id === app.ui.selectedStation);
  if (!s) return html`<${Empty} icon="building-2" title="Выберите станцию">Нажмите на станцию на схеме, чтобы увидеть подъездные пути, вагоны и группы, ожидающие приёма.</${Empty}>`;
  const groups = data.groups.filter(g => g.stationId === s.id && g.status !== 'arrived');
  return html`<div class="train-ctl">
    <div class="tc-head"><strong class="tc-num">${s.name}</strong><${Badge}>${s.type}</${Badge}><${Badge} tone="accent">${s.occupied} / ${s.capacity} ваг.</${Badge}></div>
    <ul class="st-tracks">${s.tracks.map(t => html`<li key=${t.id}><span class="st-name">${t.number}. ${t.name}<small>${data.cargoNames[t.cargo]}</small></span>
      <div class="occ-bar" role="img" aria-label=${`Занято ${t.occupied} из ${t.capacity}`}><i class="seg processing" style=${`width:${t.processing / t.capacity * 100}%`}></i><i class="seg done" style=${`width:${t.done / t.capacity * 100}%`}></i><i class="seg waiting" style=${`width:${t.waiting / t.capacity * 100}%`}></i><i class="seg reserved" style=${`width:${t.reserved / t.capacity * 100}%`}></i></div>
      <span class="num">${t.occupied}/${t.capacity}</span>
      <div class="btn-row"><${Button} size="sm" icon="check" disabled=${!t.processing} reason="Нет вагонов под грузовыми операциями" onClick=${() => act({ type: 'complete', trackId: t.id })}>Завершить</${Button}>
        <${Button} size="sm" icon="package" disabled=${!t.done} reason="Нет обработанных вагонов" onClick=${() => act({ type: 'clear', trackId: t.id })}>Убрать${t.done ? ` ${t.done}` : ''}</${Button}></div></li>`)}</ul>
    <div class="tc-block"><h3>Группы вагонов</h3>
      ${groups.length ? html`<ul class="holds big">${groups.map(g => {
        const here = g.etaAt <= nowMs;
        return html`<li key=${g.id}><span><strong>№${g.train}</strong> · ${data.cargoNames[g.cargo]}, ${g.count} ваг. · ${here ? 'прибыла' : `прибудет в ${time(g.etaAt)}`}${g.status === 'reserved' ? ' · в резерве' : ''}</span>
          <${Button} size="sm" variant=${here && g.eligible ? 'primary' : 'secondary'} icon="check" disabled=${!here || !g.eligible || g.status === 'reserved'}
            reason=${!here ? `Ещё в пути, прибытие в ${time(g.etaAt)}` : g.status === 'reserved' ? 'Уже в резерве: примите на странице станции' : g.reason} onClick=${() => act({ type: 'accept', groupId: g.id })}>Принять</${Button}></li>`;
      })}</ul>` : html`<p class="muted">Групп на подходе нет.</p>`}</div>
    <a class="link" href=${href(`/station/${s.id}`)}>Открыть страницу станции →</a>
  </div>`;
}

export function DispatcherPanel({ data }) {
  const nowMs = useLiveNow(1);
  const [tab, setTab] = useState('train');
  const tasks = buildTasks(data, nowMs);
  const urgent = tasks.filter(t => !t.info).length;
  useEffect(() => { if (app.ui.selectedTrain) setTab('train'); }, [app.ui.selectedTrain]);
  useEffect(() => { if (app.ui.selectedStation) setTab('station'); }, [app.ui.selectedStation]);
  return html`<section class="panel dispatcher" aria-labelledby="dsp-title">
    <div class="panel-head"><div><h2 id="dsp-title">Панель диспетчера</h2><small>Что требует решения, команды по поезду и станции</small></div>
      <${Badge} tone=${urgent ? 'danger' : 'neutral'} icon=${urgent ? 'siren' : 'circle-check'}>${urgent ? count(urgent, ['задача', 'задачи', 'задач']) : 'Всё по графику'}</${Badge}></div>
    <div class="dsp-grid">
      <div class="dsp-tasks"><h3>Задачи</h3>
        ${tasks.length ? html`<ul class="tasks">${tasks.map(t => html`<${Task} key=${t.id} t=${t} />`)}</ul>`
          : html`<${Empty} icon="circle-check" title="Задач нет">Движение идёт по графику. Введите событие справа или откройте «Как это работает».</${Empty}>`}</div>
      <div class="dsp-tabs"><${Tabs} label="Команды" idPrefix="dsp" value=${tab} onChange=${setTab}
          tabs=${[{ value: 'train', label: 'Поезд' }, { value: 'station', label: 'Станция' }, { value: 'events', label: 'События' }]} />
        <div id="dsp-panel" role="tabpanel" aria-labelledby=${`dsp-${tab}`} class="tab-panel">
          ${tab === 'train' ? html`<${TrainTab} data=${data} nowMs=${nowMs} />` : tab === 'station' ? html`<${StationTab} data=${data} nowMs=${nowMs} />` : html`<${Scenarios} data=${data} bare />`}
        </div></div>
    </div>
  </section>`;
}
