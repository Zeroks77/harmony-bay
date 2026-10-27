// =========================================
// LAGEPLAN (Karte mit Pins, Zoom & Pin-Arten)
// =========================================
let globalPins = [];
const PIN_TYPES = {
    ort: { label: 'Ort', color: '#e53935' },
    tatort: { label: 'Tatort', color: '#212121' },
    hinweis: { label: 'Hinweis', color: '#fdd835' },
    sichtung: { label: 'Sichtung', color: '#1e88e5' },
    gefahr: { label: 'Gefahr', color: '#8e24aa' },
    sicher: { label: 'Sicherer Ort', color: '#43a047' }
};
let mapZoom = 1; // 1 = Kartenbreite passt genau in den Ausschnitt
let hiddenPinTypes = loadPref('hb-hidden-pin-types', []);

function initKarte() {
    renderMapLegend();
    db.ref('pins').on('value', snap => {
        globalPins = Object.values(snap.val() || {});
        renderPins(); renderChronPinSelect(); renderChronicle(); renderBoard();
    });
    attachZoomGestures(document.getElementById('map-viewport'), () => mapZoom, setMapZoom);
    document.getElementById('map-image').addEventListener('load', updateMapSize);
    window.addEventListener('resize', () => { if (document.getElementById('tab-karte').classList.contains('active-tab')) updateMapSize(); });
}

function pinType(pin) { return PIN_TYPES[pin.type] || PIN_TYPES.ort; }
function pinTypeItems(action) { return Object.entries(PIN_TYPES).map(([key, t]) => ({ label: t.label, swatch: t.color, action: () => action(key) })); }

function addPin(e) {
    if (e.target.closest('.map-pin')) return;
    const rect = document.getElementById('map-container').getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100, y = ((e.clientY - rect.top) / rect.height) * 100;
    showMenu(e.clientX, e.clientY, 'Neuer Pin – welche Art?', pinTypeItems(type => {
        const note = prompt("Information anpinnen:");
        if (note && note.trim() !== "") { const id = Date.now(); db.ref('pins/' + id).set({ id, x, y, note: note.trim(), type }); }
    }));
}

function renderPins() {
    const container = document.getElementById('map-container');
    container.querySelectorAll('.map-pin').forEach(p => p.remove());
    globalPins.filter(pin => !hiddenPinTypes.includes(pin.type || 'ort')).forEach(pinData => {
        const p = document.createElement('div'); p.className = 'map-pin'; p.id = 'pin-' + pinData.id;
        p.style.left = pinData.x + '%'; p.style.top = pinData.y + '%'; p.style.backgroundColor = pinType(pinData).color;
        p.onclick = e => { e.stopPropagation(); openPinMenu(pinData, e); };
        p.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); openPinMenu(pinData, e); };
        const tooltip = document.createElement('div'); tooltip.className = 'pin-tooltip'; tooltip.innerText = pinData.note; p.appendChild(tooltip);
        container.appendChild(p);
    });
}

function openPinMenu(pin, e) {
    const events = globalChronicle.filter(item => chronPin(item) === pin).length;
    const items = [
        { label: '✎ Text bearbeiten', action: () => { const n = prompt("Information bearbeiten:", pin.note); if (n && n.trim() !== "") db.ref('pins/' + pin.id).update({ note: n.trim() }); } },
        { label: '🎨 Art ändern', action: () => showMenu(e.clientX, e.clientY, 'Art des Pins', pinTypeItems(type => db.ref('pins/' + pin.id).update({ type }))) },
        { label: '📌 An Pinnwand heften', action: () => addRefToBoard('pin', pin.id) }
    ];
    if (events > 0) items.push({ label: `🕒 ${events} Ereignis${events > 1 ? 'se' : ''} an diesem Ort`, action: () => showChronicleForPin(pin) });
    items.push({ label: '🗑 Pin löschen', danger: true, action: () => { if (confirm("Pin löschen? (Wird auch von der Pinnwand entfernt)")) db.ref().update({ ['pins/' + pin.id]: null, ...refCleanup('pin', pin.id) }); } });
    showMenu(e.clientX, e.clientY, `${pin.note} (${pinType(pin).label})`, items);
}

