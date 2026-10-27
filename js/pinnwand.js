// =========================================
// PINNWAND LOGIK (Echtzeit-Synchronisiert)
// Optik: Korkwand mit Stecknadeln, Wollfäden zwischen den Nadeln, Polaroids/Karteikarten/Haftnotizen
// =========================================
let globalPositions = {};
let globalLinks = [];
let globalBoardNotes = []; // Zettel sowie angeheftete Beweismittel/Orte ({type: 'handout'|'pin', refId})
const NOTE_COLORS = ['#fff59d', '#ffccbc', '#b3e5fc', '#c8e6c9', '#f8bbd0'];
const LINK_TYPES = {
    unklar: { label: 'Verbindung / unklar', color: '#c62828', width: 3 },
    feind: { label: 'Feindschaft', color: '#1b1b1b', width: 4 },
    verbuendet: { label: 'Verbündet', color: '#2e7d32', width: 3 },
    familie: { label: 'Familie / Beziehung', color: '#7b1fa2', width: 3 },
    verdacht: { label: 'Verdacht', color: '#ef6c00', width: 3 },
    geschaeft: { label: 'Geschäftlich', color: '#1565c0', width: 3 }
};
// Farbe der Stecknadel je Kartenart
const PUSHPIN_COLORS = { npc: '#d32f2f', zettel: '#1e88e5', handout: '#43a047' };
const STATUS_STAMPS = { 'Verdächtig': 'VERDÄCHTIG', 'Vermisst': 'VERMISST', 'Verstorben': 'VERSTORBEN' };
const CELL_W = 180, CELL_H = 230, BOARD_MIN_W = 1600, BOARD_MIN_H = 1000, BOARD_PAD = 300;
// Abstand zwischen Karten, damit Faden-Etiketten dazwischen Platz haben
const CARD_GAP_X = 60, CARD_GAP_Y = 50;
const PIN_OFFSET_Y = 12; // Nadel sitzt 12px unter der Oberkante (= Drehpunkt der Karte)
const KNOT_LENGTH = 26; // so viel Faden ist auf der eigenen Karte sichtbar (am Knoten), der Rest läuft hinter den Karten
const LONG_PRESS_MS = 300; // Touch: so lange halten, bis eine Karte am Finger hängt (sonst wird gescrollt)
const TIGHTEN_MS = 750; // neuer Faden: so lange dauert das Straffen
const NOTE_SEL = '#board-container .board-note:not(.leaving)';
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let selectedNodeId = null; let linkMode = false; let currentDragElement = null; let dragState = null;
let boardZoom = loadPref('hb-board-zoom', 1); let boardW = BOARD_MIN_W; let boardH = BOARD_MIN_H;
let boardLoaded = false; // erst danach werden neue Karten/Nadeln animiert eingeblendet (nicht beim ersten Laden)
let boardFocus = null; let focusVisible = new Set(); // Fokus auf das Netz einer Karte
let hoverNodeId = null; let lastPointerType = 'mouse';

function initPinnwand() {
    renderLinkLegend();
    document.getElementById('board-container').style.backgroundImage = `url(${corkTexture()})`;
    db.ref('positions').on('value', snap => {
        globalPositions = snap.val() || {};
        // Während eine Karte gezogen wird, nur die anderen Karten nachziehen – kein kompletter Neuaufbau (sonst ruckelt es)
        if (dragState && dragState.moved) applyPositionsLight(); else renderBoard();
        if (!boardLoaded) setTimeout(() => { boardLoaded = true; }, 1500);
    });
    db.ref('boardNotes').on('value', snap => { globalBoardNotes = Object.values(snap.val() || {}); renderBoard(); });
    let knownLinks = null;
    db.ref('links').on('value', snap => {
        const data = snap.val() || {};
        globalLinks = Object.keys(data).map(key => ({...data[key], dbKey: key}));
        if (knownLinks && !REDUCED_MOTION) globalLinks.forEach(l => { if (!knownLinks.has(l.dbKey)) newLinkTimes.set(l.dbKey, performance.now()); });
        knownLinks = new Set(globalLinks.map(l => l.dbKey));
        if (boardFocus) computeFocusSet();
        drawAllStrings(); if (newLinkTimes.size) startStringFollow(TIGHTEN_MS + 50);
    });
    const vp = document.getElementById('board-viewport');
    attachZoomGestures(vp, () => boardZoom, setBoardZoom);
    vp.addEventListener('touchstart', e => { if (e.touches.length > 1) cancelPendingDrag(); }, { passive: true }); // zwei Finger = Zoom, nicht Ziehen
    document.getElementById('board-container').addEventListener('click', e => { if (e.target.id === 'board-container' && boardFocus) clearFocus(); });
    document.addEventListener('keydown', e => {
        const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing && document.getElementById('tab-pinnwand').classList.contains('active-tab')) { e.preventDefault(); undoLast(); }
    });
    window.addEventListener('resize', () => { if (document.getElementById('tab-pinnwand').classList.contains('active-tab')) { updateBoardSize(); drawAllStrings(); } });
    updateUndoButton();
}

function linkType(link) { return LINK_TYPES[link.type] || LINK_TYPES.unklar; }
function linkTouches(link, id) { return String(link.start) === String(id) || String(link.end) === String(id); }
function renderLinkLegend() {
    document.getElementById('link-legend').innerHTML = Object.values(LINK_TYPES).map(t =>
        `<span class="legend-line"><svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4" stroke="${t.color}" stroke-width="${t.width}" stroke-linecap="round"/></svg>${t.label}</span>`).join('');
}

// Korkstruktur einmal als Bild erzeugen: ein fertiges Bild lässt sich beim Zoomen billig skalieren,
// SVG-Rauschfilter müssten bei jeder Zoomstufe neu berechnet werden
function corkTexture() {
    const size = 256, c = document.createElement('canvas'); c.width = c.height = size; const ctx = c.getContext('2d');
    ctx.fillStyle = '#b98b5e'; ctx.fillRect(0, 0, size, size);
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 260; i++) { // größere, weiche Flecken
        const x = rnd() * size, y = rnd() * size, r = 6 + rnd() * 18;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r); const light = rnd() < 0.5;
        g.addColorStop(0, light ? 'rgba(225,185,135,0.18)' : 'rgba(120,75,35,0.16)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 7000; i++) { // feine Körnung
        const dark = rnd() < 0.62;
        ctx.fillStyle = dark ? `rgba(85,48,18,${0.15 + rnd() * 0.35})` : `rgba(240,205,155,${0.15 + rnd() * 0.3})`;
        ctx.fillRect(rnd() * size, rnd() * size, 0.8 + rnd() * 1.8, 0.8 + rnd() * 1.6);
    }
    return c.toDataURL('image/png');
}

