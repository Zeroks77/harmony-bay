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
// Wie esc(), lässt aber einfache Formatierung (<b>, <i>, <u>, <strong>, <em>, <br>) und Zeichen wie &gt; / &quot; zu,
// die in älteren Einträgen stehen (früher wurde alles als HTML dargestellt)
function richText(value) {
    return esc(value).replace(/&lt;(\/?)(b|i|u|em|strong|br)\s*\/?&gt;/gi, '<$1$2>').replace(/&amp;(gt|lt|quot|amp|#39|nbsp);/g, '&$1;');
}
// Für reinen Text (z.B. Kopieren): <br> zu Zeilenumbruch, Tags und Zeichen-Codes auflösen
function plainText(value) { const d = document.createElement('div'); d.innerHTML = richText(value).replace(/<br>/gi, '\n'); return d.textContent; }

// Bilder, die nicht laden (z.B. fremde Seiten mit Hotlink-Sperre), ausblenden statt kaputtes Symbol zu zeigen
document.addEventListener('error', e => {
    const img = e.target; if (img.tagName !== 'IMG' || !img.closest('.board-note, .polaroid, .handout-card')) return;
    (img.closest('.polaroid') || img).style.display = 'none';
    if (img.closest('.board-note')) drawAllStrings(); // Karte ist jetzt kleiner, Fäden neu ausrichten
}, true);
function loadPref(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
function savePref(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }

// Kurzer Hinweis unten; optional mit Knopf (z.B. „Rückgängig“), dann bleibt er etwas länger stehen
let toastTimer = null;
function showToast(msg, actionLabel = null, onAction = null) {
    const t = document.getElementById('toast'); t.innerHTML = '';
    const text = document.createElement('span'); text.textContent = msg; t.appendChild(text);
    if (actionLabel) { const b = document.createElement('button'); b.textContent = actionLabel; b.onclick = () => { t.classList.remove('show'); onAction(); }; t.appendChild(b); }
    t.classList.toggle('has-action', !!actionLabel); t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), actionLabel ? 6000 : 2200);
}

// Kleines Auswahlmenü (funktioniert mit Maus und Touch)
function showMenu(x, y, title, items) {
    const menu = document.getElementById('ctx-menu'); menu.innerHTML = '';
    if (title) { const t = document.createElement('div'); t.className = 'menu-title'; t.innerText = title; menu.appendChild(t); }
    items.forEach(item => {
        const b = document.createElement('button'); b.innerText = item.label; if (item.danger) b.className = 'danger';
        if (item.swatch) { const s = document.createElement('span'); s.className = 'swatch'; s.style.background = item.swatch; b.prepend(s); }
        b.onclick = () => { hideMenu(); item.action(); };
        menu.appendChild(b);
    });
    menu.style.display = 'block';
    menu.style.left = Math.max(8, Math.min(x + 4, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y + 4, window.innerHeight - menu.offsetHeight - 8)) + 'px';
}
function hideMenu() { document.getElementById('ctx-menu').style.display = 'none'; }
document.addEventListener('pointerdown', e => { if (!e.target.closest('#ctx-menu')) hideMenu(); });

function flashElement(el) { if (!el) return; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); }

// Zoom per Strg+Mausrad / Trackpad und per Zwei-Finger-Geste (Pinnwand & Lageplan)
function attachZoomGestures(vp, getZoom, setZoom) {
    let pinch = null;
    const dist = e => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    vp.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); const r = vp.getBoundingClientRect(); setZoom(getZoom() * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    vp.addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = { dist: dist(e), zoom: getZoom() }; }, { passive: true });
    vp.addEventListener('touchmove', e => {
        if (!pinch || e.touches.length !== 2) return; e.preventDefault();
        const r = vp.getBoundingClientRect();
        setZoom(pinch.zoom * dist(e) / pinch.dist, (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top);
    }, { passive: false });
    vp.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; });
}

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
