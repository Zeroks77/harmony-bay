// =========================================
// LAGEPLAN (Karte mit Pins)
// =========================================
let globalPins = [];

function initKarte() {
    db.ref('pins').on('value', snap => { globalPins = Object.values(snap.val() || {}); renderPins(); });
}

function addPin(e) { if (e.target.closest('.map-pin')) return; const rect = document.getElementById('map-container').getBoundingClientRect(); const note = prompt("Information anpinnen:"); if (note && note.trim() !== "") { const id = Date.now(); db.ref('pins/' + id).set({ id, x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100, note: note.trim() }); } }
function renderPins() {
    const container = document.getElementById('map-container');
    container.querySelectorAll('.map-pin').forEach(p => p.remove());
    globalPins.forEach(pinData => {
        const p = document.createElement('div'); p.className = 'map-pin'; p.style.left = pinData.x + '%'; p.style.top = pinData.y + '%';
        p.onclick = e => { e.stopPropagation(); openPinMenu(pinData, e); };
        p.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); openPinMenu(pinData, e); };
        const tooltip = document.createElement('div'); tooltip.className = 'pin-tooltip'; tooltip.innerText = pinData.note; p.appendChild(tooltip);
        container.appendChild(p);
    });
}
function openPinMenu(pin, e) {
    showMenu(e.clientX, e.clientY, pin.note, [
        { label: '✎ Text bearbeiten', action: () => { const n = prompt("Information bearbeiten:", pin.note); if (n && n.trim() !== "") db.ref('pins/' + pin.id).update({ note: n.trim() }); } },
        { label: '🗑 Pin löschen', danger: true, action: () => { if (confirm("Pin löschen?")) db.ref('pins/' + pin.id).remove(); } }
    ]);
}
function toggleMapLabels(btn) { const on = document.getElementById('map-container').classList.toggle('show-labels'); btn.classList.toggle('active', on); }
