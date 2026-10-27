// =========================================
// PERSONEN (Bürger & Verdächtige)
// =========================================
let globalNPCs = [];
const STATUS_CLASS = { 'Verdächtig': 'st-suspect', 'Vermisst': 'st-missing', 'Verstorben': 'st-dead', 'Kooperativ': 'st-coop' };

function initPersonen() {
    db.ref('npcs').on('value', snap => {
        globalNPCs = Object.values(snap.val() || {});
        renderNpcs();
        renderChronPersonPicker();
        renderChronPersonFilter();
        renderChronicle();
        renderBoard();
    });
}

function savePerson(e) {
    e.preventDefault();
    const name = document.getElementById('npc-name').value; const role = document.getElementById('npc-role').value; const image = document.getElementById('npc-image').value; const status = document.getElementById('npc-status').value; const notes = document.getElementById('npc-notes').value;
    if (editState.npc) { db.ref('npcs/' + editState.npc).update({name, role, image, status, notes});
    } else { const id = Date.now(); db.ref().update({ ['npcs/' + id]: { id, name, role, image, status, notes }, ['positions/' + id]: findFreeSpot() }); }
    setEditMode('npc', null);
}
function editPerson(id) { const p = globalNPCs.find(n => n.id === id); if(p) { document.getElementById('npc-name').value = p.name; document.getElementById('npc-role').value = p.role; document.getElementById('npc-image').value = p.image || ''; document.getElementById('npc-status').value = p.status; document.getElementById('npc-notes').value = p.notes; setEditMode('npc', id); } }
function deletePerson(id) { if(confirm("Akte unwiderruflich löschen? (Inkl. Karte und Fäden auf der Pinnwand)")) { db.ref().update({ ['npcs/' + id]: null, ...boardNodeCleanup(id) }); if (editState.npc === id) setEditMode('npc', null); } }

function renderNpcs() {
    const list = document.getElementById('npc-list'); list.innerHTML = '';
    const q = document.getElementById('npc-search').value.trim().toLowerCase();
    const shown = globalNPCs.filter(p => !q || [p.name, p.role, p.status, p.notes].join(' ').toLowerCase().includes(q));
    if (q && shown.length === 0) { list.innerHTML = '<p class="muted">Keine passende Akte gefunden.</p>'; return; }
    shown.forEach(person => {
        const card = document.createElement('div'); card.className = 'npc-card ' + (STATUS_CLASS[person.status] || ''); card.id = 'npc-card-' + person.id;
        let imageHTML = person.image && person.image.trim() !== '' ? `<div class="polaroid"><img src="${esc(person.image)}" onclick="openLightbox(this.src)" title="Klicken zum Vergrößern"></div>` : '';
        card.innerHTML = `
            <div class="item-actions"><button class="icon-btn" onclick="editPerson(${person.id})" title="Akte bearbeiten">✎</button><button class="icon-btn danger" onclick="deletePerson(${person.id})" title="Akte löschen">X</button></div>
            ${imageHTML}<h3>${esc(person.name)}</h3><p><strong>Beruf:</strong> ${esc(person.role)}</p><p><strong>Akte:</strong> <span class="npc-notes">${esc(person.notes)}</span></p><span class="status-badge">${esc(person.status)}</span>
        `;
        list.appendChild(card);
    });
}
function showPerson(id) {
    document.getElementById('npc-search').value = ''; renderNpcs();
    if (document.getElementById('tab-pinnwand').classList.contains('fullscreen')) toggleBoardFullscreen();
    switchTab('tab-personen');
    const card = document.getElementById('npc-card-' + id); if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1600);
}