function renderMapLegend() {
    document.getElementById('map-legend').innerHTML = Object.entries(PIN_TYPES).map(([key, t]) =>
        `<button class="legend-chip${hiddenPinTypes.includes(key) ? ' off' : ''}" style="--c:${t.color}" onclick="togglePinType('${key}')" title="Ein-/ausblenden">${t.label}</button>`).join('');
}
function togglePinType(key) {
    hiddenPinTypes = hiddenPinTypes.includes(key) ? hiddenPinTypes.filter(k => k !== key) : [...hiddenPinTypes, key];
    savePref('hb-hidden-pin-types', hiddenPinTypes); renderMapLegend(); renderPins();
}
function toggleMapLabels(btn) { const on = document.getElementById('map-container').classList.toggle('show-labels'); btn.classList.toggle('active', on); }

// Zoom: Die Karte wird breiter gerendert, die Pins sitzen in % und wandern automatisch mit
let mapSized = false;
function mapRatio() { const img = document.getElementById('map-image'); return (img.naturalHeight || 1024) / (img.naturalWidth || 1536); }
function updateMapSize() {
    const vp = document.getElementById('map-viewport'); if (!vp.clientWidth) return; // Tab nicht sichtbar
    // Beim ersten Anzeigen die Höhe füllen (Handy hochkant), statt oben nur einen schmalen Streifen zu zeigen
    const first = !mapSized; if (first) { mapSized = true; mapZoom = Math.max(1, vp.clientHeight / (vp.clientWidth * mapRatio())); }
    const c = document.getElementById('map-container'); c.style.width = Math.round(vp.clientWidth * mapZoom) + 'px';
    document.getElementById('map-zoom-label').innerText = Math.round(mapZoom * 100) + '%';
    if (first) vp.scrollLeft = (c.offsetWidth - vp.clientWidth) / 2;
}
function setMapZoom(z, anchorX, anchorY) {
    const vp = document.getElementById('map-viewport');
    z = Math.max(0.3, Math.min(6, z));
    const ax = anchorX ?? vp.clientWidth / 2, ay = anchorY ?? vp.clientHeight / 2;
    const px = vp.scrollLeft + ax, py = vp.scrollTop + ay, ratio = z / mapZoom;
    mapZoom = z; updateMapSize();
    vp.scrollLeft = px * ratio - ax; vp.scrollTop = py * ratio - ay;
}
function zoomMap(dir) { setMapZoom(mapZoom * (dir > 0 ? 1.25 : 1 / 1.25)); }
function fitMap() {
    const vp = document.getElementById('map-viewport');
    setMapZoom(Math.min(1, vp.clientHeight / (vp.clientWidth * mapRatio())));
    vp.scrollLeft = 0; vp.scrollTop = 0;
}

function showPinOnMap(id) {
    const pin = globalPins.find(p => p.id === Number(id)); if (!pin) { showToast('Pin existiert nicht mehr'); return; }
    if (hiddenPinTypes.includes(pin.type || 'ort')) togglePinType(pin.type || 'ort');
    exitBoardFullscreen(); switchTab('tab-karte');
    setMapZoom(Math.max(mapZoom, 2.5));
    const vp = document.getElementById('map-viewport'); const c = document.getElementById('map-container');
    vp.scrollLeft = pin.x / 100 * c.offsetWidth - vp.clientWidth / 2; vp.scrollTop = pin.y / 100 * c.offsetHeight - vp.clientHeight / 2;
    const el = document.getElementById('pin-' + pin.id); if (el) { el.classList.add('pulse'); setTimeout(() => el.classList.remove('pulse'), 3200); }
}
