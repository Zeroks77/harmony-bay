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
let selectedNodeId = null; let linkMode = false; let currentDragElement = null; let dragState = null;
let boardZoom = loadPref('hb-board-zoom', 1); let boardW = BOARD_MIN_W; let boardH = BOARD_MIN_H;

function initPinnwand() {
    renderLinkLegend();
    document.getElementById('board-container').style.backgroundImage = `url(${corkTexture()})`;
    db.ref('positions').on('value', snap => {
        globalPositions = snap.val() || {};
        // Während eine Karte gezogen wird, nur die anderen Karten nachziehen – kein kompletter Neuaufbau (sonst ruckelt es)
        if (dragState && dragState.moved) applyPositionsLight(); else renderBoard();
    });
    db.ref('boardNotes').on('value', snap => { globalBoardNotes = Object.values(snap.val() || {}); renderBoard(); });
    db.ref('links').on('value', snap => { const data = snap.val() || {}; globalLinks = Object.keys(data).map(key => ({...data[key], dbKey: key})); drawAllStrings(); });
    attachZoomGestures(document.getElementById('board-viewport'), () => boardZoom, setBoardZoom);
    window.addEventListener('resize', () => { if (document.getElementById('tab-pinnwand').classList.contains('active-tab')) { updateBoardSize(); drawAllStrings(); } });
}

function linkType(link) { return LINK_TYPES[link.type] || LINK_TYPES.unklar; }
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
        note.className = cls + (note === currentDragElement ? ' dragging' : '') + (selectedNodeId === node.id ? ' selected-for-link' : '');
        note.style.setProperty('--rot', tiltFor(node.id, node.kind === 'zettel' ? 4 : 3).toFixed(2) + 'deg');
        note.dataset.pin = pin;
        if (stamp) note.dataset.stamp = stamp; else delete note.dataset.stamp;

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
let boardExtent = { x: 0, y: 0 };
function updateBoardSize(measure = true) {
    const container = document.getElementById('board-container'); const vp = document.getElementById('board-viewport');
    if (measure) { // Kartenausdehnung nur neu messen, wenn sich Karten geändert haben (nicht bei jedem Zoomschritt)
        let maxX = 0, maxY = 0;
        container.querySelectorAll('.board-note').forEach(n => { maxX = Math.max(maxX, parseFloat(n.style.left) + (n.offsetWidth || 140)); maxY = Math.max(maxY, parseFloat(n.style.top) + (n.offsetHeight || 170)); });
        boardExtent = { x: maxX, y: maxY };
    }
    boardW = Math.ceil(Math.max(BOARD_MIN_W, vp.clientWidth / boardZoom, boardExtent.x + BOARD_PAD));
    boardH = Math.ceil(Math.max(BOARD_MIN_H, vp.clientHeight / boardZoom, boardExtent.y + BOARD_PAD));
    container.style.width = boardW + 'px'; container.style.height = boardH + 'px'; container.style.transform = `scale(${boardZoom})`;
    const sizer = document.getElementById('board-sizer'); sizer.style.width = boardW * boardZoom + 'px'; sizer.style.height = boardH * boardZoom + 'px';
    document.getElementById('zoom-label').innerText = Math.round(boardZoom * 100) + '%';
}

function setBoardZoom(z, anchorX, anchorY) {
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
function zoomBoard(dir) { setBoardZoom(boardZoom * (dir > 0 ? 1.2 : 1 / 1.2)); }
function fitBoard() {
    const notes = Array.from(document.querySelectorAll('#board-container .board-note')); if (notes.length === 0) return;
    const vp = document.getElementById('board-viewport');
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    notes.forEach(n => { const x = parseFloat(n.style.left), y = parseFloat(n.style.top); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + n.offsetWidth); maxY = Math.max(maxY, y + n.offsetHeight); });
    // Handy: nur die Breite einpassen (lesbar, nach unten scrollen); sonst alles auf einen Blick
    const byWidth = vp.clientWidth / (maxX - minX + 80);
    setBoardZoom(boardIsNarrow() ? Math.min(byWidth, 1.2) : Math.min(byWidth, vp.clientHeight / (maxY - minY + 80), 1.2));
    vp.scrollLeft = (minX - 40) * boardZoom; vp.scrollTop = (minY - 40) * boardZoom;
}

