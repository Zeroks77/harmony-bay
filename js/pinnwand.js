// =========================================
// PINNWAND LOGIK (Echtzeit-Synchronisiert)
// =========================================
let globalPositions = {};
let globalLinks = [];
let globalBoardNotes = []; // Zettel sowie angeheftete Beweismittel/Orte ({type: 'handout'|'pin', refId})
const NOTE_COLORS = ['#fff59d', '#ffccbc', '#b3e5fc', '#c8e6c9', '#f8bbd0'];
const LINK_TYPES = {
    unklar: { label: 'Verbindung / unklar', color: '#cc0000', dash: '5,5', width: 3 },
    feind: { label: 'Feindschaft', color: '#ff1744', dash: '', width: 4 },
    verbuendet: { label: 'Verbündet', color: '#43a047', dash: '', width: 3 },
    familie: { label: 'Familie / Beziehung', color: '#ba68c8', dash: '', width: 3 },
    verdacht: { label: 'Verdacht', color: '#ffa000', dash: '12,6', width: 3 },
    geschaeft: { label: 'Geschäftlich', color: '#42a5f5', dash: '2,6', width: 3 }
};
const CELL_W = 180, CELL_H = 230, BOARD_MIN_W = 1600, BOARD_MIN_H = 1000, BOARD_PAD = 300;
let selectedNodeId = null; let linkMode = false; let currentDragElement = null; let dragState = null;
let boardZoom = loadPref('hb-board-zoom', 1); let boardW = BOARD_MIN_W; let boardH = BOARD_MIN_H;

function initPinnwand() {
    renderLinkLegend();
    db.ref('positions').on('value', snap => { globalPositions = snap.val() || {}; renderBoard(); });
    db.ref('boardNotes').on('value', snap => { globalBoardNotes = Object.values(snap.val() || {}); renderBoard(); });
    db.ref('links').on('value', snap => { const data = snap.val() || {}; globalLinks = Object.keys(data).map(key => ({...data[key], dbKey: key})); drawAllStrings(); });
    attachZoomGestures(document.getElementById('board-viewport'), () => boardZoom, setBoardZoom);
    window.addEventListener('resize', () => { if (document.getElementById('tab-pinnwand').classList.contains('active-tab')) { updateBoardSize(); drawAllStrings(); } });
}

function linkType(link) { return LINK_TYPES[link.type] || LINK_TYPES.unklar; }
function renderLinkLegend() {
    document.getElementById('link-legend').innerHTML = Object.values(LINK_TYPES).map(t =>
        `<span class="legend-line"><svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4" stroke="${t.color}" stroke-width="${t.width}" stroke-dasharray="${t.dash}"/></svg>${t.label}</span>`).join('');
}

// Sucht im Raster die erste freie Stelle, damit neue Karten nicht übereinander landen
function findFreeSpot(originX = 40, originY = 40) {
    const taken = Object.values(globalPositions);
    const vp = document.getElementById('board-viewport');
    const cols = Math.max(4, Math.floor(((vp.clientWidth || 1200) / boardZoom - 40) / CELL_W));
    for (let i = 0; i < 1000; i++) {
        const x = originX + (i % cols) * CELL_W, y = originY + Math.floor(i / cols) * CELL_H;
        if (!taken.some(p => Math.abs(p.x - x) < CELL_W - 30 && Math.abs(p.y - y) < CELL_H - 40)) return { x, y };
    }
    return { x: originX, y: originY };
}
// Freie Stelle im gerade sichtbaren Ausschnitt (falls die Pinnwand offen ist)
function findVisibleFreeSpot() {
    const vp = document.getElementById('board-viewport');
    return vp.clientWidth ? findFreeSpot(Math.round(vp.scrollLeft / boardZoom) + 40, Math.round(vp.scrollTop / boardZoom) + 40) : findFreeSpot();
}

