import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { html, Icon, time, dateLong } from './lib.js';
import { app, useApp, connect, act, href, useLiveNow, clock } from './store.js';
import { Button, Dialog, Toasts } from './ui.js';
import { Overview, DecisionsPage, Trains, Stations } from './pages.js';
import { HowPage } from './how.js';
import { StationPage } from './station.js';
import { LogPage } from './log.js';

const NAV = [
  { page: 'overview', path: '/', label: 'Обстановка', icon: 'chart-gantt' },
  { page: 'decisions', path: '/decisions', label: 'Решения', icon: 'scale' },
  { page: 'trains', path: '/trains', label: 'Поезда', icon: 'train-front' },
  { page: 'stations', path: '/stations', label: 'Станции', icon: 'building-2', also: ['station'] },
  { page: 'log', path: '/log', label: 'Журнал', icon: 'list-checks' },
  { page: 'how', path: '/how', label: 'Как это работает', icon: 'book-open' },
];
const TITLES = { overview: 'Обстановка', decisions: 'Решения', trains: 'Поезда', stations: 'Станции', station: 'Станция', log: 'Журнал', how: 'Как это работает' };

function Nav({ page, onAbout, attention, mini, onMini }) {
  return html`<nav class="nav" aria-label="Основное меню">
    <a class="brand" href=${href('/')} aria-label="Автодиспетчер — на главную">
      <img src="/assets/ktz-emblem.png" alt="" width="40" height="40" />
      <span><strong>Автодиспетчер</strong><small>Поездной диспетчер · ГИД</small></span>
    </a>
    <ul>${NAV.map(n => html`<li key=${n.page}><a href=${href(n.path)} title=${n.label} class=${page === n.page || n.also?.includes(page) ? 'on' : ''}
      aria-current=${page === n.page || n.also?.includes(page) ? 'page' : undefined}><${Icon} name=${n.icon} size=${19} /><span>${n.label}</span>${n.page === 'decisions' && attention > 0 && html`<b class="nav-badge" aria-label=${`Требует решения: ${attention}`}>${attention}</b>`}</a></li>`)}</ul>
    <div class="nav-foot">
      <img class="wordmark" src="/assets/ktz-wordmark.png" alt="Қазақстан темір жолы" />
      <button type="button" class="nav-link" onClick=${onAbout} title="О системе"><${Icon} name="info" size=${18} /><span>О системе</span></button>
      <button type="button" class="nav-link nav-collapse" onClick=${onMini} aria-pressed=${mini} title=${mini ? 'Развернуть меню' : 'Свернуть меню'}><${Icon} name=${mini ? 'chevron-right' : 'chevron-left'} size=${18} /><span>Свернуть меню</span></button>
    </div>
  </nav>`;
}

function Topbar({ data, onReset }) {
  const dis = !app.online || app.busy;
  const liveMs = useLiveNow(1);
  const step = m => act({ type: 'advance', minutes: m });
  return html`<header class="topbar">
    <div class="clock" aria-label="Время модели">
      <${Icon} name="clock" size=${18} />
      <div><strong class="num">${time(liveMs)}</strong><small>${dateLong(liveMs)} · ${clock.running ? `идёт, ×${data.speed} мин/с` : 'на паузе'}</small></div>
    </div>
    <div class="btn-group" role="group" aria-label="Перемотать время вперёд">
      ${[[15, '+15 мин'], [30, '+30 мин'], [60, '+1 час']].map(([m, l]) => html`<${Button} key=${m} size="sm" variant="secondary" disabled=${dis} reason=${app.online ? 'Выполняется действие' : 'Нет соединения с сервером'} onClick=${() => step(m)}>${l}</${Button}>`)}
    </div>
    <span class=${`conn ${app.online ? 'ok' : 'off'}`} role="status"><${Icon} name=${app.online ? 'wifi' : 'wifi-off'} size=${16} />${app.online ? 'На связи' : 'Нет связи'}</span>
    <${Button} variant="ghost" size="sm" icon="rotate-ccw" label="Начать смену заново" title="Начать смену заново" onClick=${onReset} />
  </header>`;
}

function App() {
  useApp();
  const { data, route } = app;
  const [dialog, setDialog] = useState(null);
  const [mini, setMini] = useState(() => localStorage.getItem('navMini') === '1');
  const toggleMini = () => setMini(m => { localStorage.setItem('navMini', m ? '0' : '1'); return !m; });
  useEffect(() => { document.title = `${TITLES[route.page] || 'Автодиспетчер'} — Автодиспетчер КТЖ`; }, [route.page]);
  if (!data) {
    return html`<div class="boot" role="status">${app.failed ? html`<div class="boot-error"><h1>Не удалось подключиться к серверу</h1><p>Соединение восстановится автоматически. Если страница не оживает, перезапустите сервер.</p></div>` : 'Подключение к диспетчерской…'}</div>`;
  }
  const page = {
    overview: html`<${Overview} data=${data} />`,
    decisions: html`<${DecisionsPage} data=${data} />`,
    how: html`<${HowPage} />`,
    trains: html`<${Trains} data=${data} />`,
    stations: html`<${Stations} data=${data} />`,
    station: html`<${StationPage} data=${data} params=${route.params} />`,
    log: html`<${LogPage} data=${data} />`,
  }[route.page];
  return html`<div class=${`shell ${mini ? 'mini' : ''}`}>
    <${Nav} mini=${mini} onMini=${toggleMini} page=${route.page} onAbout=${() => setDialog('about')} attention=${data.blocked && !data.planApproved ? data.dispatch.conflicts.length : 0} />
    <div class="workspace">
      <${Topbar} data=${data} onReset=${() => setDialog('reset')} />
      ${!app.online && html`<div class="offline" role="alert"><${Icon} name="wifi-off" size=${18} /> Нет соединения с сервером. Действия временно недоступны — подключаемся заново…</div>`}
      <main id="main" tabindex="-1">${page}</main>
      <footer class="foot"><span>Помощник диспетчера. Решение принимает поездной диспетчер.</span><span>Учебная модель: данные условные, система не заменяет СЦБ и сертифицированные системы безопасности.</span></footer>
    </div>
    <${Toasts} />
    <${Dialog} open=${dialog === 'reset'} onClose=${() => setDialog(null)} title="Начать смену заново?"
      actions=${html`<${Button} onClick=${() => setDialog(null)}>Отмена</${Button}><${Button} variant="danger" onClick=${async () => { setDialog(null); await act({ type: 'reset' }); }}>Сбросить смену</${Button}>`}>
      <p>Все операции, резервы, ограничения и события будут сброшены. Это общее состояние для всех, кто открыл систему.</p>
    </${Dialog}>
    <${Dialog} open=${dialog === 'about'} onClose=${() => setDialog(null)} title="О системе">
      <p>Автодиспетчер помогает поездному диспетчеру в нестандартных ситуациях: закрытие пути после схода, движение по неправильному пути, ограничения скорости после ремонта.</p>
      <p>Система находит конфликты встречных поездов, считает несколько вариантов пропуска с учётом приоритетов, предлагает лучший и пересчитывает прогноз после подтверждения. Об опоздании пассажирских поездов она сообщает пассажирам.</p>
      <p><strong>Границы.</strong> Все данные условные. Интервальное регулирование, стрелочные маршруты и сигналы не моделируются; решение остаётся за диспетчером.</p>
    </${Dialog}>
  </div>`;
}

connect();
render(html`<${App} />`, document.getElementById('root'));
