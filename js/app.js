// =========================================
// INTERFACE: WALKMAN, LOGIN, TABS, TASTATUR
// =========================================
function toggleAudio() {
    const audio = document.getElementById('bg-audio'); const btn = document.getElementById('audio-btn'); const mini = document.getElementById('walkman-mini');
    if (audio.paused) { audio.play().then(() => { btn.innerText = '⏸ STOP'; mini.innerText = '📼 ♪'; }).catch(() => showToast('Audio konnte nicht gestartet werden')); }
    else { audio.pause(); btn.innerText = '▶ PLAY'; mini.innerText = '📼'; }
}
function toggleWalkman() { const collapsed = document.getElementById('walkman-container').classList.toggle('collapsed'); savePref('hb-walkman-collapsed', collapsed); }

function startDosTerminal() { document.getElementById('tourist-view').style.display = 'none'; document.getElementById('dos-terminal').style.display = 'block'; document.getElementById('dos-input').focus(); }
function closeDosTerminal() { document.getElementById('dos-terminal').style.display = 'none'; document.getElementById('dos-error').style.display = 'none'; document.getElementById('dos-input').value = ''; document.getElementById('tourist-view').style.display = 'flex'; }
function checkPassword(e) {
    e.preventDefault();
    const input = document.getElementById('dos-input');
    if (input.value.toUpperCase().trim() === 'MONSTER') {
        input.value = ''; input.blur(); document.getElementById('dos-error').style.display = 'none';
        try { sessionStorage.setItem('hb-auth', '1'); } catch (err) {}
        enterInvestigation(true);
    } else { document.getElementById('dos-error').style.display = 'block'; input.value = ''; }
}
function enterInvestigation(withGlitch) {
    document.getElementById('tourist-view').style.display = 'none'; document.getElementById('dos-terminal').style.display = 'none';
    const inv = document.getElementById('investigation-view'); inv.style.display = 'flex';
    if (withGlitch) { inv.classList.add('glitch-effect'); setTimeout(() => { inv.classList.remove('glitch-effect'); }, 800); }
    switchTab(loadPref('hb-tab', 'tab-news'));
}
function systemLogout() {
    try { sessionStorage.removeItem('hb-auth'); } catch (err) {}
    flushPlayerNotes();
    document.getElementById('tab-pinnwand').classList.remove('fullscreen');
    document.getElementById('investigation-view').style.display = 'none'; document.getElementById('tourist-view').style.display = 'flex';
}
function switchTab(tabId) {
    if (!document.getElementById(tabId)) tabId = 'tab-news';
    document.querySelectorAll('.tab-content').forEach(content => content.classList.toggle('active-tab', content.id === tabId));
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
    const activeBtn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`); if (activeBtn) activeBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    document.querySelector('.content-area').scrollTop = 0;
    savePref('hb-tab', tabId);
    if(tabId === 'tab-pinnwand') { renderBoard(); }
    if(tabId === 'tab-karte') { updateMapSize(); }
}
function openLightbox(imageUrl) { document.getElementById('lightbox-img').src = imageUrl; document.getElementById('lightbox').style.display = 'flex'; }
function closeLightbox() { document.getElementById('lightbox').style.display = 'none'; }

document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    hideMenu(); closeLightbox();
    if (selectedNodeId !== null || linkMode) setLinkMode(false);
    else if (document.getElementById('tab-pinnwand').classList.contains('fullscreen')) toggleBoardFullscreen();
    if (document.getElementById('dos-terminal').style.display === 'block') closeDosTerminal();
});

// =========================================
// START: erst wenn alle Module geladen sind, Firebase-Listener registrieren
// =========================================
db.ref('.info/connected').on('value', snap => {
    const el = document.getElementById('live-indicator');
    el.classList.toggle('offline', !snap.val()); el.innerText = snap.val() ? '● LIVE SYNC' : '○ OFFLINE';
});
initNews();
initPersonen();
initChronik();
initKarte();
initPinnwand();
initArchiv();

if (loadPref('hb-walkman-collapsed', window.matchMedia('(max-width: 700px)').matches)) document.getElementById('walkman-container').classList.add('collapsed');
try { if (sessionStorage.getItem('hb-auth') === '1') enterInvestigation(false); } catch (err) {}