// Alle Datenbank-Änderungen, die beim Entfernen einer Karte anfallen (Position + Fäden)
function boardNodeCleanup(id) {
    const updates = { ['positions/' + id]: null };
    globalLinks.filter(l => Number(l.start) === Number(id) || Number(l.end) === Number(id)).forEach(l => { updates['links/' + l.dbKey] = null; });
    return updates;
}
// Entfernt alle Pinnwand-Karten, die auf ein gelöschtes Beweismittel bzw. einen gelöschten Pin zeigen
function refCleanup(type, refId) {
    let updates = {};
    globalBoardNotes.filter(n => n.type === type && n.refId === refId).forEach(n => { updates = { ...updates, ['boardNotes/' + n.id]: null, ...boardNodeCleanup(n.id) }; });
    return updates;
}

function getBoardNodes() {
    const refNodes = globalBoardNotes.map(n => {
        if (n.type === 'handout') { const ref = globalHandouts.find(h => h.id === n.refId); return ref ? { id: n.id, kind: 'handout', data: n, ref } : null; }
        if (n.type === 'pin') { const ref = globalPins.find(p => p.id === n.refId); return ref ? { id: n.id, kind: 'pin', data: n, ref } : null; }
        return { id: n.id, kind: 'zettel', data: n };
    }).filter(Boolean);
    return [...globalNPCs.map(p => ({ id: p.id, kind: 'npc', data: p })), ...refNodes];
}
function nodeTitle(id) {
    const node = getBoardNodes().find(n => n.id === Number(id)); if (!node) return '?';
    return { npc: () => node.data.name, zettel: () => node.data.text, handout: () => node.ref.title, pin: () => node.ref.note }[node.kind]();
}

function renderBoard() {
    const container = document.getElementById('board-container');
    const nodes = getBoardNodes();
    nodes.forEach(node => {
        let note = document.getElementById('note-' + node.id);
        if(!note) {
            note = document.createElement('div'); note.id = 'note-' + node.id; note.dataset.id = node.id;
            note.addEventListener('pointerdown', onNotePointerDown);
            note.addEventListener('pointermove', onNotePointerMove);
            note.addEventListener('pointerup', onNotePointerUp);
            note.addEventListener('pointercancel', onNotePointerUp);
            note.oncontextmenu = function(e) { e.preventDefault(); if (dragState) dragState.cancelTap = true; handleLinkSelection(node.id, e); }; // Long-Press auf Android löst auch contextmenu aus
            container.appendChild(note);
        }
        let newHTML, cls;
        note.style.backgroundColor = ''; note.style.borderTopColor = '';
        if (node.kind === 'npc') {
            const person = node.data;
            const imageHTML = person.image && person.image.trim() !== '' ? `<img src="${esc(person.image)}" draggable="false">` : '';
            newHTML = `${imageHTML}<strong>${esc(person.name)}</strong>${person.role ? `<small>${esc(person.role)}</small>` : ''}`;
            cls = 'board-note ' + (STATUS_CLASS[person.status] || '');
        } else if (node.kind === 'handout') {
            const h = node.ref;
            const imageHTML = h.image && h.image.trim() !== '' ? `<img src="${esc(h.image)}" draggable="false">` : '';
            newHTML = `<div class="card-kind">📄 Beweismittel</div>${imageHTML}<strong>${esc(h.title)}</strong>`;
            cls = 'board-note handout-note';
        } else if (node.kind === 'pin') {
            const t = pinType(node.ref);
            newHTML = `<div class="card-kind">📍 ${t.label}</div><strong>${esc(node.ref.note)}</strong>`;
            cls = 'board-note pin-note'; note.style.borderTopColor = t.color;
        } else {
            newHTML = `<div class="zettel-text">${esc(node.data.text)}</div>`;
            cls = 'board-note zettel';
            note.style.backgroundColor = NOTE_COLORS[node.data.color || 0] || NOTE_COLORS[0];
        }
        if (note.dataset.html !== newHTML) { note.innerHTML = newHTML; note.dataset.html = newHTML; }
        note.className = cls + (note === currentDragElement ? ' dragging' : '') + (selectedNodeId === node.id ? ' selected-for-link' : '');

        if(currentDragElement !== note) {
            let pos = globalPositions[node.id];
            if (!pos) { pos = findFreeSpot(); globalPositions[node.id] = pos; } // nur lokal, wird beim ersten Verschieben gespeichert
            note.style.left = pos.x + 'px'; note.style.top = pos.y + 'px';
        }
    });
    Array.from(container.querySelectorAll('.board-note')).forEach(note => { if(!nodes.some(n => String(n.id) === note.dataset.id)) note.remove(); });
    updateBoardSize();
    drawAllStrings();
}

