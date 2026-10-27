// =========================================
// CLOUD BACKUP & RESTORE
// =========================================
function exportBackup() {
    db.ref('/').once('value').then(snap => {
        const blob = new Blob([JSON.stringify(snap.val())], {type: 'application/json'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'harmony_bay_cloud_backup_' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
    });
}

function importBackup() {
    const fileInput = document.getElementById('backup-file');
    if (fileInput.files.length === 0) { alert("Bitte wähle zuerst eine Backup-Datei aus!"); return; }

    if(confirm("Bist du sicher? Dies überschreibt ALLE aktuellen Daten in der Cloud und bei allen Spielern sofort!")) {
        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                // Überschreibt die komplette Datenbank in der Cloud auf einen Schlag
                db.ref('/').set(data).then(() => {
                    alert("Cloud-Restore erfolgreich! Das System ist wieder auf dem alten Stand.");
                    document.getElementById('backup-file').value = ''; // Input Feld leeren
                }).catch(err => {
                    alert("Fehler beim Schreiben in die Cloud: " + err.message);
                });
            } catch(err) { alert("Fehler beim Lesen der JSON-Datei! Ist das wirklich das Backup?"); }
        };
        reader.readAsText(file);
    }
}