// Feste "Zufalls"-Werte pro Karte/Faden, damit alle Spieler dieselbe schiefe Aufhängung sehen
function hashStr(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
function tiltFor(id, maxDeg = 3) { return ((hashStr(id) % 61) / 30 - 1) * maxDeg; }

// Belegte Flächen mit der echten Kartengröße (Karten mit Foto/langem Text sind deutlich höher)
function takenRects() {
    return Object.entries(globalPositions).map(([id, p]) => {
        const el = document.getElementById('note-' + id);
        return { x: p.x, y: p.y, w: (el && el.offsetWidth) || 140, h: (el && el.offsetHeight) || 200 };
    });
}

// Sucht die erste freie Stelle, damit neue Karten nicht übereinander landen
function findFreeSpot(originX = 40, originY = 40, w = 140, h = 200) {
    const taken = takenRects();
    const vp = document.getElementById('board-viewport');
    const cols = Math.max(4, Math.floor(((vp.clientWidth || 1200) / boardZoom - 40) / CELL_W));
    const free = (x, y) => !taken.some(t => x < t.x + t.w + CARD_GAP_X / 2 && x + w + CARD_GAP_X / 2 > t.x && y < t.y + t.h + CARD_GAP_Y / 2 && y + h + CARD_GAP_Y / 2 > t.y);
    for (let row = 0; row < 400; row++) {
        for (let col = 0; col < cols; col++) {
            const x = originX + col * CELL_W, y = originY + row * 40;
            if (free(x, y)) return { x, y };
        }
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
    globalLinks.filter(l => linkTouches(l, id)).forEach(l => { updates['links/' + l.dbKey] = null; });
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

// =========================================
// RÜCKGÄNGIG: jede Aktion merkt sich die Datenbank-Änderungen, die sie wieder aufheben
// =========================================
const undoStack = [];
function pushUndo(label, revert, toast = true) {
    undoStack.push({ label, revert }); if (undoStack.length > 30) undoStack.shift();
    updateUndoButton();
    if (toast) showToast(label, 'Rückgängig', undoLast);
}
function undoLast() {
    const step = undoStack.pop(); updateUndoButton();
    if (!step) { showToast('Nichts mehr rückgängig zu machen'); return; }
    db.ref().update(step.revert);
    showToast('Rückgängig: ' + step.label);
}
function updateUndoButton() {
    const b = document.getElementById('undo-btn'); if (!b) return;
    b.disabled = undoStack.length === 0;
    b.title = undoStack.length ? `Rückgängig: ${undoStack[undoStack.length - 1].label} (Strg+Z)` : 'Nichts rückgängig zu machen';
}
function linkData(link) { const { dbKey, ...data } = link; return data; }
// Alles, was zum Wiederherstellen einer Karte nötig ist (Karte, Position, Fäden)
function cardSnapshot(id) {
    const snap = { ['positions/' + id]: globalPositions[id] || null };
    const note = globalBoardNotes.find(n => n.id === Number(id)); if (note) snap['boardNotes/' + id] = note;
    globalLinks.filter(l => linkTouches(l, id)).forEach(l => { snap['links/' + l.dbKey] = linkData(l); });
    return snap;
}
function removeCardFromBoard(id, label) {
    const revert = cardSnapshot(id);
    db.ref().update({ ['boardNotes/' + id]: null, ...boardNodeCleanup(id) });
    pushUndo(label, revert);
}

// =========================================
// KARTEN ZEICHNEN
// =========================================
function renderBoard() {
    const container = document.getElementById('board-container');
    const nodes = getBoardNodes();
    if (boardFocus && !nodes.some(n => n.id === boardFocus.id)) { boardFocus = null; focusVisible = new Set(); renderFocusBar(); }
    nodes.forEach(node => {
        let note = document.getElementById('note-' + node.id); let created = false;
        if (note && note._leaveTimer) { clearTimeout(note._leaveTimer); note._leaveTimer = 0; } // kam per Rückgängig zurück
        if (!note) {
            created = true;
            note = document.createElement('div'); note.id = 'note-' + node.id; note.dataset.id = node.id;
            note.addEventListener('pointerdown', onNotePointerDown);
            note.addEventListener('pointermove', onNotePointerMove);
            note.addEventListener('pointerup', onNotePointerUp);
            note.addEventListener('pointercancel', onNotePointerUp);
            // Touch: Scrollen erst blockieren, wenn die Karte nach langem Drücken am Finger hängt
            note.addEventListener('touchmove', e => { if (dragState && dragState.note === note && dragState.armed) e.preventDefault(); }, { passive: false });
            note.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse' && !dragState) { hoverNodeId = node.id; updateStringStates(); } });
            note.addEventListener('pointerleave', e => { if (hoverNodeId === node.id) { hoverNodeId = null; updateStringStates(); } });
            // Rechtsklick (Maus) = Faden spannen; das Long-Press-contextmenu auf Android ignorieren wir, dafür gibt es das Menü
            note.oncontextmenu = function(e) { e.preventDefault(); if (lastPointerType !== 'mouse') return; if (dragState) dragState.cancelTap = true; handleLinkSelection(node.id, e); };
            if (boardLoaded && !REDUCED_MOTION) note._appearUntil = performance.now() + 650;
            container.appendChild(note);
        }
        let newHTML, cls, stamp = null, pin = PUSHPIN_COLORS[node.kind];
        note.style.backgroundColor = ''; note.style.borderTopColor = '';
        if (node.kind === 'npc') {
            const person = node.data; const hasPhoto = person.image && person.image.trim() !== '';
            newHTML = `${hasPhoto ? `<img src="${esc(person.image)}" draggable="false">` : ''}<strong>${esc(person.name)}</strong>${person.role ? `<small>${esc(person.role)}</small>` : ''}`;
            cls = 'board-note ' + (hasPhoto ? 'polaroid-note ' : 'index-card ') + (STATUS_CLASS[person.status] || '');
            stamp = STATUS_STAMPS[person.status] || null;
        } else if (node.kind === 'handout') {
            const h = node.ref;
            const imageHTML = h.image && h.image.trim() !== '' ? `<img src="${esc(h.image)}" draggable="false">` : '';
            newHTML = `<div class="card-kind">Beweismittel</div>${imageHTML}<strong>${esc(h.title)}</strong>`;
            cls = 'board-note handout-note';
        } else if (node.kind === 'pin') {
            const t = pinType(node.ref);
            newHTML = `<div class="card-kind">📍 ${t.label}</div><strong>${esc(node.ref.note)}</strong>`;
            cls = 'board-note pin-note'; note.style.borderTopColor = t.color; pin = t.color;
        } else {
            newHTML = `<div class="zettel-text">${esc(node.data.text)}</div>`;
            cls = 'board-note zettel';
            note.style.backgroundColor = NOTE_COLORS[node.data.color || 0] || NOTE_COLORS[0];
        }
        if (note.dataset.html !== newHTML) { note.innerHTML = newHTML; note.dataset.html = newHTML; }
        note.className = cls + stateClasses(note, node.id);
        note.style.setProperty('--rot', tiltFor(node.id, node.kind === 'zettel' ? 4 : 3).toFixed(2) + 'deg');
        note.dataset.pin = pin;
        if (stamp) note.dataset.stamp = stamp; else delete note.dataset.stamp;

        if(currentDragElement !== note) {
            let pos = globalPositions[node.id];
            if (!pos) { pos = findFreeSpot(); globalPositions[node.id] = pos; } // nur lokal, wird beim ersten Verschieben gespeichert
            placeNote(note, pos.x, pos.y, !created); // Änderungen (z.B. von anderen Spielern) gleiten statt zu springen
        }
    });
    container.querySelectorAll('.board-note').forEach(note => { if (!note._leaveTimer && !note.classList.contains('leaving') && !nodes.some(n => String(n.id) === note.dataset.id)) leaveNote(note); });
    updateBoardSize();
    drawAllStrings();
    updateSearchList();
}
// Zustände, die beim Neuzeichnen der Klassen erhalten bleiben müssen
function stateClasses(note, id) {
    const now = performance.now(); let c = '';
    if (note === currentDragElement) c += ' dragging';
    if (dragState && dragState.note === note && dragState.armed && !dragState.moved) c += ' lifting';
    if (selectedNodeId === id) c += ' selected-for-link';
    if (note._appearUntil > now) c += ' appear';
    if (note._pulseUntil > now) c += ' pulse';
    if (boardFocus) c += boardFocus.id === id ? ' focused' : (focusVisible.has(String(id)) ? '' : ' dimmed');
    return c;
}
function leaveNote(note) {
    note.classList.add('leaving');
    note._leaveTimer = setTimeout(() => { note.remove(); drawAllStrings(); }, REDUCED_MOTION ? 0 : 280);
}
// Setzt die Position einer Karte; mit animate gleitet sie dorthin (Dauer je nach Strecke) und die Fäden laufen mit
function placeNote(note, x, y, animate = true, duration = null, delay = 0) {
    const px = parseFloat(note.style.left), py = parseFloat(note.style.top);
    if (px === x && py === y) return;
    if (animate && !REDUCED_MOTION && !isNaN(px) && note.offsetParent) {
        const d = duration ?? (Math.hypot(x - px, y - py) > 260 ? 0.7 : 0.25);
        note.style.setProperty('--glide', d + 's'); note.style.setProperty('--glide-delay', delay + 's');
        clearTimeout(note._glideTimer);
        note._glideTimer = setTimeout(() => { note.style.setProperty('--glide', '0s'); note.style.setProperty('--glide-delay', '0s'); }, (d + delay) * 1000 + 60);
        startStringFollow((d + delay) * 1000 + 80);
    }
    note.style.left = x + 'px'; note.style.top = y + 'px';
}
// Solange Karten gleiten, die Fäden in jedem Frame nachziehen
let followUntil = 0, followRaf = 0;
function startStringFollow(ms) {
    if (REDUCED_MOTION) return;
    followUntil = Math.max(followUntil, performance.now() + ms);
    if (!followRaf) followRaf = requestAnimationFrame(followFrame);
}
function followFrame(now) {
    drawAllStrings();
    if (now < followUntil) followRaf = requestAnimationFrame(followFrame); else { followRaf = 0; drawAllStrings(); }
}
function pulseCard(id) {
    const el = document.getElementById('note-' + id); if (!el) return;
    el._pulseUntil = performance.now() + 2300; el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
    setTimeout(() => el.classList.remove('pulse'), 2300);
}

// Pinnwand wächst mit den Karten mit (scrollbar) statt sie abzuschneiden
let boardExtent = { x: 0, y: 0 };
function updateBoardSize(measure = true) {
    const container = document.getElementById('board-container'); const vp = document.getElementById('board-viewport');
    if (measure) { // Kartenausdehnung nur neu messen, wenn sich Karten geändert haben (nicht bei jedem Zoomschritt)
        let maxX = 0, maxY = 0;
        container.querySelectorAll('.board-note:not(.leaving)').forEach(n => { maxX = Math.max(maxX, parseFloat(n.style.left) + (n.offsetWidth || 140)); maxY = Math.max(maxY, parseFloat(n.style.top) + (n.offsetHeight || 170)); });
        boardExtent = { x: maxX, y: maxY };
    }
    boardW = Math.ceil(Math.max(BOARD_MIN_W, vp.clientWidth / boardZoom, boardExtent.x + BOARD_PAD));
    boardH = Math.ceil(Math.max(BOARD_MIN_H, vp.clientHeight / boardZoom, boardExtent.y + BOARD_PAD));
    container.style.width = boardW + 'px'; container.style.height = boardH + 'px'; container.style.transform = `scale(${boardZoom})`;
    const sizer = document.getElementById('board-sizer'); sizer.style.width = boardW * boardZoom + 'px'; sizer.style.height = boardH * boardZoom + 'px';
    document.getElementById('zoom-label').innerText = Math.round(boardZoom * 100) + '%';
}

// =========================================
// ZOOM & ANSICHT
// =========================================
function setBoardZoom(z, anchorX, anchorY) {
    cancelAnimationFrame(viewAnim); viewAnim = 0;
    const vp = document.getElementById('board-viewport');
    z = Math.max(0.25, Math.min(2, z));
    const ax = anchorX ?? vp.clientWidth / 2, ay = anchorY ?? vp.clientHeight / 2;
    const bx = (vp.scrollLeft + ax) / boardZoom, by = (vp.scrollTop + ay) / boardZoom;
    // Während des Zoomens skaliert der Browser die Wand als fertiges Bild, danach wird sie wieder scharf gezeichnet
    const container = document.getElementById('board-container'); container.style.willChange = 'transform';
    clearTimeout(setBoardZoom.sharpen); setBoardZoom.sharpen = setTimeout(() => { container.style.willChange = ''; }, 250);
    boardZoom = z; updateBoardSize(false);
    vp.scrollLeft = bx * z - ax; vp.scrollTop = by * z - ay;
    savePref('hb-board-zoom', boardZoom);
}
// Weicher Kameraflug: Zoom und Bildmitte (in Pinnwand-Koordinaten) gleiten zum Ziel
let viewAnim = 0;
function animateBoardView(z1, cx1 = null, cy1 = null, ms = 380) {
    const vp = document.getElementById('board-viewport'); const container = document.getElementById('board-container');
    const vw = vp.clientWidth, vh = vp.clientHeight; if (!vw) return;
    z1 = Math.max(0.25, Math.min(2, z1));
    const z0 = boardZoom, cx0 = (vp.scrollLeft + vw / 2) / z0, cy0 = (vp.scrollTop + vh / 2) / z0;
    cx1 = cx1 ?? cx0; cy1 = cy1 ?? cy0;
    cancelAnimationFrame(viewAnim); container.style.willChange = 'transform';
    const t0 = performance.now(), dur = REDUCED_MOTION ? 0 : ms;
    const step = now => {
        const p = dur ? Math.min(1, (now - t0) / dur) : 1, e = 1 - Math.pow(1 - p, 3);
        boardZoom = z0 + (z1 - z0) * e; updateBoardSize(false);
        vp.scrollLeft = (cx0 + (cx1 - cx0) * e) * boardZoom - vw / 2; vp.scrollTop = (cy0 + (cy1 - cy0) * e) * boardZoom - vh / 2;
        if (p < 1) { viewAnim = requestAnimationFrame(step); return; }
        viewAnim = 0; container.style.willChange = ''; savePref('hb-board-zoom', boardZoom);
    };
    viewAnim = requestAnimationFrame(step);
}
function zoomBoard(dir) { animateBoardView(boardZoom * (dir > 0 ? 1.25 : 1 / 1.25), null, null, 220); }
function fitBoard() {
    const notes = Array.from(document.querySelectorAll(NOTE_SEL)); if (notes.length === 0) return;
    const vp = document.getElementById('board-viewport');
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    notes.forEach(n => { const x = parseFloat(n.style.left), y = parseFloat(n.style.top); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + n.offsetWidth); maxY = Math.max(maxY, y + n.offsetHeight); });
    // Handy: nur die Breite einpassen (lesbar, nach unten scrollen); sonst alles auf einen Blick
    const byWidth = vp.clientWidth / (maxX - minX + 80);
    const z = Math.max(0.25, boardIsNarrow() ? Math.min(byWidth, 1.2) : Math.min(byWidth, vp.clientHeight / (maxY - minY + 80), 1.2));
    animateBoardView(z, (minX + maxX) / 2, boardIsNarrow() ? minY - 40 + vp.clientHeight / (2 * z) : (minY + maxY) / 2, 450);
}
function centerOnCard(id) {
    const el = document.getElementById('note-' + id); if (!el) return;
    animateBoardView(Math.max(boardZoom, boardIsNarrow() ? NARROW_ZOOM : 0.75), parseFloat(el.style.left) + el.offsetWidth / 2, parseFloat(el.style.top) + el.offsetHeight / 2, 500);
}

// =========================================
// FOKUS & SUCHE: das Netz einer Karte hervorheben, alles andere abdunkeln
// =========================================
function computeFocusSet() {
    const vis = new Set([String(boardFocus.id)]); let frontier = [String(boardFocus.id)];
    for (let d = 0; d < boardFocus.depth; d++) {
        const next = [];
        frontier.forEach(f => globalLinks.forEach(l => { const a = String(l.start), b = String(l.end); const o = a === f ? b : (b === f ? a : null); if (o && !vis.has(o)) { vis.add(o); next.push(o); } }));
        frontier = next;
    }
    focusVisible = vis;
}
function setFocus(id, depth = 1) { boardFocus = { id: Number(id), depth }; computeFocusSet(); renderFocusBar(); renderBoard(); }
function clearFocus() { boardFocus = null; focusVisible = new Set(); renderFocusBar(); renderBoard(); }
function renderFocusBar() {
    const bar = document.getElementById('focus-bar');
    if (!boardFocus) { bar.hidden = true; bar.innerHTML = ''; return; }
    const title = String(nodeTitle(boardFocus.id)); const count = focusVisible.size - 1;
    bar.innerHTML = `<span>🔦 Fokus: <strong>${esc(title.length > 40 ? title.slice(0, 40) + '…' : title)}</strong> · ${count} ${boardFocus.depth === 1 ? (count === 1 ? 'direkter Kontakt' : 'direkte Kontakte') : 'Kontakte bis zum 2. Grad'}</span>
        <button class="tool-btn" onclick="setFocus(${boardFocus.id}, ${boardFocus.depth === 1 ? 2 : 1})">${boardFocus.depth === 1 ? '+ 2. Grad' : 'nur direkte'}</button>
        <button class="tool-btn" onclick="clearFocus()">✕ Fokus beenden</button>`;
    bar.hidden = false;
}
function updateSearchList() {
    const dl = document.getElementById('board-search-list');
    const html = [...new Set(getBoardNodes().map(n => String(nodeTitle(n.id))))].sort((a, b) => a.localeCompare(b)).map(t => `<option value="${esc(t)}">`).join('');
    if (dl._html !== html) { dl.innerHTML = html; dl._html = html; }
}
function boardSearch(input) {
    const q = input.value.trim().toLowerCase(); if (!q) return;
    const nodes = getBoardNodes(); const title = n => String(nodeTitle(n.id)).toLowerCase();
    const node = nodes.find(n => title(n) === q) || nodes.find(n => title(n).includes(q));
    if (!node) { showToast('Keine passende Karte gefunden'); return; }
    input.value = ''; input.blur();
    setFocus(node.id, 1); centerOnCard(node.id); pulseCard(node.id);
}

// =========================================
// AUFRÄUMEN: verbundene Karten gruppieren, Gruppen und lose Karten sinnvoll anordnen
// =========================================
function arrangeBoard() {
    const nodes = Array.from(document.querySelectorAll(NOTE_SEL)).map(el => ({ el, id: el.dataset.id, w: el.offsetWidth, h: el.offsetHeight }));
    if (nodes.length === 0) return;
    const layout = smartLayout(nodes);
    const revert = {}, updates = {};
    nodes.forEach(n => { const p = globalPositions[n.id]; revert['positions/' + n.id] = p ? { x: p.x, y: p.y } : null; updates[n.id] = layout.get(n.id); });
    // Karten gleiten als sanfte Welle von links nach rechts an ihren Platz
    [...nodes].sort((a, b) => layout.get(a.id).x - layout.get(b.id).x).forEach((n, i) => { const p = layout.get(n.id); placeNote(n.el, p.x, p.y, true, 0.75, Math.min(i * 0.015, 0.35)); });
    updateBoardSize(); fitBoard();
    db.ref('positions').update(updates);
    pushUndo('Pinnwand aufgeräumt', revert);
}

function smartLayout(nodes) {
    const index = new Map(nodes.map((n, i) => [String(n.id), i]));
    const adj = nodes.map(() => new Set());
    globalLinks.forEach(l => { const a = index.get(String(l.start)), b = index.get(String(l.end)); if (a !== undefined && b !== undefined && a !== b) { adj[a].add(b); adj[b].add(a); } });
    // Zusammenhängende Gruppen (über Fäden erreichbar) finden – größte zuerst
    const seen = new Array(nodes.length).fill(false); const groups = [];
    nodes.forEach((_, start) => {
        if (seen[start] || adj[start].size === 0) return;
        const list = [start]; seen[start] = true;
        for (let k = 0; k < list.length; k++) adj[list[k]].forEach(j => { if (!seen[j]) { seen[j] = true; list.push(j); } });
        groups.push(list);
    });
    groups.sort((a, b) => b.length - a.length);
    const boxes = groups.map(list => forceLayoutBox(list, nodes, adj));
    // Lose Karten nach Art bündeln: Personen nach Status, dann Zettel, Beweismittel, Orte
    const info = new Map(getBoardNodes().map(n => [String(n.id), n]));
    const LOOSE_ORDER = ['npc:Verdächtig', 'npc:Vermisst', 'npc:Kooperativ', 'npc:Unauffällig', 'npc:', 'npc:Verstorben', 'zettel', 'handout', 'pin'];
    const looseKey = i => { const n = info.get(String(nodes[i].id)); if (!n) return 'zettel'; if (n.kind !== 'npc') return n.kind; const k = 'npc:' + n.data.status; return LOOSE_ORDER.includes(k) ? k : 'npc:'; };
    const loose = new Map(LOOSE_ORDER.map(k => [k, []]));
    nodes.forEach((_, i) => { if (adj[i].size === 0) loose.get(looseKey(i)).push(i); });
    loose.forEach(list => {
        if (list.length === 0) return;
        list.sort((a, b) => String(nodeTitle(nodes[a].id)).localeCompare(String(nodeTitle(nodes[b].id))));
        boxes.push(gridBox(list, nodes));
    });
    return packBoxes(boxes, nodes);
}

// Netz-Layout einer Gruppe (Stress-Layout): Jede Karte bekommt zu jeder anderen einen Zielabstand
// proportional zur Anzahl Fäden dazwischen – direkt Verbundene hängen nebeneinander, das Netz bleibt kompakt
function forceLayoutBox(list, nodes, adj) {
    const n = list.length, L = 230;
    const local = new Map(list.map((g, k) => [g, k]));
    // Kürzeste Wege (in Fäden) zwischen allen Karten der Gruppe
    const D = list.map(src => {
        const dist = new Array(n).fill(Infinity); dist[local.get(src)] = 0; const queue = [src];
        for (let k = 0; k < queue.length; k++) adj[queue[k]].forEach(j => { const lj = local.get(j); if (lj !== undefined && dist[lj] === Infinity) { dist[lj] = dist[local.get(queue[k])] + 1; queue.push(j); } });
        return dist;
    });
    // Start: Ringe um die am stärksten vernetzte Karte
    const hub = local.get(list.reduce((best, g) => adj[g].size > adj[best].size ? g : best, list[0]));
    const rings = new Map(); D[hub].forEach((d, k) => { if (!rings.has(d)) rings.set(d, []); rings.get(d).push(k); });
    const px = new Array(n).fill(0), py = new Array(n).fill(0);
    rings.forEach((ring, d) => ring.forEach((k, idx) => { const ang = (idx / ring.length) * Math.PI * 2 + d * 0.7; px[k] = Math.cos(ang) * d * L; py[k] = Math.sin(ang) * d * L; }));
    // Stress per stochastischem Gradientenabstieg (feste Reihenfolge, damit alle dasselbe Ergebnis sehen)
    const pairs = []; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
    let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const maxD = Math.max(1, ...D.flat().filter(Number.isFinite));
    const etaMax = (maxD * L) ** 2, etaMin = 0.01 * L * L, ROUNDS = 40;
    for (let t = 0; t < ROUNDS; t++) {
        const eta = etaMax * Math.pow(etaMin / etaMax, t / (ROUNDS - 1));
        for (let k = pairs.length - 1; k > 0; k--) { const r = Math.floor(rnd() * (k + 1)); [pairs[k], pairs[r]] = [pairs[r], pairs[k]]; }
        pairs.forEach(([i, j]) => {
            const target = D[i][j] * L; const mu = Math.min(1, eta / (target * target));
            const vx = px[i] - px[j], vy = py[i] - py[j], mag = Math.max(0.01, Math.hypot(vx, vy));
            const r = mu * (mag - target) / 2 / mag;
            px[i] -= r * vx; py[i] -= r * vy; px[j] += r * vx; py[j] += r * vy;
        });
    }
    // Netz so drehen, dass seine lange Seite zur Bildschirmform passt (quer am PC, hochkant am Handy)
    const mx = px.reduce((s, v) => s + v, 0) / n, my = py.reduce((s, v) => s + v, 0) / n;
    let sxx = 0, syy = 0, sxy = 0; for (let k = 0; k < n; k++) { const ax = px[k] - mx, ay = py[k] - my; sxx += ax * ax; syy += ay * ay; sxy += ax * ay; }
    const narrow = boardIsNarrow();
    const turn = (boardAspect() >= 1 ? 0 : Math.PI / 2) - 0.5 * Math.atan2(2 * sxy, sxx - syy);
    for (let k = 0; k < n; k++) {
        const ax = px[k] - mx, ay = py[k] - my;
        // Zusammenschieben: danach werden nur echte Überlappungen wieder aufgelöst – so bleibt kein leerer Kork zwischen den Karten
        px[k] = (ax * Math.cos(turn) - ay * Math.sin(turn)) * 0.8; py[k] = (ax * Math.sin(turn) + ay * Math.cos(turn)) * 0.8;
    }
    const w = list.map(g => nodes[g].w), h = list.map(g => nodes[g].h);
    if (!narrow && n > 2) { // Netz an die Bildschirmform anpassen (Breitbild: breiter und flacher)
        const rx = Math.max(...px) - Math.min(...px) + 150, ry = Math.max(...py) - Math.min(...py) + 200;
        const f = Math.max(0.7, Math.min(1.8, Math.sqrt(boardAspect() * 0.85 / (rx / ry))));
        for (let k = 0; k < n; k++) { px[k] *= f; py[k] /= f; }
    }
    if (narrow) { // Handy: Breite begrenzen, damit die Wand lesbar bleibt – es wird dann nur nach unten gescrollt
        const minX = Math.min(...px), range = Math.max(...px) - minX, allowed = narrowBoardWidth() - Math.max(...w);
        if (range > allowed) for (let k = 0; k < n; k++) px[k] = (px[k] - minX) * allowed / range;
    }
    resolveOverlaps(px, py, w, h, narrow);
    return toBox(list, px, py, w, h);
}
// Schiebt überlappende Karten (echte Größe + Abstand für Etiketten) auseinander; verticalOnly hält die Breite fest (Handy)
// Beim Aufräumen etwas mehr Luft als beim Platzieren einzelner Karten, damit Etiketten an dicht vernetzten Karten Platz haben
const LAYOUT_GAP_X = 90, LAYOUT_GAP_Y = 70;
function resolveOverlaps(px, py, w, h, verticalOnly = false) {
    for (let pass = 0; pass < 600; pass++) {
        let moved = false;
        for (let a = 0; a < px.length; a++) for (let b = a + 1; b < px.length; b++) {
            const vx = px[a] - px[b], vy = py[a] - py[b];
            const ox = (w[a] + w[b]) / 2 + LAYOUT_GAP_X - Math.abs(vx), oy = (h[a] + h[b]) / 2 + LAYOUT_GAP_Y - Math.abs(vy);
            if (ox <= 0 || oy <= 0) continue;
            moved = true;
            if (ox < oy && !verticalOnly) { const s = (vx >= 0 ? 1 : -1) * ox / 2; px[a] += s; px[b] -= s; }
            else { const s = (vy > 0 || (vy === 0 && a > b) ? 1 : -1) * oy / 2; py[a] += s; py[b] -= s; }
        }
        if (!moved) break;
    }
}
function toBox(list, px, py, w, h) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    list.forEach((_, k) => { minX = Math.min(minX, px[k] - w[k] / 2); minY = Math.min(minY, py[k] - h[k] / 2); maxX = Math.max(maxX, px[k] + w[k] / 2); maxY = Math.max(maxY, py[k] + h[k] / 2); });
    return { w: maxX - minX, h: maxY - minY, items: list.map((g, k) => ({ g, x: px[k] - w[k] / 2 - minX, y: py[k] - h[k] / 2 - minY })) };
}
// Lose Karten einer Art im Raster
function gridBox(list, nodes) {
    const colW = Math.max(...list.map(g => nodes[g].w)) + CARD_GAP_X;
    let cols = Math.max(2, Math.ceil(Math.sqrt(list.length)));
    if (boardIsNarrow()) cols = Math.max(1, Math.floor((narrowBoardWidth() + CARD_GAP_X) / colW));
    const items = []; let y = 0;
    for (let r = 0; r < list.length; r += cols) {
        const row = list.slice(r, r + cols);
        row.forEach((g, c) => items.push({ g, x: c * colW, y }));
        y += Math.max(...row.map(g => nodes[g].h)) + CARD_GAP_Y;
    }
    return { w: Math.min(cols, list.length) * colW - CARD_GAP_X, h: y - CARD_GAP_Y, items };
}
function boardAspect() { const vp = document.getElementById('board-viewport'); return vp.clientWidth && vp.clientHeight ? vp.clientWidth / vp.clientHeight : 1.6; }
// Handy (schmaler Ausschnitt): Wand nur so breit, dass sie bei ca. 55 % Zoom lesbar ist
const NARROW_ZOOM = 0.55;
function boardIsNarrow() { const vp = document.getElementById('board-viewport'); return vp.clientWidth > 0 && vp.clientWidth < 600; }
function narrowBoardWidth() { return document.getElementById('board-viewport').clientWidth / NARROW_ZOOM - 60; }
// Gruppen dicht packen: jede Gruppe an die höchste freie Stelle (dann möglichst links).
// Am PC werden mehrere Gesamtbreiten probiert – genommen wird die, bei der die Wand am größten auf den Bildschirm passt.
function packBoxes(boxes, nodes) {
    const GAP = 100;
    const packWith = maxW => {
        const placed = [];
        boxes.forEach(box => {
            const xs = [0, ...placed.map(p => p.x + p.w + GAP)], ys = [0, ...placed.map(p => p.y + p.h + GAP)];
            let best = null;
            ys.forEach(y => xs.forEach(x => {
                if (x > 0 && x + box.w > maxW) return;
                if (placed.some(p => x < p.x + p.w + GAP && x + box.w + GAP > p.x && y < p.y + p.h + GAP && y + box.h + GAP > p.y)) return;
                if (!best || y < best.y || (y === best.y && x < best.x)) best = { x, y };
            }));
            placed.push({ ...best, w: box.w, h: box.h, box });
        });
        return { placed, W: Math.max(...placed.map(p => p.x + p.w)), H: Math.max(...placed.map(p => p.y + p.h)) };
    };
    const widest = Math.max(...boxes.map(b => b.w));
    let chosen;
    if (boardIsNarrow()) chosen = packWith(Math.max(widest, narrowBoardWidth()));
    else {
        const vp = document.getElementById('board-viewport'); const vw = vp.clientWidth || 1600, vh = vp.clientHeight || 900;
        const total = boxes.reduce((s, b) => s + b.w + GAP, 0);
        for (let i = 0; i <= 16; i++) {
            const candidate = packWith(widest + (total - widest) * i / 16);
            candidate.zoom = Math.min(vw / (candidate.W + 80), vh / (candidate.H + 80));
            if (!chosen || candidate.zoom > chosen.zoom + 0.001) chosen = candidate;
        }
    }
    const result = new Map();
    chosen.placed.forEach(p => p.box.items.forEach(it => result.set(String(nodes[it.g].id), { x: Math.round(40 + p.x + it.x), y: Math.round(40 + p.y + it.y) })));
    return result;
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

// =========================================
// ZIEHEN per Maus und Touch (Pointer Events)
// Maus: sofort ziehen. Touch: erst nach kurzem Halten (Karte hebt sich), normales Wischen scrollt die Wand.
// Kurzes Antippen ohne Bewegung = Menü bzw. Verbinden.
// Die Karte wird per GPU-Transform verschoben (kein Layout pro Frame) und nur einmal pro Bildschirm-Frame aktualisiert.
// =========================================
function onNotePointerDown(e) {
    lastPointerType = e.pointerType;
    if (e.button !== 0) return;
    const note = e.currentTarget;
    const c = document.getElementById('board-container').getBoundingClientRect();
    const baseX = parseFloat(note.style.left), baseY = parseFloat(note.style.top);
    note.style.setProperty('--glide', '0s'); // eine laufende Gleit-Animation nicht mit dem Ziehen vermischen
    const touch = e.pointerType !== 'mouse';
    const s = dragState = { note, id: Number(note.dataset.id), startX: e.clientX, startY: e.clientY, baseX, baseY, x: baseX, y: baseY, offX: (e.clientX - c.left) / boardZoom - baseX, offY: (e.clientY - c.top) / boardZoom - baseY, moved: false, lastSync: 0, raf: 0, touch, armed: !touch, timer: 0 };
    if (touch) s.timer = setTimeout(() => armTouchDrag(s), LONG_PRESS_MS);
    note.setPointerCapture(e.pointerId);
}
function armTouchDrag(s) {
    if (dragState !== s || s.moved) return;
    s.armed = true; s.note.classList.add('lifting');
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) {}
}
// Touch-Druck abbrechen, bevor gezogen wurde (Finger scrollt oder zweiter Finger zoomt)
function cancelPendingDrag() {
    const s = dragState; if (!s || s.moved) return;
    clearTimeout(s.timer); s.note.classList.remove('lifting'); dragState = null;
}
function onNotePointerMove(e) {
    const s = dragState; if (!s || s.note !== e.currentTarget) return;
    const dist = Math.hypot(e.clientX - s.startX, e.clientY - s.startY);
    if (!s.armed) { if (dist > 10) cancelPendingDrag(); return; } // Finger bewegt sich vor dem Halten = Scrollen
    if (!s.moved) {
        if (dist < (s.touch ? 2 : 6)) return;
        s.moved = true; currentDragElement = s.note; s.note.classList.remove('lifting'); s.note.classList.add('dragging');
        if (hoverNodeId !== null) { hoverNodeId = null; updateStringStates(); } // Leuchtfilter beim Ziehen aus – er müsste sonst jeden Frame neu berechnet werden
        s.rects = cardRects().filter(r => r.el !== s.note); // andere Karten bewegen sich nicht – einmal messen reicht
        drawAllStrings(s.id, s.rects);
    }
    s.clientX = e.clientX; s.clientY = e.clientY;
    if (!s.raf) s.raf = requestAnimationFrame(() => { s.raf = 0; applyDrag(s); });
}
function applyDrag(s) {
    if (dragState !== s || s.clientX === undefined) return;
    const c = document.getElementById('board-container').getBoundingClientRect();
    s.x = Math.round(Math.max(0, (s.clientX - c.left) / boardZoom - s.offX)); s.y = Math.round(Math.max(0, (s.clientY - c.top) / boardZoom - s.offY));
    s.note._dragPos = { x: s.x, y: s.y };
    s.note.style.setProperty('--dx', (s.x - s.baseX) + 'px'); s.note.style.setProperty('--dy', (s.y - s.baseY) + 'px');
    if (s.x + 200 > boardW || s.y + 250 > boardH) { boardExtent = { x: Math.max(boardExtent.x, s.x + 160), y: Math.max(boardExtent.y, s.y + 260) }; updateBoardSize(false); }
    drawAllStrings(s.id, s.rects);
    const now = Date.now(); if (now - s.lastSync > 150) { s.lastSync = now; db.ref('positions/' + s.id).set({ x: s.x, y: s.y }); } // live für die anderen
}
function onNotePointerUp(e) {
    const s = dragState; if (!s || s.note !== e.currentTarget) return;
    clearTimeout(s.timer);
    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; applyDrag(s); }
    dragState = null; s.note.classList.remove('lifting');
    if (s.moved) {
        const note = s.note;
        // Erst endgültige Position setzen und Verschiebung auf 0 – noch ohne Übergang –, dann die Karte "loslassen" (federt kurz nach)
        note.style.left = s.x + 'px'; note.style.top = s.y + 'px'; note.style.setProperty('--dx', '0px'); note.style.setProperty('--dy', '0px');
        delete note._dragPos; void note.offsetWidth;
        currentDragElement = null; note.classList.remove('dragging');
        db.ref('positions/' + s.id).set({ x: s.x, y: s.y });
        // Am Handy mit Hinweis – falls doch versehentlich verschoben; am PC reicht der Knopf bzw. Strg+Z
        if (s.x !== s.baseX || s.y !== s.baseY) pushUndo('Karte verschoben', { ['positions/' + s.id]: { x: s.baseX, y: s.baseY } }, s.touch);
        updateBoardSize(); drawAllStrings();
        const pin = pinEls.get(String(s.id)); if (pin && !REDUCED_MOTION) { pin.classList.remove('drop'); void pin.offsetWidth; pin.classList.add('drop'); } // Nadel wieder einstecken
    } else if (e.type === 'pointerup' && !s.cancelTap) {
        handleNoteTap(s.id, e);
    }
}
// Positionsänderungen anderer (bzw. das Echo der eigenen) während des Ziehens: nur betroffene Karten verschieben
function applyPositionsLight() {
    let changed = false;
    document.querySelectorAll(NOTE_SEL).forEach(note => {
        if (note === currentDragElement) return;
        const pos = globalPositions[note.dataset.id]; if (!pos) return;
        if (parseFloat(note.style.left) !== pos.x || parseFloat(note.style.top) !== pos.y) { placeNote(note, pos.x, pos.y); changed = true; }
    });
    if (changed && dragState) dragState.rects = cardRects().filter(r => r.el !== dragState.note);
}

