// =========================================
// ARCHIV (Beweismittel / Handouts)
// =========================================
let globalHandouts = [];

function initArchiv() {
    db.ref('handouts').on('value', snap => {
        globalHandouts = Object.values(snap.val() || {});
        const list = document.getElementById('handout-list'); list.innerHTML = '';
        globalHandouts.forEach(handout => {
            const card = document.createElement('div'); card.className = 'handout-card'; card.id = 'handout-card-' + handout.id;
            let imgHTML = handout.image && handout.image.trim() !== '' ? `<img src="${esc(handout.image)}" class="handout-img" onclick="openLightbox(this.src)" title="Klicken zum Vergrößern">` : '';
            card.innerHTML = `<div class="item-actions"><button class="icon-btn" onclick="addRefToBoard('handout', ${handout.id})" title="An die Pinnwand heften">📌</button><button class="icon-btn" onclick="editHandout(${handout.id})" title="Bearbeiten">✎</button><button class="icon-btn danger" onclick="deleteHandout(${handout.id})" title="Löschen">X</button></div><h3>${esc(handout.title)}</h3>${imgHTML}<div class="handout-text">${richText(handout.text)}</div>`;
            list.appendChild(card);
        });
        renderBoard();
    });
}

function saveHandout(e) {
    e.preventDefault();
    const data = { title: document.getElementById('handout-title').value, image: document.getElementById('handout-image').value, text: document.getElementById('handout-text').value };
    if (editState.handout) { db.ref('handouts/' + editState.handout).update(data); }
    else { const id = Date.now(); db.ref('handouts/' + id).set({ id, ...data }); }
    setEditMode('handout', null);
}
function editHandout(id) { const h = globalHandouts.find(x => x.id === id); if (!h) return; document.getElementById('handout-title').value = h.title; document.getElementById('handout-image').value = h.image || ''; document.getElementById('handout-text').value = h.text || ''; setEditMode('handout', id); }
function deleteHandout(id) { if (confirm("Beweismittel löschen? (Wird auch von der Pinnwand entfernt)")) { db.ref().update({ ['handouts/' + id]: null, ...refCleanup('handout', id) }); if (editState.handout === id) setEditMode('handout', null); } }
function showHandout(id) { exitBoardFullscreen(); switchTab('tab-archiv'); flashElement(document.getElementById('handout-card-' + id)); }
