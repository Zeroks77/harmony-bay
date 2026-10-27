// =========================================
// CHRONIK (Zeitstrahl mit Tagen, Kategorien & Personen) + SPIELER-NOTIZEN
// =========================================
let globalChronicle = [];
const CHRON_CATEGORIES = {
    vorfall: { label: 'Vorfall', color: '#ff5252' },
    spur: { label: 'Hinweis / Spur', color: '#ffd740' },
    begegnung: { label: 'Begegnung', color: '#40c4ff' },
    opfer: { label: 'Tod / Opfer', color: '#b388ff' },
    uebernatuerlich: { label: 'Übernatürlich', color: '#e040fb' },
    gruppe: { label: 'Aktion der Gruppe', color: '#00ff41' },
    sonstiges: { label: 'Sonstiges', color: '#aaaaaa' }
};
const DAY_RE = /tag\s*(\d+)/i;
const CLOCK_RE = /(\d{1,2})[:.](\d{2})(\s*uhr)?|(\d{1,2})\s*uhr/i;
let chronNewestFirst = false;

function initChronik() {
    initChronicleSelects();
    renderChronPersonPicker([]);
    renderChronPinSelect();
    db.ref('chronicle').on('value', snap => { globalChronicle = Object.values(snap.val() || {}); renderChronicle(); });
    db.ref('playerNotes').on('value', snap => {
        const textarea = document.getElementById('player-notes-area');
        if(document.activeElement !== textarea) { textarea.value = snap.val() || ""; }
    });
}

// Liefert Tag, Minuten und Anzeige-Text. Alte Einträge ({time: "Tag 1, 22:00 Uhr"}) werden geparst.
function chronInfo(item) {
    let day = null, minutes = null, label;
    if (item.v === 2) {
        if (item.day !== '' && item.day != null) day = Number(item.day);
        if (item.clock) { const [h, m] = item.clock.split(':').map(Number); minutes = h * 60 + m; }
        label = [day !== null ? 'Tag ' + day : '', item.clock ? item.clock + ' Uhr' : '', item.timeNote || ''].filter(Boolean).join(' · ');
    } else {
        const t = item.time || '';
        const d = DAY_RE.exec(t); if (d) day = Number(d[1]);
        const c = CLOCK_RE.exec(t); if (c) minutes = c[1] !== undefined ? Number(c[1]) * 60 + Number(c[2]) : Number(c[4]) * 60;
        label = t;
    }
    return { day, minutes, label: label || 'Ohne Zeitangabe' };
}
function npcName(id) { const p = globalNPCs.find(n => n.id === Number(id)); return p ? p.name : null; }
// Pin zum Ereignis: fest verknüpft (pinId) oder Ort heißt genau wie ein Pin
function chronPin(item) {
    if (item.pinId) { const p = globalPins.find(pin => pin.id === Number(item.pinId)); if (p) return p; }
    const loc = (item.location || '').trim().toLowerCase();
    return loc ? globalPins.find(pin => pin.note.trim().toLowerCase() === loc) || null : null;
}
function renderChronPinSelect() {
    const sel = document.getElementById('chronicle-pin'); const current = sel.value;
    sel.innerHTML = '<option value="">— kein Pin —</option>' + [...globalPins].sort((a, b) => a.note.localeCompare(b.note)).map(p => `<option value="${p.id}">${esc(p.note)}</option>`).join('');
    sel.value = current; if (sel.value !== current) sel.value = '';
}
function onChronPinChange() {
    const pin = globalPins.find(p => p.id === Number(document.getElementById('chronicle-pin').value));
    const loc = document.getElementById('chronicle-location'); if (pin && loc.value.trim() === '') loc.value = pin.note;
}
function showChronicleForPin(pin) {
    switchTab('tab-chronik');
    document.getElementById('chron-search').value = pin.note; renderChronicle();
    showToast('Gefiltert nach Ort: ' + pin.note);
}

function initChronicleSelects() {
    const options = Object.entries(CHRON_CATEGORIES).map(([key, c]) => `<option value="${key}">${c.label}</option>`).join('');
    document.getElementById('chronicle-category').innerHTML = '<option value="">— keine —</option>' + options;
    document.getElementById('chron-filter-cat').innerHTML = '<option value="">Alle Kategorien</option>' + options;
    renderChronPersonFilter();
}
function renderChronPersonFilter() {
    const sel = document.getElementById('chron-filter-person'); const current = sel.value;
    sel.innerHTML = '<option value="">Alle Personen</option>' + globalNPCs.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    sel.value = current; if (sel.value !== current) sel.value = '';
}
function renderChronPersonPicker(selected) {
    const box = document.getElementById('chronicle-persons');
    const sel = (selected || getCheckedPersons()).map(Number);
    box.innerHTML = '';
    if (globalNPCs.length === 0) { box.innerHTML = '<span class="muted">Noch keine Personen angelegt.</span>'; return; }
    globalNPCs.forEach(p => {
        const lbl = document.createElement('label'); const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.value = p.id; cb.checked = sel.includes(p.id);
        lbl.classList.toggle('checked', cb.checked); cb.onchange = () => lbl.classList.toggle('checked', cb.checked);
        lbl.append(cb, p.name); box.appendChild(lbl);
    });
}
function getCheckedPersons() { return Array.from(document.querySelectorAll('#chronicle-persons input:checked')).map(cb => Number(cb.value)); }