// Pinnwand wächst mit den Karten mit (scrollbar) statt sie abzuschneiden
function updateBoardSize() {
    const container = document.getElementById('board-container'); const vp = document.getElementById('board-viewport');
    let maxX = 0, maxY = 0;
    container.querySelectorAll('.board-note').forEach(n => { maxX = Math.max(maxX, parseFloat(n.style.left) + (n.offsetWidth || 130)); maxY = Math.max(maxY, parseFloat(n.style.top) + (n.offsetHeight || 170)); });
    boardW = Math.ceil(Math.max(BOARD_MIN_W, vp.clientWidth / boardZoom, maxX + BOARD_PAD));
    boardH = Math.ceil(Math.max(BOARD_MIN_H, vp.clientHeight / boardZoom, maxY + BOARD_PAD));
    container.style.width = boardW + 'px'; container.style.height = boardH + 'px'; container.style.transform = `scale(${boardZoom})`;
    const sizer = document.getElementById('board-sizer'); sizer.style.width = boardW * boardZoom + 'px'; sizer.style.height = boardH * boardZoom + 'px';
    document.getElementById('zoom-label').innerText = Math.round(boardZoom * 100) + '%';
}

function setBoardZoom(z, anchorX, anchorY) {
    const vp = document.getElementById('board-viewport');
    z = Math.max(0.25, Math.min(2, z));
    const ax = anchorX ?? vp.clientWidth / 2, ay = anchorY ?? vp.clientHeight / 2;
    const bx = (vp.scrollLeft + ax) / boardZoom, by = (vp.scrollTop + ay) / boardZoom;
    boardZoom = z; updateBoardSize();
    vp.scrollLeft = bx * z - ax; vp.scrollTop = by * z - ay;
    savePref('hb-board-zoom', boardZoom);
}
function zoomBoard(dir) { setBoardZoom(boardZoom * (dir > 0 ? 1.2 : 1 / 1.2)); }
function fitBoard() {
    const notes = Array.from(document.querySelectorAll('#board-container .board-note')); if (notes.length === 0) return;
    const vp = document.getElementById('board-viewport');
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    notes.forEach(n => { const x = parseFloat(n.style.left), y = parseFloat(n.style.top); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + n.offsetWidth); maxY = Math.max(maxY, y + n.offsetHeight); });
    setBoardZoom(Math.min(vp.clientWidth / (maxX - minX + 80), vp.clientHeight / (maxY - minY + 80), 1.2));
    vp.scrollLeft = (minX - 40) * boardZoom; vp.scrollTop = (minY - 40) * boardZoom;
}
function arrangeBoard() {
    if (!confirm("Alle Karten automatisch im Raster anordnen? Überlappungen werden dabei aufgelöst.")) return;
    const nodes = Array.from(document.querySelectorAll('#board-container .board-note')).map(n => ({ id: n.dataset.id, x: parseFloat(n.style.left) || 0, y: parseFloat(n.style.top) || 0 }));
    nodes.sort((a, b) => (Math.round(a.y / CELL_H) - Math.round(b.y / CELL_H)) || (a.x - b.x)); // grobe Reihenfolge beibehalten
    const cols = Math.max(3, Math.min(10, Math.ceil(Math.sqrt(nodes.length * 1.6))));
    const updates = {};
    nodes.forEach((n, i) => {
        const pos = { x: 40 + (i % cols) * CELL_W, y: 40 + Math.floor(i / cols) * CELL_H }; updates[n.id] = pos;
        const el = document.getElementById('note-' + n.id); el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px';
    });
    db.ref('positions').update(updates);
    updateBoardSize(); drawAllStrings(); fitBoard();
}
function toggleBoardFullscreen() {
    const on = document.getElementById('tab-pinnwand').classList.toggle('fullscreen');
    document.getElementById('board-fs-btn').innerText = on ? '✕ Vollbild beenden' : '⛶ Vollbild';
    updateBoardSize(); drawAllStrings();
}
function exitBoardFullscreen() { if (document.getElementById('tab-pinnwand').classList.contains('fullscreen')) toggleBoardFullscreen(); }
function setLinkMode(on) {
    linkMode = on;
    document.getElementById('link-mode-btn').classList.toggle('active', on);
    document.getElementById('board-container').classList.toggle('link-mode', on);
    if (on) showToast('Zwei Karten nacheinander antippen, um sie zu verbinden');
    else if (selectedNodeId !== null) { selectedNodeId = null; renderBoard(); }
}

