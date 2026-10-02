// Главная страница: вся сеть КТЖ на карте Казахстана в реальном времени.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html, Icon, time, dateLong, duration, count } from './lib.js';
import { app, act, go, updateUi, useLiveNow, liveNow, clock } from './store.js';
import { Badge, Button, Kpi, PageHeader, Segmented, Empty } from './ui.js';
import { attachNetwork, NetworkBar, useNetwork, KZ_BOUNDS } from './geo-network.js';
import { FleetSummary } from './fleet.js';
import { prepare, networkTrains, networkStats, CATEGORIES } from './network-sim.js';
import { placeTrains } from './trackmap.js';
import { coordinateAt, indexOfLocation, prepareGeometry } from './geo-position.js';
import { CORRIDOR } from '/engine/rail-corridor.js';

const COLORS = { passenger: '#007aa5', container: '#2c5770', freight: '#7a8c98' };
const FILTERS = [{ value: 'all', label: 'Все' }, { value: 'passenger', label: 'Пассажирские' }, { value: 'container', label: 'Контейнерные' }, { value: 'freight', label: 'Грузовые' }, { value: 'stopped', label: 'Стоят' }];
const GEOMETRY = prepareGeometry(CORRIDOR.segments);
const SPEEDS = [{ value: 1, label: 'Реальное' }, { value: 60, label: '×60' }, { value: 180, label: '×180' }, { value: 600, label: '×600' }];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n.toLocaleString('ru-RU');

let simLoading;
function useSim() {
  const [sim, setSim] = useState(null);
  useEffect(() => { simLoading ||= fetch('/data/kz-routes.json').then(r => r.json()).then(prepare); simLoading.then(setSim).catch(() => setSim({ error: true })); }, []);
  return sim;
}

// Поезда детальной модели участка рисуются отдельно, поэтому сетевые рядом с участком скрываем.
const corridorCells = new Set();
for (const seg of CORRIDOR.segments) for (const [lat, lon] of seg) for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) corridorCells.add(`${Math.floor(lat / 0.012) + di}:${Math.floor(lon / 0.012) + dj}`);
const inCorridor = (lat, lon) => corridorCells.has(`${Math.floor(lat / 0.012)}:${Math.floor(lon / 0.012)}`);

const matches = (t, filter) => filter === 'all' || (filter === 'stopped' ? t.stopped && !t.planned : t.category === filter);