function handleNoteTap(id, e) {
    if (linkMode || selectedNodeId !== null) { handleLinkSelection(id, e); return; }
    const node = getBoardNodes().find(n => n.id === id); if (!node) return;
    const startLink = { label: '🧵 Faden von hier spannen', action: () => { setLinkMode(true); handleLinkSelection(id, e); } };
    const focusItem = boardFocus && boardFocus.id === id
        ? (boardFocus.depth === 1 ? { label: '🔦 Auch 2. Grad zeigen', action: () => setFocus(id, 2) } : { label: '🔦 Fokus beenden', action: clearFocus })
        : { label: '🔦 Netz zeigen', action: () => setFocus(id, 1) };
    const removeCard = { label: '🗑 Von Pinnwand entfernen', danger: true, action: () => removeCardFromBoard(id, 'Karte von der Pinnwand genommen') };
    if (node.kind === 'npc') {
        const person = node.data;
        const items = [focusItem, startLink, { label: '📂 Akte anzeigen', action: () => showPerson(id) }];
        if (person.image && person.image.trim() !== '') items.push({ label: '🔍 Bild vergrößern', action: () => openLightbox(person.image) });
        showMenu(e.clientX, e.clientY, person.name, items);
    } else if (node.kind === 'handout') {
        const items = [focusItem, startLink, { label: '📄 Im Archiv öffnen', action: () => showHandout(node.ref.id) }];
        if (node.ref.image && node.ref.image.trim() !== '') items.push({ label: '🔍 Bild vergrößern', action: () => openLightbox(node.ref.image) });
        showMenu(e.clientX, e.clientY, node.ref.title, [...items, removeCard]);
    } else if (node.kind === 'pin') {
        showMenu(e.clientX, e.clientY, node.ref.note, [focusItem, startLink, { label: '🗺 Auf Karte zeigen', action: () => showPinOnMap(node.ref.id) }, removeCard]);
    } else {
        const zettel = node.data;
        showMenu(e.clientX, e.clientY, zettel.text, [
            focusItem, startLink,
            { label: '✎ Text bearbeiten', action: () => { const t = prompt("Zettel bearbeiten:", zettel.text); if (t && t.trim() !== "" && t.trim() !== zettel.text) { db.ref('boardNotes/' + id).update({ text: t.trim() }); pushUndo('Zettel geändert', { ['boardNotes/' + id + '/text']: zettel.text }); } } },
            { label: '🎨 Farbe wechseln', action: () => { db.ref('boardNotes/' + id).update({ color: ((zettel.color || 0) + 1) % NOTE_COLORS.length }); pushUndo('Farbe geändert', { ['boardNotes/' + id + '/color']: zettel.color || 0 }, false); } },
            { label: '🗑 Zettel entfernen', danger: true, action: () => removeCardFromBoard(id, 'Zettel entfernt') }
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
    pushUndo('An die Pinnwand geheftet', { ['boardNotes/' + id]: null, ['positions/' + id]: null });
}
function addBoardNote() {
    const text = prompt("Was soll auf den Zettel? (z.B. Hinweis, Theorie)"); if (!text || text.trim() === "") return;
    const id = Date.now();
    db.ref().update({ ['boardNotes/' + id]: { id, text: text.trim(), color: 0 }, ['positions/' + id]: findVisibleFreeSpot() });
    pushUndo('Zettel angeheftet', { ['boardNotes/' + id]: null, ['positions/' + id]: null });
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
                if (labelInput === null) return;
                const key = start + "_" + id;
                db.ref('links/' + key).set({ start, end: id, label: labelInput.trim(), type });
                pushUndo('Faden gespannt', { ['links/' + key]: null });
            });
        }
        selectedNodeId = null;
    }
    renderBoard();
}