// Ziehen per Maus UND Touch (Pointer Events). Kurzes Antippen ohne Bewegung = Menü bzw. Verbinden
function onNotePointerDown(e) {
    if (e.button !== 0) return;
    const note = e.currentTarget; const rect = note.getBoundingClientRect();
    dragState = { note, id: Number(note.dataset.id), startX: e.clientX, startY: e.clientY, offX: (e.clientX - rect.left) / boardZoom, offY: (e.clientY - rect.top) / boardZoom, moved: false, lastSync: 0 };
    note.setPointerCapture(e.pointerId);
}
function onNotePointerMove(e) {
    const s = dragState; if (!s || s.note !== e.currentTarget) return;
    if (!s.moved) { if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < 6) return; s.moved = true; currentDragElement = s.note; s.note.classList.add('dragging'); }
    const c = document.getElementById('board-container').getBoundingClientRect();
    const x = Math.round(Math.max(0, (e.clientX - c.left) / boardZoom - s.offX)); const y = Math.round(Math.max(0, (e.clientY - c.top) / boardZoom - s.offY));
    s.note.style.left = x + 'px'; s.note.style.top = y + 'px';
    if (x + 200 > boardW || y + 250 > boardH) updateBoardSize();
    drawAllStrings();
    const now = Date.now(); if (now - s.lastSync > 120) { s.lastSync = now; db.ref('positions/' + s.id).set({ x, y }); }
}
function onNotePointerUp(e) {
    const s = dragState; if (!s || s.note !== e.currentTarget) return;
    dragState = null;
    if (s.moved) {
        currentDragElement = null; s.note.classList.remove('dragging');
        db.ref('positions/' + s.id).set({ x: parseFloat(s.note.style.left), y: parseFloat(s.note.style.top) });
        updateBoardSize();
    } else if (e.type === 'pointerup' && !s.cancelTap) {
        handleNoteTap(s.id, e);
    }
}