export function NetworkPage({ data }) {
  const sim = useSim();
  const net = useNetwork();
  const now = useLiveNow(1);
  const container = useRef(null), scene = useRef(null);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [background, setBackground] = useState('loading');
  const trains = useMemo(() => (sim && !sim.error ? networkTrains(sim, now, { exclude: inCorridor }) : []), [sim, Math.floor(now / 1000)]);
  const stats = networkStats(trains);
  const shown = trains.filter(t => matches(t, filter));
  const picked = selected && trains.find(t => t.uid === selected);
  const nm = (now - data.baseTime) / 60000;
  const detailed = placeTrains(data, nm);
  const forced = trains.filter(t => t.stopped && !t.planned).sort((a, b) => b.delayMin - a.delayMin).slice(0, 7);
  const simRef = useRef(sim); simRef.current = sim;
  const trainsRef = useRef(trains); trainsRef.current = trains;
  const filterRef = useRef(filter); filterRef.current = filter;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const detailedRef = useRef(detailed); detailedRef.current = detailed;

  // карта создаётся один раз
  useEffect(() => {
    const L = window.L;
    if (!L || !container.current) { setBackground('error'); return; }
    let alive = true;
    const map = L.map(container.current, { zoomControl: true, scrollWheelZoom: true, attributionControl: true, minZoom: 4, maxZoom: 16, preferCanvas: true, zoomSnap: 0.25 });
    map.attributionControl.setPrefix(false);
    map.fitBounds(KZ_BOUNDS, { padding: [8, 8] });
    let ok = 0;
    const base = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>' });
    base.on('tileload', () => { ok++; if (alive) setBackground('ready'); });
    base.on('tileerror', () => { if (alive && !ok) setBackground('error'); });
    base.addTo(map);
    L.tileLayer('https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', { maxZoom: 19, opacity: 0.45,
      attribution: 'Railway style: <a href="https://www.openrailwaymap.org">OpenRailwayMap</a> (CC-BY-SA 2.0)' }).addTo(map);
    const network = attachNetwork(L, map);
    network.set('stations', true);
    const renderer = L.canvas({ padding: 0.3 });
    const trainLayer = L.layerGroup().addTo(map);
    const selectedRoute = L.polyline([], { color: '#bf2520', weight: 4, opacity: 0.85, interactive: false }).addTo(map);
    // участок диспетчерской модели
    CORRIDOR.segments.forEach(points => L.polyline(points, { color: '#fff', weight: 7, opacity: 0.95, interactive: false }).addTo(map));
    CORRIDOR.segments.forEach(points => L.polyline(points, { color: '#00a9d8', weight: 4, opacity: 0.95, interactive: false }).addTo(map).bindTooltip('Участок диспетчерской модели: Караганда — Мойынты'));
    const markers = new Map(), detailedMarkers = new Map();
    scene.current = { map, network, markers, flyTo: (lat, lon, z = 9) => map.flyTo([lat, lon], z, { duration: 0.8 }) };
    const sync = () => {
      if (!alive) return;
      const list = trainsRef.current.filter(t => matches(t, filterRef.current));
      const keep = new Set();
      for (const t of list) {
        keep.add(t.uid);
        const sel = selectedRef.current === t.uid;
        const style = { renderer, radius: sel ? 8 : t.category === 'passenger' ? 4.5 : 3.4, color: sel ? '#bf2520' : t.stopped && !t.planned ? '#bf2520' : '#fff',
          weight: sel ? 3 : t.stopped && !t.planned ? 2 : 1, fillColor: COLORS[t.category], fillOpacity: 0.95 };
        let m = markers.get(t.uid);
        if (!m) {
          m = L.circleMarker([t.lat, t.lon], style).addTo(trainLayer);
          m.on('click', () => { updateUi({ selectedNetTrain: t.uid }); setSelected(t.uid); });
          m.bindTooltip(() => { const x = m.netInfo; return `№${x.number} · ${esc(x.label)} · ${esc(x.route)} · ${x.stopped ? `стоит: ${esc(x.reason)}` : `${x.speedKmh} км/ч`}`; }, { direction: 'top', offset: [0, -4] });
          markers.set(t.uid, m);
        } else { m.setLatLng([t.lat, t.lon]); m.setStyle(style); }
        m.netInfo = t;
      }
      for (const [uid, m] of markers) if (!keep.has(uid)) { trainLayer.removeLayer(m); markers.delete(uid); }
      // детальная модель
      const seen = new Set();
      for (const r of detailedRef.current) {
        const number = `D${r.t.number}`; seen.add(number);
        const point = coordinateAt(GEOMETRY, indexOfLocation(r.loc));
        let m = detailedMarkers.get(number);
        const st = { radius: 6, color: '#fff', weight: 2, fillColor: '#00a9d8', fillOpacity: 1 };
        if (!m) { m = L.circleMarker(point, { ...st, renderer }).addTo(map); m.bindTooltip(`№${esc(r.t.number)} · диспетчерская модель`, { direction: 'top' }); m.on('click', () => { updateUi({ selectedTrain: r.t.number }); go('/overview'); }); detailedMarkers.set(number, m); }
        else m.setLatLng(point);
      }
      for (const [k, m] of detailedMarkers) if (!seen.has(k)) { map.removeLayer(m); detailedMarkers.delete(k); }
      const sel = trainsRef.current.find(t => t.uid === selectedRef.current);
      if (sel && simRef.current?.byId) {
        const route = simRef.current.byId.get(sel.routeId);
        selectedRoute.setLatLngs(route ? route.points.map(p => [p[0], p[1]]) : []);
      } else selectedRoute.setLatLngs([]);
    };
    scene.current.sync = sync;
    const timeout = setTimeout(() => { if (alive && !ok) setBackground('error'); }, 10000);
    return () => { alive = false; clearTimeout(timeout); network.destroy(); scene.current = null; map.remove(); };
  }, []);
  // обновление поездов на карте — раз в секунду и при смене фильтра/выбора
  useEffect(() => { scene.current?.sync?.(); }, [trains, filter, selected, detailed.length]);

  const flyToTrain = t => { setSelected(t.uid); updateUi({ selectedNetTrain: t.uid }); scene.current?.flyTo(t.lat, t.lon, 8); };
  const aheadOfReal = clock.now - Date.now() > 120_000;
  return html`<${PageHeader} title="Сеть КТЖ в реальном времени"
      subtitle=${`${fmt(stats.total + detailed.length)} поездов на сети · ${net && !net.error ? fmt(net.net.stations.length) : '…'} станций · ${sim?.routes ? sim.routes.length : '…'} магистральных маршрутов`}
      actions=${html`<${Button} icon="chart-gantt" onClick=${() => go('/overview')}>Диспетчерский участок</${Button}>`} />
    <section class="kpis net-kpis" aria-label="Сеть в цифрах">
      <${Kpi} label="Поездов на сети" icon="train-front" value=${fmt(stats.total + detailed.length)} note=${`${detailed.length} в детальной модели участка`} />
      <${Kpi} label="Пассажирских" icon="users" value=${stats.passenger} note=${`≈ ${fmt(Math.round(stats.passengers / 100) * 100)} пассажиров в пути`} />
      <${Kpi} label="Грузовых и контейнерных" icon="package" value=${fmt(stats.freight + stats.container)} note=${`${fmt(stats.wagons)} вагонов в пути`} />
      <${Kpi} label="Локомотивы в пути" icon="zap" value=${fmt(stats.electric + stats.diesel)} note=${`электровозов ${stats.electric}, тепловозов ${stats.diesel}`} />
      <${Kpi} label="Стоят на станциях" icon="hourglass" tone=${stats.forced > 40 ? 'danger' : 'neutral'} value=${fmt(stats.stopped)} note=${`из них вынужденно ${stats.forced}`} />
      <${Kpi} label="Средняя скорость" icon="gauge" value=${stats.avgSpeed} unit="км/ч" note=${`${stats.delayed} с задержкой от 15 мин`} />
    </section>
    <section class="panel net-panel" aria-labelledby="netmap-title">
      <div class="panel-head"><div><h2 id="netmap-title">Карта сети</h2><small>Каждая точка — поезд. Цвет — тип, красный контур — вынужденная остановка. Голубая линия — участок диспетчерской модели.</small></div>
        <div class="net-clock"><strong class="num">${time(now)}</strong><small>${dateLong(now)}</small></div></div>
      <div class="net-toolbar">
        <${Segmented} label="Показать поезда" value=${filter} options=${FILTERS} onChange=${setFilter} />
        <span class="net-count">На карте <strong>${fmt(shown.length)}</strong> из ${fmt(trains.length)}</span>
        <div class="net-time" role="group" aria-label="Время сети">
          <${Button} size="sm" variant=${clock.running ? 'secondary' : 'primary'} icon=${clock.running ? 'pause' : 'play'} onClick=${() => act({ type: 'clock', running: !clock.running })}>${clock.running ? 'Пауза' : 'Пуск'}</${Button}>
          <${Segmented} label="Скорость времени" value=${data.speed} options=${SPEEDS} onChange=${v => act({ type: 'clock', speed: v })} />
          ${aheadOfReal && html`<${Badge} tone="danger" icon="clock">время опережает реальное</${Badge}>`}</div>
      </div>
      <${NetworkBar} scene=${scene} />
      <div class="net-layout">
        <div class="net-map-wrap"><div ref=${container} class="net-map" role="region" aria-label="Карта железнодорожной сети Казахстана с поездами"></div>
          ${background === 'error' && html`<div class="geo-background-status" role="status">Фоновая карта недоступна. Станции и поезда отображаются на пустом фоне.</div>`}
          ${sim?.error && html`<div class="geo-background-status" role="alert">Не удалось загрузить маршруты сети.</div>`}</div>
        <aside class="net-aside" aria-label="Выбранный поезд и сводка">
          ${picked ? html`<div class="net-train">
              <div class="tc-head"><strong class="tc-num">№${picked.number}</strong><${Badge} tone=${picked.category === 'passenger' ? 'accent' : 'neutral'}>${picked.label}</${Badge}>
                <${Button} size="sm" variant="ghost" icon="x" onClick=${() => { setSelected(null); updateUi({ selectedNetTrain: null }); }}>Снять</${Button}></div>
              <p class="tc-status">${picked.stopped ? `Стоит ${picked.planned ? '(плановая стоянка)' : '(вынужденно)'}: ${picked.reason}. Отправление через ${picked.restMin} мин.` : `В пути со скоростью ${picked.speedKmh} км/ч, пройдено ${Math.round(picked.progress * 100)}%.`}</p>
              <div class="facts">
                <div class="fact"><${Icon} name="route" size=${16} /><span>Маршрут</span><strong>${picked.from} → ${picked.to}</strong></div>
                <div class="fact"><${Icon} name="ruler" size=${16} /><span>Пройдено</span><strong>${Math.round(picked.km)} из ${Math.round(picked.totalKm)} км</strong></div>
                <div class="fact"><${Icon} name="truck" size=${16} /><span>Локомотив</span><strong>${picked.loco.series}, ${picked.loco.type}</strong></div>
                <div class="fact"><${Icon} name="package" size=${16} /><span>${picked.category === 'passenger' ? 'Вагонов' : 'Состав'}</span><strong>${picked.wagons} ваг.${picked.cargo ? ` · ${picked.cargo}, ${picked.loaded ? 'гружёный' : 'порожний'}` : ''}</strong></div>
                <div class="fact"><${Icon} name="clock" size=${16} /><span>Прибытие</span><strong>${time(picked.arrivesMs)}${picked.extraMin ? ` · задержка до ${picked.extraMin} мин` : ''}</strong></div>
              </div>
              <${Button} icon="locate-fixed" onClick=${() => flyToTrain(picked)}>Показать на карте</${Button}></div>`
            : html`<div class="net-hint"><${Icon} name="mouse-pointer-click" size=${18} /><span>Нажмите на точку-поезд или на станцию. Колёсико мыши — масштаб, перетаскивание — сдвиг.</span></div>`}
          <section class="net-list" aria-labelledby="forced-title"><h3 id="forced-title">Вынужденные стоянки <${Badge} tone=${forced.length ? 'danger' : 'neutral'}>${stats.forced}</${Badge}></h3>
            ${forced.length ? html`<ul>${forced.map(t => html`<li key=${t.uid}><button type="button" onClick=${() => flyToTrain(t)}>
              <strong>№${t.number}</strong><span>${t.route}: ${t.reason}</span><span class="bad num">${t.delayMin} мин</span></button></li>`)}</ul>` : html`<p class="muted">Сейчас таких остановок нет.</p>`}</section>
          <${FleetSummary} data=${data} compact />
        </aside>
      </div>
    </section>
    <section class="panel net-corridor" aria-labelledby="corr-title">
      <div class="panel-head"><div><h2 id="corr-title">Диспетчерский участок Караганда — Мойынты</h2><small>336 км, 10 станций: здесь работает полная модель — конфликты, варианты пропуска, ТО, поломки.</small></div>
        <${Badge} tone=${data.blocked ? 'danger' : 'neutral'} icon=${data.blocked ? 'siren' : 'circle-check'}>${data.blocked ? 'Есть закрытие пути' : 'Движение по графику'}</${Badge}></div>
      <div class="btn-row"><${Button} variant="primary" icon="chart-gantt" onClick=${() => go('/overview')}>Открыть обстановку</${Button}><${Button} icon="scale" onClick=${() => go('/decisions')}>Решения диспетчера</${Button}><${Button} icon="map-pin" onClick=${() => go('/map')}>Карта участка</${Button}><${Button} icon="truck" onClick=${() => go('/fleet')}>Парк и сеть</${Button}></div>
    </section>`;
}