function openLinkMenu(link, e) {
    const key = link.dbKey;
    showMenu(e.clientX, e.clientY, `${nodeTitle(link.start)} ↔ ${nodeTitle(link.end)}\n(${linkType(link).label})`, [
        { label: '✎ Beschriftung ändern', action: () => { const l = prompt("Beschriftung des Fadens:", link.label || ''); if (l !== null && l.trim() !== (link.label || '')) { db.ref('links/' + key).update({ label: l.trim() }); pushUndo('Beschriftung geändert', { ['links/' + key + '/label']: link.label || '' }, false); } } },
        { label: '🎨 Art ändern', action: () => chooseLinkType(e, 'Art der Verbindung', type => { db.ref('links/' + key).update({ type }); pushUndo('Fadenart geändert', { ['links/' + key + '/type']: link.type || null }, false); }) },
        { label: '🗑 Faden löschen', danger: true, action: () => { db.ref('links/' + key).remove(); pushUndo('Faden gelöscht', { ['links/' + key]: linkData(link) }); } }
    ]);
}
function clearStrings() {
    if (!globalLinks.length || !confirm("Alle Fäden löschen?")) return;
    const revert = {}; globalLinks.forEach(l => { revert['links/' + l.dbKey] = linkData(l); });
    db.ref('links').remove();
    pushUndo('Alle Fäden gelöscht', revert);
}