function handleNoteTap(id, e) {
    if (linkMode || selectedNodeId !== null) { handleLinkSelection(id, e); return; }
    const node = getBoardNodes().find(n => n.id === id); if (!node) return;
    const startLink = { label: '🧵 Faden von hier spannen', action: () => { setLinkMode(true); handleLinkSelection(id, e); } };
    const removeCard = { label: '🗑 Von Pinnwand entfernen', danger: true, action: () => { if (confirm("Karte samt Fäden von der Pinnwand nehmen? (Das Original bleibt erhalten)")) db.ref().update({ ['boardNotes/' + id]: null, ...boardNodeCleanup(id) }); } };
    if (node.kind === 'npc') {
        const person = node.data;
        const items = [startLink, { label: '📂 Akte anzeigen', action: () => showPerson(id) }];
        if (person.image && person.image.trim() !== '') items.push({ label: '🔍 Bild vergrößern', action: () => openLightbox(person.image) });
        showMenu(e.clientX, e.clientY, person.name, items);
    } else if (node.kind === 'handout') {
        const items = [startLink, { label: '📄 Im Archiv öffnen', action: () => showHandout(node.ref.id) }];
        if (node.ref.image && node.ref.image.trim() !== '') items.push({ label: '🔍 Bild vergrößern', action: () => openLightbox(node.ref.image) });
        showMenu(e.clientX, e.clientY, node.ref.title, [...items, removeCard]);
    } else if (node.kind === 'pin') {
        showMenu(e.clientX, e.clientY, node.ref.note, [startLink, { label: '🗺 Auf Karte zeigen', action: () => showPinOnMap(node.ref.id) }, removeCard]);
    } else {
        const zettel = node.data;
        showMenu(e.clientX, e.clientY, zettel.text, [
            startLink,
            { label: '✎ Text bearbeiten', action: () => { const t = prompt("Zettel bearbeiten:", zettel.text); if (t && t.trim() !== "") db.ref('boardNotes/' + id).update({ text: t.trim() }); } },
            { label: '🎨 Farbe wechseln', action: () => db.ref('boardNotes/' + id).update({ color: ((zettel.color || 0) + 1) % NOTE_COLORS.length }) },
            { label: '🗑 Zettel entfernen', danger: true, action: () => { if (confirm("Zettel samt Fäden entfernen?")) db.ref().update({ ['boardNotes/' + id]: null, ...boardNodeCleanup(id) }); } }
        ]);
    }
}

// „+ Hinzufügen“: Zettel, Beweismittel aus dem Archiv oder Orte vom Lageplan
function openAddMenu(btn) {
    const r = btn.getBoundingClientRect();
    showMenu(r.left, r.bottom, 'An die Pinnwand heften', [
        { label: '📝 Zettel schreiben', action: addBoardNote },
        { label: '📄 Beweismittel …', action: () => pickBoardRef('handout', r) },
        { label: '📍 Ort vom Lageplan …', action: () => pickBoardRef('pin', r) }
    ]);
}
function pickBoardRef(type, r) {
    const onBoard = globalBoardNotes.filter(n => n.type === type).map(n => n.refId);
    const list = (type === 'handout' ? globalHandouts : globalPins).filter(item => !onBoard.includes(item.id));
    if (list.length === 0) { showToast(type === 'handout' ? 'Keine (weiteren) Beweismittel im Archiv' : 'Keine (weiteren) Pins auf dem Lageplan'); return; }
    showMenu(r.left, r.bottom, type === 'handout' ? 'Welches Beweismittel?' : 'Welcher Ort?', list.map(item => type === 'handout'
        ? { label: item.title, action: () => addRefToBoard('handout', item.id) }
        : { label: item.note, swatch: pinType(item).color, action: () => addRefToBoard('pin', item.id) }));
}
function addRefToBoard(type, refId) {
    if (globalBoardNotes.some(n => n.type === type && n.refId === refId)) { showToast('Hängt schon an der Pinnwand'); return; }
    const id = Date.now();
    db.ref().update({ ['boardNotes/' + id]: { id, type, refId }, ['positions/' + id]: findVisibleFreeSpot() });
    showToast('An die Pinnwand geheftet');
}
function addBoardNote() {
    const text = prompt("Was soll auf den Zettel? (z.B. Hinweis, Theorie)"); if (!text || text.trim() === "") return;
    const id = Date.now();
    db.ref().update({ ['boardNotes/' + id]: { id, text: text.trim(), color: 0 }, ['positions/' + id]: findVisibleFreeSpot() });
}

