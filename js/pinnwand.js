// =========================================
// PINNWAND LOGIK (Echtzeit-Synchronisiert)
// =========================================
let globalPositions = {};
let globalLinks = [];
let globalBoardNotes = [];
const NOTE_COLORS = ['#fff59d', '#ffccbc', '#b3e5fc', '#c8e6c9', '#f8bbd0'];
const CELL_W = 180, CELL_H = 230, BOARD_MIN_W = 1600, BOARD_MIN_H = 1000, BOARD_PAD = 300;
let selectedNodeId = null; let linkMode = false; let currentDragElement = null; let dragState = null;
let boardZoom = loadPref('hb-board-zoom', 1); let boardW = BOARD_MIN_W; let boardH = BOARD_MIN_H;

function initPinnwand() {
    db.ref('positions').on('value', snap => { globalPositions = snap.val() || {}; renderBoard(); });
    db.ref('boardNotes').on('value', snap => { globalBoardNotes = Object.values(snap.val() || {}); renderBoard(); });
    db.ref('links').on('value', snap => { const data = snap.val() || {}; globalLinks = Object.keys(data).map(key => ({...data[key], dbKey: key})); drawAllStrings(); });
    initBoardGestures();
    window.addEventListener('resize', () => { if (document.getElementById('tab-pinnwand').classList.contains('active-tab')) { updateBoardSize(); drawAllStrings(); } });
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

// Alle Datenbank-Änderungen, die beim Entfernen einer Karte anfallen (Position + Fäden)
function boardNodeCleanup(id) {
    const updates = { ['positions/' + id]: null };
    globalLinks.filter(l => Number(l.start) === Number(id) || Number(l.end) === Number(id)).forEach(l => { updates['links/' + l.dbKey] = null; });
    return updates;
}

function getBoardNodes() {
    return [
        ...globalNPCs.map(p => ({ id: p.id, kind: 'npc', data: p })),
        ...globalBoardNotes.map(n => ({ id: n.id, kind: 'zettel', data: n }))
    ];
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
            note.oncontextmenu = function(e) { e.preventDefault(); if (dragState) dragState.cancelTap = true; handleLinkSelection(node.id); }; // Long-Press auf Android löst auch contextmenu aus
            container.appendChild(note);
        }
        let newHTML, cls;
        if (node.kind === 'npc') {
            const person = node.data;
            const imageHTML = person.image && person.image.trim() !== '' ? `<img src="${esc(person.image)}" draggable="false">` : '';
            newHTML = `${imageHTML}<strong>${esc(person.name)}</strong>${person.role ? `<small>${esc(person.role)}</small>` : ''}`;
            cls = 'board-note ' + (STATUS_CLASS[person.status] || '');
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
    if (linkMode || selectedNodeId !== null) { handleLinkSelection(id); return; }
    const person = globalNPCs.find(p => p.id === id); const zettel = globalBoardNotes.find(n => n.id === id);
    const startLink = { label: '🧵 Faden von hier spannen', action: () => { setLinkMode(true); handleLinkSelection(id); } };
    if (person) {
        const items = [startLink, { label: '📂 Akte anzeigen', action: () => showPerson(id) }];
        if (person.image && person.image.trim() !== '') items.push({ label: '🔍 Bild vergrößern', action: () => openLightbox(person.image) });
        showMenu(e.clientX, e.clientY, person.name, items);
    } else if (zettel) {
        showMenu(e.clientX, e.clientY, zettel.text, [
            startLink,
            { label: '✎ Text bearbeiten', action: () => { const t = prompt("Zettel bearbeiten:", zettel.text); if (t && t.trim() !== "") db.ref('boardNotes/' + id).update({ text: t.trim() }); } },
            { label: '🎨 Farbe wechseln', action: () => db.ref('boardNotes/' + id).update({ color: ((zettel.color || 0) + 1) % NOTE_COLORS.length }) },
            { label: '🗑 Zettel entfernen', danger: true, action: () => { if (confirm("Zettel samt Fäden entfernen?")) db.ref().update({ ['boardNotes/' + id]: null, ...boardNodeCleanup(id) }); } }
        ]);
    }
}

function addBoardNote() {
    const text = prompt("Was soll auf den Zettel? (z.B. Hinweis, Ort, Theorie)"); if (!text || text.trim() === "") return;
    const vp = document.getElementById('board-viewport'); const id = Date.now();
    const pos = findFreeSpot(Math.round(vp.scrollLeft / boardZoom) + 40, Math.round(vp.scrollTop / boardZoom) + 40); // im sichtbaren Bereich
    db.ref().update({ ['boardNotes/' + id]: { id, text: text.trim(), color: 0 }, ['positions/' + id]: pos });
}

function handleLinkSelection(id) {
    if (selectedNodeId === null) { selectedNodeId = id; }
    else if (selectedNodeId === id) { selectedNodeId = null; }
    else {
        const exists = globalLinks.some(link => (Number(link.start) === selectedNodeId && Number(link.end) === id) || (Number(link.start) === id && Number(link.end) === selectedNodeId));
        if (exists) { showToast('Diese Karten sind bereits verbunden'); }
        else {
            const labelInput = prompt("Verbindung? (z.B. 'Feinde' oder leer lassen)");
            if (labelInput !== null) { const linkId = selectedNodeId + "_" + id; db.ref('links/' + linkId).set({ start: selectedNodeId, end: id, label: labelInput.trim() }); }
        }
        selectedNodeId = null;
    }
    renderBoard();
}

function openLinkMenu(link, e) {
    const names = [link.start, link.end].map(id => npcName(id) || (globalBoardNotes.find(n => n.id === Number(id)) || {}).text || '?');
    showMenu(e.clientX, e.clientY, names.join(' ↔ '), [
        { label: '✎ Beschriftung ändern', action: () => { const l = prompt("Beschriftung des Fadens:", link.label || ''); if (l !== null) db.ref('links/' + link.dbKey).update({ label: l.trim() }); } },
        { label: '🗑 Faden löschen', danger: true, action: () => { if (confirm("Verbindung löschen?")) db.ref('links/' + link.dbKey).remove(); } }
    ]);
}

function drawAllStrings() {
    const svg = document.getElementById('strings-svg'); const labelsContainer = document.getElementById('string-labels-container');
    svg.innerHTML = ''; labelsContainer.innerHTML = '';
    globalLinks.forEach(link => {
        const startEl = document.getElementById('note-' + link.start); const endEl = document.getElementById('note-' + link.end);
        if(startEl && endEl) {
            const x1 = parseFloat(startEl.style.left) + (startEl.offsetWidth / 2); const y1 = parseFloat(startEl.style.top) + (startEl.offsetHeight / 2); const x2 = parseFloat(endEl.style.left) + (endEl.offsetWidth / 2); const y2 = parseFloat(endEl.style.top) + (endEl.offsetHeight / 2);
            // Leicht durchhängender Faden statt gerader Linie
            const sag = Math.min(60, Math.hypot(x2 - x1, y2 - y1) * 0.12); const cx = (x1 + x2) / 2; const cy = (y1 + y2) / 2 + sag;
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`);
            const active = selectedNodeId !== null && (Number(link.start) === selectedNodeId || Number(link.end) === selectedNodeId);
            path.setAttribute('class', 'string-line' + (active ? ' active' : '')); svg.appendChild(path);
            const labelDiv = document.createElement('div'); labelDiv.className = 'string-label'; labelDiv.style.left = (x1 + 2 * cx + x2) / 4 + 'px'; labelDiv.style.top = (y1 + 2 * cy + y2) / 4 + 'px'; labelDiv.innerText = (link.label && link.label.trim() !== "") ? link.label : "🔗"; labelDiv.title = "Klicken zum Beschriften oder Löschen";
            labelDiv.onclick = e => openLinkMenu(link, e);
            labelDiv.oncontextmenu = e => { e.preventDefault(); openLinkMenu(link, e); };
            labelsContainer.appendChild(labelDiv);
        }
    });
}
function clearStrings() { if(confirm("Alle roten Fäden löschen?")) { db.ref('links').remove(); } }

// Zoom per Strg+Mausrad / Trackpad und per Zwei-Finger-Geste
function initBoardGestures() {
    const vp = document.getElementById('board-viewport'); let pinch = null;
    const dist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    vp.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); const r = vp.getBoundingClientRect(); setBoardZoom(boardZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    vp.addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = { dist: dist(e), zoom: boardZoom }; }, { passive: true });
    vp.addEventListener('touchmove', e => {
        if (!pinch || e.touches.length !== 2) return; e.preventDefault();
        const r = vp.getBoundingClientRect();
        setBoardZoom(pinch.zoom * dist(e) / pinch.dist, (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top);
    }, { passive: false });
    vp.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; });
}