function saveChronicleEvent(e) {
    e.preventDefault();
    const day = document.getElementById('chronicle-day').value.trim();
    const data = {
        v: 2, day,
        clock: document.getElementById('chronicle-clock').value,
        timeNote: document.getElementById('chronicle-timenote').value.trim(),
        text: document.getElementById('chronicle-event').value.trim(),
        category: document.getElementById('chronicle-category').value,
        location: document.getElementById('chronicle-location').value.trim(),
        pinId: Number(document.getElementById('chronicle-pin').value) || null,
        details: document.getElementById('chronicle-details').value.trim(),
        persons: getCheckedPersons(),
        important: document.getElementById('chronicle-important').checked
    };
    data.time = chronInfo(data).label; // für ältere Versionen der Seite
    const isNew = !editState.chronicle;
    if (isNew) { const id = Date.now(); db.ref('chronicle/' + id).set({ id, ...data }); }
    else { db.ref('chronicle/' + editState.chronicle).update(data); }
    setEditMode('chronicle', null);
    if (isNew) { document.getElementById('chronicle-day').value = day; document.getElementById('chronicle-event').focus(); } // Tag für Folgeeinträge behalten
    showToast(isNew ? 'Ereignis eingetragen' : 'Ereignis aktualisiert');
}
function editChronicle(id) {
    const item = globalChronicle.find(c => c.id === id); if (!item) return;
    const info = chronInfo(item);
    let timeNote = item.timeNote || '';
    if (item.v !== 2) timeNote = (item.time || '').replace(DAY_RE, '').replace(CLOCK_RE, '').replace(/^[\s,·\-]+|[\s,·\-]+$/g, '');
    document.getElementById('chronicle-day').value = info.day ?? '';
    document.getElementById('chronicle-clock').value = info.minutes !== null ? String(Math.floor(info.minutes / 60) % 24).padStart(2, '0') + ':' + String(info.minutes % 60).padStart(2, '0') : '';
    document.getElementById('chronicle-timenote').value = timeNote;
    document.getElementById('chronicle-event').value = item.text || '';
    document.getElementById('chronicle-category').value = item.category || '';
    document.getElementById('chronicle-location').value = item.location || '';
    document.getElementById('chronicle-pin').value = item.pinId && globalPins.some(p => p.id === Number(item.pinId)) ? String(item.pinId) : '';
    document.getElementById('chronicle-details').value = item.details || '';
    document.getElementById('chronicle-important').checked = !!item.important;
    renderChronPersonPicker(item.persons || []);
    document.getElementById('chronicle-form-wrap').open = true;
    setEditMode('chronicle', id);
}
function deleteChronicle(id) { if (confirm("Ereignis aus der Chronik löschen?")) { db.ref('chronicle/' + id).remove(); if (editState.chronicle === id) setEditMode('chronicle', null); } }
function toggleChronicleSort() { chronNewestFirst = !chronNewestFirst; document.getElementById('chron-sort-btn').innerText = chronNewestFirst ? '↑ Neueste zuerst' : '↓ Älteste zuerst'; renderChronicle(); }

function getVisibleChronicle() {
    const q = document.getElementById('chron-search').value.trim().toLowerCase();
    const cat = document.getElementById('chron-filter-cat').value;
    const person = document.getElementById('chron-filter-person').value;
    const onlyImportant = document.getElementById('chron-filter-important').checked;
    let entries = globalChronicle.map(item => ({ item, info: chronInfo(item) }));
    // Sortierung: Tag (ohne Tag zuerst), dann Uhrzeit (ohne Uhrzeit ans Tagesende), dann Erstellungszeit
    entries.sort((a, b) => ((a.info.day ?? -1) - (b.info.day ?? -1)) || ((a.info.minutes ?? 1440) - (b.info.minutes ?? 1440)) || (a.item.id - b.item.id));
    entries = entries.filter(({ item, info }) => {
        if (cat && item.category !== cat) return false;
        if (person && !(item.persons || []).map(Number).includes(Number(person))) return false;
        if (onlyImportant && !item.important) return false;
        if (q) { const hay = [info.label, item.text, item.details, item.location, (chronPin(item) || {}).note, ...(item.persons || []).map(npcName)].join(' ').toLowerCase(); if (!hay.includes(q)) return false; }
        return true;
    });
    if (chronNewestFirst) entries.reverse();
    return entries;
}