// =========================================
// AUFRÄUMEN: verbundene Karten gruppieren, Gruppen und lose Karten sinnvoll anordnen
// =========================================
function arrangeBoard() {
    if (!confirm("Pinnwand neu ordnen? Karten, die per Faden verbunden sind, werden zusammen gruppiert, lose Karten nach Art sortiert. Die neue Anordnung sehen alle.")) return;
    const nodes = Array.from(document.querySelectorAll('#board-container .board-note')).map(el => ({ el, id: el.dataset.id, w: el.offsetWidth, h: el.offsetHeight }));
    if (nodes.length === 0) return;
    const layout = smartLayout(nodes);
    const updates = {};
    nodes.forEach(n => { updates[n.id] = layout.get(n.id); });
    animateBoardTo(nodes, layout);
    db.ref('positions').update(updates);
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
// Karten gleiten an ihren neuen Platz, Fäden laufen mit
function animateBoardTo(nodes, layout) {
    const container = document.getElementById('board-container');
    container.classList.add('arranging');
    nodes.forEach(n => { const p = layout.get(n.id); n.el.style.left = p.x + 'px'; n.el.style.top = p.y + 'px'; });
    updateBoardSize();
    const end = performance.now() + 750;
    const frame = now => {
        drawAllStrings();
        if (now < end) { requestAnimationFrame(frame); return; }
        container.classList.remove('arranging'); updateBoardSize(); drawAllStrings(); fitBoard();
    };
    requestAnimationFrame(frame);
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
// Die Karte wird beim Ziehen per GPU-Transform verschoben (kein Layout pro Frame) und nur einmal pro Bildschirm-Frame aktualisiert
function onNotePointerDown(e) {
    if (e.button !== 0) return;
    const note = e.currentTarget;
    const c = document.getElementById('board-container').getBoundingClientRect();
    const baseX = parseFloat(note.style.left), baseY = parseFloat(note.style.top);
    dragState = { note, id: Number(note.dataset.id), startX: e.clientX, startY: e.clientY, baseX, baseY, x: baseX, y: baseY, offX: (e.clientX - c.left) / boardZoom - baseX, offY: (e.clientY - c.top) / boardZoom - baseY, moved: false, lastSync: 0, raf: 0 };
    note.setPointerCapture(e.pointerId);
}
function onNotePointerMove(e) {
    const s = dragState; if (!s || s.note !== e.currentTarget) return;
    if (!s.moved) {
        if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < 6) return;
        s.moved = true; currentDragElement = s.note; s.note.classList.add('dragging');
        s.rects = cardRects().filter(r => r.el !== s.note); // andere Karten bewegen sich nicht – einmal messen reicht
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
    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; applyDrag(s); }
    dragState = null;
    if (s.moved) {
        const note = s.note;
        // Erst endgültige Position setzen und Verschiebung auf 0 – noch ohne Übergang –, dann die Karte "loslassen"
        note.style.left = s.x + 'px'; note.style.top = s.y + 'px'; note.style.setProperty('--dx', '0px'); note.style.setProperty('--dy', '0px');
        delete note._dragPos; void note.offsetWidth;
        currentDragElement = null; note.classList.remove('dragging');
        db.ref('positions/' + s.id).set({ x: s.x, y: s.y });
        updateBoardSize(); drawAllStrings();
    } else if (e.type === 'pointerup' && !s.cancelTap) {
        handleNoteTap(s.id, e);
    }
}
// Positionsänderungen anderer (bzw. das Echo der eigenen) während des Ziehens: nur betroffene Karten verschieben
function applyPositionsLight() {
    let changed = false;
    document.querySelectorAll('#board-container .board-note').forEach(note => {
        if (note === currentDragElement) return;
        const pos = globalPositions[note.dataset.id]; if (!pos) return;
        if (parseFloat(note.style.left) !== pos.x || parseFloat(note.style.top) !== pos.y) { note.style.left = pos.x + 'px'; note.style.top = pos.y + 'px'; changed = true; }
    });
    if (changed) { if (dragState) dragState.rects = cardRects().filter(r => r.el !== dragState.note); drawAllStrings(); }
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

// Position einer Karte: beim Ziehen die aktuelle Zugposition, sonst offsetLeft (folgt auch der Gleit-Animation beim Aufräumen)
function notePos(el) { return el._dragPos || { x: el.offsetLeft, y: el.offsetTop }; }
function pinAnchor(el) { const p = notePos(el); return { x: p.x + el.offsetWidth / 2, y: p.y + PIN_OFFSET_Y }; }
function cardRects() { return Array.from(document.querySelectorAll('#board-container .board-note')).map(n => { const p = notePos(n); return { el: n, x: p.x, y: p.y, w: n.offsetWidth, h: n.offsetHeight }; }); }
// Faden von Nadel zu Nadel, hängt je nach Länge durch. Das Etikett sitzt möglichst mittig,
// rutscht aber entlang des Fadens an eine Stelle, an der es keine Karte verdeckt
function linkGeometry(link, rects = cardRects()) {
    const a = document.getElementById('note-' + link.start), b = document.getElementById('note-' + link.end); if (!a || !b) return null;
    const p1 = pinAnchor(a), p2 = pinAnchor(b);
    const sag = Math.min(110, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.16) + 8;
    const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2 + sag;
    const at = t => ({ x: (1 - t) ** 2 * p1.x + 2 * (1 - t) * t * cx + t * t * p2.x, y: (1 - t) ** 2 * p1.y + 2 * (1 - t) * t * cy + t * t * p2.y });
    const covers = p => rects.some(r => p.x > r.x - 35 && p.x < r.x + r.w + 35 && p.y > r.y - 12 && p.y < r.y + r.h + 12);
    const spot = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82].map(at).find(p => !covers(p)) || at(0.5);
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, cx, cy, lx: spot.x, ly: spot.y };
}