// Fäden: erst zwei Karten wählen, dann Art und Beschriftung
function chooseLinkType(e, title, onChoose) {
    const x = e ? e.clientX : window.innerWidth / 2, y = e ? e.clientY : window.innerHeight / 3;
    showMenu(x, y, title, Object.entries(LINK_TYPES).map(([key, t]) => ({ label: t.label, swatch: t.color, action: () => onChoose(key) })));
}
function handleLinkSelection(id, e) {
    if (selectedNodeId === null) { selectedNodeId = id; }
    else if (selectedNodeId === id) { selectedNodeId = null; }
    else {
        const start = selectedNodeId;
        const exists = globalLinks.some(link => (Number(link.start) === start && Number(link.end) === id) || (Number(link.start) === id && Number(link.end) === start));
        if (exists) { showToast('Diese Karten sind bereits verbunden'); }
        else {
            chooseLinkType(e, 'Art der Verbindung?', type => {
                const labelInput = prompt("Beschriftung? (z.B. 'schuldet Geld' oder leer lassen)");
                if (labelInput !== null) db.ref('links/' + start + "_" + id).set({ start, end: id, label: labelInput.trim(), type });
            });
        }
        selectedNodeId = null;
    }
    renderBoard();
}

function openLinkMenu(link, e) {
    showMenu(e.clientX, e.clientY, `${nodeTitle(link.start)} ↔ ${nodeTitle(link.end)}\n(${linkType(link).label})`, [
        { label: '✎ Beschriftung ändern', action: () => { const l = prompt("Beschriftung des Fadens:", link.label || ''); if (l !== null) db.ref('links/' + link.dbKey).update({ label: l.trim() }); } },
        { label: '🎨 Art ändern', action: () => chooseLinkType(e, 'Art der Verbindung', type => db.ref('links/' + link.dbKey).update({ type })) },
        { label: '🗑 Faden löschen', danger: true, action: () => { if (confirm("Verbindung löschen?")) db.ref('links/' + link.dbKey).remove(); } }
    ]);
}

// Geometrie eines Fadens: leicht durchhängende Kurve zwischen den Kartenmitten, Etikett in der Mitte der Kurve
function linkGeometry(link) {
    const a = document.getElementById('note-' + link.start), b = document.getElementById('note-' + link.end); if (!a || !b) return null;
    const x1 = parseFloat(a.style.left) + a.offsetWidth / 2, y1 = parseFloat(a.style.top) + a.offsetHeight / 2;
    const x2 = parseFloat(b.style.left) + b.offsetWidth / 2, y2 = parseFloat(b.style.top) + b.offsetHeight / 2;
    const sag = Math.min(60, Math.hypot(x2 - x1, y2 - y1) * 0.12); const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2 + sag;
    return { x1, y1, x2, y2, cx, cy, lx: (x1 + 2 * cx + x2) / 4, ly: (y1 + 2 * cy + y2) / 4 };
}

function drawAllStrings() {
    const svg = document.getElementById('strings-svg'); const labelsContainer = document.getElementById('string-labels-container');
    svg.innerHTML = ''; labelsContainer.innerHTML = '';
    globalLinks.forEach(link => {
        const g = linkGeometry(link); if (!g) return;
        const t = linkType(link);
        const active = selectedNodeId !== null && (Number(link.start) === selectedNodeId || Number(link.end) === selectedNodeId);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', `M${g.x1},${g.y1} Q${g.cx},${g.cy} ${g.x2},${g.y2}`);
        path.setAttribute('class', 'string-line' + (active ? ' active' : ''));
        path.style.stroke = t.color; path.style.strokeWidth = t.width + (active ? 2 : 0); path.style.strokeDasharray = t.dash || 'none';
        svg.appendChild(path);
        const labelDiv = document.createElement('div'); labelDiv.className = 'string-label'; labelDiv.style.left = g.lx + 'px'; labelDiv.style.top = g.ly + 'px'; labelDiv.style.borderLeftColor = t.color;
        labelDiv.innerText = (link.label && link.label.trim() !== "") ? link.label : "🔗"; labelDiv.title = t.label + " – klicken zum Bearbeiten oder Löschen";
        labelDiv.onclick = e => openLinkMenu(link, e);
        labelDiv.oncontextmenu = e => { e.preventDefault(); openLinkMenu(link, e); };
        labelsContainer.appendChild(labelDiv);
    });
}
function clearStrings() { if(confirm("Alle Fäden löschen?")) { db.ref('links').remove(); } }

