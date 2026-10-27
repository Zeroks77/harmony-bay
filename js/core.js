// =========================================
// FIREBASE INITIALISIERUNG
// =========================================
const firebaseConfig = {
    databaseURL: "https://harmony-bay-default-rtdb.firebaseio.com/"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// =========================================
// HILFSFUNKTIONEN (von allen Modulen genutzt)
// =========================================
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// Wie esc(), lässt aber einfache Formatierung (<b>, <i>, <u>, <strong>, <em>, <br>) in News & Handouts zu
function richText(value) { return esc(value).replace(/&lt;(\/?)(b|i|u|em|strong|br)\s*\/?&gt;/gi, '<$1$2>'); }
function loadPref(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
function savePref(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }

let toastTimer = null;
function showToast(msg) { const t = document.getElementById('toast'); t.innerText = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }

// Kleines Auswahlmenü (funktioniert mit Maus und Touch)
function showMenu(x, y, title, items) {
    const menu = document.getElementById('ctx-menu'); menu.innerHTML = '';
    if (title) { const t = document.createElement('div'); t.className = 'menu-title'; t.innerText = title; menu.appendChild(t); }
    items.forEach(item => {
        const b = document.createElement('button'); b.innerText = item.label; if (item.danger) b.className = 'danger';
        b.onclick = () => { hideMenu(); item.action(); };
        menu.appendChild(b);
    });
    menu.style.display = 'block';
    menu.style.left = Math.max(8, Math.min(x + 4, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y + 4, window.innerHeight - menu.offsetHeight - 8)) + 'px';
}
function hideMenu() { document.getElementById('ctx-menu').style.display = 'none'; }
document.addEventListener('pointerdown', e => { if (!e.target.closest('#ctx-menu')) hideMenu(); });

// Bearbeiten-Modus für alle Formulare (news, npc, handout, chronicle)
const editState = { news: null, npc: null, handout: null, chronicle: null };
function setEditMode(kind, id) {
    editState[kind] = id;
    const submit = document.getElementById(kind + '-submit-btn'); const cancel = document.getElementById(kind + '-cancel-btn');
    if (!submit.dataset.label) submit.dataset.label = submit.innerText;
    submit.innerText = id ? 'Änderungen speichern' : submit.dataset.label;
    cancel.style.display = id ? 'inline-block' : 'none';
    const form = document.getElementById(kind + '-form');
    if (id) { form.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else { form.reset(); }
    if (kind === 'chronicle') {
        if (!id) renderChronPersonPicker([]);
        document.getElementById('chronicle-form-title').innerText = id ? '✎ Ereignis bearbeiten' : '+ Neues Ereignis eintragen';
    }
}