// =========================================
// FÄDEN & NADELN
// Der Faden läuft HINTER fremden Karten durch. Sichtbar auf einer Karte ist nur das kurze Stück am Knoten
// um die eigene Nadel – so verdecken Fäden keine Gesichter und Namen.
// =========================================
// Position einer Karte: beim Ziehen die aktuelle Zugposition, sonst offsetLeft (folgt auch Gleit-Animationen)
function notePos(el) { return el._dragPos || { x: el.offsetLeft, y: el.offsetTop }; }
function noteRect(el) { const p = notePos(el); return { el, x: p.x, y: p.y, w: el.offsetWidth, h: el.offsetHeight }; }
function pinAnchor(el) { const p = notePos(el); return { x: p.x + el.offsetWidth / 2, y: p.y + PIN_OFFSET_Y }; }
function cardRects() { return Array.from(document.querySelectorAll(NOTE_SEL)).map(noteRect); }
// Punkt bzw. Teilstück der quadratischen Fadenkurve
function quadAt(g, t) { const u = 1 - t; return { x: u * u * g.x1 + 2 * u * t * g.cx + t * t * g.x2, y: u * u * g.y1 + 2 * u * t * g.cy + t * t * g.y2 }; }
function quadSegment(g, t0, t1) {
    const p0 = quadAt(g, t0), p1 = quadAt(g, t1), k = (t1 - t0) / 2;
    const dx = 2 * (1 - t0) * (g.cx - g.x1) + 2 * t0 * (g.x2 - g.cx), dy = 2 * (1 - t0) * (g.cy - g.y1) + 2 * t0 * (g.y2 - g.cy);
    return { x0: p0.x, y0: p0.y, cx: p0.x + dx * k, cy: p0.y + dy * k, x1: p1.x, y1: p1.y };
}
function segPath(s, ox = 0, oy = 0) { return `M${s.x0 + ox},${s.y0 + oy} Q${s.cx + ox},${s.cy + oy} ${s.x1 + ox},${s.y1 + oy}`; }
// Sichtbare Stücke auf den eigenen Karten: von der Nadel bis zum Kartenrand, höchstens KNOT_LENGTH lang
function knotSegments(g) {
    if (g.tA >= g.tB) return [quadSegment(g, 0, 1)]; // Karten überlappen – ganzer Faden sichtbar
    const len = (Math.hypot(g.cx - g.x1, g.cy - g.y1) + Math.hypot(g.x2 - g.cx, g.y2 - g.cy) + Math.hypot(g.x2 - g.x1, g.y2 - g.y1)) / 2;
    const knot = Math.min(0.5, KNOT_LENGTH / Math.max(1, len));
    return [quadSegment(g, 0, Math.min(g.tA, knot)), quadSegment(g, Math.max(g.tB, 1 - knot), 1)];
}
// Faden von Nadel zu Nadel, hängt je nach Länge durch. Das Etikett sitzt auf dem sichtbaren Stück zwischen den Karten,
// möglichst mittig, und rutscht an eine Stelle, an der es keine Karte verdeckt
const newLinkTimes = new Map();
function linkGeometry(link, rects = cardRects()) {
    const a = document.getElementById('note-' + link.start), b = document.getElementById('note-' + link.end); if (!a || !b) return null;
    const p1 = pinAnchor(a), p2 = pinAnchor(b);
    let sag = Math.min(110, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.16) + 8;
    const born = newLinkTimes.get(link.dbKey);
    if (born !== undefined) { // neuer Faden hängt erst locker durch und strafft sich dann
        const p = Math.min(1, (performance.now() - born) / TIGHTEN_MS);
        if (p >= 1) newLinkTimes.delete(link.dbKey); else sag *= 1 + 1.6 * Math.pow(1 - p, 3);
    }
    const g = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, cx: (p1.x + p2.x) / 2, cy: (p1.y + p2.y) / 2 + sag };
    // Wo verlässt der Faden die eigenen Karten?
    const inside = (p, r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
    const ra = noteRect(a), rb = noteRect(b);
    let tA = 0; while (tA < 1 && inside(quadAt(g, tA), ra)) tA += 0.02;
    let tB = 1; while (tB > 0 && inside(quadAt(g, tB), rb)) tB -= 0.02;
    g.tA = Math.min(1, tA); g.tB = Math.max(0, tB);
    const covers = p => rects.some(r => p.x > r.x - 35 && p.x < r.x + r.w + 35 && p.y > r.y - 12 && p.y < r.y + r.h + 12);
    const from = g.tA < g.tB ? g.tA : 0, to = g.tA < g.tB ? g.tB : 1;
    const spot = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82].map(t => quadAt(g, from + (to - from) * t)).find(p => !covers(p)) || quadAt(g, (from + to) / 2);
    g.lx = spot.x; g.ly = spot.y;
    return g;
}

