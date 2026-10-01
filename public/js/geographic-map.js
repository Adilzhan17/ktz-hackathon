import { useEffect, useRef, useState } from 'preact/hooks';
import { html, Icon, time, delayText } from './lib.js';
import { app, act, href, updateUi, useLiveNow, liveNow, clock } from './store.js';
import { Button, PageHeader, Badge, Segmented } from './ui.js';
import { DispatcherPanel } from './panel.js';
import { placeTrains, describeTrain } from './trackmap.js';
import { stationTraffic } from './station-metrics.js';
import { CORRIDOR } from '/engine/rail-corridor.js';
import { coordinateAt, indexOfLocation, prepareGeometry } from './geo-position.js';

// A small railway silhouette: two cars and a cab at the leading end.
// Rotate only the vehicle; the number remains upright at every track heading.
const TRAIN_SVG = `<svg class="geo-train-vehicle" viewBox="0 0 76 24" aria-hidden="true" focusable="false">
  <g class="geo-train-body" fill="currentColor" stroke="#fff" stroke-width="1.6" stroke-linejoin="round">
    <path d="M2 5h19v12H2zM25 5h19v12H25zM48 5h12V2h7l7 8v7H48z"/>
    <path d="M21 12h4m19 0h4" fill="none"/>
  </g>
  <path class="geo-train-windows" d="M6 8h4v4H6zm8 0h4v4h-4zm15 0h4v4h-4zm8 0h4v4h-4zm25-3h3l4 5h-7z" fill="#fff"/>
  <path d="M49 13h21" stroke="#fff" stroke-width="1.5"/>
  <g fill="#183444" stroke="#fff" stroke-width="1"><circle cx="7" cy="19" r="2.6"/><circle cx="17" cy="19" r="2.6"/><circle cx="30" cy="19" r="2.6"/><circle cx="40" cy="19" r="2.6"/><circle cx="54" cy="19" r="2.6"/><circle cx="68" cy="19" r="2.6"/></g>
</svg>`;
const GEOMETRY = prepareGeometry(CORRIDOR.segments);
const SPEEDS = [{ value: 1, label: 'Реальное' }, { value: 60, label: '×60' }, { value: 180, label: '×180' }, { value: 600, label: '×600' }];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function GeographicMap({ data }) {
  const container = useRef(null), scene = useRef(null), current = useRef(data);
  current.current = data;
  const [background, setBackground] = useState('loading');
  const [railway, setRailway] = useState(true);
  const [follow, setFollow] = useState(false);
  const followRef = useRef(follow); followRef.current = follow;
  const now = useLiveNow(2);
  const tMin = (now - data.baseTime) / 60000;
  const live = placeTrains(data, tMin);
  const rec = live.find(r => r.t.number === app.ui.selectedTrain);
  const selectedTrain = data.trains.find(t => t.number === app.ui.selectedTrain);
  const station = data.stations.find(s => s.id === app.ui.selectedStation);

  useEffect(() => {
    const L = window.L;
    if (!L || !container.current) { setBackground('error'); return; }
    let alive = true;
    const map = L.map(container.current, { zoomControl: true, scrollWheelZoom: false, attributionControl: true, minZoom: 5, maxZoom: 18 });
    map.attributionControl.setPrefix(false);
    const bounds = L.latLngBounds(CORRIDOR.segments.flat());
    map.fitBounds(bounds, { padding: [60, 45] });
    const base = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>' });
    let successes = 0;
    base.on('tileload', () => { successes++; if (alive) setBackground('ready'); });
    base.on('tileerror', () => { if (alive && !successes) setBackground('error'); });
    base.addTo(map);
    const rails = L.tileLayer('https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
      maxZoom: 19, opacity: .65,
      attribution: 'Railway style: <a href="https://www.openrailwaymap.org">OpenRailwayMap</a> (<a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA 2.0</a>)',
    }).addTo(map);
    // Local geometry remains available even when external tile services fail.
    map.attributionControl.addAttribution('Маршрут: <a href="https://www.openstreetmap.org/copyright">OSM / ODbL</a>');
    const lines = CORRIDOR.segments.map((points, i) => {
      L.polyline(points, { color: '#fff', weight: 8, opacity: .95, interactive: false }).addTo(map);
      return L.polyline(points, { color: '#007fa3', weight: 4, opacity: .9 }).addTo(map).bindTooltip(`${esc(CORRIDOR.stations[i].name)} — ${esc(CORRIDOR.stations[i + 1].name)}`);
    });
    const stations = CORRIDOR.stations.map((s, i) => {
      const marker = L.marker(coordinateAt(GEOMETRY, i), {
        icon: L.divIcon({ className: 'geo-station-icon', html: `<span>${esc(s.id)}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
        title: `Выбрать станцию ${s.name}`, keyboard: true,
      }).addTo(map);
      marker.bindTooltip(esc(s.name), { permanent: true, direction: i % 2 ? 'right' : 'left', className: 'geo-station-label', offset: [i % 2 ? 12 : -12, 0] });
      marker.on('click', () => { updateUi({ selectedStation: s.id, selectedTrain: null }); });
      marker.getElement().setAttribute('aria-label', `Выбрать станцию ${s.name}`);
      marker.getElement().setAttribute('role', 'button');
      marker.getElement().addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); updateUi({ selectedStation: s.id, selectedTrain: null }); } });
      return marker;
    });
    const trains = new Map();
    scene.current = { map, base, rails, bounds, stations, lines, trains };
    const observer = new ResizeObserver(() => map.invalidateSize()); observer.observe(container.current);
    let raf = 0, last = -Infinity, lastFollow = -Infinity;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const draw = ts => {
      if (ts - last >= (reduced.matches ? 500 : 100)) {
        last = ts;
        const d = current.current, t = (liveNow() - d.baseTime) / 60000;
        const records = placeTrains(d, t);
        const visible = new Set(records.map(r => r.t.number));
        for (const [number, entry] of trains) if (!visible.has(number)) { map.removeLayer(entry.marker); trains.delete(number); }
        for (const r of records) {
          const number = r.t.number, index = indexOfLocation(r.loc), point = coordinateAt(GEOMETRY, index);
          const compact = map.getZoom() < 9 && number !== app.ui.selectedTrain;
          const state = `${compact}:${r.t.category}:${r.stopped || r.broken}:${r.service}:${number === app.ui.selectedTrain}:${r.odd}`;
          let entry = trains.get(number);
          if (!entry) {
            const marker = L.marker(point, { icon: L.divIcon({ className: 'geo-train-icon', html: '', iconSize: [66, 28], iconAnchor: [33, 14] }), keyboard: true, title: `Выбрать поезд №${number}`, zIndexOffset: 500 });
            entry = { marker, state: null }; trains.set(number, entry);
            marker.on('click', () => updateUi({ selectedTrain: number, selectedStation: null }));
            marker.addTo(map);
          }
          if (entry.state !== state) {
            entry.marker.setIcon(L.divIcon({ className: 'geo-train-icon', iconSize: compact ? [44, 44] : [76, 76], iconAnchor: compact ? [22, 22] : [38, 38],
              html: `<span class="geo-train ${compact ? 'compact' : ''} ${r.t.category} ${r.stopped || r.broken ? 'stopped' : ''} ${r.service ? 'service' : ''} ${number === app.ui.selectedTrain ? 'selected' : ''}">${TRAIN_SVG}<span class="geo-train-number">${esc(number)}</span>${r.stopped || r.broken || r.service ? '<span class="geo-train-stop" aria-hidden="true"></span>' : ''}</span>` }));
            const el = entry.marker.getElement(); el.setAttribute('aria-label', `Выбрать поезд №${number}`); el.setAttribute('role', 'button');
            el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); updateUi({ selectedTrain: number, selectedStation: null }); } };
            entry.marker.unbindTooltip().bindTooltip(`№${esc(number)} · ${esc(r.t.label)}`, { direction: 'top' });
            entry.state = state;
          }
          entry.marker.setLatLng(point);
          // Sample both sides to retain the track heading at endpoints and while stopped.
          const behind = map.latLngToLayerPoint(coordinateAt(GEOMETRY, index - .003));
          const ahead = map.latLngToLayerPoint(coordinateAt(GEOMETRY, index + .003));
          const angle = Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180 / Math.PI + (r.odd ? 180 : 0);
          entry.marker.getElement().style.setProperty('--train-heading', `${angle}deg`);
          if (followRef.current && number === app.ui.selectedTrain && ts - lastFollow > 1000) { map.panTo(point, { animate: false }); lastFollow = ts; }
        }
        stations.forEach((marker, i) => {
          marker.getElement()?.classList.toggle('selected', d.stations[i]?.id === app.ui.selectedStation);
        });
        lines.forEach((line, i) => {
          const closed = d.dispatch.closures.some(c => c.segment === i && t >= c.from && (c.until == null || t < c.until));
          const limited = d.restrictions.some(r => r.segment === i && (r.from == null || t >= r.from) && (r.until == null || t < r.until));
          line.setStyle({ color: closed ? '#bf2520' : limited ? '#a96b06' : '#007fa3', dashArray: closed ? '8 7' : limited ? '3 5' : null });
        });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const timeout = setTimeout(() => { if (alive && !successes) setBackground('error'); }, 10000);
    return () => { alive = false; clearTimeout(timeout); cancelAnimationFrame(raf); observer.disconnect(); scene.current = null; map.remove(); };
  }, []);

  useEffect(() => {
    const s = scene.current; if (!s) return;
    if (railway && !s.map.hasLayer(s.rails)) s.rails.addTo(s.map);
    else if (!railway && s.map.hasLayer(s.rails)) s.map.removeLayer(s.rails);
  }, [railway]);
  const fit = () => { setFollow(false); scene.current?.map.fitBounds(scene.current.bounds, { padding: [60, 45] }); };
  const center = () => {
    if (rec) { scene.current?.map.setView(coordinateAt(GEOMETRY, indexOfLocation(rec.loc)), 12); setFollow(true); }
  };
  return html`<section class="panel geo-panel" aria-labelledby="geo-title">
    <div class="geo-toolbar">
      <div class="geo-clock"><strong>${time(now)}</strong><${Badge} tone="accent">Модельное движение</${Badge}></div>
      <div class="geo-time"><${Button} size="sm" icon=${clock.running ? 'pause' : 'play'} onClick=${() => act({ type: 'clock', running: !clock.running })} disabled=${!app.online || app.busy}>${clock.running ? 'Пауза' : 'Пуск'}</${Button}><${Segmented} label="Скорость времени на карте" value=${data.speed} options=${SPEEDS} onChange=${speed => act({ type: 'clock', speed })} /></div>
      <${Button} size="sm" icon="locate-fixed" onClick=${fit}>Весь участок</${Button}>
      <label class="geo-train-picker"><span>Поезд на карте</span><select aria-label="Выбрать поезд на карте" value=${rec?.t.number ?? ''} onChange=${e => { if (!e.target.value) return; updateUi({ selectedTrain: e.target.value, selectedStation: null }); const r = live.find(r => r.t.number === e.target.value); if (r) scene.current?.map.setView(coordinateAt(GEOMETRY, indexOfLocation(r.loc)), 11); }}><option value="">Выберите номер</option>${live.map(r => html`<option key=${r.t.number} value=${r.t.number}>№${r.t.number} · ${r.t.label}</option>`)}</select></label>
    </div>
    <div class="geo-layout">
      <div class="geo-map-wrap"><div ref=${container} class="geo-map" role="region" aria-label="Географическая карта железнодорожного участка"></div>
        ${background !== 'ready' && html`<div class="geo-background-status" role="status">${background === 'loading' ? 'Загрузка фоновой карты…' : html`Фоновая карта недоступна. Маршрут и поезда доступны. <button type="button" onClick=${() => { setBackground('loading'); scene.current?.base.redraw(); scene.current?.rails.redraw(); }}>Повторить</button>`}</div>`}
      </div>
      <aside class="geo-details" aria-label="Выбранный объект на карте">
        <h2 id="geo-title">${station ? station.name : selectedTrain ? `Поезд №${selectedTrain.number}` : 'Участок на карте'}</h2>
        ${station ? html`<${Badge}>Станция ${station.id} · ${station.type}</${Badge}><p>Грузовая работа и подъездные пути</p><dl class="geo-facts"><div><dt>На путях</dt><dd>${station.occupied} / ${station.capacity} ваг.</dd></div><div><dt>Доступно для подачи</dt><dd>${station.available} ваг.</dd></div><div><dt>Резерв</dt><dd>${station.reserved} ваг.</dd></div><div><dt>Ждут приёма</dt><dd>${stationTraffic(data, station.id, now).waiting} групп</dd></div></dl><a class="btn btn-primary" href=${href(`/station/${station.id}`)}>Грузовая работа станции</a>`
        : selectedTrain ? html`<${Badge} tone=${selectedTrain.delay ? 'danger' : 'accent'}>${selectedTrain.label}</${Badge}><p class="geo-train-status">${rec ? describeTrain(data, rec, tMin) : 'Поезд сейчас вне участка: ожидает отправления или завершил рейс.'}</p><dl class="geo-facts"><div><dt>Маршрут</dt><dd>${data.stations[selectedTrain.route[0][1]].name} → ${data.stations[selectedTrain.route.at(-1)[1]].name}</dd></div><div><dt>Вагонов</dt><dd>${selectedTrain.wagons}</dd></div><div><dt>Задержка</dt><dd>${delayText(selectedTrain.delay)}</dd></div></dl><${Button} icon="locate-fixed" disabled=${!rec} reason="Поезд сейчас вне участка" onClick=${center}>Найти поезд</${Button}><label class="geo-check"><input type="checkbox" checked=${follow} disabled=${!rec} onChange=${e => setFollow(e.target.checked)} />Следить за поездом</label>`
        : html`<p>Караганда → Мойынты</p><dl class="geo-facts"><div><dt>Станций</dt><dd>${CORRIDOR.stations.length}</dd></div><div><dt>Длина маршрута</dt><dd>${Math.round(CORRIDOR.lengthKm)} км</dd></div><div><dt>На карте сейчас</dt><dd>${live.length} поездов</dd></div></dl><p class="muted">Выберите станцию или номер поезда. Колесо прокручивает страницу; масштаб карты меняется кнопками + и −.</p>`}
        ${(station || selectedTrain) && html`<${Button} onClick=${() => document.getElementById('geo-dispatcher')?.scrollIntoView({ behavior: 'auto' })}>Команды диспетчера</${Button}><${Button} size="sm" variant="ghost" onClick=${() => { updateUi({ selectedStation: null, selectedTrain: null }); setFollow(false); }}>Снять выбор</${Button}>`}
        <label class="geo-check"><input type="checkbox" checked=${railway} onChange=${e => setRailway(e.target.checked)} />Слой OpenRailwayMap</label>
      </aside>
    </div>
    <div class="geo-legend" aria-label="Обозначения карты"><span><i class="geo-key passenger"></i>Пассажирский</span><span><i class="geo-key freight"></i>Грузовой</span><span><i class="geo-key container"></i>Контейнерный</span><span><i class="geo-key stopped"></i>Стоянка / неисправность</span><span><i class="geo-line closed"></i>Закрытие</span><span><i class="geo-line limited"></i>Ограничение скорости</span></div>
    <p class="geo-caption">Миниатюрные поезда направлены по ходу движения. Приблизьте карту, чтобы увидеть номера. География — OpenStreetMap. Расписание, движение поездов и грузовая работа — учебная модель.</p>
  </section>`;
}

export function MapPage({ data }) {
  return html`<${PageHeader} title="Карта участка" subtitle="Караганда — Мойынты · станции, движение поездов и состояние перегонов" actions=${html`<a class="btn btn-secondary" href=${href('/')}><${Icon} name="chart-gantt" size=${17} />Открыть схему и ГИД</a>`} />
    <${GeographicMap} data=${data} /><div id="geo-dispatcher"><${DispatcherPanel} data=${data} /></div>`;
}