// =========================================
// PINNWAND ALS BILD (PNG) EXPORTIEREN
// =========================================
function exportBoardImage() {
    if (document.querySelectorAll('#board-container .board-note').length === 0) { showToast('Die Pinnwand ist leer'); return; }
    downloadCanvas(renderBoardCanvas(true))
        // Externe Bilder ohne CORS-Freigabe "verunreinigen" das Canvas – dann ohne Fotos exportieren
        .catch(() => downloadCanvas(renderBoardCanvas(false)).then(() => showToast('Exportiert – externe Fotos mussten weggelassen werden')))
        .catch(() => showToast('Export fehlgeschlagen'));
}
function downloadCanvas(canvas) {
    return new Promise((resolve, reject) => {
        try {
            canvas.toBlob(blob => {
                if (!blob) { reject(new Error('Leeres Bild')); return; }
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'pinnwand_' + new Date().toISOString().slice(0, 10) + '.png'; a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 2000); resolve();
            }, 'image/png');
        } catch (err) { reject(err); }
    });
}
function renderBoardCanvas(withImages) {
    const notes = Array.from(document.querySelectorAll('#board-container .board-note'));
    const strings = globalLinks.map(link => ({ link, g: linkGeometry(link) })).filter(s => s.g);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    notes.forEach(n => { const x = parseFloat(n.style.left), y = parseFloat(n.style.top); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + n.offsetWidth); maxY = Math.max(maxY, y + n.offsetHeight); });
    strings.forEach(({ g }) => { minX = Math.min(minX, g.lx - 80); maxX = Math.max(maxX, g.lx + 80); maxY = Math.max(maxY, g.ly + 20); });
    const pad = 40, w = maxX - minX + 2 * pad, h = maxY - minY + 2 * pad;
    const scale = Math.min(2, 8000 / Math.max(w, h));
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(w * scale); canvas.height = Math.ceil(h * scale);
    const ctx = canvas.getContext('2d'); ctx.scale(scale, scale); ctx.translate(pad - minX, pad - minY);
    ctx.fillStyle = '#2a2015'; ctx.fillRect(minX - pad, minY - pad, w, h);

    strings.forEach(({ link, g }) => {
        const t = linkType(link);
        ctx.save(); ctx.strokeStyle = t.color; ctx.lineWidth = t.width; ctx.setLineDash(t.dash ? t.dash.split(',').map(Number) : []);
        ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
        ctx.beginPath(); ctx.moveTo(g.x1, g.y1); ctx.quadraticCurveTo(g.cx, g.cy, g.x2, g.y2); ctx.stroke(); ctx.restore();
    });
    strings.forEach(({ link, g }) => {
        const text = link.label && link.label.trim() !== '' ? link.label : '🔗';
        ctx.font = '11px "Courier New", monospace'; const tw = Math.min(150, ctx.measureText(text).width);
        ctx.fillStyle = '#fff9c4'; ctx.fillRect(g.lx - tw / 2 - 7, g.ly - 10, tw + 14, 20);
        ctx.strokeStyle = '#999'; ctx.lineWidth = 1; ctx.strokeRect(g.lx - tw / 2 - 7, g.ly - 10, tw + 14, 20);
        ctx.fillStyle = linkType(link).color; ctx.fillRect(g.lx - tw / 2 - 7, g.ly - 10, 4, 20);
        ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, g.lx + 2, g.ly, 150);
    });
    notes.forEach(n => drawNoteOnCanvas(ctx, n, withImages));
    return canvas;
}
// Zeichnet eine Karte anhand ihres tatsächlichen Layouts im DOM nach (Farben, Text, Bilder)
function drawNoteOnCanvas(ctx, n, withImages) {
    const x = parseFloat(n.style.left), y = parseFloat(n.style.top), w = n.offsetWidth, h = n.offsetHeight; const cs = getComputedStyle(n);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 3;
    ctx.fillStyle = cs.backgroundColor; ctx.fillRect(x, y, w, h); ctx.restore();
    const bt = parseFloat(cs.borderTopWidth); if (bt > 1) { ctx.fillStyle = cs.borderTopColor; ctx.fillRect(x, y, w, bt); }
    const bl = parseFloat(cs.borderLeftWidth); if (bl > 1) { ctx.strokeStyle = cs.borderLeftColor; ctx.lineWidth = bl; ctx.setLineDash(cs.borderLeftStyle === 'dashed' ? [6, 4] : []); ctx.strokeRect(x + bl / 2, y + bl / 2, w - bl, h - bl); ctx.setLineDash([]); }
    ctx.fillStyle = 'silver'; ctx.beginPath(); ctx.arc(x + w / 2, y + 6, 3, 0, Math.PI * 2); ctx.fill();
    Array.from(n.children).forEach(child => {
        const cx = x + child.offsetLeft, cy = y + child.offsetTop, cw = child.offsetWidth, ch = child.offsetHeight;
        if (child.tagName === 'IMG') {
            if (withImages && child.complete && child.naturalWidth) {
                const iw = child.naturalWidth, ih = child.naturalHeight, s = Math.max(cw / iw, ch / ih), sw = cw / s, sh = ch / s;
                ctx.save(); ctx.filter = getComputedStyle(child).filter; ctx.drawImage(child, (iw - sw) / 2, (ih - sh) / 2, sw, sh, cx, cy, cw, ch); ctx.restore();
            } else { ctx.fillStyle = '#bbb'; ctx.fillRect(cx, cy, cw, ch); }
            return;
        }
        const ccs = getComputedStyle(child); const fontSize = parseFloat(ccs.fontSize);
        const lineH = parseFloat(ccs.lineHeight) || fontSize * 1.2;
        ctx.font = `${ccs.fontWeight} ${ccs.fontSize} ${ccs.fontFamily}`; ctx.fillStyle = ccs.color; ctx.textBaseline = 'top';
        const center = ccs.textAlign === 'center'; ctx.textAlign = center ? 'center' : 'left';
        wrapCanvasText(ctx, child.innerText, cw).forEach((line, i) => {
            const tx = center ? cx + cw / 2 : cx, ty = cy + i * lineH;
            ctx.fillText(line, tx, ty);
            if (ccs.textDecorationLine.includes('line-through')) { const lw = ctx.measureText(line).width, sx = center ? tx - lw / 2 : tx; ctx.fillRect(sx, ty + fontSize * 0.55, lw, 1.5); }
        });
    });
}
function wrapCanvasText(ctx, text, maxWidth) {
    const lines = [];
    String(text).split('\n').forEach(paragraph => {
        let line = '';
        paragraph.split(' ').forEach(word => {
            const test = line ? line + ' ' + word : word;
            if (ctx.measureText(test).width <= maxWidth) { line = test; return; }
            if (line) lines.push(line);
            line = '';
            for (const ch of word) { if (ctx.measureText(line + ch).width > maxWidth && line) { lines.push(line); line = ''; } line += ch; } // überlange Wörter zeichenweise umbrechen
        });
        lines.push(line);
    });
    return lines;
}