function renderChronicle() {
    const list = document.getElementById('chronicle-list'); list.innerHTML = '';
    const entries = getVisibleChronicle();
    const total = globalChronicle.length;
    document.getElementById('chron-count').innerText = total === 0 ? '' : (entries.length === total ? `${total} Ereignisse` : `${entries.length} von ${total} Ereignissen`);
    if (entries.length === 0) { list.innerHTML = `<p class="muted">${total === 0 ? 'Noch keine Ereignisse eingetragen.' : 'Keine Ereignisse passen zum Filter.'}</p>`; return; }
    const showDays = globalChronicle.some(item => chronInfo(item).day !== null);
    let lastDay;
    entries.forEach(({ item, info }, idx) => {
        if (showDays && (idx === 0 || info.day !== lastDay)) {
            const h = document.createElement('div'); h.className = 'chronicle-day'; h.innerText = info.day !== null ? 'TAG ' + info.day : 'OHNE TAG / VORGESCHICHTE'; list.appendChild(h);
        }
        lastDay = info.day;
        const cat = CHRON_CATEGORIES[item.category];
        const persons = (item.persons || []).filter(pid => npcName(pid) !== null);
        const pin = chronPin(item); const place = item.location || (pin ? pin.note : '');
        const placeHTML = pin ? `<button class="loc-link" onclick="showPinOnMap(${pin.id})" title="Auf dem Lageplan zeigen">📍 ${esc(place)} <span>· auf Karte</span></button>` : (place ? `📍 ${esc(place)}` : '');
        const el = document.createElement('div'); el.className = 'chronicle-item' + (item.important ? ' important' : '');
        if (cat) el.style.setProperty('--cat', cat.color);
        el.innerHTML = `
            <div class="item-actions"><button class="icon-btn" onclick="editChronicle(${item.id})" title="Bearbeiten">✎</button><button class="icon-btn danger" onclick="deleteChronicle(${item.id})" title="Löschen">X</button></div>
            <div class="chronicle-head">${item.important ? '★ ' : ''}${esc(info.label)}${cat ? `<span class="cat-badge">${cat.label}</span>` : ''}</div>
            <div class="chronicle-title">${esc(item.text)}</div>
            ${placeHTML ? `<div class="chronicle-meta">${placeHTML}</div>` : ''}
            ${item.details ? `<div class="chronicle-details">${esc(item.details)}</div>` : ''}
            ${persons.length ? `<div>${persons.map(pid => `<button class="person-chip" onclick="showPerson(${Number(pid)})" title="Akte öffnen">👤 ${esc(npcName(pid))}</button>`).join('')}</div>` : ''}
        `;
        list.appendChild(el);
    });
}

function copyChronicle() {
    const entries = getVisibleChronicle(); if (entries.length === 0) { showToast('Nichts zum Kopieren'); return; }
    const showDays = globalChronicle.some(item => chronInfo(item).day !== null);
    let lastDay; const lines = [];
    entries.forEach(({ item, info }, idx) => {
        if (showDays && (idx === 0 || info.day !== lastDay)) lines.push('', `=== ${info.day !== null ? 'TAG ' + info.day : 'OHNE TAG / VORGESCHICHTE'} ===`);
        lastDay = info.day;
        const cat = CHRON_CATEGORIES[item.category]; const place = item.location || (chronPin(item) || {}).note;
        lines.push(`${item.important ? '★ ' : ''}[${info.label}] ${item.text}${cat ? ` (${cat.label})` : ''}${place ? ` – ${place}` : ''}`);
        if (item.details) lines.push('    ' + item.details.replace(/\n/g, '\n    '));
        const names = (item.persons || []).map(npcName).filter(Boolean);
        if (names.length) lines.push('    Beteiligt: ' + names.join(', '));
    });
    const text = lines.join('\n').trim();
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => showToast('Chronik kopiert'), () => prompt('Zum Kopieren markieren:', text));
    else prompt('Zum Kopieren markieren:', text);
}

// Spieler-Notizen: gebündelt speichern statt bei jedem Tastendruck
let notesTimer = null;
function savePlayerNotes() { document.getElementById('notes-status').innerText = '… speichert'; clearTimeout(notesTimer); notesTimer = setTimeout(flushPlayerNotes, 500); }
function flushPlayerNotes() {
    if (notesTimer === null) return;
    clearTimeout(notesTimer); notesTimer = null;
    db.ref('playerNotes').set(document.getElementById('player-notes-area').value).then(() => { document.getElementById('notes-status').innerText = '✓ gespeichert'; });
}
