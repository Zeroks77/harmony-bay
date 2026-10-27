// =========================================
// NEWS & WETTER (Touristen-Seite)
// =========================================
let globalNews = [];

function initNews() {
    db.ref('weather').on('value', snap => {
        const w = snap.val() || "Heiter bis wolkig, mäßiger Wind vom Ozean.";
        document.getElementById('public-weather-text').innerText = w;
        document.getElementById('weather-input').value = w;
    });

    db.ref('news').on('value', snap => {
        globalNews = Object.values(snap.val() || {}).sort((a, b) => b.id - a.id);
        const publicBoard = document.getElementById('public-news-content');
        const backendBoard = document.getElementById('news-backend-list');

        if (globalNews.length === 0) {
            publicBoard.innerHTML = '<p style="text-align: center; color: #888; font-style: italic;">Derzeit keine offiziellen Ankündigungen.</p>';
            backendBoard.innerHTML = '';
        } else {
            publicBoard.innerHTML = ''; backendBoard.innerHTML = '';
            globalNews.forEach(article => {
                const pItem = document.createElement('div'); pItem.className = 'news-article';
                pItem.innerHTML = `<div class="news-date">${esc(article.date)}</div><div class="news-headline">${esc(article.headline)}</div><div class="news-content">${richText(article.text).replace(/\n/g, '<br>')}</div>`;
                publicBoard.appendChild(pItem);

                const bItem = document.createElement('div'); bItem.className = 'backend-news-item';
                bItem.innerHTML = `<div class="item-actions"><button class="icon-btn" onclick="editNews(${article.id})" title="Bearbeiten">✎</button><button class="icon-btn danger" onclick="deleteNews(${article.id})" title="Löschen">X</button></div><strong>${esc(article.date)} | ${esc(article.headline)}</strong>`;
                backendBoard.appendChild(bItem);
            });
        }
    });
}

function saveWeather() { db.ref('weather').set(document.getElementById('weather-input').value); showToast('Wetter aktualisiert'); }

function saveNews(e) {
    e.preventDefault();
    const data = { date: document.getElementById('news-date').value, headline: document.getElementById('news-headline').value, text: document.getElementById('news-text').value };
    if (editState.news) { db.ref('news/' + editState.news).update(data); }
    else { const id = Date.now(); db.ref('news/' + id).set({ id, ...data }); }
    setEditMode('news', null);
}
function editNews(id) { const n = globalNews.find(a => a.id === id); if (!n) return; document.getElementById('news-date').value = n.date; document.getElementById('news-headline').value = n.headline; document.getElementById('news-text').value = n.text; setEditMode('news', id); }
function deleteNews(id) { if (confirm("Bekanntmachung löschen?")) { db.ref('news/' + id).remove(); if (editState.news === id) setEditMode('news', null); } }
