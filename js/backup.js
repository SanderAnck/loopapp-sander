// Backup screen (#/backup): save all Pace data as one JSON file (Files or
// iCloud Drive via the share sheet) and restore it. The Intervals.icu key
// never goes into the file.

import { db } from './db.js';
import { esc, showToast } from './ui.js';

const BACKUP_KEY = 'backup';

export async function loadBackupInfo() {
  return (await db.get('profile', BACKUP_KEY)) || { id: BACKUP_KEY, lastAt: null };
}

export function backupDue(info, hasData) {
  if (!hasData) return false;
  return !info.lastAt || Date.now() - new Date(info.lastAt) > 14 * 24 * 3600 * 1000;
}

const when = (iso) =>
  iso ? new Date(iso).toLocaleString('nl-BE', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'nog nooit';

async function makeFile() {
  const data = await db.exportAll();
  const counts = Object.fromEntries(Object.entries(data.data).map(([k, v]) => [k, v.length]));
  const name = `pace-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(data, null, 1)], name, { type: 'application/json' });
  return { file, counts };
}

export const backupView = {
  title: 'Back-up',
  tab: 'profiel',

  html() {
    return '<section class="card"><p class="card__text" style="margin-top:0">Laden…</p></section>';
  },

  async mount(root) {
    const info = await loadBackupInfo();
    root.innerHTML = `
      <a class="btn btn--ghost" href="#/profiel" style="justify-content:flex-start;padding:0 4px;width:auto">‹ Profiel</a>
      <section class="card">
        <div class="card__eyebrow">Je gegevens</div>
        <p class="card__text" style="margin-top:0">Alles van Pace staat alleen op deze iPhone: je doel, schema, lopen en antwoorden. Maak af en toe een back-up, bijvoorbeeld in iCloud Drive. Dan ben je niets kwijt als je de app verwijdert of een nieuwe iPhone neemt.</p>
        <p class="card__text">Laatste back-up: <strong>${esc(when(info.lastAt))}</strong></p>
        <button class="btn" type="button" id="export" style="margin-top:12px">Back-up maken</button>
        <p class="field__hint">Kies daarna <strong>Bewaar in Bestanden</strong> en een map in iCloud Drive. Je Intervals.icu-sleutel zit niet in het bestand.</p>
      </section>
      <section class="card">
        <div class="card__eyebrow">Terugzetten</div>
        <p class="card__text" style="margin-top:0">Kies een back-upbestand van Pace. Let op: alles wat nu in de app staat wordt vervangen door de inhoud van het bestand.</p>
        <label class="btn btn--secondary" style="margin-top:12px">Bestand kiezen<input type="file" id="import-file" accept="application/json,.json" hidden></label>
        <div id="import-confirm" hidden style="margin-top:12px"></div>
      </section>`;

    root.querySelector('#export').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const { file } = await makeFile();
        let saved = false;
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: 'Pace back-up' });
            saved = true;
          } catch (err) {
            if (err.name === 'AbortError') {
              showToast('Back-up niet bewaard.');
              return;
            }
          }
        }
        if (!saved) {
          const url = URL.createObjectURL(file);
          const a = document.createElement('a');
          a.href = url;
          a.download = file.name;
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
        await db.put('profile', { id: BACKUP_KEY, lastAt: new Date().toISOString() });
        showToast('Back-up gemaakt.');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (err) {
        console.error(err);
        showToast('De back-up lukte niet.');
      } finally {
        btn.disabled = false;
      }
    });

    let pending = null;
    root.querySelector('#import-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const box = root.querySelector('#import-confirm');
      try {
        pending = JSON.parse(await f.text());
        if (pending.app !== 'pace' || typeof pending.data !== 'object') throw new Error('bad');
      } catch {
        pending = null;
        box.hidden = false;
        box.innerHTML = '<div class="note note--very-ambitious"><strong>Geen Pace-back-up</strong>Dit bestand kan Pace niet lezen.</div>';
        return;
      }
      const d = pending.data;
      const n = (k) => (d[k] || []).length;
      box.hidden = false;
      box.innerHTML = `
        <div class="note note--ambitious"><strong>Back-up van ${esc(when(pending.exportedAt))}</strong>${n('workouts')} trainingen, ${n('runs')} lopen en ${n('checkins')} vragenlijsten. Dit vervangt alles wat nu in de app staat.</div>
        <button class="btn" type="button" id="import-go" style="margin-top:12px">Ja, terugzetten</button>`;
      box.querySelector('#import-go').addEventListener('click', async () => {
        try {
          await db.importAll(pending);
          showToast('Back-up teruggezet.');
          setTimeout(() => {
            location.hash = '#/vandaag';
            location.reload();
          }, 600);
        } catch (err) {
          showToast(err.message || 'Terugzetten lukte niet.');
        }
      });
    });
  },
};