// Fäden, Etiketten und Nadeln bleiben als Elemente bestehen und werden nur aktualisiert.
// Mit onlyNodeId (beim Ziehen) werden nur die Fäden dieser einen Karte neu berechnet.
const stringEls = new Map(); const pinEls = new Map();
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, cls) { const el = document.createElementNS(SVG_NS, tag); if (cls) el.setAttribute('class', cls); return el; }
function createStringEls(link) {
    const yarn = () => { const g = svgEl('g', 'yarn-group'); const parts = { shadow: svgEl('path', 'yarn-shadow'), base: svgEl('path', 'yarn'), twist: svgEl('path', 'yarn-twist') }; g.append(parts.shadow, parts.base, parts.twist); return { g, ...parts }; };
    const els = { under: yarn(), over: yarn(), label: document.createElement('div') };
    els.label.className = 'string-label';
    const key = link.dbKey; const current = () => globalLinks.find(l => l.dbKey === key);
    els.label.onclick = e => { const l = current(); if (l) openLinkMenu(l, e); };
    els.label.oncontextmenu = e => { e.preventDefault(); const l = current(); if (l) openLinkMenu(l, e); };
    els.label.onpointerenter = () => { hoverNodeId = null; els.under.g.classList.add('hl'); els.over.g.classList.add('hl'); };
    els.label.onpointerleave = () => { const l = current(); if (l) setStringState(l, els); };
    if (newLinkTimes.has(key)) { [els.under.g, els.over.g, els.label].forEach(x => x.classList.add('appear')); setTimeout(() => [els.under.g, els.over.g, els.label].forEach(x => x.classList.remove('appear')), 1000); }
    document.getElementById('strings-under').appendChild(els.under.g); document.getElementById('strings-over').appendChild(els.over.g);
    document.getElementById('string-labels-container').appendChild(els.label);
    stringEls.set(key, els);
    return els;
}
function removeStringEls(key, els) {
    stringEls.delete(key);
    const parts = [els.under.g, els.over.g, els.label];
    parts.forEach(x => x.classList.add('leaving'));
    setTimeout(() => parts.forEach(x => x.remove()), REDUCED_MOTION ? 0 : 320);
}
function setStringState(link, els) {
    const dim = !!boardFocus && !(focusVisible.has(String(link.start)) && focusVisible.has(String(link.end)));
    const hl = !dim && ((hoverNodeId !== null && linkTouches(link, hoverNodeId)) || (selectedNodeId !== null && linkTouches(link, selectedNodeId)) || (!!boardFocus && linkTouches(link, boardFocus.id)));
    [els.under.g, els.over.g, els.label].forEach(x => { x.classList.toggle('dim', dim); x.classList.toggle('hl', hl); });
}
function updateStringStates() {
    globalLinks.forEach(l => { const els = stringEls.get(l.dbKey); if (els) setStringState(l, els); });
    pinEls.forEach((p, id) => p.classList.toggle('dim', !!boardFocus && !focusVisible.has(id)));
}
function drawAllStrings(onlyNodeId = null, rectsOverride = null) {
    const notes = Array.from(document.querySelectorAll(NOTE_SEL));
    const rects = rectsOverride ? [...rectsOverride, ...(dragState && dragState.moved ? [{ x: dragState.x, y: dragState.y, w: dragState.note.offsetWidth, h: dragState.note.offsetHeight }] : [])] : cardRects();
    const live = new Set();
    globalLinks.forEach(link => {
        live.add(link.dbKey);
        if (onlyNodeId !== null && !linkTouches(link, onlyNodeId)) return;
        let els = stringEls.get(link.dbKey);
        const g = linkGeometry(link, rects);
        if (!g) { if (els) removeStringEls(link.dbKey, els); return; }
        if (!els) els = createStringEls(link);
        const t = linkType(link);
        // Ganzer Faden unter den Karten, Knoten-Stücke über den eigenen Karten (beide mit Schatten)
        const full = quadSegment(g, 0, 1), knots = knotSegments(g);
        els.under.shadow.setAttribute('d', segPath(full, 2, 5)); els.under.base.setAttribute('d', segPath(full)); els.under.twist.setAttribute('d', segPath(full));
        els.over.shadow.setAttribute('d', knots.map(s => segPath(s, 1.5, 3.5)).join(' ')); els.over.base.setAttribute('d', knots.map(s => segPath(s)).join(' ')); els.over.twist.setAttribute('d', knots.map(s => segPath(s)).join(' '));
        [els.under.g, els.over.g].forEach(x => { x.style.stroke = t.color; x.style.strokeWidth = t.width; });
        els.label.style.left = g.lx + 'px'; els.label.style.top = g.ly + 'px';
        els.label.style.borderTopColor = t.color; els.label.style.setProperty('--rot', tiltFor(link.dbKey, 4).toFixed(1) + 'deg');
        const text = (link.label && link.label.trim() !== "") ? link.label : "🔗"; if (els.label.textContent !== text) els.label.textContent = text;
        els.label.title = t.label + " – klicken zum Bearbeiten oder Löschen";
        if (onlyNodeId === null) setStringState(link, els);
    });
    // Stecknadeln liegen über allem – die Fäden sind darum geknotet
    const pinsLayer = document.getElementById('board-pins'); const livePins = new Set();
    notes.forEach(n => {
        livePins.add(n.dataset.id);
        if (onlyNodeId !== null && Number(n.dataset.id) !== onlyNodeId) return;
        let p = pinEls.get(n.dataset.id);
        if (!p) {
            p = document.createElement('div'); p.className = 'pushpin'; pinsLayer.appendChild(p); pinEls.set(n.dataset.id, p);
            if (boardLoaded && !REDUCED_MOTION) { p.classList.add('drop'); setTimeout(() => p.classList.remove('drop'), 700); } // neue Karte: Nadel wird eingesteckt
        }
        const a = pinAnchor(n);
        p.style.left = a.x + 'px'; p.style.top = a.y + 'px'; p.style.setProperty('--pin', n.dataset.pin || PUSHPIN_COLORS.npc);
        p.style.display = n.classList.contains('dragging') ? 'none' : ''; // abgenommene Karte hat gerade keine Nadel
    });
    if (onlyNodeId === null) { // Verwaiste Elemente (gelöschte Fäden/Karten) ausblenden und entfernen
        stringEls.forEach((els, key) => { if (!live.has(key)) removeStringEls(key, els); });
        pinEls.forEach((p, id) => { if (!livePins.has(id)) { pinEls.delete(id); p.classList.add('leaving'); setTimeout(() => p.remove(), REDUCED_MOTION ? 0 : 300); } });
        updateStringStates();
    }
}