// Fäden, Etiketten und Nadeln bleiben als Elemente bestehen und werden nur aktualisiert.
// Mit onlyNodeId (beim Ziehen) werden nur die Fäden dieser einen Karte neu berechnet.
const stringEls = new Map(); const pinEls = new Map();
const SVG_NS = 'http://www.w3.org/2000/svg';
function drawAllStrings(onlyNodeId = null, rectsOverride = null) {
    const svg = document.getElementById('strings-svg'); const labelsContainer = document.getElementById('string-labels-container'); const pins = document.getElementById('board-pins');
    const notes = Array.from(document.querySelectorAll('#board-container .board-note'));
    const rects = rectsOverride ? [...rectsOverride, ...(dragState ? [{ x: dragState.x, y: dragState.y, w: dragState.note.offsetWidth, h: dragState.note.offsetHeight }] : [])] : cardRects();
    const live = new Set();
    globalLinks.forEach(link => {
        live.add(link.dbKey);
        if (onlyNodeId !== null && Number(link.start) !== onlyNodeId && Number(link.end) !== onlyNodeId) return;
        let els = stringEls.get(link.dbKey);
        const g = linkGeometry(link, rects);
        if (!g) { if (els) { els.shadow.remove(); els.base.remove(); els.twist.remove(); els.label.remove(); stringEls.delete(link.dbKey); } return; }
        if (!els) {
            // Schatten als versetzter dunkler Faden statt SVG-Filter (Filter müssten bei jeder Bewegung neu berechnet werden)
            els = { shadow: document.createElementNS(SVG_NS, 'path'), base: document.createElementNS(SVG_NS, 'path'), twist: document.createElementNS(SVG_NS, 'path'), label: document.createElement('div') };
            els.shadow.setAttribute('class', 'yarn-shadow'); els.twist.setAttribute('class', 'yarn-twist'); els.label.className = 'string-label';
            const key = link.dbKey; const current = () => globalLinks.find(l => l.dbKey === key);
            els.label.onclick = e => { const l = current(); if (l) openLinkMenu(l, e); };
            els.label.oncontextmenu = e => { e.preventDefault(); const l = current(); if (l) openLinkMenu(l, e); };
            svg.append(els.shadow, els.base, els.twist); labelsContainer.appendChild(els.label);
            stringEls.set(key, els);
        }
        const t = linkType(link);
        const active = selectedNodeId !== null && (Number(link.start) === selectedNodeId || Number(link.end) === selectedNodeId);
        const d = `M${g.x1},${g.y1} Q${g.cx},${g.cy} ${g.x2},${g.y2}`;
        els.base.setAttribute('d', d); els.twist.setAttribute('d', d);
        els.shadow.setAttribute('d', `M${g.x1 + 2},${g.y1 + 5} Q${g.cx + 2},${g.cy + 5} ${g.x2 + 2},${g.y2 + 5}`);
        els.base.setAttribute('class', 'yarn' + (active ? ' active' : '')); els.base.style.stroke = t.color; els.base.style.strokeWidth = t.width + (active ? 1.5 : 0);
        els.shadow.style.strokeWidth = t.width + 1;
        els.label.style.left = g.lx + 'px'; els.label.style.top = g.ly + 'px';
        els.label.style.borderTopColor = t.color; els.label.style.setProperty('--rot', tiltFor(link.dbKey, 4).toFixed(1) + 'deg');
        const text = (link.label && link.label.trim() !== "") ? link.label : "🔗"; if (els.label.textContent !== text) els.label.textContent = text;
        els.label.title = t.label + " – klicken zum Bearbeiten oder Löschen";
    });
    // Stecknadeln liegen über den Fäden – die Fäden sind darum geknotet
    const livePins = new Set();
    notes.forEach(n => {
        livePins.add(n.dataset.id);
        if (onlyNodeId !== null && Number(n.dataset.id) !== onlyNodeId) return;
        let p = pinEls.get(n.dataset.id);
        if (!p) { p = document.createElement('div'); p.className = 'pushpin'; pins.appendChild(p); pinEls.set(n.dataset.id, p); }
        const a = pinAnchor(n);
        p.style.left = a.x + 'px'; p.style.top = a.y + 'px'; p.style.setProperty('--pin', n.dataset.pin || PUSHPIN_COLORS.npc);
        p.style.display = n.classList.contains('dragging') ? 'none' : ''; // abgenommene Karte hat gerade keine Nadel
    });
    if (onlyNodeId === null) { // Verwaiste Elemente (gelöschte Fäden/Karten) aufräumen
        stringEls.forEach((els, key) => { if (!live.has(key)) { els.shadow.remove(); els.base.remove(); els.twist.remove(); els.label.remove(); stringEls.delete(key); } });
        pinEls.forEach((p, id) => { if (!livePins.has(id)) { p.remove(); pinEls.delete(id); } });
    }
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
    const rects = cardRects(); const strings = globalLinks.map(link => ({ link, g: linkGeometry(link, rects) })).filter(s => s.g);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    notes.forEach(n => { const x = parseFloat(n.style.left), y = parseFloat(n.style.top); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + n.offsetWidth); maxY = Math.max(maxY, y + n.offsetHeight); });
    strings.forEach(({ g }) => { minX = Math.min(minX, g.lx - 80); maxX = Math.max(maxX, g.lx + 80); maxY = Math.max(maxY, g.ly + 20); });
    const pad = 50, w = maxX - minX + 2 * pad, h = maxY - minY + 2 * pad;
    const scale = Math.min(2, 8000 / Math.max(w, h));
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(w * scale); canvas.height = Math.ceil(h * scale);
    const ctx = canvas.getContext('2d'); ctx.scale(scale, scale); ctx.translate(pad - minX, pad - minY);
    // Kork: Grundfarbe + feste Körnung
    ctx.fillStyle = '#b98b5e'; ctx.fillRect(minX - pad, minY - pad, w, h);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < w * h / 60; i++) { ctx.fillStyle = rnd() < 0.6 ? 'rgba(90,50,20,0.22)' : 'rgba(235,200,150,0.25)'; ctx.fillRect(minX - pad + rnd() * w, minY - pad + rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }

    notes.forEach(n => drawNoteOnCanvas(ctx, n, withImages));
    strings.forEach(({ link, g }) => {
        const t = linkType(link);
        ctx.save(); ctx.strokeStyle = t.color; ctx.lineWidth = t.width; ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 3; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 4;
        ctx.beginPath(); ctx.moveTo(g.x1, g.y1); ctx.quadraticCurveTo(g.cx, g.cy, g.x2, g.y2); ctx.stroke(); ctx.restore();
        ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(g.x1, g.y1); ctx.quadraticCurveTo(g.cx, g.cy, g.x2, g.y2); ctx.stroke(); ctx.restore();
    });
    notes.forEach(n => drawPushpinOnCanvas(ctx, pinAnchor(n), n.dataset.pin || PUSHPIN_COLORS.npc));
    strings.forEach(({ link, g }) => { // Etiketten wie auf der Pinnwand ganz oben
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