// =========================================
// PINNWAND ALS BILD (PNG) EXPORTIEREN
// =========================================
function exportBoardImage() {
    if (document.querySelectorAll(NOTE_SEL).length === 0) { showToast('Die Pinnwand ist leer'); return; }
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
    const notes = Array.from(document.querySelectorAll(NOTE_SEL));
    const rects = cardRects(); const strings = globalLinks.map(link => ({ link, g: linkGeometry(link, rects) })).filter(s => s.g);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    notes.forEach(n => { const x = parseFloat(n.style.left), y = parseFloat(n.style.top); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + n.offsetWidth); maxY = Math.max(maxY, y + n.offsetHeight); });
    strings.forEach(({ g }) => { minX = Math.min(minX, g.lx - 80); maxX = Math.max(maxX, g.lx + 80); maxY = Math.max(maxY, g.ly + 20, g.cy); });
    const pad = 50, w = maxX - minX + 2 * pad, h = maxY - minY + 2 * pad;
    const scale = Math.min(2, 8000 / Math.max(w, h));
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(w * scale); canvas.height = Math.ceil(h * scale);
    const ctx = canvas.getContext('2d'); ctx.scale(scale, scale); ctx.translate(pad - minX, pad - minY);
    // Kork: Grundfarbe + feste Körnung
    ctx.fillStyle = '#b98b5e'; ctx.fillRect(minX - pad, minY - pad, w, h);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < w * h / 60; i++) { ctx.fillStyle = rnd() < 0.6 ? 'rgba(90,50,20,0.22)' : 'rgba(235,200,150,0.25)'; ctx.fillRect(minX - pad + rnd() * w, minY - pad + rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }

    const curve = (s, color, width, dash, ox = 0, oy = 0) => {
        ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.setLineDash(dash || []);
        ctx.beginPath(); ctx.moveTo(s.x0 + ox, s.y0 + oy); ctx.quadraticCurveTo(s.cx + ox, s.cy + oy, s.x1 + ox, s.y1 + oy); ctx.stroke(); ctx.restore();
    };
    const yarn = (segs, t, shadowOffset) => {
        segs.forEach(s => curve(s, 'rgba(20,10,0,0.28)', t.width, null, shadowOffset[0], shadowOffset[1]));
        segs.forEach(s => curve(s, t.color, t.width));
        segs.forEach(s => curve(s, 'rgba(255,255,255,0.3)', 1, [2, 3]));
    };
    // wie auf der Pinnwand: Fäden hinter den Karten, Knoten-Stücke darüber, dann Nadeln und Etiketten
    strings.forEach(({ link, g }) => yarn([quadSegment(g, 0, 1)], linkType(link), [2, 5]));
    notes.forEach(n => drawNoteOnCanvas(ctx, n, withImages));
    strings.forEach(({ link, g }) => yarn(knotSegments(g), linkType(link), [1.5, 3.5]));
    notes.forEach(n => drawPushpinOnCanvas(ctx, pinAnchor(n), n.dataset.pin || PUSHPIN_COLORS.npc));
    strings.forEach(({ link, g }) => {
        const text = link.label && link.label.trim() !== '' ? link.label : '🔗';
        ctx.save(); ctx.translate(g.lx, g.ly); ctx.rotate(tiltFor(link.dbKey, 4) * Math.PI / 180);
        ctx.font = '600 17px Caveat, "Segoe Print", cursive'; const tw = Math.min(150, ctx.measureText(text).width);
        ctx.shadowColor = 'rgba(30,15,0,0.45)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 3;
        ctx.fillStyle = '#fbf3dc'; ctx.fillRect(-tw / 2 - 8, -11, tw + 16, 22); ctx.shadowColor = 'transparent';
        ctx.fillStyle = linkType(link).color; ctx.fillRect(-tw / 2 - 8, -11, tw + 16, 3);
        ctx.fillStyle = '#2a2a2a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 0, 1, 150);
        ctx.restore();
    });
    return canvas;
}
function drawPushpinOnCanvas(ctx, a, color) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x + 2, a.y + 3); ctx.lineTo(a.x + 7, a.y + 11); ctx.stroke(); // Schatten der Nadel
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 3; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 4;
    const grad = ctx.createRadialGradient(a.x - 3, a.y - 3, 1, a.x, a.y, 8); grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.25, color); grad.addColorStop(1, color);
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(a.x, a.y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(a.x + 1.5, a.y + 1.5, 8, 0.1 * Math.PI, 0.9 * Math.PI); ctx.fill();
    ctx.restore();
}
// Zeichnet eine Karte anhand ihres tatsächlichen Layouts im DOM nach (Farben, Text, Bilder, Neigung, Stempel)
function drawNoteOnCanvas(ctx, n, withImages) {
    const x = parseFloat(n.style.left), y = parseFloat(n.style.top), w = n.offsetWidth, h = n.offsetHeight; const cs = getComputedStyle(n);
    ctx.save();
    const rot = parseFloat(n.style.getPropertyValue('--rot')) || 0;
    ctx.translate(x + w / 2, y + PIN_OFFSET_Y); ctx.rotate(rot * Math.PI / 180); ctx.translate(-(x + w / 2), -(y + PIN_OFFSET_Y));
    ctx.save(); ctx.shadowColor = 'rgba(30,15,0,0.45)'; ctx.shadowBlur = 12; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 7;
    ctx.fillStyle = cs.backgroundColor; ctx.fillRect(x, y, w, h); ctx.restore();
    if (n.classList.contains('index-card')) { // Karteikarten-Linien
        ctx.fillStyle = 'rgba(80,130,200,0.3)'; for (let ly = y + 42; ly < y + h - 4; ly += 19) ctx.fillRect(x, ly, w, 1);
        ctx.fillStyle = 'rgba(214,64,64,0.6)'; ctx.fillRect(x, y + 24, w, 1);
    }
    const bt = parseFloat(cs.borderTopWidth); if (bt > 1) { ctx.fillStyle = cs.borderTopColor; ctx.fillRect(x, y, w, bt); }
    Array.from(n.children).forEach(child => {
        if (child.style.display === 'none') return;
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
    if (n.dataset.stamp) { // Status-Stempel
        const st = getComputedStyle(n, '::after');
        ctx.save(); ctx.translate(x + w / 2, y + h * 0.45); ctx.rotate(-16 * Math.PI / 180);
        ctx.font = `bold 15px ${st.fontFamily}`; const tw = ctx.measureText(n.dataset.stamp).width + 14;
        ctx.globalAlpha = 0.85; ctx.strokeStyle = st.color; ctx.fillStyle = st.color; ctx.lineWidth = 2;
        ctx.strokeRect(-tw / 2, -13, tw, 26); ctx.strokeRect(-tw / 2 + 3, -10, tw - 6, 20);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(n.dataset.stamp, 0, 1);
        ctx.restore();
    }
    ctx.restore();
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
