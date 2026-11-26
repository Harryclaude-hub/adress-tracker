'use strict';
/* Adress-Tracker, Logik und Aufbau der Oberflaeche.
   Der Schluessel unten ist der oeffentliche Projektschluessel (publishable). Er darf im Browser stehen:
   Die Tabellen sind fuer ihn gesperrt, Daten gibt es nur ueber Funktionen, die einen Zugangsschluessel pruefen. */
const SB_URL = 'https://rsthdilxubmefulnthgc.supabase.co';
const SB_KEY = 'sb_publishable_ZwlJ8o3GaILrQ13gyD7CXA_WtNQpXfl';
const STORE = 'adress-tracker.zugang';
const POLL_MS = 8000;

const STATES = {AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
/* Stufen: nur von Hand gesetzt, nichts ändert sich automatisch. */
const STATUS = [
  { k: 'leer', l: 'Leer, kein Auftrag' },
  { k: 'zu_erledigen', l: 'Zu erledigen' },
  { k: 'erledigt', l: 'Erledigt' },
  { k: 'veraltet', l: 'Übernommen' },
  { k: 'test', l: 'Test' },
];
const STATUS_L = Object.fromEntries(STATUS.map(s => [s.k, s.l]));
const STATUS_ORDER = Object.fromEntries(STATUS.map((s, i) => [s.k, i]));
const SORTS = [['neu', 'Neueste zuerst'], ['name', 'Name A bis Z'], ['nr', 'Adressnummer'], ['state', 'State'], ['status', 'Stufe'], ['geaendert', 'Zuletzt geändert']];

const S = {
  code: null, me: null, personen: [], sig: '', stand: null, online: true, lastN: 0,
  einst: { standardwert: 40, zaehlt_ab: 'veraltet' }, esig: '', projekte: [], ansicht: 'start',
  f: { status: 'alle', q: '', state: 'alle', haken: 'alle', projekt: 'alle', mail: 'alle', konto: 'alle', sort: 'neu' },
};

/* ------------------------------------------------------------------ Helfer */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  const BOOL = ['checked', 'disabled', 'selected', 'hidden', 'readOnly', 'required'];
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || (v === false && !BOOL.includes(k))) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (BOOL.includes(k) || k === 'value') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  return el;
}
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
function heute() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function datumDE(iso) { if (!iso) return ''; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? m[3] + '.' + m[2] + '.' + m[1] : iso; }
function rel(ts) {
  if (!ts) return 'noch nie';
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return 'vor ' + Math.floor(s / 60) + ' Min';
  if (s < 86400) return 'vor ' + Math.floor(s / 3600) + ' Std';
  if (s < 86400 * 14) return 'vor ' + Math.floor(s / 86400) + ' Tagen';
  return new Date(ts).toLocaleDateString('de-DE');
}
/* Wert je Person: Standardwert, wenn nichts eingetragen. Zaehlt nur, wenn "Dazurechnen" an ist UND die Stufe ab der eingestellten erreicht ist. */
const RANG = { zu_erledigen: 1, erledigt: 2, veraltet: 3 };
const ZAEHLT_AB = [['veraltet', 'Übernommen'], ['erledigt', 'Erledigt'], ['zu_erledigen', 'Zu erledigen']];
const eur = n => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n || 0);
function parseEuro(t) { const x = String(t).trim().replace(',', '.'); return /^\d{1,6}(\.\d{1,2})?$/.test(x) ? Number(x) : NaN; }
function wertVon(p) { return p.wert == null ? Number(S.einst.standardwert) : Number(p.wert); }
function stufeReicht(p) { return (RANG[p.status] || 0) >= (RANG[S.einst.zaehlt_ab] || 3); }
function zaehltJetzt(p) { return !!p.zaehlt && stufeReicht(p); }
const summe = a => a.reduce((t, p) => t + Math.round(wertVon(p) * 100), 0) / 100;

function toast(msg, bad) {
  const box = $('#toastbox'); box.textContent = '';
  const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status', text: msg });
  box.append(t); setTimeout(() => t.remove(), bad ? 6000 : 2600);
}
async function kopieren(text, ok) {
  try { await navigator.clipboard.writeText(text); toast(ok || 'Kopiert'); }
  catch (e) { toast('Kopieren hat nicht geklappt. Bitte den Text markieren und von Hand kopieren.', true); }
}
function store(v) { try { v == null ? localStorage.removeItem(STORE) : localStorage.setItem(STORE, v); } catch (e) {} }
function stored() { try { return localStorage.getItem(STORE); } catch (e) { return null; } }
function initialen(n) { const t = String(n || '?').trim().split(/\s+/); return ((t[0] || '?')[0] + (t.length > 1 ? t[t.length - 1][0] : '')).toUpperCase(); }
const AVATAR_FARBEN = [['blau', 'Blau'], ['tuerkis', 'Türkis'], ['gruen', 'Grün'], ['orange', 'Orange'], ['rot', 'Rot'], ['pink', 'Pink'], ['violett', 'Violett'], ['grau', 'Grau']];
/* z = Zugang mit avatar_bild und avatar_farbe (optional). Foto nur, wenn es genau ein JPEG als Daten-Adresse ist. */
function avatar(n, big, z) {
  if (z && z.avatar_bild && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(z.avatar_bild)) return h('img', { class: 'av bild' + (big ? ' big' : ''), src: z.avatar_bild, alt: '' });
  const fb = z && AVATAR_FARBEN.some(f => f[0] === z.avatar_farbe) ? z.avatar_farbe : null;
  let x = 0; for (const c of String(n)) x = (x * 31 + c.charCodeAt(0)) % 6;
  return h('div', { class: 'av ' + (fb ? 'fb-' + fb : 'av' + x) + (big ? ' big' : ''), 'aria-hidden': 'true', text: initialen(n) });
}

const ICONS = {
  plus: 'M12 5v14M5 12h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  chevron: 'M9 6l6 6-6 6',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-3.3 3.6-6 8-6s8 2.7 8 6',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3 3-5.5 6.5-5.5s6.5 2.5 6.5 5.5M18 8v6M15 11h6',
  filter: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  down: 'M12 4v11M7.5 11L12 15.5 16.5 11M5 20h14',
  sum: 'M18 5H6l6 7-6 7h12',
  back: 'M15 5l-7 7 7 7',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
};
function ic(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ic' + (name === 'more' ? ' dots' : '')); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', ICONS[name]); s.append(p); return s;
}
function logoImg(px) { return h('img', { src: 'logo.svg', alt: '', width: px, height: px }); }

/* ------------------------------------------------------------------ Aehnliche Namen finden */
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function toks(s) { return norm(s).split(' ').filter(Boolean); }
function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/* 'exakt' = gleicher Name (auch vertauscht). 'aehnlich' = wirklich fast gleich: nur Doppelbuchstaben (Anna / Ana) oder ein
   Buchstabe anders (Jon / John), bei sehr langen Namen zwei. Alles andere zaehlt nicht als aehnlich. */
const kollabiere = t => t.replace(/(.)\1+/g, '$1');
function aehnlich(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return null;
  if (na === nb) return 'exakt';
  const sa = toks(a).sort().join(' '), sb = toks(b).sort().join(' ');
  if (sa === sb) return 'exakt';
  if (kollabiere(sa) === kollabiere(sb)) return 'aehnlich';
  const kurz = Math.min(sa.length, sb.length);
  if (kurz < 6) return null;
  const lim = kurz >= 14 ? 2 : 1;
  return (lev(sa, sb) <= lim || lev(na, nb) <= lim) ? 'aehnlich' : null;
}

/* Titel einer Zeile: Name, sonst das erste ausgefuellte Feld (E-Mail, Nummer, ...). k = welches Feld es war. */
function titelVon(p) {
  if (p.name && p.name.trim()) return { t: p.name, k: 'name' };
  for (const k of ['email', 'nummer', 'adressnummer', 'state', 'zustaendig', 'adresse', 'notiz']) {
    const v = p[k] && String(p[k]).trim();
    if (v) return { t: v.split('\n')[0], k };
  }
  return { t: '(ohne Angaben)', k: null };
}
function titel(p) { return titelVon(p).t; }

const FEHLER = {
  zugang_ungueltig: 'Dieser Zugangsschlüssel gilt nicht (mehr).',
  nur_admin: 'Das darf nur ein Admin.',
  name_fehlt: 'Der Name fehlt.',
  leer: 'Bitte mindestens ein Feld ausfüllen.',
  wert_ungueltig: 'Der Wert ist ungültig. Erlaubt sind Zahlen von 0 bis 100000.',
  zaehlt_ab_ungueltig: 'Die Stufe, ab der der Wert zählt, ist ungültig.',
  datei_zu_gross: 'Die Datei ist größer als 5 MB.',
  datei_ungueltig: 'Die Datei konnte nicht gelesen werden.',
  zu_viele_dateien: 'Mehr als 20 Dateien pro Person gehen nicht.',
  speicher_voll: 'Der Datei-Speicher ist voll (300 MB). Bitte alte Dateien löschen.',
  datei_typ_nicht_erlaubt: 'Diesen Dateityp gibt es hier nicht. Erlaubt sind Bilder, PDF, Word, Excel, PowerPoint, ZIP, TXT und CSV.',
  datei_inhalt_passt_nicht: 'Der Inhalt passt nicht zur Dateiendung. Die Datei wurde nicht gespeichert.',
  zu_schnell: 'Zu viele Dateien auf einmal. Bitte eine Minute warten.',
  projekt_name_fehlt: 'Bitte dem Projekt einen Namen geben.',
  projekt_name_vergeben: 'Ein Projekt mit diesem Namen gibt es schon.',
  symbol_ungueltig: 'Das Bild des Projekts ist ungültig. Bitte Flagge, Emoji oder Foto neu wählen.',
  projekt_nicht_leer: 'In diesem Projekt sind noch Personen. Verschiebe sie zuerst in ein anderes Projekt.',
  letztes_projekt: 'Das letzte Projekt kann nicht gelöscht werden.',
  zu_viele_projekte: 'Mehr als 30 Projekte gehen nicht.',
  nur_inhaber: 'Das darf nur der Inhaber.',
  inhaber_geschuetzt: 'Der Inhaber ist geschützt. Er kann nicht herabgestuft, gesperrt oder gelöscht werden.',
  mail_status_fehlt: 'Bitte den Mail-Status wählen: Erhalten oder Erstellt.',
  avatar_ungueltig: 'Das Profilbild oder die Farbe ist ungültig.',
  name_doppelt: 'Diesen Namen gibt es schon (in irgendeinem Projekt). Kein Name darf doppelt vorkommen.',
  mail_doppelt: 'Diese Mail gibt es schon bei einem anderen Eintrag. Das geht nur, wenn sie dort und hier als selbst erstellt steht.',
  mail_voll: 'Diese Mail ist schon voll: Sie steht bei zwei Einträgen oder beide Konten sind vergeben.',
  mail_konto_belegt: 'Bet Online oder Stake ist mit dieser Mail schon bei einem anderen Eintrag angelegt.',
  stake_gesperrt: 'Bei einer erhaltenen Mail geht Stake nicht mehr, wenn Bet Online schon gesetzt ist.',
  projekt_ungueltig: 'Dieses Projekt gibt es nicht.',
  mail_status_ungueltig: 'Der Mail-Status ist ungültig.',
  konto_ungueltig: 'Die Konto-Angabe ist ungültig.',
  zu_lang: 'Ein Feld ist zu lang.',
  nicht_gefunden: 'Den Eintrag gibt es nicht mehr. Die Liste wird neu geladen.',
  setup_ungueltig: 'Der Einrichtungs-Schlüssel stimmt nicht.',
  schon_eingerichtet: 'Die Einrichtung ist schon erledigt.',
  sich_selbst_nicht: 'Den eigenen Zugang kann man nicht sperren.',
  datum_ungueltig: 'Das Datum ist ungültig.',
  zu_viele_zeilen: 'Zu viele Zeilen auf einmal.',
  letzter_admin: 'Der letzte Admin kann nicht herabgestuft werden.',
  name_vergeben: 'Dieser Name ist schon vergeben. Bitte einen anderen wählen.',
};
function fehlertext(e) {
  if (/duplicate key|zugang_name_eindeutig/.test(e.message)) return FEHLER.name_vergeben;
  return FEHLER[e.message] || (e.network ? 'Keine Verbindung zum Server.' : 'Das hat nicht geklappt: ' + e.message);
}
async function rpc(name, args) {
  let r;
  try {
    r = await fetch(SB_URL + '/rest/v1/rpc/' + name, {
      method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}),
    });
  } catch (e) { const err = new Error('netz'); err.network = true; throw err; }
  let body = null; try { body = await r.json(); } catch (e) {}
  if (!r.ok) { const err = new Error((body && body.message) || 'HTTP ' + r.status); err.status = r.status; throw err; }
  return body;
}
function istAdmin() { return !!S.me && S.me.rolle === 'admin'; }

/* ------------------------------------------------------------------ Start und Anmeldung */
async function start() {
  const m = /^#k=([A-Za-z0-9_-]{20,200})$/.exec(location.hash);
  if (m) { store(m[1]); history.replaceState(null, '', location.pathname + location.search); }
  S.code = stored();
  if (S.code) { await laden(true); return; }
  await gate();
}
function gateBox(...kids) {
  const app = $('#app'); app.textContent = '';
  app.append(h('div', { class: 'gate-wrap' }, h('div', { class: 'gate' }, logoImg(76), h('h1', { text: 'Adress-Tracker' }), ...kids)));
}
async function gate(msg) {
  gateBox(h('p', { class: 'hint', text: 'Verbindung wird geprüft ...' }));
  let st;
  try { st = await rpc('tr_status'); }
  catch (e) { gateBox(h('p', { class: 'err', text: fehlertext(e) }), h('button', { class: 'btn', text: 'Nochmal versuchen', onclick: () => gate() })); return; }
  if (!st.eingerichtet) return einrichtung();
  const inp = h('input', { id: 'key', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Zugangsschlüssel', 'aria-label': 'Zugangsschlüssel' });
  const err = h('p', { class: 'err', text: msg || '' });
  const go = async () => {
    const v = inp.value.trim(); if (!v) return;
    S.code = v; err.textContent = '';
    const ok = await laden(false);
    if (ok) store(v); else { S.code = null; err.textContent = 'Dieser Zugangsschlüssel gilt nicht.'; }
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  gateBox(
    h('p', { class: 'hint', text: 'Geschlossene Liste. Den Zugangsschlüssel bekommst du vom Admin, am besten als Link. Er bleibt nur in diesem Browser gespeichert.' }),
    h('div', { class: 'fg' }, h('label', { class: 'fr one' }, inp)),
    err,
    h('button', { class: 'btn pri', text: 'Anmelden', onclick: go }));
  inp.focus();
}
function einrichtung() {
  const k = h('input', { id: 'ek', type: 'password', autocomplete: 'off', placeholder: 'Einrichtungs-Schlüssel', 'aria-label': 'Einrichtungs-Schlüssel' });
  const n = h('input', { id: 'nm', autocomplete: 'off', placeholder: 'Dein Name', 'aria-label': 'Dein Name' });
  const err = h('p', { class: 'err' });
  gateBox(
    h('p', { class: 'hint', text: 'Erste Einrichtung. Du legst den Admin-Zugang an. Der Server erzeugt deinen Schlüssel und zeigt ihn genau einmal an.' }),
    h('div', { class: 'fg' }, h('label', { class: 'fr one' }, k), h('label', { class: 'fr one' }, n)),
    err,
    h('button', { class: 'btn pri', text: 'Admin-Zugang erstellen', onclick: async (ev) => {
      err.textContent = ''; ev.target.disabled = true;
      try {
        const r = await rpc('tr_einrichten', { p_setup: k.value.trim(), p_name: n.value.trim() });
        S.code = r.code; store(r.code);
        gateBox(h('p', { class: 'hint', text: 'Dein Admin-Schlüssel wird nur jetzt angezeigt. Kopiere ihn und bewahre ihn sicher auf. Dieser Browser ist schon angemeldet.' }),
          h('div', { class: 'keybox', text: r.code }),
          h('div', { class: 'kbar' }, h('button', { class: 'btn', text: 'Schlüssel kopieren', onclick: () => kopieren(r.code, 'Schlüssel kopiert') }),
            h('button', { class: 'btn pri', text: 'Weiter zur Liste', onclick: () => laden(true) })));
      } catch (e) { err.textContent = fehlertext(e); ev.target.disabled = false; }
    } }));
}

/* ------------------------------------------------------------------ Daten laden */
let pollTimer = null;
async function laden(first) {
  try {
    const r = await rpc('tr_laden', { p_code: S.code });
    const rolleAlt = S.me && S.me.rolle; S.me = r.ich; S.stand = r.stand; S.online = true;
    const rolleGewechselt = !!rolleAlt && rolleAlt !== r.ich.rolle;
    if (rolleGewechselt) { schliesseAlle(); S.einst = { standardwert: 40, zaehlt_ab: 'veraltet' }; S.f.haken = 'alle'; }
    const sig = JSON.stringify(r.personen), esig = JSON.stringify(r.einstellungen || null);
    const changed = sig !== S.sig || esig !== S.esig;
    S.personen = r.personen; S.sig = sig; S.esig = esig;
    if (r.einstellungen) S.einst = { ...S.einst, ...r.einstellungen };
    if (r.projekte) S.projekte = r.projekte;
    if (first || rolleGewechselt || (S.ansicht === 'liste' && !$('#rows')) || (S.ansicht === 'start' && !$('.start'))) aufbau();
    else if (S.ansicht === 'start') { setSub(); if (changed) startAufbau(); }
    else { setSub(); if (changed) zeichne(); }
    if (!pollTimer) {
      pollTimer = setInterval(() => { if (!document.hidden && !pending.size && S.code) laden(false); }, POLL_MS);
      document.addEventListener('visibilitychange', () => { if (!document.hidden && S.code && !pending.size) laden(false); });
    }
    return true;
  } catch (e) {
    if (e.message === 'zugang_ungueltig') {
      store(null); S.code = null; S.sig = '';
      if (first || $('#rows')) { $('#layer').textContent = ''; await gate('Dieser Zugangsschlüssel gilt nicht (mehr). Bitte neuen Schlüssel eingeben.'); }
      return false;
    }
    S.online = false; setSub();
    if (first) gateBox(h('p', { class: 'err', text: fehlertext(e) }), h('button', { class: 'btn', text: 'Nochmal versuchen', onclick: () => laden(true) }));
    return false;
  }
}

/* ------------------------------------------------------------------ Seitenaufbau */
function navItem(label, count, active, onclick, dot) {
  return h('button', { class: 'nav-item', 'aria-pressed': String(active), onclick },
    dot != null ? h('span', { class: 'sw-dot ' + dot }) : null,
    h('span', { class: 'nl', text: label }),
    count != null ? h('span', { class: 'nc', text: count }) : null);
}
function aufbau() {
  if (S.ansicht === 'start') { startAufbau(); return; }
  const app = $('#app'); app.textContent = '';
  const side = h('aside', { class: 'side', 'aria-label': 'Filter' },
    h('div', { class: 'side-brand' }, logoImg(30), h('span', { class: 'side-title', text: 'Adress-Tracker' })),
    h('div', { class: 'side-scroll' },
      h('button', { class: 'nav-item', onclick: zumStart }, ic('back'), h('span', { class: 'nl', text: 'Alle Projekte' })),
      istAdmin() ? h('button', { class: 'nav-item', onclick: uebersichtSheet }, ic('sum'), h('span', { class: 'nl', text: 'Übersicht und Wert' })) : null,
      h('div', { class: 'side-label', text: 'Land' }), h('div', { id: 'sideLand' }),
      h('div', { class: 'side-label', text: 'Stufe' }), h('div', { id: 'sideStatus' }),
      h('div', { class: 'side-label', text: 'Mail' }), h('div', { id: 'sideMail' }),
      h('div', { class: 'side-label', text: 'Konto' }), h('div', { id: 'sideKonto' }),
      ...(istAdmin() ? [h('div', { class: 'side-label', text: 'Dazurechnen' }), h('div', { id: 'sideHaken' })] : []),
      h('div', { class: 'side-label', text: 'State' }), h('div', { id: 'sideStates' })),
    h('button', { class: 'side-me', onclick: profilSheet, 'aria-label': 'Profil öffnen' }, avatar(S.me.name, false, S.me),
      h('span', { class: 'me-t' }, h('strong', { text: S.me.name }), h('small', { text: istAdmin() ? 'Admin' : 'Mitarbeiter' })), ic('chevron')));

  const search = h('div', { class: 'search' }, ic('search'),
    h('input', { id: 'q', type: 'search', placeholder: 'E-Mail-Adresse suchen', 'aria-label': 'Suchen nach E-Mail-Adresse, Name, Adressnummer, Nummer oder Adresse', value: S.f.q, autocomplete: 'off', oninput: e => { S.f.q = e.target.value; zeichne(); } }));
  const sortSel = h('select', { class: 'btn sortsel only-desk', 'aria-label': 'Sortierung', onchange: e => { S.f.sort = e.target.value; zeichne(); } },
    ...SORTS.map(([v, t]) => h('option', { value: v, text: t })));
  sortSel.value = S.f.sort;
  const topbar = h('header', { class: 'topbar' },
    h('div', { class: 'tb-row' },
      h('button', { class: 'ibtn back', 'aria-label': 'Zu den Projekten', onclick: zumStart }, ic('back')),
      h('div', { class: 'tb-title' }, h('h1', null, h('span', { id: 'tflag', class: 'tflag' }), h('span', { id: 'title', text: 'Personen' })), h('div', { class: 'sub', id: 'sub' })),
      h('button', { class: 'btn pri only-desk', 'aria-label': 'Person hinzufügen', onclick: () => personSheet(null) }, ic('plus'), h('span', { class: 'lbl', text: 'Person' })),
      h('button', { class: 'ibtn', 'aria-label': 'Mehr', onclick: ev => hauptmenue(ev.currentTarget) }, ic('more'))),
    h('div', { class: 'tb-row' }, search, sortSel,
      h('button', { class: 'ibtn only-mob', 'aria-label': 'Filter und Sortierung', onclick: filterSheet }, ic('filter'), h('span', { class: 'badge', id: 'fbadge', hidden: true }))),
    h('div', { class: 'chips', id: 'chips', role: 'group', 'aria-label': 'Stufe filtern' }));

  const content = h('div', { class: 'content' }, h('div', { id: 'rows' }));
  const fab = h('button', { class: 'fab only-mob', 'aria-label': 'Person hinzufügen', onclick: () => personSheet(null) }, ic('plus'));
  app.append(h('div', { class: 'shell' }, side, h('main', { class: 'main' }, topbar, content)), fab);
  zeichne();
}
function hauptmenue(anchor) {
  const items = [];
  if (istAdmin()) items.push({ label: 'Übersicht und Wert', icon: 'sum', fn: uebersichtSheet }, { label: 'PDF laden', icon: 'down', fn: pdfSheet }, { label: 'Admin-Portal', icon: 'people', fn: zugaengeSheet }, '-');
  items.push({ label: 'Profil', icon: 'person', fn: profilSheet });
  popMenu(anchor, items);
}

/* ------------------------------------------------------------------ Filter, Sortierung, Liste */
function passtOhneStatus(p) {
  const f = S.f;
  if (f.projekt !== 'alle' && p.projekt_id !== f.projekt) return false;
  if (!mailPasst(p, f.mail) || !kontoPasst(p, f.konto)) return false;
  if (istAdmin() && f.haken === 'offen' && p.zaehlt) return false;
  if (istAdmin() && f.haken === 'ja' && !p.zaehlt) return false;
  if (f.state === 'ohne' && p.state) return false;
  if (f.state !== 'alle' && f.state !== 'ohne' && p.state !== f.state) return false;
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = [p.name, p.adressnummer, p.state, STATES[p.state], p.nummer, p.email, p.adresse, p.zustaendig, p.notiz, p.geaendert_von].filter(Boolean).join(' ').toLowerCase();
    for (const w of q.split(/\s+/)) if (!hay.includes(w)) return false;
  }
  return true;
}
function sortiere(arr) {
  const s = S.f.sort, c = (a, b) => (a || '').localeCompare(b || '', 'de', { sensitivity: 'base' });
  const cn = (a, b) => c(titel(a), titel(b));
  const out = arr.slice();
  out.sort((a, b) => {
    if (s === 'name') return cn(a, b);
    if (s === 'nr') return (a.adressnummer ? 0 : 1) - (b.adressnummer ? 0 : 1) || (a.adressnummer || '').localeCompare(b.adressnummer || '', 'de', { numeric: true }) || cn(a, b);
    if (s === 'state') return (a.state ? 0 : 1) - (b.state ? 0 : 1) || c(a.state, b.state) || cn(a, b);
    if (s === 'status') return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || cn(a, b);
    if (s === 'geaendert') return (b.geaendert || '').localeCompare(a.geaendert || '');
    return (b.erstellt || '').localeCompare(a.erstellt || '');
  });
  return out;
}
function setSub() {
  const el = $('#sub'); if (!el) return;
  const n = S.lastN, total = S.ansicht === 'start' ? S.personen.length : S.personen.filter(imProjekt).length;
  el.textContent = '';
  el.append(h('span', { text: S.ansicht === 'start' || n === total ? total + (total === 1 ? ' Person' : ' Personen') : n + ' von ' + total }),
    h('span', { class: 'dot' + (S.online ? '' : ' off'), 'aria-hidden': 'true' }),
    h('span', { text: S.online ? 'Live, Stand ' + new Date(S.stand).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : 'Keine Verbindung' }));
}
function zeichne() {
  const base = S.personen.filter(passtOhneStatus);
  const cnt = { alle: base.length, ...Object.fromEntries(STATUS.map(s => [s.k, 0])) };
  base.forEach(p => { if (p.status in cnt) cnt[p.status]++; });
  const rows = sortiere(base.filter(p => S.f.status === 'alle' || p.status === S.f.status));
  S.lastN = rows.length;
  if (S.f.projekt !== 'alle' && !S.projekte.some(x => x.id === S.f.projekt)) S.f.projekt = 'alle';
  const pr = S.f.projekt === 'alle' ? null : projektVon(S.f.projekt), inP = S.personen.filter(imProjekt);
  $('#title').textContent = (pr ? pr.name : 'Alle Personen') + (S.f.status === 'alle' ? '' : ' · ' + STATUS_L[S.f.status]);
  const tf = $('#tflag'); tf.textContent = ''; if (pr) tf.append(projektSymbol(pr, 'mini'));
  setSub();

  // Seitenleiste
  const ss = $('#sideStatus'); ss.textContent = '';
  ss.append(navItem('Alle', cnt.alle, S.f.status === 'alle', () => { S.f.status = 'alle'; zeichne(); }, ''));
  STATUS.forEach(s => ss.append(navItem(s.l, cnt[s.k], S.f.status === s.k, () => { S.f.status = s.k; zeichne(); }, s.k)));
  const sl = $('#sideLand'); sl.textContent = '';
  sl.append(navItem('Alle Länder', S.personen.length, S.f.projekt === 'alle', () => { S.f.projekt = 'alle'; zeichne(); }));
  S.projekte.forEach(x => { const b = navItem(x.name, S.personen.filter(p => p.projekt_id === x.id).length, S.f.projekt === x.id, () => { S.f.projekt = x.id; zeichne(); }); b.prepend(projektSymbol(x, 'mini')); sl.append(b); });
  const sm = $('#sideMail'); sm.textContent = '';
  MAIL_FILTER.forEach(([k, l]) => sm.append(navItem(l, inP.filter(p => mailPasst(p, k)).length, S.f.mail === k, () => { S.f.mail = k; zeichne(); })));
  const sk = $('#sideKonto'); sk.textContent = '';
  KONTO_FILTER.forEach(([k, l]) => sk.append(navItem(l, inP.filter(p => kontoPasst(p, k)).length, S.f.konto === k, () => { S.f.konto = k; zeichne(); })));
  const sh = $('#sideHaken'); if (sh) sh.textContent = '';
  if (sh) [['alle', 'Alle'], ['offen', 'Nicht dazugerechnet'], ['ja', 'Dazugerechnet']].forEach(([k, l]) => sh.append(navItem(l, null, S.f.haken === k, () => { S.f.haken = k; zeichne(); })));
  const counts = {}; let ohne = 0;
  S.personen.forEach(p => { if (p.state) counts[p.state] = (counts[p.state] || 0) + 1; else ohne++; });
  const known = ['alle', 'ohne', ...Object.keys(counts)];
  if (!known.includes(S.f.state) || (S.f.state === 'ohne' && !ohne)) S.f.state = 'alle';
  const st = $('#sideStates'); st.textContent = '';
  st.append(navItem('Alle States', S.personen.length, S.f.state === 'alle', () => { S.f.state = 'alle'; zeichne(); }));
  if (ohne) st.append(navItem('Ohne State', ohne, S.f.state === 'ohne', () => { S.f.state = 'ohne'; zeichne(); }));
  Object.keys(counts).sort().forEach(k => st.append(navItem(k + (STATES[k] ? ' · ' + STATES[k] : ''), counts[k], S.f.state === k, () => { S.f.state = k; zeichne(); })));

  // Kapseln (Handy)
  const chips = $('#chips'); chips.textContent = '';
  [{ k: 'alle', l: 'Alle' }, ...STATUS].forEach(s => chips.append(h('button', { class: 'chip', 'data-s': s.k, 'aria-pressed': String(S.f.status === s.k), onclick: () => { S.f.status = s.k; zeichne(); } }, s.k === 'alle' ? null : h('span', { class: 'sw-dot ' + s.k }), s.l, h('span', { class: 'n', text: cnt[s.k] }))));
  const b = (S.f.state !== 'alle') + (istAdmin() && S.f.haken !== 'alle') + (S.f.mail !== 'alle') + (S.f.konto !== 'alle');
  const badge = $('#fbadge'); if (badge) { badge.hidden = !b; badge.textContent = b; }

  // Zeilen
  const box = $('#rows'); box.textContent = '';
  if (!inP.length) {
    box.append(h('div', { class: 'group' }, h('div', { class: 'empty' }, h('h2', { text: S.personen.length ? 'In diesem Projekt sind noch keine Personen' : 'Noch keine Personen' }),
      h('p', { text: 'Lege die erste Person an. Es reicht ein einziges Feld, zum Beispiel nur die E-Mail oder nur die Nummer. Den Rest trägst du später nach.' }),
      h('button', { class: 'btn pri', onclick: () => personSheet(null) }, ic('plus'), 'Person hinzufügen'))));
    return;
  }
  if (!rows.length) {
    box.append(h('div', { class: 'group' }, h('div', { class: 'empty' }, h('h2', { text: 'Nichts gefunden' }), h('p', { text: 'Kein Eintrag passt zu den gewählten Filtern.' }),
      h('button', { class: 'btn', text: 'Filter zurücksetzen', onclick: () => { S.f = { status: 'alle', q: '', state: 'alle', haken: 'alle', projekt: S.f.projekt, mail: 'alle', konto: 'alle', sort: S.f.sort }; $('#q').value = ''; zeichne(); } }))));
    return;
  }
  const grp = h('div', { class: 'group' }, h('div', { class: 'colhead' }, h('span'), ...[['main', 'Person'], ['kontakt', 'E-Mail und Nummer'], ['adr', 'State und Adresse'], ['konten', 'Mail und Konten'], ['status', 'Stufe'], ['last', 'Zuletzt']].map(([k, t]) => h('span', { class: 'h-' + k, text: t }))));
  rows.forEach(p => grp.append(zeile(p)));
  box.append(grp, h('div', { class: 'foot', text: rows.length + ' von ' + inP.length + ' angezeigt' + (istAdmin() ? ', ' + inP.filter(p => p.zaehlt).length + ' dazugerechnet' : '') }));
}
function aehnTag(p) {
  const am = aehnlichkeiten().get(p.id); if (!am || !am.length) return null;
  const ex = am.some(x => x.art === 'exakt');
  return h('span', { class: 'tag ' + (ex ? 'rot' : 'blue'), title: am.map(x => (x.art === 'exakt' ? 'Gleiche' + (x.was === 'Name' ? 'r Name' : ' E-Mail') : 'Ähnliche' + (x.was === 'Name' ? 'r Name' : ' E-Mail')) + ' wie ' + titel(x.p) + ' (' + projektTitel(x.p.projekt_id) + ')').join('; '), text: ex ? 'Doppelt' : 'Ähnlich' });
}
function zeile(p) {
  const tv = titelVon(p), name = (p.name || '').trim();
  const stsel = h('select', { class: 'pillsel', 'data-s': p.status, 'aria-label': 'Stufe von ' + tv.t, onchange: e => quick(p.id, { status: e.target.value }) },
    ...STATUS.map(s => h('option', { value: s.k, text: s.l })));
  stsel.value = p.status;
  /* Jede Angabe hat ihren festen Platz. Fehlt sie, steht dort ein leiser Hinweis (am Handy ausgeblendet). */
  const leer = t => h('span', { class: 'leer-t', text: t });
  const zeigePerson = e => { if (!e.target.closest('input, select, label, button') && !String(getSelection())) personSheet(p.id); };
  return h('div', { class: 'row', 'data-id': p.id, onclick: zeigePerson },
    istAdmin() ? h('label', { class: 'cb' }, h('input', { class: 'cbx', type: 'checkbox', checked: !!p.zaehlt, 'aria-label': 'Dazurechnen: ' + tv.t, title: 'Dazurechnen', onchange: e => quick(p.id, { zaehlt: e.target.checked }) })) : h('span', { class: 'cb' }),
    h('div', { class: 'c-main' },
      h('div', { class: 'nmline' }, S.f.projekt === 'alle' ? projektSymbol(projektVon(p.projekt_id), 'mini') : null, h('button', { class: 'nm' + (name ? '' : ' ohne'), text: name || 'Ohne Name', 'aria-label': name || 'Ohne Name, ' + tv.t, onclick: () => personSheet(p.id) })),
      h('div', { class: 'c-meta' }, p.adressnummer ? h('span', { class: 'nr', title: 'Adressnummer', text: 'Nr. ' + p.adressnummer }) : null, p.dateien ? h('span', { class: 'nr', title: 'Dateien', text: p.dateien + (p.dateien === 1 ? ' Datei' : ' Dateien') }) : null, aehnTag(p), p.zustaendig ? h('span', { class: 'zu', text: 'Zuständig: ' + p.zustaendig }) : null)),
    h('div', { class: 'c-kontakt' }, p.email ? h('span', { class: 'em', title: p.email, text: p.email }) : leer('keine E-Mail'), p.nummer ? h('span', { class: 'ph', text: p.nummer }) : leer('keine Nummer'), mailTeilTag(p)),
    h('div', { class: 'c-adr' + (p.state || p.adresse ? '' : ' nix') }, p.state ? h('span', { class: 'c-state', title: STATES[p.state] || p.state, text: p.state }) : null, p.adresse ? h('span', { class: 'ad', title: p.adresse, text: p.adresse }) : leer(p.state ? 'keine Adresse' : 'kein State, keine Adresse')),
    h('div', { class: 'c-konten' }, p.mail_status ? h('span', { class: 'ms-pill ' + p.mail_status, text: p.mail_status === 'erhalten' ? 'Erhalten' : 'Erstellt' }) : p.email ? leer('Status offen') : null,
      p.betonline || p.stake ? h('span', { class: 'logos' }, ...kontoMarken(p)) : leer('kein Konto')),
    h('div', { class: 'c-status' }, stsel),
    h('div', { class: 'c-last' }, rel(p.geaendert), h('br'), p.geaendert_von ? 'von ' + p.geaendert_von : ''));
}

/* ------------------------------------------------------------------ Speichern */
const pending = new Map();
function enqueue(id, fn) {
  const prev = pending.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  pending.set(id, next);
  next.finally(() => { if (pending.get(id) === next) pending.delete(id); }).catch(() => {});
  return next;
}
function einsetzen(r) {
  const i = S.personen.findIndex(x => x.id === r.id);
  if (i >= 0) S.personen[i] = r; else S.personen.unshift(r);
  S.sig = JSON.stringify(S.personen);
}
async function quick(id, felder) {
  const p = S.personen.find(x => x.id === id); if (!p) return;
  const snap = { ...p };
  Object.assign(p, felder);
  zeichne();
  try { einsetzen(await enqueue(id, () => rpc('tr_person_speichern', { p_code: S.code, p_id: id, p_felder: felder }))); }
  catch (e) {
    Object.assign(p, snap); toast(fehlertext(e), true);
    if (e.message === 'nicht_gefunden' || e.message === 'zugang_ungueltig') laden(false);
  }
  zeichne();
}

/* ------------------------------------------------------------------ Menue und Sheets */
let popClose = null;
function closePop() { if (popClose) { popClose(); popClose = null; } }
function popMenu(anchor, items) {
  closePop();
  const pop = h('div', { class: 'pop', role: 'menu' });
  items.forEach(it => {
    if (it === '-') pop.append(h('div', { class: 'mi-sep' }));
    else pop.append(h('button', { class: 'mi' + (it.red ? ' red' : ''), role: 'menuitem', onclick: () => { closePop(); it.fn(); } }, it.icon ? ic(it.icon) : null, it.label));
  });
  document.body.append(pop);
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth;
  pop.style.top = Math.min(r.bottom + 8, innerHeight - pop.offsetHeight - 8) + 'px';
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  const onDoc = e => { if (!pop.contains(e.target)) closePop(); };
  const onKey = e => { if (e.key === 'Escape') closePop(); };
  setTimeout(() => { document.addEventListener('pointerdown', onDoc, true); document.addEventListener('keydown', onKey); }, 0);
  popClose = () => { document.removeEventListener('pointerdown', onDoc, true); document.removeEventListener('keydown', onKey); pop.remove(); };
  const first = pop.querySelector('.mi'); if (first) first.focus();
}
/* Nach dem Speichern die Ansicht neu zeichnen, die gerade offen ist */
function neuZeichnen() { if (S.ansicht === 'start') startAufbau(); else zeichne(); }
function sheetEl(title, body, opt) {
  opt = opt || {};
  return h('div', { class: 'sheet' + (opt.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'grab' }),
    h('div', { class: 'sheet-h' }, h('div', { class: 'l' }, opt.left || null), h('h2', { text: title }), h('div', { class: 'r' }, opt.right || null)),
    body,
    opt.foot ? h('div', { class: 'sheet-f' }, opt.foot) : null);
}
function oeffne(el, outsideClose) {
  const layer = $('#layer'), back = document.activeElement;
  const veil = h('div', { class: 'veil', onmousedown: e => { if (outsideClose && e.target === veil) close(); } }, el);
  const esc = e => { if (e.key === 'Escape') close(); };
  function close() { document.removeEventListener('keydown', esc); veil.remove(); if (back && back.focus) try { back.focus(); } catch (e) {} }
  document.addEventListener('keydown', esc);
  layer.append(veil); el.__close = close;
  return close;
}
function schliesseAlle() { $('#layer').textContent = ''; }

/* ---------- Filter (Handy) */
function filterSheet() {
  const selS = h('select', { id: 'f-state', 'aria-label': 'State', onchange: e => { S.f.state = e.target.value; zeichne(); } });
  const counts = {}; let ohne = 0;
  S.personen.forEach(p => { if (p.state) counts[p.state] = (counts[p.state] || 0) + 1; else ohne++; });
  selS.append(h('option', { value: 'alle', text: 'Alle' }));
  if (ohne) selS.append(h('option', { value: 'ohne', text: 'Ohne State (' + ohne + ')' }));
  Object.keys(counts).sort().forEach(k => selS.append(h('option', { value: k, text: k + (STATES[k] ? ' · ' + STATES[k] : '') + ' (' + counts[k] + ')' })));
  selS.value = S.f.state;
  const selH = h('select', { id: 'f-haken', 'aria-label': 'Haken', onchange: e => { S.f.haken = e.target.value; zeichne(); } },
    h('option', { value: 'alle', text: 'Alle' }), h('option', { value: 'offen', text: 'Nicht dazugerechnet' }), h('option', { value: 'ja', text: 'Dazugerechnet' }));
  selH.value = S.f.haken;
  const selL = h('select', { id: 'f-land', 'aria-label': 'Land', onchange: e => { S.f.projekt = e.target.value; zeichne(); } }, h('option', { value: 'alle', text: 'Alle Länder' }), ...S.projekte.map(x => h('option', { value: x.id, text: x.name })));
  selL.value = S.f.projekt;
  const selM = h('select', { id: 'f-mail', 'aria-label': 'Mail', onchange: e => { S.f.mail = e.target.value; zeichne(); } }, ...MAIL_FILTER.map(([k, l]) => h('option', { value: k, text: l })));
  selM.value = S.f.mail;
  const selK = h('select', { id: 'f-konto', 'aria-label': 'Konto', onchange: e => { S.f.konto = e.target.value; zeichne(); } }, ...KONTO_FILTER.map(([k, l]) => h('option', { value: k, text: l })));
  selK.value = S.f.konto;
  const selO = h('select', { id: 'f-sort', 'aria-label': 'Sortierung', onchange: e => { S.f.sort = e.target.value; zeichne(); } }, ...SORTS.map(([v, t]) => h('option', { value: v, text: t })));
  selO.value = S.f.sort;
  const sh = sheetEl('Filter', h('div', { class: 'sheet-b' },
    h('div', { class: 'fg' }, h('label', { class: 'fr' }, h('span', { class: 'fl', text: 'Land' }), selL), h('label', { class: 'fr' }, h('span', { class: 'fl', text: 'Mail' }), selM), h('label', { class: 'fr' }, h('span', { class: 'fl', text: 'Konto' }), selK), h('label', { class: 'fr' }, h('span', { class: 'fl', text: 'State' }), selS), istAdmin() ? h('label', { class: 'fr' }, h('span', { class: 'fl', text: 'Dazurechnen' }), selH) : null, h('label', { class: 'fr' }, h('span', { class: 'fl', text: 'Sortierung' }), selO)),
    h('button', { class: 'btn', text: 'Zurücksetzen', onclick: () => { S.f = { status: 'alle', q: S.f.q, state: 'alle', haken: 'alle', projekt: S.f.projekt, mail: 'alle', konto: 'alle', sort: 'neu' }; zeichne(); sh.__close(); } })),
    { left: h('button', { class: 'tbtn', text: 'Schließen', onclick: () => sh.__close() }), right: h('button', { class: 'tbtn strong', text: 'Fertig', onclick: () => sh.__close() }) });
  oeffne(sh, true);
}

/* ---------- Person anlegen und bearbeiten */
function frow(label, control, extra, tall) {
  return h('label', { class: 'fr' + (tall ? ' tall' : '') }, h('span', { class: 'fl', text: label }), control, extra || null);
}
function personSheet(id, dateien) {
  const neu = id == null;
  const p = neu ? { name: '', adressnummer: '', state: null, nummer: '', email: '', adresse: '', status: 'zu_erledigen', zaehlt: false, wert: null, projekt_id: S.f.projekt !== 'alle' ? S.f.projekt : 'usa', mail_status: null, betonline: false, stake: false, zustaendig: '', notiz: '' } : S.personen.find(x => x.id === id);
  if (!p) return;
  const name = h('input', { id: 'd-name', value: p.name, maxlength: 200, autocomplete: 'off', autocapitalize: 'words', placeholder: 'optional, Vor- und Nachname' });
  const anr = h('input', { id: 'd-anr', value: p.adressnummer || '', maxlength: 40, autocomplete: 'off', autocapitalize: 'off', placeholder: 'eigene Nummer, optional' });
  const st = h('select', { id: 'd-state' }, h('option', { value: '', text: 'noch offen' }));
  Object.entries(STATES).forEach(([k, v]) => st.append(h('option', { value: k, text: k + ' · ' + v })));
  if (p.state && !STATES[p.state]) st.append(h('option', { value: p.state, text: p.state }));
  st.value = p.state || '';
  const status = h('select', { id: 'd-status' }, ...STATUS.map(s => h('option', { value: s.k, text: s.l }))); status.value = p.status;
  const haken = h('input', { id: 'd-haken', class: 'sw', type: 'checkbox', role: 'switch', checked: !!p.zaehlt });
  const nummer = h('input', { id: 'd-nummer', value: p.nummer || '', inputmode: 'tel', autocomplete: 'off', maxlength: 60, placeholder: 'noch offen' });
  const email = h('input', { id: 'd-email', value: p.email || '', inputmode: 'email', autocomplete: 'off', autocapitalize: 'off', maxlength: 254, placeholder: 'noch offen' });
  const projSel = h('select', { id: 'd-projekt', 'aria-label': 'Projekt' }, ...S.projekte.map(x => h('option', { value: x.id, text: x.name }))); projSel.value = p.projekt_id;
  /* Mail-Status: zwei Knoepfe mit zwei Farben, einer von beiden muss es sein. */
  let mailWahl = p.mail_status || '';
  const erBtn = h('button', { class: 'mbtn er', type: 'button', text: 'Erhalten', 'aria-label': 'Mail erhalten' }), esBtn = h('button', { class: 'mbtn es', type: 'button', text: 'Erstellt', 'aria-label': 'Mail selbst erstellt' });
  const mailZeigen = () => {
    erBtn.setAttribute('aria-pressed', String(mailWahl === 'erhalten')); esBtn.setAttribute('aria-pressed', String(mailWahl === 'erstellt'));
    const aus = !email.value.trim(); erBtn.disabled = aus; esBtn.disabled = aus;
  };
  /* Konten: Bei Mail erstellt gehen Stake und Bet Online in jeder Reihenfolge. Bei Mail erhalten fragt die Seite bei Stake nach,
     und ist Bet Online gesetzt, geht Stake nicht mehr. */
  const origBet = !!p.betonline, origStake = !!p.stake; let bet = origBet, stk = origStake;
  const betBtn = h('button', { class: 'kbtn bo', type: 'button' }, kontoLogo('bo'), 'Bet Online'), stakeBtn = h('button', { class: 'kbtn st', type: 'button' }, kontoLogo('st'), 'Stake');
  const kHint = h('div', { class: 'khint' }), kWarn = h('div', { class: 'warn info', hidden: true, role: 'alert' });
  let stakeOk = origStake && (p.mail_status || '') === 'erhalten';
  const kontenZeigen = () => {
    betBtn.setAttribute('aria-pressed', String(bet)); stakeBtn.setAttribute('aria-pressed', String(stk));
    const erh = mailWahl === 'erhalten';
    stakeBtn.disabled = erh && !stk && !origStake && (bet || origBet);
    const text = erh ? (stakeBtn.disabled ? 'Erhaltene Mail mit Bet Online: Stake geht hier nicht mehr.' : 'Erhaltene Mail: Hier ist nur Bet Online vorgesehen. Bei Stake fragt die Seite nach. Ist Bet Online gesetzt, geht Stake nicht mehr.')
      : mailWahl === 'erstellt' ? 'Selbst erstellte Mail: Stake und Bet Online gehen in jeder Reihenfolge.' : '';
    kHint.textContent = ''; if (text) kHint.append(h('p', { class: 'hint', text }));
  };
  const stakeFrage = () => {
    kWarn.textContent = ''; kWarn.hidden = false;
    kWarn.append(h('h3', { text: 'Bist du sicher?' }),
      h('p', { text: 'Diese Mail wurde nur erhalten, nicht selbst erstellt. Bei erhaltenen Mails ist nur ein Bet-Online-Konto vorgesehen. Willst du trotzdem ein Stake-Konto setzen?' }),
      h('div', { class: 'warn-actions' },
        h('button', { class: 'btn', type: 'button', text: 'Ja, Stake setzen', onclick: () => { stakeOk = true; kWarn.hidden = true; stk = true; kontenZeigen(); } }),
        h('button', { class: 'btn', type: 'button', text: 'Abbrechen', onclick: () => { kWarn.hidden = true; } })));
    kWarn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  betBtn.addEventListener('click', () => { bet = !bet; kontenZeigen(); });
  stakeBtn.addEventListener('click', () => { if (stakeBtn.disabled) return; if (!stk && mailWahl === 'erhalten' && !stakeOk) { stakeFrage(); return; } stk = !stk; kontenZeigen(); });
  let autoStatus = false;
  erBtn.addEventListener('click', () => { mailWahl = 'erhalten'; autoStatus = false; mailZeigen(); kontenZeigen(); });
  esBtn.addEventListener('click', () => { mailWahl = 'erstellt'; autoStatus = false; mailZeigen(); kontenZeigen(); });
  email.addEventListener('input', () => { if (!email.value.trim()) mailWahl = ''; mailZeigen(); kontenZeigen(); });
  mailZeigen(); kontenZeigen();
  const mailInfo = h('div', { class: 'mailinfo', hidden: true });
  /* Liste der noch offenen (selbst erstellten) Mails: Doppelklick auf das Mail-Feld oder der Knopf */
  const offenBtn = h('button', { class: 'cp om-btn', type: 'button', text: 'Offene Mails', title: 'Selbst erstellte Mails, bei denen Bet Online oder Stake noch frei ist' });
  /* Eine ausgewaehlte, selbst erstellte Mail bringt ihren Status mit */
  const waehleMail = m => {
    email.value = m; email.dispatchEvent(new Event('input'));
    const g = mailGruppe(m, id);
    if (mailWahl !== 'erstellt' && g.length && g.every(o => o.mail_status === 'erstellt')) { mailWahl = 'erstellt'; autoStatus = false; mailZeigen(); kontenZeigen(); mailInfoZeigen(); live(); }
  };
  offenBtn.addEventListener('click', () => offeneMailsSheet(waehleMail, id));
  email.addEventListener('dblclick', () => offenBtn.click());
  const wert = h('input', { id: 'd-wert', value: p.wert == null ? '' : String(p.wert).replace('.', ','), inputmode: 'decimal', autocomplete: 'off', maxlength: 10, placeholder: 'Standard ' + eur(S.einst.standardwert) });
  const adresse = h('textarea', { id: 'd-adresse', maxlength: 500, placeholder: 'Zugeteilte Adresse', rows: 2 }); adresse.value = p.adresse || '';
  const zust = h('input', { id: 'd-zust', value: p.zustaendig || '', autocomplete: 'off', maxlength: 100, placeholder: 'optional' });
  const notiz = h('textarea', { id: 'd-notiz', maxlength: 2000, placeholder: 'optional', rows: 2 }); notiz.value = p.notiz || '';
  const bereich = dateiBereich(neu ? null : id);
  const err = h('p', { class: 'err' });
  const warnBox = h('div', { class: 'warn', hidden: true, role: 'alert' });
  const soft = h('div', { class: 'softwarn', hidden: true });
  const cp = (get) => h('button', { class: 'cp', type: 'button', text: 'Kopieren', onclick: ev => { ev.preventDefault(); const v = get(); if (v) kopieren(v); } });
  let bestaetigt = false;

  let hartGrund = '';
  const relevant = () => neu || mailWahl !== (p.mail_status || '') || bet !== origBet || stk !== origStake || name.value.trim() !== p.name || email.value.trim() !== (p.email || '') || nummer.value.trim() !== (p.nummer || '') || anr.value.trim() !== (p.adressnummer || '');
  function treffer() {
    if (!relevant()) return [];
    const n = name.value.trim(), em = email.value.trim().toLowerCase(), ph = nummer.value.replace(/\D/g, ''), an = anr.value.trim().toLowerCase();
    const out = [];
    const grp = em ? mailGruppe(email.value, id) : [], grpProblem = mailProblem(grp, mailWahl, bet, stk); hartGrund = grpProblem || '';
    for (const x of S.personen) {
      if (x.id === id) continue;
      const gruende = []; const a = n ? aehnlich(n, x.name) : null;
      if (a === 'exakt') gruende.push('Name gleich'); else if (a) gruende.push('Name sehr ähnlich');
      const ma = em && x.email ? mailAehnlich(email.value, x.email) : null;
      if (ma === 'exakt') gruende.push(grpProblem ? 'Gleiche E-Mail' : 'Mail wird geteilt'); else if (ma) gruende.push('E-Mail sehr ähnlich');
      if (ph.length >= 7 && x.nummer && x.nummer.replace(/\D/g, '') === ph) gruende.push('Gleiche Nummer');
      if (an && x.adressnummer && x.adressnummer.trim().toLowerCase() === an) gruende.push('Gleiche Adressnummer');
      if (gruende.length) out.push({ p: x, gruende, exakt: a === 'exakt', nurTeilen: gruende.length === 1 && gruende[0] === 'Mail wird geteilt', nurMail: gruende.every(g => g === 'Mail wird geteilt' || g === 'Gleiche E-Mail'), hart: gruende.includes('Name gleich') || gruende.includes('Gleiche E-Mail') });
    }
    out.sort((a, b) => (b.hart - a.hart) || (b.exakt - a.exakt) || (b.gruende.length - a.gruende.length));
    return out.slice(0, 3);
  }
  function zeigeWarnung(list, hart) {
    warnBox.textContent = ''; warnBox.hidden = !list.length; if (!list.length) return;
    warnBox.className = 'warn ' + (hart ? 'hart' : 'info');
    const mine = { name: name.value.trim(), adressnummer: anr.value.trim(), state: st.value, nummer: nummer.value.trim(), email: email.value.trim(), adresse: adresse.value.trim(), status: status.value };
    warnBox.append(h('h3', { text: hart ? 'Das gibt es schon, Sichern geht nicht' : 'Diese Person gibt es vielleicht schon' }),
      h('p', { text: hart ? [list.some(t => t.gruende.includes('Name gleich')) ? 'Kein Name darf doppelt vorkommen, in keinem Projekt.' : '', list.some(t => t.gruende.includes('Gleiche E-Mail')) ? hartGrund : '', 'Öffne die vorhandene Person oder ändere deinen Eintrag.'].filter(Boolean).join(' ') : 'Name oder E-Mail sind einem vorhandenen Eintrag sehr ähnlich. Vielleicht ist es dieselbe Person. Bitte vergleiche beide. Wenn du trotzdem sicherst, gibt es zwei ähnliche Einträge.' }));
    list.forEach(t => {
      const x = t.p;
      const val = (k, a, b) => { const same = a && b && norm(a) === norm(b); return [h('div', { class: 'v' + (same ? ' same' : (a || b ? ' diff' : '')), text: a || '–' }), h('div', { class: 'v' + (same ? ' same' : (a || b ? ' diff' : '')), text: b || '–' })]; };
      const rows = [['Projekt', projektTitel(projSel.value), projektTitel(x.projekt_id)], ['Name', mine.name, x.name], ['Adressnr.', mine.adressnummer, x.adressnummer || ''], ['State', mine.state, x.state || ''], ['Nummer', mine.nummer, x.nummer || ''], ['E-Mail', mine.email, x.email || ''], ['Adresse', mine.adresse, x.adresse || ''], ['Stufe', STATUS_L[mine.status], STATUS_L[x.status]]];
      const grid = h('div', { class: 'cmp' }, h('div', { class: 'h' }), h('div', { class: 'h', text: 'Dein Eintrag' }), h('div', { class: 'h', text: 'Schon in der Liste' }));
      rows.forEach(([k, a, b]) => grid.append(h('div', { class: 'k', text: k }), ...val(k, a, b)));
      warnBox.append(h('div', { class: 'cmp-card' },
        h('div', { class: 'cmp-top' }, projektSymbol(projektVon(x.projekt_id), 'mini'), h('strong', { text: projektTitel(x.projekt_id) }), ...t.gruende.map(g => h('span', { class: 'tag ' + (g === 'Name gleich' || g === 'Gleiche E-Mail' ? 'rot' : 'blue'), text: g }))),
        grid,
        h('div', { class: 'meta', text: 'Angelegt von ' + (x.erstellt_von || 'unbekannt') + ', ' + rel(x.erstellt) }),
        h('div', { class: 'warn-actions' }, h('button', { class: 'btn sm', type: 'button', text: 'Vorhandene öffnen', onclick: () => { sh.__close(); personSheet(x.id); } }))));
    });
    warnBox.append(h('div', { class: 'warn-actions' }, h('button', { class: 'btn', type: 'button', text: 'Zurück zum Bearbeiten', onclick: () => { name.focus(); } })));
    if (hart) setLabel('Sichern', false);
  }
  function pruefeLive() {
    /* Gleiche Mails zeigt der Kasten direkt unter der Mail, hier stehen nur Namen, Nummern und aehnliche Eintraege. */
    const list = treffer().filter(t => !t.nurMail);
    if (bestaetigt) { bestaetigt = false; setLabel('Sichern', false); warnBox.hidden = true; }
    if (list.length) { soft.hidden = false; const hart = list.some(t => t.hart); soft.className = 'softwarn' + (hart ? ' hart' : ''); soft.textContent = (hart ? 'Schon vorhanden (Sichern geht nicht): ' : 'Ähnlich in der Liste: ') + list.map(t => titel(t.p) + ' (' + projektTitel(t.p.projekt_id) + ')').join(', '); }
    else soft.hidden = true;
  }
  let tmr = null; const live = () => { clearTimeout(tmr); tmr = setTimeout(pruefeLive, 250); };
  [name, email, nummer, anr].forEach(el => el.addEventListener('input', live));
  /* Wo gibt es diese Mail noch? Hinweis unter der Mail, mit Sprung zum anderen Eintrag.
     Fehlt dort der Mail-Status (Altbestand), kann man ihn hier mit einem Tipp nachtragen. */
  const statusKlaeren = o => {
    const knopf = (text, felder) => h('button', { class: 'btn sm', type: 'button', text, onclick: async ev => {
      ev.target.disabled = true;
      try {
        einsetzen(await enqueue(o.id, () => rpc('tr_person_speichern', { p_code: S.code, p_id: o.id, p_felder: felder })));
        neuZeichnen(); mailInfoZeigen(); live(); toast('Gespeichert bei ' + titel(o));
      } catch (e) { toast(fehlertext(e), true); ev.target.disabled = false; }
    } });
    const ohneKonto = !o.betonline && !o.stake;
    return h('div', { class: 'mi-klar' }, h('p', { text: 'Bei „' + titel(o) + '“ fehlt noch der Mail-Status. Was stimmt?' }),
      h('div', { class: 'mi-knoepfe' }, ohneKonto ? [knopf('Erstellt, dort Bet Online', { mail_status: 'erstellt', betonline: true }), knopf('Erstellt, dort Stake', { mail_status: 'erstellt', stake: true }), knopf('Erstellt, dort noch kein Konto', { mail_status: 'erstellt' })] : knopf('Selbst erstellt', { mail_status: 'erstellt' }), knopf('Erhalten', { mail_status: 'erhalten' })));
  };
  const mailInfoZeigen = () => {
    const grp = email.value.trim() ? mailGruppe(email.value, id) : [];
    /* Steht die Mail schon als selbst erstellt in der Liste, ist sie auch hier "erstellt". */
    if (neu || email.value.trim() !== (p.email || '')) {
      const klar = grp.length === 1 && grp[0].mail_status === 'erstellt';
      if (klar && !mailWahl) { mailWahl = 'erstellt'; autoStatus = true; mailZeigen(); kontenZeigen(); }
      else if (!klar && autoStatus) { mailWahl = ''; autoStatus = false; mailZeigen(); kontenZeigen(); }
    }
    mailInfo.textContent = ''; mailInfo.hidden = !grp.length; if (!grp.length) return;
    const problem = mailProblem(grp, mailWahl, bet, stk), offen = grp.filter(o => !o.mail_status);
    mailInfo.className = 'mailinfo' + (problem && !offen.length ? ' bad' : '');
    mailInfo.append(h('div', { class: 'mi-k', text: 'Diese Mail gibt es auch bei:' }),
      ...grp.map(o => h('button', { class: 'mi-row', type: 'button', onclick: () => { sh.__close(); personSheet(o.id); } }, projektSymbol(projektVon(o.projekt_id), 'mini'), h('span', { text: titel(o) + ' (' + projektTitel(o.projekt_id) + ')' }), h('span', { class: 'om-k' }, ...kontoMarken(o)), h('span', { class: 'mi-s', text: o.mail_status === 'erhalten' ? 'erhalten' : o.mail_status === 'erstellt' ? 'erstellt' : 'Status offen' }))),
      ...(offen.length && !grp.some(o => o.mail_status === 'erhalten') ? offen.map(statusKlaeren) : [h('p', { class: 'hint', text: problem || ('Frei für dich: ' + (mailFrei(grp).join(' und ') || 'nichts') + '.') })]));
  };
  email.addEventListener('input', mailInfoZeigen);
  [erBtn, esBtn, betBtn, stakeBtn].forEach(b => b.addEventListener('click', () => { mailInfoZeigen(); live(); }));
  mailInfoZeigen();

  /* Vorschlaege beim Tippen: Mails, die noch fuer Bet Online oder Stake frei sind */
  const vorschlag = h('div', { class: 'sugg', role: 'listbox', 'aria-label': 'Noch offene Mails', hidden: true });
  let vListe = [], vAktiv = -1;
  const vZu = () => { vorschlag.hidden = true; vorschlag.textContent = ''; vListe = []; vAktiv = -1; };
  const vNimm = m => { waehleMail(m); vZu(); };
  const vZeigen = () => {
    const q = email.value.trim(), alle = neu || q !== (p.email || '') ? mailVorschlaege(q, id) : [];
    vZu(); if (!alle.length) return;
    vListe = alle.slice(0, 6); vorschlag.hidden = false;
    vorschlag.append(h('div', { class: 'sg-k', text: 'Noch offen' }), ...vListe.map(m => mailEintrag(m, 'sg', () => vNimm(m.mail))),
      ...(alle.length > 6 ? [h('div', { class: 'sg-k', text: (alle.length - 6) + ' weitere. Tippe weiter oder öffne „Offene Mails“.' })] : []));
    vorschlag.querySelectorAll('.sg').forEach(b => { b.setAttribute('role', 'option'); b.tabIndex = -1; b.addEventListener('pointerdown', e => e.preventDefault()); });
  };
  email.addEventListener('input', vZeigen);
  email.addEventListener('focus', vZeigen);
  email.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== email) vZu(); }, 200));
  email.addEventListener('keydown', e => {
    if (vorschlag.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); vAktiv = (vAktiv + (e.key === 'ArrowDown' ? 1 : vAktiv < 0 ? 0 : -1) + vListe.length) % vListe.length;
      vorschlag.querySelectorAll('.sg').forEach((b, i) => { b.classList.toggle('on', i === vAktiv); b.setAttribute('aria-selected', String(i === vAktiv)); });
    } else if (e.key === 'Enter' && vAktiv >= 0) { e.preventDefault(); vNimm(vListe[vAktiv].mail); }
    else if (e.key === 'Escape') { e.stopPropagation(); vZu(); }
  });

  const sichern = h('button', { class: 'tbtn strong', type: 'button', text: 'Sichern' });
  const fuss = h('button', { class: 'btn pri big', type: 'button', text: 'Sichern', onclick: () => sichern.click() });
  function setLabel(t, warn) { sichern.textContent = t; sichern.classList.toggle('warn', warn); fuss.textContent = t; fuss.classList.toggle('warnbtn', warn); }
  sichern.addEventListener('click', async () => {
    err.textContent = '';
    const nm = name.value.trim();
    if (![nm, anr.value, st.value, nummer.value, email.value, adresse.value, zust.value, notiz.value].some(v => v && v.trim())) { err.textContent = neu && bereich.wartend() ? 'Zu den Dateien braucht es mindestens ein Feld, zum Beispiel den Namen oder die E-Mail.' : 'Bitte mindestens ein Feld ausfüllen.'; name.focus(); return; }
    if (email.value.trim() && !mailWahl && (neu || email.value.trim() !== (p.email || ''))) { err.textContent = 'Bitte den Mail-Status wählen: Erhalten oder Erstellt.'; erBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    if (mailWahl === 'erhalten' && stk && !origStake && origBet) { err.textContent = FEHLER.stake_gesperrt; return; }
    const wz = wert.value.trim() === '' ? null : parseEuro(wert.value);
    if (Number.isNaN(wz)) { err.textContent = 'Bitte beim Wert eine Zahl eintragen, zum Beispiel 40 oder 35,50.'; wert.focus(); return; }
    const list = treffer();
    if (list.some(t => t.hart)) { zeigeWarnung(list, true); bestaetigt = false; warnBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    if (mailWahl === 'erhalten' && stk && !stakeOk) { stakeFrage(); return; }
    const weich = list.filter(t => !t.nurTeilen);
    if (weich.length && !bestaetigt) {
      zeigeWarnung(weich, false); bestaetigt = true; setLabel('Trotzdem sichern', true);
      warnBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return;
    }
    const neuF = { name: nm, adressnummer: anr.value.trim(), state: st.value || null, nummer: nummer.value.trim(), email: email.value.trim(), adresse: adresse.value.trim(), status: status.value, zaehlt: haken.checked, wert: wz, projekt: projSel.value, mail_status: mailWahl || null, betonline: bet, stake: stk, zustaendig: zust.value.trim(), notiz: notiz.value.trim() };
    if (!istAdmin()) { delete neuF.zaehlt; delete neuF.wert; }
    let felder = {};
    if (neu) { for (const [k, v] of Object.entries(neuF)) if (v !== '' && v !== null && !(['zaehlt', 'betonline', 'stake'].includes(k) && v === false) && !(k === 'status' && v === 'zu_erledigen')) felder[k] = v; }
    else {
      for (const [k, v] of Object.entries(neuF)) { const o0 = p[k === 'projekt' ? 'projekt_id' : k]; const o = o0 == null ? (['zaehlt', 'betonline', 'stake'].includes(k) ? false : '') : o0; const n = v == null ? '' : v; if (o !== n) felder[k] = v; }
      if (!Object.keys(felder).length) { sh.__close(); return; }
    }
    sichern.disabled = true; fuss.disabled = true;
    try {
      const r = await enqueue(id || 'neu', () => rpc('tr_person_speichern', { p_code: S.code, p_id: id, p_felder: felder }));
      einsetzen(r); sh.__close(); neuZeichnen(); toast(neu ? 'Person angelegt' : 'Gespeichert');
      if (neu && bereich.wartend()) {
        const u = await bereich.hochladen(r.id); await laden(false);
        toast(u.fehler ? u.ok + ' Dateien gespeichert, ' + u.fehler + ' nicht: ' + u.grund : u.ok + (u.ok === 1 ? ' Datei hochgeladen' : ' Dateien hochgeladen'), !!u.fehler);
      }
    } catch (e) { err.textContent = fehlertext(e); sichern.disabled = false; fuss.disabled = false; if (['nicht_gefunden', 'name_doppelt', 'mail_doppelt', 'mail_voll', 'mail_konto_belegt', 'stake_gesperrt'].includes(e.message)) laden(false); }
  });

  let armed = false;
  const del = istAdmin() && !neu ? h('div', { class: 'fg' }, h('button', { class: 'btn red', type: 'button', text: 'Person löschen', onclick: async (ev) => {
    if (!armed) { armed = true; ev.target.classList.add('armed'); ev.target.textContent = 'Wirklich löschen? Nochmal tippen'; return; }
    ev.target.disabled = true;
    try { await rpc('tr_person_loeschen', { p_code: S.code, p_id: id }); S.personen = S.personen.filter(x => x.id !== id); S.sig = JSON.stringify(S.personen); sh.__close(); zeichne(); toast('Gelöscht'); }
    catch (e) { err.textContent = fehlertext(e); ev.target.disabled = false; }
  } })) : null;

  const abschnitt = (titelText, rechts, ...kinder) => h('section', { class: 'abschnitt' }, h('div', { class: 'ab-kopf' }, h('h3', { class: 'fg-t', text: titelText }), rechts), ...kinder);
  const body = h('div', { class: 'sheet-b' },
    warnBox,
    abschnitt('Person', null, h('div', { class: 'fg' }, frow('Projekt', projSel), frow('Name', name), soft, frow('State', st), frow('Adresse', adresse, cp(() => adresse.value), true), frow('Adressnr.', anr))),
    abschnitt('E-Mail und Nummer', offenBtn, h('div', { class: 'fg' }, frow('E-Mail', email, cp(() => email.value)), vorschlag, h('div', { class: 'fr ms' }, h('span', { class: 'fl', text: 'Mail-Status' }), h('div', { class: 'mbtns' }, erBtn, esBtn)), frow('Nummer', nummer, cp(() => nummer.value))), mailInfo),
    abschnitt('Konten', null, h('div', { class: 'fg' }, h('div', { class: 'fr konto' }, h('span', { class: 'fl', text: 'Konten' }), h('div', { class: 'kbtns' }, betBtn, stakeBtn))), kWarn, kHint),
    abschnitt('Stand und Notiz', null, h('div', { class: 'fg' }, frow('Stufe', status), istAdmin() ? [frow('Wert (€)', wert), h('label', { class: 'fr sw-row' }, h('span', { class: 'fl', text: 'Dazurechnen' }), haken)] : null, frow('Zuständig', zust), frow('Notiz', notiz, null, true))),
    abschnitt('Dateien und Fotos', null, bereich.el),
    !neu && p.geaendert_von ? h('p', { class: 'meta', text: 'Zuletzt geändert von ' + p.geaendert_von + ', ' + rel(p.geaendert) + '. Angelegt von ' + (p.erstellt_von || 'unbekannt') + '.' }) : null,
    err, del);
  const sh = sheetEl(neu ? 'Neue Person' : 'Person', body, { left: h('button', { class: 'tbtn', type: 'button', text: 'Abbrechen', onclick: () => sh.__close() }), right: sichern, foot: fuss });
  oeffne(sh, false);
  /* Dateien und Fotos nimmt die offene Person entgegen: hineinziehen oder mit Strg+V (siehe "Dateien annehmen") */
  sh.__dateien = f => bereich.neue(f);
  sh.__wer = () => name.value.trim() || (neu ? 'der neuen Person' : titel(p));
  if (neu) name.focus(); else { sh.tabIndex = -1; sh.focus({ preventScroll: true }); }
  if (Array.isArray(dateien)) bereich.neue(dateien);
}

/* ---------- Flaggen (als Zeichnung, weil Windows keine Flaggen-Emojis zeigt). Alle im Format 30 x 20. */
function svgEl(tag, a) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(a || {})) e.setAttribute(k, v); return e; }
const streifenH = (...f) => f.map((c, i) => ['r', 0, i * 20 / f.length, 30, 20 / f.length + .02, c]);
const streifenV = (...f) => f.map((c, i) => ['r', i * 30 / f.length, 0, 30 / f.length + .02, 20, c]);
const kreuz = (x, y, w, farbe) => [['r', x, 0, w, 20, farbe], ['r', 0, y, 30, w, farbe]];
const FLAGGEN = {
  us: { n: 'USA', z: [['r', 0, 0, 30, 20, '#fff'], ...[0, 2, 4, 6, 8, 10, 12].map(i => ['r', 0, i * 20 / 13, 30, 20 / 13, '#b22234']), ['r', 0, 0, 12, 10.8, '#3c3b6e'],
    ...[0, 1, 2, 3].flatMap(i => [0, 1, 2].map(j => ['c', 1.8 + i * 3, 2 + j * 3.2, .55, '#fff']))] },
  gb: { n: 'Großbritannien', z: [['r', 0, 0, 30, 20, '#012169'], ['l', 0, 0, 30, 20, '#fff', 4], ['l', 30, 0, 0, 20, '#fff', 4], ['l', 0, 0, 30, 20, '#c8102e', 1.3], ['l', 30, 0, 0, 20, '#c8102e', 1.3],
    ['r', 12, 0, 6, 20, '#fff'], ['r', 0, 7, 30, 6, '#fff'], ['r', 13, 0, 4, 20, '#c8102e'], ['r', 0, 8, 30, 4, '#c8102e']] },
  de: { n: 'Deutschland', z: streifenH('#000', '#dd0000', '#ffce00') },
  fr: { n: 'Frankreich', z: streifenV('#0055a4', '#fff', '#ef4135') },
  it: { n: 'Italien', z: streifenV('#009246', '#fff', '#ce2b37') },
  es: { n: 'Spanien', z: [['r', 0, 0, 30, 20, '#aa151b'], ['r', 0, 5, 30, 10, '#f1bf00']] },
  ie: { n: 'Irland', z: streifenV('#169b62', '#fff', '#ff883e') },
  at: { n: 'Österreich', z: streifenH('#ed2939', '#fff', '#ed2939') },
  nl: { n: 'Niederlande', z: streifenH('#ae1c28', '#fff', '#21468b') },
  pl: { n: 'Polen', z: streifenH('#fff', '#dc143c') },
  ua: { n: 'Ukraine', z: streifenH('#0057b7', '#ffd700') },
  ru: { n: 'Russland', z: streifenH('#fff', '#0039a6', '#d52b1e') },
  se: { n: 'Schweden', z: [['r', 0, 0, 30, 20, '#006aa7'], ...kreuz(9, 8, 4, '#fecc00')] },
  dk: { n: 'Dänemark', z: [['r', 0, 0, 30, 20, '#c8102e'], ...kreuz(9, 8, 4, '#fff')] },
  no: { n: 'Norwegen', z: [['r', 0, 0, 30, 20, '#ba0c2f'], ...kreuz(8, 7, 6, '#fff'), ...kreuz(9.5, 8.5, 3, '#00205b')] },
  fi: { n: 'Finnland', z: [['r', 0, 0, 30, 20, '#fff'], ...kreuz(8, 7.75, 4.5, '#003580')] },
  ch: { n: 'Schweiz', z: [['r', 0, 0, 30, 20, '#d52b1e'], ['r', 13, 4, 4, 12, '#fff'], ['r', 9, 8, 12, 4, '#fff']] },
  jp: { n: 'Japan', z: [['r', 0, 0, 30, 20, '#fff'], ['c', 15, 10, 6, '#bc002d']] },
  bd: { n: 'Bangladesch', z: [['r', 0, 0, 30, 20, '#006a4e'], ['c', 13.5, 10, 6, '#f42a41']] },
  tr: { n: 'Türkei', z: [['r', 0, 0, 30, 20, '#e30a17'], ['c', 11, 10, 5, '#fff'], ['c', 12.4, 10, 4, '#e30a17'], ['c', 17.2, 10, 1.4, '#fff']] },
  in: { n: 'Indien', z: [...streifenH('#ff9933', '#fff', '#138808'), ['c', 15, 10, 2.6, 'none', '#000080', .5]] },
  br: { n: 'Brasilien', z: [['r', 0, 0, 30, 20, '#009c3b'], ['p', '15,2 27,10 15,18 3,10', '#ffdf00'], ['c', 15, 10, 4, '#002776']] },
};
function flagge(code, groesse) {
  const f = FLAGGEN[code];
  const s = svgEl('svg', { viewBox: '0 0 30 20', class: 'flag ' + (groesse || ''), 'aria-hidden': 'true' });
  for (const t of (f ? f.z : [['r', 0, 0, 30, 20, '#8e8e93']])) {
    if (t[0] === 'r') s.append(svgEl('rect', { x: t[1], y: t[2], width: t[3], height: t[4], fill: t[5] }));
    else if (t[0] === 'c') s.append(svgEl('circle', { cx: t[1], cy: t[2], r: t[3], fill: t[4], stroke: t[5] || 'none', 'stroke-width': t[6] || 0 }));
    else if (t[0] === 'l') s.append(svgEl('line', { x1: t[1], y1: t[2], x2: t[3], y2: t[4], stroke: t[5], 'stroke-width': t[6] }));
    else if (t[0] === 'p') s.append(svgEl('polygon', { points: t[1], fill: t[2] }));
  }
  return s;
}
/* Symbol eines Projekts: Flagge, Emoji oder Foto. Fotos werden nur gezeigt, wenn sie genau ein JPEG als Daten-Adresse sind. */
function projektSymbol(pr, groesse) {
  const t = pr.symbol_typ || 'flagge', sym = pr.symbol || '';
  if (t === 'emoji') return h('span', { class: 'psym emoji ' + (groesse || ''), 'aria-hidden': 'true', text: sym });
  if (t === 'bild' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(sym)) return h('img', { class: 'psym bild ' + (groesse || ''), src: sym, alt: '' });
  return flagge(sym, groesse);
}
/* Platzhalter-Logos fuer Bet Online und Stake (eigene kleine Zeichen, bis echte Logo-Dateien da sind). */
function kontoLogo(art) {
  const st = art === 'st';
  const sv = svgEl('svg', { viewBox: '0 0 24 24', class: 'klogo ' + art, 'aria-hidden': 'true' });
  sv.append(svgEl('rect', { width: 24, height: 24, rx: 6, fill: st ? '#1db954' : '#e8590c' }));
  const t = svgEl('text', { x: 12, y: st ? 17.5 : 16, 'text-anchor': 'middle', 'font-size': st ? 16 : 11.5, 'font-weight': 800, fill: '#fff', 'font-family': 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' });
  t.textContent = st ? 'S' : 'BO'; sv.append(t); return sv;
}
/* Vorschau in der Liste: Mail-Status (zwei Farben) und die Logos der Konten */
function kontenZeile(p, leer) {
  const out = [];
  if (p.mail_status) out.push(h('span', { class: 'ms-pill ' + p.mail_status, text: p.mail_status === 'erhalten' ? 'Erhalten' : 'Erstellt' }));
  if (p.betonline) out.push(h('span', { class: 'kbadge', title: 'Bet Online', 'aria-label': 'Bet Online' }, kontoLogo('bo')));
  if (p.stake) out.push(h('span', { class: 'kbadge', title: 'Stake', 'aria-label': 'Stake' }, kontoLogo('st')));
  if (!out.length && leer) out.push(h('span', { class: 'none', text: '–' }));
  return out;
}
const projektVon = id => S.projekte.find(x => x.id === id) || { id, name: String(id || '?'), symbol_typ: 'flagge', symbol: '' };
const projektTitel = id => projektVon(id).name;
const imProjekt = p => S.f.projekt === 'alle' || p.projekt_id === S.f.projekt;
const KONTO_FILTER = [['alle', 'Alle'], ['stake', 'Nur Stake'], ['betonline', 'Nur Bet Online'], ['beides', 'Beides'], ['keins', 'Kein Konto']];
const MAIL_FILTER = [['alle', 'Alle'], ['erhalten', 'Erhalten'], ['erstellt', 'Erstellt'], ['ohne', 'Ohne Status']];
function kontoPasst(p, k) { const b = !!p.betonline, s = !!p.stake; return k === 'alle' || (k === 'stake' && s && !b) || (k === 'betonline' && b && !s) || (k === 'beides' && b && s) || (k === 'keins' && !b && !s); }
function mailPasst(p, k) { return k === 'alle' || (k === 'ohne' ? !p.mail_status : p.mail_status === k); }

/* Mails vergleichen: gleich ist gleich nach Gross/Klein, ohne +Zusatz, bei Gmail auch ohne Punkte (wie in der Datenbank).
   Aehnlich nur bei fast gleicher Mail beim selben Anbieter. */
function mailKey(m) {
  m = String(m || '').trim().toLowerCase(); if (!m) return '';
  const i = m.indexOf('@'), l0 = i < 0 ? m : m.slice(0, i), d = i < 0 ? '' : m.slice(i + 1), l = l0.split('+')[0];
  return (d === 'gmail.com' || d === 'googlemail.com') ? l.replace(/\./g, '') + '@gmail.com' : l + '@' + d;
}
function mailAehnlich(a, b) {
  const ka = mailKey(a), kb = mailKey(b); if (!ka || !kb) return null;
  if (ka === kb) return 'exakt';
  const [la, da] = ka.split('@'), [lb, db] = kb.split('@');
  if (da !== db) return null;
  const sa = la.replace(/[._-]/g, ''), sb = lb.replace(/[._-]/g, '');
  if (sa === sb) return 'aehnlich';
  if (Math.min(sa.length, sb.length) >= 6 && lev(sa, sb) <= 1) return 'aehnlich';
  return null;
}

/* Mails teilen: Eine selbst erstellte Mail darf bei zwei Eintraegen stehen (Bet Online getrennt von Stake). Eine erhaltene nur einmal. */
function mailGruppe(mail, ausserId) { const k = mailKey(mail); return k ? S.personen.filter(o => o.id !== ausserId && o.email && mailKey(o.email) === k) : []; }
function mailProblem(grp, status, bet, stk) {
  if (!grp.length) return null;
  if (grp.some(o => o.mail_status === 'erhalten')) return 'Diese Mail ist verbraucht: Sie wurde erhalten und steht schon bei einem anderen Eintrag. Eine erhaltene Mail geht nur einmal.';
  if (grp.some(o => o.mail_status !== 'erstellt')) return 'Beim anderen Eintrag fehlt noch, ob die Mail erstellt oder erhalten ist. Wähle das im Kasten unter der Mail.';
  const bo = grp.some(o => o.betonline), st = grp.some(o => o.stake);
  if (grp.length >= 2 || (bo && st)) return 'Diese Mail ist schon voll: Sie steht bei zwei Einträgen oder beide Konten (Bet Online und Stake) sind vergeben.';
  if (status !== 'erstellt') return 'Diese Mail steht als selbst erstellt in der Liste. Wähle beim Mail-Status „Erstellt“.';
  if ((bet && bo) || (stk && st)) return (bet && bo ? 'Bet Online' : 'Stake') + ' ist mit dieser Mail schon bei einem anderen Eintrag angelegt. Wähle das andere Konto.';
  return null;
}
function mailFrei(grp) { return [...(grp.some(o => o.betonline) ? [] : ['Bet Online']), ...(grp.some(o => o.stake) ? [] : ['Stake'])]; }
function mailKarte() {
  if (S._msig === S.sig && S._mmap) return S._mmap;
  const m = new Map(); S.personen.forEach(p => { const k = p.email && mailKey(p.email); if (k) { if (!m.has(k)) m.set(k, []); m.get(k).push(p); } });
  S._msig = S.sig; S._mmap = m; return m;
}
function mailTeilTag(p) {
  const k = p.email && mailKey(p.email), g = k ? (mailKarte().get(k) || []).filter(o => o.id !== p.id) : [];
  if (!g.length) return null;
  return h('span', { class: 'tag blue', title: 'Diese Mail gibt es auch bei: ' + g.map(o => titel(o) + ' (' + projektTitel(o.projekt_id) + ')').join(', '), text: 'Mail auch bei ' + titel(g[0]) + (g.length > 1 ? ' +' + (g.length - 1) : '') });
}
function kontoMarken(p) { return [p.betonline ? h('span', { class: 'kbadge', title: 'Bet Online' }, kontoLogo('bo')) : null, p.stake ? h('span', { class: 'kbadge', title: 'Stake' }, kontoLogo('st')) : null]; }
function offeneMails(ausserId) {
  const out = [];
  mailKarte().forEach(g => {
    if (g.some(o => o.id === ausserId) || g.length >= 2 || g.some(o => o.mail_status === 'erhalten')) return;
    const frei = mailFrei(g); if (frei.length) out.push({ mail: g[0].email, eintraege: g, frei, offen: g.some(o => !o.mail_status) });
  });
  return out.sort((a, b) => (a.offen - b.offen) || a.mail.localeCompare(b.mail));
}
/* Ab dem ersten Buchstaben: erst Treffer am Anfang, ab drei Zeichen auch mitten in der Mail. Selbst erstellte zuerst. */
function mailVorschlaege(text, ausserId) {
  const q = text.trim().toLowerCase(); if (!q) return [];
  const alle = offeneMails(ausserId), k = mailKey(q);
  if (alle.some(m => mailKey(m.mail) === k)) return [];
  const am = m => m.mail.toLowerCase().startsWith(q);
  return alle.filter(m => q.length < 3 ? am(m) : m.mail.toLowerCase().includes(q)).sort((a, b) => (a.offen - b.offen) || (am(b) - am(a)) || a.mail.localeCompare(b.mail));
}
function mailEintrag(m, klasse, klick) {
  return h('button', { class: klasse, type: 'button', onclick: klick },
    h('span', { class: 'om-t' }, h('strong', { text: m.mail }), h('small', { text: 'bei ' + m.eintraege.map(o => titel(o) + ' (' + projektTitel(o.projekt_id) + ')').join(', ') })),
    h('span', { class: 'om-k' }, ...m.eintraege.flatMap(kontoMarken)), m.offen ? h('span', { class: 'tag', text: 'Status offen' }) : h('span', { class: 'tag blue', text: 'frei: ' + m.frei.join(', ') }));
}
function offeneMailsSheet(waehle, ausserId) {
  const liste = h('div', { class: 'fg om' }), suche = h('input', { type: 'search', placeholder: 'Mail oder Name suchen', 'aria-label': 'Offene Mails durchsuchen', autocomplete: 'off' });
  const alle = offeneMails(ausserId);
  const zeig = () => {
    const q = suche.value.trim().toLowerCase(); liste.textContent = '';
    const tr = alle.filter(m => !q || m.mail.toLowerCase().includes(q) || m.eintraege.some(o => titel(o).toLowerCase().includes(q)));
    if (!tr.length) { liste.append(h('p', { class: 'hint', text: alle.length ? 'Keine Mail passt zur Suche.' : 'Keine offene Mail. Offen ist eine selbst erstellte Mail, bei der Bet Online oder Stake noch nicht angelegt ist.' })); return; }
    tr.forEach((m, i) => {
      if (m.offen && (i === 0 || !tr[i - 1].offen)) liste.append(h('div', { class: 'om-kopf', text: 'Mail-Status noch nicht festgelegt (ältere Einträge)' }));
      liste.append(mailEintrag(m, 'om-row', () => { sh.__close(); waehle(m.mail); }));
    });
  };
  suche.addEventListener('input', zeig);
  const sh = sheetEl('Offene Mails', h('div', { class: 'sheet-b' }, h('p', { class: 'hint', text: 'Mails, die noch für Bet Online oder Stake frei sind. Tippe eine an, sie wird eingetragen.' }), h('div', { class: 'fg' }, h('label', { class: 'fr one' }, suche)), liste), { left: h('button', { class: 'tbtn', type: 'button', text: 'Schließen', onclick: () => sh.__close() }) });
  zeig(); oeffne(sh, true); suche.focus();
}

/* Aehnliche Namen und Mails ueber ALLE Projekte (wird nur neu gerechnet, wenn sich die Liste aendert). */
function aehnlichkeiten() {
  if (S._asig === S.sig && S._amap) return S._amap;
  const m = new Map(), P = S.personen;
  const dazu = (a, b, art, was) => { if (!m.has(a.id)) m.set(a.id, []); m.get(a.id).push({ p: b, art, was }); };
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const n = P[i].name && P[j].name ? aehnlich(P[i].name, P[j].name) : null;
    if (n) { dazu(P[i], P[j], n, 'Name'); dazu(P[j], P[i], n, 'Name'); }
    const e = P[i].email && P[j].email ? mailAehnlich(P[i].email, P[j].email) : null;
    if (e && e !== 'exakt') { dazu(P[i], P[j], e, 'E-Mail'); dazu(P[j], P[i], e, 'E-Mail'); }
  }
  S._asig = S.sig; S._amap = m; return m;
}

/* ---------- Startbildschirm: die Projekte */
function oeffneProjekt(id) {
  S.f = { ...S.f, projekt: id, status: 'alle', q: '', state: 'alle', haken: 'alle', mail: 'alle', konto: 'alle' };
  S.ansicht = 'liste'; aufbau();
}
function zumStart() { schliesseAlle(); S.ansicht = 'start'; S._startAnim = true; aufbau(); }
function gruss() { const hh = new Date().getHours(); return hh < 5 ? 'Gute Nacht' : hh < 11 ? 'Guten Morgen' : hh < 18 ? 'Guten Tag' : 'Guten Abend'; }
/* Zahl sanft hochzaehlen (nur wenn Bewegung erwuenscht ist) */
function zaehlAnim(el, ziel, fmt, an) {
  if (!an) { el.textContent = fmt(ziel); return; }
  const t0 = performance.now(), dauer = 800; el.textContent = fmt(0);
  const schritt = t => { const k = Math.min(1, (t - t0) / dauer), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(ziel * e); if (k < 1 && el.isConnected) requestAnimationFrame(schritt); else el.textContent = fmt(ziel); };
  requestAnimationFrame(schritt);
}
function startAufbau() {
  const app = $('#app'); app.textContent = '';
  const P = S.personen, adm = istAdmin(), an = P.filter(zaehltJetzt), wartet = P.filter(p => p.zaehlt && !stufeReicht(p));
  const bewegung = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches), anim = bewegung && S._startAnim !== false; S._startAnim = false;
  let n = 0; const rise = el => { if (anim) { el.classList.add('rise'); el.style.setProperty('--i', n++); } return el; };
  const zaehler = [];
  const zahl = (ziel, fmt) => { const sp = h('span', { text: fmt(ziel) }); zaehler.push(() => zaehlAnim(sp, ziel, fmt, anim)); return sp; };
  const ganz = v => String(Math.round(v));

  const karte = pr => {
    const a = P.filter(p => p.projekt_id === pr.id), ang = a.filter(zaehltJetzt);
    const er = a.filter(p => p.mail_status === 'erhalten').length, es = a.filter(p => p.mail_status === 'erstellt').length;
    return rise(h('div', { class: 'pwrap' },
      h('button', { class: 'pcard', type: 'button', onclick: () => oeffneProjekt(pr.id), 'aria-label': pr.name + ': ' + a.length + (a.length === 1 ? ' Person' : ' Personen') },
        projektSymbol(pr, 'big'),
        h('div', { class: 'pc-t' }, h('strong', { text: pr.name }), h('span', { class: 'pc-s', text: a.length + (a.length === 1 ? ' Person' : ' Personen') })),
        adm ? h('div', { class: 'pc-m' }, h('b', { text: eur(summe(ang)) }), h('small', { text: 'angekommen' })) : null,
        h('div', { class: 'pc-k', text: es + (es === 1 ? ' Mail' : ' Mails') + ' erstellt, ' + er + ' erhalten' })),
      h('button', { class: 'pc-edit', type: 'button', 'aria-label': pr.name + ' bearbeiten', title: 'Bearbeiten', onclick: () => projektSheet(pr) }, ic('edit'))));
  };
  const alle = rise(h('button', { class: 'pcard alle', type: 'button', onclick: () => oeffneProjekt('alle'), 'aria-label': 'Alle Personen: ' + P.length },
    h('span', { class: 'psym emoji big' }, ic('people')),
    h('div', { class: 'pc-t' }, h('strong', { text: 'Alle Personen' }), h('span', { class: 'pc-s', text: P.length + (P.length === 1 ? ' Person' : ' Personen') + ' in allen Projekten' })),
    adm ? h('div', { class: 'pc-m' }, h('b', { text: eur(summe(an)) }), h('small', { text: 'angekommen' })) : null,
    h('div', { class: 'pc-k', text: 'Kein Name und keine Mail kommt doppelt vor' })));
  const neuK = rise(h('button', { class: 'pcard neu', type: 'button', onclick: () => projektSheet(null), 'aria-label': 'Projekt erstellen' },
    h('span', { class: 'psym emoji big plus' }, ic('plus')),
    h('div', { class: 'pc-t' }, h('strong', { text: 'Projekt erstellen' }), h('span', { class: 'pc-s', text: 'Name und Bild, in Sekunden' }))));
  const alleAehn = [...aehnlichkeiten().values()];
  const doppelt = alleAehn.filter(l => l.some(x => x.art === 'exakt')).length, aehn = alleAehn.filter(l => !l.some(x => x.art === 'exakt')).length;

  // Kopf: Begruessung, Datum, grosse Zahl
  const vorname = String(S.me.name).trim().split(/\s+/)[0];
  const hero = rise(h('section', { class: 'hero' },
    h('div', { class: 'hero-t' },
      h('h2', { text: gruss() + ', ' + vorname }),
      h('p', { text: new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + P.length + (P.length === 1 ? ' Person' : ' Personen') + ' in ' + S.projekte.length + (S.projekte.length === 1 ? ' Projekt' : ' Projekten') })),
    adm ? h('button', { class: 'hero-n', type: 'button', onclick: () => uebersichtSheet(), 'aria-label': 'Gewinn gemeinsam, Übersicht öffnen' },
      h('span', { class: 'g-l', text: 'Gewinn gemeinsam, alle Projekte' }),
      h('b', null, zahl(summe(an), eur)),
      h('span', { class: 'g-s', text: an.length + (an.length === 1 ? ' Person' : ' Personen') + ' angekommen' + (wartet.length ? ', ' + eur(summe(wartet)) + ' warten noch' : '') }))
      : h('div', { class: 'hero-n plain' }, h('span', { class: 'g-l', text: 'Personen in allen Projekten' }), h('b', null, zahl(P.length, ganz)), h('span', { class: 'g-s', text: 'Du siehst die Personen und ihre Konten.' }))));

  // Kennzahlen (nur Desktop)
  const kacheln = [['Personen', P.length, 'k-pers'], ['Mails erstellt', P.filter(p => p.mail_status === 'erstellt').length, 'k-es'], ['Mails erhalten', P.filter(p => p.mail_status === 'erhalten').length, 'k-er'], ['Bet Online', P.filter(p => p.betonline).length, 'k-bo'], ['Stake', P.filter(p => p.stake).length, 'k-st']];
  const stats = rise(h('div', { class: 'st-grid desk-only' }, ...kacheln.map(([l, v, k]) => h('div', { class: 'st-tile ' + k }, h('span', { class: 'st-l', text: l }), h('b', null, zahl(v, ganz))))));
  // Stufen als farbiger Balken
  const bar = h('div', { class: 'sbar', role: 'img', 'aria-label': 'Verteilung der Stufen' });
  STATUS.forEach(s => { const c = P.filter(p => p.status === s.k).length; if (c) { const seg = h('span', { class: 'sb-seg sb-' + s.k, title: s.l + ': ' + c }); seg.style.flexGrow = c; bar.append(seg); } });
  const stufen = rise(h('div', { class: 'stufen desk-only' }, h('div', { class: 'sb-kopf', text: 'Stufen' }), bar,
    h('div', { class: 'sb-leg' }, ...STATUS.map(s => h('span', null, h('i', { class: 'sw-dot ' + s.k }), s.l + ' ' + P.filter(p => p.status === s.k).length)))));
  // Zuletzt bearbeitet
  const neu = P.slice().sort((a, b) => (b.geaendert || '').localeCompare(a.geaendert || '')).slice(0, 6);
  const zuletzt = rise(h('aside', { class: 'recent desk-only' }, h('div', { class: 'sb-kopf', text: 'Zuletzt bearbeitet' }),
    ...(neu.length ? neu.map(p => h('button', { class: 'rc', type: 'button', onclick: () => personSheet(p.id) },
      projektSymbol(projektVon(p.projekt_id), 'mini'),
      h('span', { class: 'rc-t' }, h('strong', { text: titel(p) }), h('small', { text: (p.geaendert_von ? 'von ' + p.geaendert_von + ', ' : '') + rel(p.geaendert) })))) : [h('p', { class: 'hint', text: 'Noch nichts bearbeitet.' })])));

  app.append(
    h('header', { class: 'start-top' },
      h('div', { class: 'start-brand' }, logoImg(36), h('div', null, h('h1', { text: 'Adress-Tracker' }), h('div', { class: 'sub', id: 'sub' }))),
      h('div', { class: 'start-actions' },
        adm ? h('button', { class: 'btn', type: 'button', onclick: uebersichtSheet }, ic('sum'), h('span', { class: 'lbl', text: 'Übersicht' })) : null,
        h('button', { class: 'ibtn', 'aria-label': 'Mehr', onclick: ev => hauptmenue(ev.currentTarget) }, ic('more')),
        h('button', { class: 'side-me compact', onclick: profilSheet, 'aria-label': 'Profil öffnen' }, avatar(S.me.name, false, S.me)))),
    h('main', { class: 'start' },
      hero,
      h('div', { class: 'start-grid' },
        h('div', { class: 'start-main' },
          stats,
          h('h2', { class: 'start-h', text: 'Projekte' }),
          h('div', { class: 'pgrid' }, ...S.projekte.map(karte), alle, neuK),
          (doppelt || aehn) ? h('p', { class: 'start-sum' }, doppelt ? doppelt + ' Personen haben einen doppelten Namen oder eine doppelte Mail. ' : '', aehn ? aehn + ' Personen haben einen sehr ähnlichen Namen oder eine sehr ähnliche Mail (blau markiert in der Liste).' : '') : null),
        h('div', { class: 'start-side' }, stufen, zuletzt))));
  setSub();
  zaehler.forEach(f => f());
}

/* ---------- Projekt erstellen und bearbeiten */
const EMOJIS = ['🌍', '🌎', '🌏', '🏠', '🏢', '💼', '⭐', '🔥', '💎', '🎯', '🚀', '💰', '🏦', '📈', '🛒', '🎰', '🃏', '🎲', '⚽', '🏀', '🏈', '⚾', '🎾', '🎮', '📱', '💻', '✉️', '📦', '🔑', '🛡️', '🍀', '🌟', '🌈', '☀️', '🌙', '⚡', '❄️', '🌴', '🏝️', '🏔️', '🗽', '🕌', '🎓', '🧠', '🤝', '👥'];
async function bildQuadrat(file, px) {
  const bmp = await createImageBitmap(file), s = Math.min(bmp.width, bmp.height);
  const cv = document.createElement('canvas'); cv.width = cv.height = px;
  const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, px, px);
  cx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, px, px);
  if (bmp.close) bmp.close();
  for (const q of [0.85, 0.7, 0.55]) {
    const b = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', q));
    const d = 'data:image/jpeg;base64,' + await lesBase64(b);
    if (d.length <= 38000) return d;
  }
  return null;
}
function projektSheet(pr) {
  const neu = !pr;
  let typ = neu ? 'emoji' : pr.symbol_typ, sym = neu ? '🌍' : pr.symbol;
  const name = h('input', { id: 'pr-name', value: neu ? '' : pr.name, maxlength: 40, autocomplete: 'off', autocapitalize: 'words', placeholder: 'Name, zum Beispiel Österreich', 'aria-label': 'Projektname' });
  const vor = h('div', { class: 'pr-vor' }), feld = h('div', { class: 'pr-feld' }), err = h('p', { class: 'err' });
  const tabs = h('div', { class: 'segc3', role: 'tablist' });
  const vorschau = () => { vor.textContent = ''; vor.append(sym ? projektSymbol({ symbol_typ: typ, symbol: sym }, 'big') : h('span', { class: 'psym emoji big', text: '?' })); };
  const setTyp = t => {
    if (t === typ) return; typ = t;
    sym = t === 'flagge' ? (pr && pr.symbol_typ === 'flagge' ? pr.symbol : 'us') : t === 'emoji' ? (pr && pr.symbol_typ === 'emoji' ? pr.symbol : '🌍') : (pr && pr.symbol_typ === 'bild' ? pr.symbol : null);
    zeige();
  };
  function zeige() {
    tabs.textContent = '';
    [['flagge', 'Flagge'], ['emoji', 'Emoji'], ['bild', 'Foto']].forEach(([k, l]) => tabs.append(h('button', { class: 'seg', type: 'button', role: 'tab', 'aria-pressed': String(typ === k), text: l, onclick: () => setTyp(k) })));
    feld.textContent = '';
    if (typ === 'flagge') {
      feld.append(h('div', { class: 'pg' }, ...Object.entries(FLAGGEN).map(([c, f]) => h('button', { class: 'pg-b', type: 'button', 'aria-pressed': String(sym === c), title: f.n, 'aria-label': f.n, onclick: () => { sym = c; zeige(); } }, flagge(c, 'mini2')))));
    } else if (typ === 'emoji') {
      const eigen = h('input', { class: 'pr-eigen', maxlength: 12, autocomplete: 'off', placeholder: 'Eigenes Emoji einfügen oder tippen', 'aria-label': 'Eigenes Emoji', oninput: e => { const v = e.target.value.trim(); if (v && !/[A-Za-z0-9<>&"']/.test(v) && [...v].length <= 8) { sym = v; vorschau(); feld.querySelectorAll('.pg-b').forEach(b => b.setAttribute('aria-pressed', 'false')); } } });
      feld.append(h('div', { class: 'pg emojis' }, ...EMOJIS.map(e => h('button', { class: 'pg-b', type: 'button', 'aria-pressed': String(sym === e), 'aria-label': e, text: e, onclick: () => { sym = e; zeige(); } }))), eigen);
    } else {
      const datei = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': 'Foto auswählen' });
      datei.addEventListener('change', async () => {
        const f = datei.files[0]; datei.value = ''; if (!f) return; err.textContent = '';
        try { const d = await bildQuadrat(f, 96); if (!d) throw new Error('bild_zu_gross'); sym = d; vorschau(); zeige(); }
        catch (e) { err.textContent = 'Das Foto konnte nicht gelesen werden. Bitte ein anderes nehmen.'; }
      });
      feld.append(h('button', { class: 'btn', type: 'button', text: sym ? 'Anderes Foto wählen' : 'Foto wählen', onclick: () => datei.click() }), datei, h('p', { class: 'hint', text: 'Das Foto wird auf ein kleines Quadrat zugeschnitten.' }));
    }
    vorschau();
  }
  const sichern = h('button', { class: 'tbtn strong', type: 'button', text: neu ? 'Erstellen' : 'Sichern' });
  const fuss = h('button', { class: 'btn pri big', type: 'button', text: neu ? 'Projekt erstellen' : 'Sichern', onclick: () => sichern.click() });
  sichern.addEventListener('click', async () => {
    err.textContent = '';
    const n = name.value.trim();
    if (!n) { err.textContent = 'Bitte einen Namen eintragen.'; name.focus(); return; }
    if (!sym) { err.textContent = 'Bitte ein Bild wählen: Flagge, Emoji oder Foto.'; return; }
    sichern.disabled = true; fuss.disabled = true;
    try {
      const r = await rpc('tr_projekt_speichern', { p_code: S.code, p_id: neu ? null : pr.id, p_name: n, p_typ: typ, p_symbol: sym });
      const i = S.projekte.findIndex(x => x.id === r.id); if (i >= 0) S.projekte[i] = r; else S.projekte.push(r);
      sh.__close(); if (S.ansicht === 'start') startAufbau(); else zeichne(); toast(neu ? 'Projekt erstellt' : 'Gespeichert'); laden(false);
    } catch (e) { err.textContent = fehlertext(e); sichern.disabled = false; fuss.disabled = false; }
  });
  name.addEventListener('keydown', e => { if (e.key === 'Enter') sichern.click(); });
  let armed = false;
  const anz = neu ? 0 : S.personen.filter(p => p.projekt_id === pr.id).length;
  const del = !neu && istAdmin() ? h('div', null, h('div', { class: 'fg' }, h('button', { class: 'btn red', type: 'button', disabled: anz > 0 || S.projekte.length <= 1, text: 'Projekt löschen', onclick: async ev => {
    if (!armed) { armed = true; ev.target.classList.add('armed'); ev.target.textContent = 'Wirklich löschen? Nochmal tippen'; return; }
    ev.target.disabled = true;
    try { await rpc('tr_projekt_loeschen', { p_code: S.code, p_id: pr.id }); S.projekte = S.projekte.filter(x => x.id !== pr.id); if (S.f.projekt === pr.id) S.f.projekt = 'alle'; sh.__close(); startAufbau(); toast('Projekt gelöscht'); }
    catch (e) { err.textContent = fehlertext(e); ev.target.disabled = false; }
  } })), anz > 0 ? h('p', { class: 'hint', text: 'Gelöscht werden kann nur ein leeres Projekt. Verschiebe zuerst die ' + anz + (anz === 1 ? ' Person' : ' Personen') + ' in ein anderes Projekt.' }) : null) : null;
  const body = h('div', { class: 'sheet-b' }, vor, h('div', { class: 'fg' }, frow('Name', name)), tabs, feld, err, del);
  const sh = sheetEl(neu ? 'Neues Projekt' : 'Projekt', body, { left: h('button', { class: 'tbtn', type: 'button', text: 'Abbrechen', onclick: () => sh.__close() }), right: sichern, foot: fuss });
  zeige(); oeffne(sh, false); name.focus();
}

/* ---------- Dateien an einer Person (Klicken oder Reinziehen) */
const DATEI_MAX = 5 * 1024 * 1024, DATEI_ANZ = 20;
const BILD_OK = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const DATEI_ENDUNGEN = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'pdf', 'docx', 'xlsx', 'pptx', 'zip', 'doc', 'xls', 'ppt', 'txt', 'csv'];
const endungOk = name => DATEI_ENDUNGEN.includes((/\.([A-Za-z0-9]{1,5})$/.exec(name || '') || [])[1]?.toLowerCase());
function groesseText(n) { return n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
function lesBase64(blob) {
  return new Promise((ok, nein) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] || ''); fr.onerror = () => nein(fr.error); fr.readAsDataURL(blob); });
}
async function bildKlein(file, max, q) {
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * sc)), hh = Math.max(1, Math.round(bmp.height * sc));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
  const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, hh); cx.drawImage(bmp, 0, 0, w, hh);
  if (bmp.close) bmp.close();
  return new Promise(ok => cv.toBlob(ok, 'image/jpeg', q));
}
/* Grosse Fotos werden auf 2000 Pixel verkleinert, dazu kommt eine kleine Vorschau. Alles andere geht unveraendert hoch. */
async function dateiVorbereiten(file) {
  let blob = file, name = file.name || 'Datei', typ = file.type || 'application/octet-stream', vorschau = null;
  if (['image/jpeg', 'image/png', 'image/webp'].includes(typ)) {
    try {
      if (file.size > 1200000) {
        const b = await bildKlein(file, 2000, 0.85);
        if (b && b.size < file.size) { blob = b; typ = 'image/jpeg'; name = name.replace(/\.[^.]+$/, '') + '.jpg'; }
      }
      const t = await bildKlein(file, 160, 0.7);
      if (t) { const v = 'data:image/jpeg;base64,' + await lesBase64(t); if (v.length <= 40000) vorschau = v; }
    } catch (e) { /* Vorschau ist optional */ }
  }
  if (blob.size > DATEI_MAX) throw new Error('datei_zu_gross');
  return { name, typ, vorschau, blob };
}
async function dateiHochladen(personId, file) {
  const v = await dateiVorbereiten(file);
  return rpc('tr_datei_neu', { p_code: S.code, p_person: personId, p_name: v.name, p_typ: v.typ, p_daten: await lesBase64(v.blob), p_vorschau: v.vorschau });
}
async function dateiHolen(d) {
  const r = await rpc('tr_datei_holen', { p_code: S.code, p_id: d.id });
  if (BILD_OK.includes(r.typ)) {
    const sh = sheetEl(r.name, h('div', { class: 'sheet-b' }, h('img', { class: 'lb', alt: r.name, src: 'data:' + r.typ + ';base64,' + r.daten })), { right: h('button', { class: 'tbtn strong', text: 'Fertig', onclick: () => sh.__close() }) });
    oeffne(sh, true);
    return;
  }
  const bin = atob(r.daten), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = h('a', { href: url, download: r.name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
/* personId = null: neue Person, die Dateien warten, bis sie gespeichert ist (hochladen(id)). */
function dateiBereich(personId) {
  let liste = [], wartend = [], laeuft = 0;
  const grid = h('div', { class: 'files' }), msg = h('p', { class: 'err' });
  const input = h('input', { type: 'file', multiple: true, hidden: true, 'aria-label': 'Dateien auswählen' });
  const zone = h('div', { class: 'dz', role: 'button', tabindex: '0', 'aria-label': 'Dateien hinzufügen' },
    h('strong', { text: 'Dateien oder Fotos hinzufügen' }), h('span', { text: 'Hier tippen und auswählen. Oder irgendwo auf die Seite ziehen oder mit Strg+V einfügen. Bilder, PDF, Word, Excel, PowerPoint, ZIP, TXT, CSV. Bis 5 MB je Datei, Fotos werden verkleinert.' }));
  const ablage = navigator.clipboard && navigator.clipboard.read ? h('button', { class: 'btn einf', type: 'button', text: 'Aus Zwischenablage einfügen', onclick: () => ausAblage() }) : null;
  const el = h('div', { class: 'fg dz-box' }, zone, ablage, input, grid, msg);
  /* Knopf fuer Maus und Handy: holt ein kopiertes Bild oder einen Screenshot aus der Zwischenablage */
  async function ausAblage() {
    msg.textContent = '';
    try {
      const files = [];
      for (const it of await navigator.clipboard.read()) {
        const t = it.types.find(x => x.startsWith('image/'));
        if (t) files.push(new File([await it.getType(t)], dateiName(t), { type: t }));
        else if (it.types.includes('text/html')) { const b = bildAusHtml(await (await it.getType('text/html')).text()); if (b) files.push(b); }
      }
      if (files.length) neue(files); else msg.textContent = 'In der Zwischenablage ist kein Bild. Dateien aus dem Explorer ziehst du herein oder fügst sie mit Strg+V ein.';
    } catch (e) { msg.textContent = 'Der Browser hat das Einfügen nicht erlaubt. Erlaube den Zugriff auf die Zwischenablage oder nimm Strg+V.'; }
  }

  function zeige() {
    grid.textContent = '';
    liste.forEach(d => {
      const th = h('button', { class: 'fi-th', type: 'button', 'aria-label': d.name + ' öffnen', onclick: () => oeffnen(d) },
        d.vorschau && d.vorschau.startsWith('data:image/jpeg;base64,') ? h('img', { src: d.vorschau, alt: '' }) : h('span', { text: (d.name.split('.').pop() || 'Datei').slice(0, 4).toUpperCase() }));
      let armed = false;
      const weg = h('button', { class: 'cp red', type: 'button', text: 'Löschen', onclick: async ev => {
        if (!armed) { armed = true; ev.target.textContent = 'Wirklich?'; return; }
        ev.target.disabled = true;
        try { await rpc('tr_datei_loeschen', { p_code: S.code, p_id: d.id }); liste = liste.filter(x => x.id !== d.id); zeige(); laden(false); }
        catch (e) { msg.textContent = fehlertext(e); ev.target.disabled = false; armed = false; ev.target.textContent = 'Löschen'; }
      } });
      grid.append(h('div', { class: 'fi' }, th,
        h('div', { class: 'fi-t' }, h('span', { class: 'fi-n', text: d.name }), h('small', { text: groesseText(d.groesse) + (d.erstellt_von ? ' · ' + d.erstellt_von : '') })),
        h('button', { class: 'cp', type: 'button', text: BILD_OK.includes(d.typ) ? 'Ansehen' : 'Laden', onclick: () => oeffnen(d) }), weg));
    });
    wartend.forEach((f, i) => grid.append(h('div', { class: 'fi' }, h('span', { class: 'fi-th' }, h('span', { text: (f.name.split('.').pop() || 'Datei').slice(0, 4).toUpperCase() })),
      h('div', { class: 'fi-t' }, h('span', { class: 'fi-n', text: f.name }), h('small', { text: groesseText(f.size) + ' · wird nach dem Sichern hochgeladen' })),
      h('span'), h('button', { class: 'cp red', type: 'button', text: 'Entfernen', onclick: () => { wartend.splice(i, 1); zeige(); } }))));
    if (laeuft) grid.append(h('p', { class: 'hint', text: 'Lädt hoch: ' + laeuft + (laeuft === 1 ? ' Datei' : ' Dateien') + ' ...' }));
  }
  async function oeffnen(d) { msg.textContent = ''; try { await dateiHolen(d); } catch (e) { msg.textContent = fehlertext(e); } }
  async function neue(files) {
    msg.textContent = ''; if (!files.length) return;
    let ok = 0, vorgemerkt = 0;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    for (let f of files) {
      if (!f.name) f = new File([f], dateiName(f.type || 'image/png'), { type: f.type });
      if (liste.length + wartend.length + laeuft >= DATEI_ANZ) { msg.textContent = FEHLER.zu_viele_dateien; break; }
      if (!endungOk(f.name)) { msg.textContent = '"' + f.name + '": ' + FEHLER.datei_typ_nicht_erlaubt; continue; }
      if (f.size > DATEI_MAX && !f.type.startsWith('image/')) { msg.textContent = '"' + f.name + '": ' + FEHLER.datei_zu_gross; continue; }
      if (!personId) { wartend.push(f); vorgemerkt++; zeige(); continue; }
      laeuft++; zeige();
      try { const d = await dateiHochladen(personId, f); liste = [...liste.filter(x => x.id !== d.id), d]; ok++; } catch (e) { msg.textContent = '"' + f.name + '": ' + fehlertext(e); }
      laeuft--; zeige();
    }
    if (msg.textContent) toast(msg.textContent, true);
    else if (ok) toast(ok === 1 ? 'Datei gespeichert' : ok + ' Dateien gespeichert');
    else if (vorgemerkt) toast((vorgemerkt === 1 ? 'Datei vorgemerkt, sie wird' : vorgemerkt + ' Dateien vorgemerkt, sie werden') + ' beim Sichern hochgeladen');
    if (personId) laden(false);
  }
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { const f = [...input.files]; input.value = ''; neue(f); });
  if (personId) {
    grid.append(h('p', { class: 'hint', text: 'Lädt ...' }));
    rpc('tr_dateien', { p_code: S.code, p_person: personId }).then(r => { liste = [...r, ...liste.filter(x => !r.some(y => y.id === x.id))]; zeige(); }).catch(e => { grid.textContent = ''; msg.textContent = fehlertext(e); });
  }
  return {
    el, neue,
    wartend: () => wartend.length > 0,
    async hochladen(id) {
      let ok = 0, fehler = 0, grund = '';
      for (const f of wartend) { try { await dateiHochladen(id, f); ok++; } catch (e) { fehler++; grund = fehlertext(e); } }
      wartend = []; return { ok, fehler, grund };
    },
  };
}
/* ---------- Dateien annehmen: ueberall auf die Seite ziehen oder mit Strg+V einfuegen.
   Offene Person: die Datei geht zu ihr. In der Liste: auf eine Person ziehen, sonst entsteht eine neue Person.
   Was auf die Seite faellt, oeffnet nie eine andere Seite. */
function dateiName(typ) {
  const d = new Date(), e = (String(typ || '').split('/')[1] || 'png').split('+')[0];
  return 'Einfuegung_' + heute() + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.' + (e === 'jpeg' ? 'jpg' : e);
}
/* Manche Programme liefern ein Bild nur eingebettet im HTML. Fremde Adressen werden nie geladen (Sicherheitsregel der Seite). */
function bildAusHtml(html) {
  const m = /<img[^>]+src=["']data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+\/=\s]+)["']/i.exec(html || '');
  if (!m) return null;
  try { const bin = atob(m[2].replace(/\s/g, '')); return new File([Uint8Array.from(bin, c => c.charCodeAt(0))], dateiName(m[1]), { type: m[1] }); } catch (e) { return null; }
}
const istFeld = el => !!el && /^(INPUT|TEXTAREA)$/.test(el.tagName);
const blaetter = () => [...document.querySelectorAll('#layer > .veil > .sheet')];
const offenesBlatt = () => blaetter().reverse().find(s => s.__dateien);
let zugIntern = false, zugBild = null, zugUhr = null;
function zugArt(e) {
  const t = e.dataTransfer ? [...e.dataTransfer.types] : [];
  if (zugIntern) return null;
  if (t.includes('Files')) return 'datei';
  return t.includes('text/uri-list') && !istFeld(e.target) ? 'link' : null;
}
function zugZiel(e) {
  const offen = offenesBlatt();
  if (offen) return { text: 'Hier loslassen: Datei für ' + offen.__wer(), tun: f => offen.__dateien(f) };
  if (blaetter().length || !S.me || S.ansicht !== 'liste') return null;
  const row = e.target.closest ? e.target.closest('.row') : null, p = row && S.personen.find(x => String(x.id) === row.dataset.id);
  if (p) return { row, text: 'Hier loslassen: Datei für ' + titel(p), tun: f => personSheet(p.id, f) };
  return { text: 'Auf eine Person ziehen. Hier loslassen legt eine neue Person an.', tun: f => personSheet(null, f) };
}
function zugEnde() {
  clearTimeout(zugUhr); if (zugBild) { zugBild.remove(); zugBild = null; }
  document.querySelectorAll('.row.ziel').forEach(r => r.classList.remove('ziel'));
}
function zugZeigen(z) {
  if (!zugBild) { zugBild = h('div', { class: 'zug', 'aria-hidden': 'true' }, h('div', { class: 'zug-t' })); document.body.append(zugBild); }
  zugBild.firstChild.textContent = z.text;
  document.querySelectorAll('.row.ziel').forEach(r => { if (r !== z.row) r.classList.remove('ziel'); });
  if (z.row) z.row.classList.add('ziel');
  clearTimeout(zugUhr); zugUhr = setTimeout(zugEnde, 300);
}
document.addEventListener('dragstart', () => { zugIntern = true; });
document.addEventListener('dragend', () => { zugIntern = false; zugEnde(); });
document.addEventListener('dragover', e => {
  if (!zugArt(e)) return;
  e.preventDefault();
  const z = zugZiel(e); if (!z) { zugEnde(); return; }
  e.dataTransfer.dropEffect = /^(link|linkMove)$/.test(e.dataTransfer.effectAllowed) ? 'link' : 'copy';
  zugZeigen(z);
});
document.addEventListener('drop', e => {
  if (!zugArt(e)) return;
  e.preventDefault();
  const z = zugZiel(e); zugEnde(); if (!z) return;
  let files = [...e.dataTransfer.files];
  if (!files.length) { const b = bildAusHtml(e.dataTransfer.getData('text/html')); if (b) files = [b]; }
  if (files.length) z.tun(files);
  else toast('Das kam nur als Link an, nicht als Datei. Rechtsklick auf das Bild, „Bild kopieren“, dann hier Strg+V.', true);
});
document.addEventListener('paste', e => {
  const cd = e.clipboardData; if (!cd) return;
  let files = [...cd.files];
  const text = (cd.getData('text/plain') || '').trim();
  if (!files.length && !istFeld(e.target)) { const b = bildAusHtml(cd.getData('text/html')); if (b) files = [b]; }
  if (!files.length) return;
  if (istFeld(e.target) && text && !/^(https?|file|blob|data):\S*$/i.test(text) && !files.some(f => f.name === text)) return;
  const offen = offenesBlatt();
  if (!offen) { if (!blaetter().length && S.me) { e.preventDefault(); toast('Öffne zuerst die Person, dann mit Strg+V einfügen.', true); } return; }
  e.preventDefault();
  offen.__dateien(files.map(f => /^image\.\w+$/i.test(f.name) ? new File([f], dateiName(f.type), { type: f.type }) : f));
});

/* ---------- Einstellungen (Profil) und Uebersicht */
function einstellungenBlock(err) {
  const wv = h('input', { id: 'e-wert', value: String(S.einst.standardwert).replace('.', ','), inputmode: 'decimal', autocomplete: 'off', maxlength: 10, 'aria-label': 'Standardwert in Euro' });
  const ab = h('select', { id: 'e-ab', 'aria-label': 'Der Wert zählt ab dieser Stufe' }, ...ZAEHLT_AB.map(([k, l]) => h('option', { value: k, text: l })));
  ab.value = S.einst.zaehlt_ab;
  const speichern = h('button', { class: 'btn', type: 'button', text: 'Einstellungen speichern', onclick: async ev => {
    err.textContent = '';
    const n = parseEuro(wv.value);
    if (Number.isNaN(n)) { err.textContent = 'Bitte beim Standardwert eine Zahl eintragen, zum Beispiel 40 oder 35,50.'; wv.focus(); return; }
    ev.target.disabled = true;
    try { S.einst = await rpc('tr_einstellungen_setzen', { p_code: S.code, p_standardwert: n, p_zaehlt_ab: ab.value }); S.esig = JSON.stringify(S.einst); zeichne(); toast('Einstellungen gespeichert'); }
    catch (e) { err.textContent = fehlertext(e); } finally { ev.target.disabled = false; }
  } });
  return [
    h('div', null, h('div', { class: 'fg-t', text: 'Wert pro Person (gilt für alle Angemeldeten)' }), h('div', { class: 'fg' }, frow('Standard €', wv), frow('Zählt ab', ab))),
    speichern,
    h('p', { class: 'hint', text: 'Der Wert zählt nur, wenn bei der Person "Dazurechnen" an ist und ihre Stufe mindestens die gewählte erreicht hat. Bei jeder Person lässt sich ein eigener Wert eintragen, sonst gilt der Standard.' }),
  ];
}
function uebersichtSheet(pid) {
  if (!istAdmin()) return;
  pid = typeof pid === 'string' ? pid : 'alle';
  const Pall = S.personen, P = pid === 'alle' ? Pall : Pall.filter(p => p.projekt_id === pid), pr0 = pid === 'alle' ? null : projektVon(pid);
  const jetzt = P.filter(zaehltJetzt), wartet = P.filter(p => p.zaehlt && !stufeReicht(p)), nein = P.filter(p => !p.zaehlt);
  const abL = (ZAEHLT_AB.find(([k]) => k === S.einst.zaehlt_ab) || ZAEHLT_AB[0])[1];
  const karte = (kl, titel, zahl, sub, extra) => h('div', { class: 'ue-card ' + kl }, h('div', { class: 'ue-l', text: titel }), h('div', { class: 'ue-n', text: zahl }), h('div', { class: 'ue-s', text: sub }), extra || null);
  const tb = h('table', { class: 'pv' }, h('thead', null, h('tr', null, ...['Stufe', 'Personen', 'Dazu', 'Angekommen'].map(t => h('th', { text: t })))));
  const body = h('tbody');
  STATUS.forEach(s => {
    const a = P.filter(p => p.status === s.k), z = a.filter(p => p.zaehlt), an = a.filter(zaehltJetzt);
    body.append(h('tr', null, h('td', null, h('span', { class: 'sw-dot ' + s.k }), ' ' + s.l), h('td', { text: a.length }), h('td', { text: z.length }), h('td', { text: an.length ? eur(summe(an)) + ' (' + an.length + ')' : '–' })));
  });
  tb.append(body);
  const tp = h('table', { class: 'pv' }, h('thead', null, h('tr', null, ...['Projekt', 'Personen', 'Dazu', 'Angekommen'].map(t => h('th', { text: t })))));
  const bp = h('tbody');
  S.projekte.forEach(x => {
    const a = Pall.filter(p => p.projekt_id === x.id), an = a.filter(zaehltJetzt);
    bp.append(h('tr', null, h('td', null, projektSymbol(x, 'mini'), ' ' + x.name), h('td', { text: a.length }), h('td', { text: a.filter(p => p.zaehlt).length }), h('td', { text: an.length ? eur(summe(an)) + ' (' + an.length + ')' : '–' })));
  });
  { const gan = Pall.filter(zaehltJetzt); bp.append(h('tr', { class: 'tot' }, h('td', { text: 'Gemeinsam' }), h('td', { text: Pall.length }), h('td', { text: Pall.filter(p => p.zaehlt).length }), h('td', { text: eur(summe(gan)) + ' (' + gan.length + ')' }))); }
  tp.append(bp);
  const sel = h('select', { id: 'ue-projekt', 'aria-label': 'Projekt auswerten', onchange: e => { sh.__close(); uebersichtSheet(e.target.value); } }, h('option', { value: 'alle', text: 'Alle Projekte gemeinsam' }), ...S.projekte.map(x => h('option', { value: x.id, text: x.name }))); sel.value = pid;
  const sh = sheetEl('Übersicht und Wert', h('div', { class: 'sheet-b' },
    h('div', { class: 'fg' }, frow('Auswerten', sel)),
    pr0 ? h('p', { class: 'hint', text: 'Gewinn gemeinsam, alle Projekte zusammen: ' + eur(summe(Pall.filter(zaehltJetzt))) + '. Die Projekte zählen einzeln, der Gewinn ist gemeinsam.' }) : null,
    h('div', { class: 'ue-grid' },
      karte('main', pr0 ? 'Angekommen in ' + pr0.name : 'Gewinn gemeinsam, angekommen', eur(summe(jetzt)), jetzt.length + (jetzt.length === 1 ? ' Person' : ' Personen')),
      karte('', 'Angehakt, wartet noch', eur(summe(wartet)), wartet.length + (wartet.length === 1 ? ' Person' : ' Personen') + ', zählt ab ' + abL),
      karte('', 'Nicht dazugerechnet', String(nein.length), nein.length === 1 ? 'Person bekommt keinen Wert' : 'Personen bekommen keinen Wert')),
    h('div', { class: 'fg table-wrap' }, tb),
    h('div', { class: 'fg table-wrap' }, tp),
    h('p', { class: 'hint', text: 'Dateispeicher: ' + (((S.einst.dateien_bytes || 0) / 1048576).toFixed(1).replace('.', ',')) + ' MB von 300 MB' + ((S.einst.dateien_bytes || 0) > 0.8 * 314572800 ? ' (fast voll, bitte alte Dateien löschen)' : '') }),
    h('p', { class: 'hint', text: 'Standardwert ' + eur(S.einst.standardwert) + ' je Person, zählt ab Stufe "' + abL + '", und nur bei Personen mit "Dazurechnen". ' + Pall.length + (Pall.length === 1 ? ' Person' : ' Personen') + ' insgesamt.' }),
    h('button', { class: 'btn', text: 'Einstellungen ändern', onclick: () => { sh.__close(); profilSheet(); } })),
  { right: h('button', { class: 'tbtn strong', text: 'Fertig', onclick: () => sh.__close() }), wide: true });
  oeffne(sh, true);
}

/* ---------- PDF (Admin): ohne Bibliothek. Linien, Flaechen und Text sind Vektoren, darum immer scharf, nie verpixelt. */
const HELV = '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584'.split(' ').map(Number);
function pdfBreite(t, gr, fett) {
  let w = 0;
  for (const ch of String(t)) {
    const c = ch.charCodeAt(0);
    let b = 556;
    if (c >= 32 && c <= 126) b = HELV[c - 32];
    else if (c === 223) b = 611;
    else { const f = ch.normalize('NFD').charCodeAt(0); if (f >= 32 && f <= 126) b = HELV[f - 32]; }
    w += b;
  }
  return w * gr / 1000 * (fett ? 1.07 : 1);
}
const PDF_EXTRA = { 'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'ı': 'i', 'İ': 'I' };
/* Text in die Schrift "WinAnsi" umsetzen und fuer PDF maskieren (alles bleibt reines ASCII) */
function pdfText(t) {
  let o = '';
  for (const ch of String(t)) {
    let c = ch.charCodeAt(0);
    if (ch === '€') c = 128; else if (ch === '–') c = 150; else if (ch === '·') c = 183;
    else if (!((c >= 32 && c <= 126) || (c >= 160 && c <= 255))) {
      const b = PDF_EXTRA[ch] || ch.normalize('NFD')[0]; c = b.charCodeAt(0);
      if (!(c >= 32 && c <= 126)) c = 63;
    }
    o += (c === 40 || c === 41 || c === 92) ? '\\' + String.fromCharCode(c) : (c >= 32 && c <= 126) ? String.fromCharCode(c) : '\\' + c.toString(8).padStart(3, '0');
  }
  return o;
}
function pdfFarbe(hex) { const v = parseInt(hex.slice(1), 16); return [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255].map(x => x.toFixed(3)).join(' '); }
function pdfDokument() {
  const seiten = []; let cur = null; const z = n => (Math.round(n * 100) / 100).toString();
  return {
    neueSeite(w, hh) { cur = { w, h: hh, c: [] }; seiten.push(cur); return cur; },
    anzahl: () => seiten.length,
    seite: i => seiten[i],
    rect(x, y, w, hh, fill) { cur.c.push(pdfFarbe(fill) + ' rg ' + z(x) + ' ' + z(cur.h - y - hh) + ' ' + z(w) + ' ' + z(hh) + ' re f'); },
    rundRect(x, y, w, hh, r, fill) {
      const Y = cur.h - y - hh, k = r * 0.5523;
      cur.c.push(pdfFarbe(fill) + ' rg ' + z(x + r) + ' ' + z(Y) + ' m ' + z(x + w - r) + ' ' + z(Y) + ' l ' + z(x + w - r + k) + ' ' + z(Y) + ' ' + z(x + w) + ' ' + z(Y + r - k) + ' ' + z(x + w) + ' ' + z(Y + r) + ' c '
        + z(x + w) + ' ' + z(Y + hh - r) + ' l ' + z(x + w) + ' ' + z(Y + hh - r + k) + ' ' + z(x + w - r + k) + ' ' + z(Y + hh) + ' ' + z(x + w - r) + ' ' + z(Y + hh) + ' c '
        + z(x + r) + ' ' + z(Y + hh) + ' l ' + z(x + r - k) + ' ' + z(Y + hh) + ' ' + z(x) + ' ' + z(Y + hh - r + k) + ' ' + z(x) + ' ' + z(Y + hh - r) + ' c '
        + z(x) + ' ' + z(Y + r) + ' l ' + z(x) + ' ' + z(Y + r - k) + ' ' + z(x + r - k) + ' ' + z(Y) + ' ' + z(x + r) + ' ' + z(Y) + ' c f');
    },
    linie(x1, y1, x2, y2, farbe, breite) { cur.c.push(pdfFarbe(farbe) + ' RG ' + z(breite || .5) + ' w ' + z(x1) + ' ' + z(cur.h - y1) + ' m ' + z(x2) + ' ' + z(cur.h - y2) + ' l S'); },
    text(x, y, t, gr, fett, farbe) { cur.c.push('BT /' + (fett ? 'F2' : 'F1') + ' ' + z(gr) + ' Tf ' + pdfFarbe(farbe || '#111827') + ' rg ' + z(x) + ' ' + z(cur.h - y) + ' Td (' + pdfText(t) + ') Tj ET'); },
    seiteText(i, x, y, t, gr, fett, farbe) { const s = seiten[i], k = cur; cur = s; this.text(x, y, t, gr, fett, farbe); cur = k; },
    ausgeben() {
      const o = []; o[1] = '<< /Type /Catalog /Pages 2 0 R >>';
      o[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
      o[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
      const kids = []; let n = 5;
      seiten.forEach(s => { const st = s.c.join('\n'); o[n] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + s.w + ' ' + s.h + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (n + 1) + ' 0 R >>'; o[n + 1] = '<< /Length ' + st.length + ' >>\nstream\n' + st + '\nendstream'; kids.push(n + ' 0 R'); n += 2; });
      o[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + kids.length + ' >>';
      let out = '%PDF-1.4\n'; const off = [];
      for (let i = 1; i < o.length; i++) { off[i] = out.length; out += i + ' 0 obj\n' + o[i] + '\nendobj\n'; }
      const xr = out.length;
      out += 'xref\n0 ' + o.length + '\n0000000000 65535 f \n' + off.slice(1).map(x => String(x).padStart(10, '0') + ' 00000 n \n').join('');
      return out + 'trailer\n<< /Size ' + o.length + ' /Root 1 0 R >>\nstartxref\n' + xr + '\n%%EOF';
    },
  };
}
const PDF_STUFE = { leer: '#6b7280', zu_erledigen: '#b45309', erledigt: '#15803d', veraltet: '#7e22ce', test: '#1d4ed8' };
function pdfPassend(t, breite, gr, fett) {
  t = String(t == null ? '' : t); if (pdfBreite(t, gr, fett) <= breite) return t;
  while (t.length > 1 && pdfBreite(t + '...', gr, fett) > breite) t = t.slice(0, -1);
  return t + '...';
}
function pdfTabelle(rows, opt) {
  const doc = pdfDokument(), W = 842, H = 595, R = 30, kopfH = 22, zH = 19, gr = 8.5;
  const SP = [['Projekt', 62], ['Name', 110], ['E-Mail', 146], ['Nummer', 72], ['State', 32], ['Mail', 50], ['Konten', 56], ['Stufe', 92], ['Wert', 52], ['Zählt', 44], ['Angelegt', 62]];
  const gesamtW = SP.reduce((t, c) => t + c[1], 0), x0 = R + (W - 2 * R - gesamtW) / 2;
  const an = rows.filter(zaehltJetzt), warten = rows.filter(p => p.zaehlt && !stufeReicht(p));
  const kopfBlock = () => {
    doc.neueSeite(W, H);
    doc.rect(0, 0, W, 6, '#1f2a44');
    doc.text(R + 2, 40, 'Adress-Tracker', 20, true, '#111827');
    doc.text(R + 2, 56, 'Personenliste', 10.5, false, '#4b5563');
    return 78;
  };
  let y = kopfBlock();
  // Filter-Zeile und Zusammenfassung
  doc.text(R + 2, y, opt.beschreibung, 8.5, false, '#4b5563'); y += 14;
  const karten = [['Personen', String(rows.length)], ['Angekommen', eur(summe(an)) + '  (' + an.length + ')'], ['Wartet noch', eur(summe(warten)) + '  (' + warten.length + ')']];
  karten.forEach((k, i) => { const kx = R + 2 + i * 190; doc.rundRect(kx, y, 180, 36, 6, '#f3f4f6'); doc.text(kx + 10, y + 14, k[0], 8, false, '#6b7280'); doc.text(kx + 10, y + 29, k[1], 12, true, '#111827'); });
  y += 50;
  const kopfZeile = () => {
    doc.rect(x0, y, gesamtW, kopfH, '#1f2a44');
    let x = x0; SP.forEach(([t, w]) => { const r = t === 'Wert'; doc.text(r ? x + w - 6 - pdfBreite(t, 8.5, true) : x + 6, y + 14.5, t, 8.5, true, '#ffffff'); x += w; });
    y += kopfH;
  };
  kopfZeile();
  if (!rows.length) doc.text(x0 + 6, y + 24, 'Keine Personen im gewählten Zeitraum.', 10, false, '#6b7280');
  const untenGrenze = H - 46;
  rows.forEach((p, i) => {
    if (y + zH > untenGrenze) { y = kopfBlock() ; doc.text(R + 2, y, opt.beschreibung + ' (Fortsetzung)', 8.5, false, '#4b5563'); y += 16; kopfZeile(); }
    if (i % 2 === 1) doc.rect(x0, y, gesamtW, zH, '#f6f7f9');
    doc.linie(x0, y + zH, x0 + gesamtW, y + zH, '#e5e7eb', .5);
    const base = y + 12.8; let x = x0;
    const zelle = (idx, t, o) => { const w = SP[idx][1]; const s = pdfPassend(t, w - 12, gr, o && o.fett); doc.text(o && o.rechts ? x + w - 6 - pdfBreite(s, gr, o.fett) : x + 6, base, s, gr, o && o.fett, o && o.farbe); x += w; };
    zelle(0, projektTitel(p.projekt_id));
    zelle(1, titel(p), { fett: true });
    zelle(2, p.email || '–', { farbe: p.email ? '#111827' : '#9ca3af' });
    zelle(3, p.nummer || '–', { farbe: p.nummer ? '#111827' : '#9ca3af' });
    zelle(4, p.state || '–', { farbe: p.state ? '#111827' : '#9ca3af' });
    zelle(5, p.mail_status === 'erhalten' ? 'Erhalten' : p.mail_status === 'erstellt' ? 'Erstellt' : '–', { fett: !!p.mail_status, farbe: p.mail_status === 'erhalten' ? '#1d4ed8' : p.mail_status === 'erstellt' ? '#7e22ce' : '#9ca3af' });
    { // Konten als farbige Marken
      let bx = x + 6;
      if (p.betonline) { doc.rundRect(bx, y + 4, 18, 11, 3, '#e8590c'); doc.text(bx + 3.2, y + 12, 'BO', 6.5, true, '#ffffff'); bx += 22; }
      if (p.stake) { doc.rundRect(bx, y + 4, 12, 11, 3, '#1db954'); doc.text(bx + 3.6, y + 12, 'S', 7, true, '#ffffff'); }
      if (!p.betonline && !p.stake) doc.text(x + 6, base, '–', gr, false, '#9ca3af');
      x += SP[6][1];
    }
    zelle(7, STATUS_L[p.status] || p.status, { fett: true, farbe: PDF_STUFE[p.status] });
    zelle(8, eur(wertVon(p)), { rechts: true, farbe: p.zaehlt ? '#111827' : '#9ca3af' });
    zelle(9, zaehltJetzt(p) ? 'Ja' : p.zaehlt ? 'wartet' : '–', { fett: zaehltJetzt(p), farbe: zaehltJetzt(p) ? '#15803d' : p.zaehlt ? '#b45309' : '#9ca3af' });
    zelle(10, datumDE((p[opt.datumFeld] || '').slice(0, 10)));
    y += zH;
  });
  // Summenzeile
  if (rows.length) {
    if (y + 26 > untenGrenze) { y = kopfBlock() + 4; }
    doc.rect(x0, y, gesamtW, 24, '#eef2ff');
    doc.text(x0 + 6, y + 16, 'Gesamt: ' + rows.length + (rows.length === 1 ? ' Person' : ' Personen'), 9.5, true, '#1f2a44');
    const t = 'Angekommen: ' + eur(summe(an));
    doc.text(x0 + gesamtW - 8 - pdfBreite(t, 9.5, true), y + 16, t, 9.5, true, '#15803d');
  }
  // Fuss auf jeder Seite
  const stand = new Date().toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  for (let i = 0; i < doc.anzahl(); i++) {
    doc.seiteText(i, R + 2, H - 22, 'Adress-Tracker, Stand ' + stand, 7.5, false, '#9ca3af');
    const s = 'Seite ' + (i + 1) + ' von ' + doc.anzahl(); doc.seiteText(i, W - R - 2 - pdfBreite(s, 7.5, false), H - 22, s, 7.5, false, '#9ca3af');
  }
  return doc.ausgeben();
}
/* Auswahl vor dem Herunterladen: Zeitraum, Projekt, Stufe */
function pdfSheet() {
  if (!istAdmin()) return;
  const lok = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const von = h('input', { id: 'pdf-von', type: 'date', 'aria-label': 'Von' }), bis = h('input', { id: 'pdf-bis', type: 'date', 'aria-label': 'Bis' });
  const feld = h('select', { id: 'pdf-feld', 'aria-label': 'Datum nach' }, h('option', { value: 'erstellt', text: 'Angelegt am' }), h('option', { value: 'geaendert', text: 'Zuletzt geändert' }));
  const proj = h('select', { id: 'pdf-projekt', 'aria-label': 'Projekt' }, h('option', { value: 'alle', text: 'Alle Projekte' }), ...S.projekte.map(x => h('option', { value: x.id, text: x.name })));
  if (S.f.projekt !== 'alle') proj.value = S.f.projekt;
  const stufe = h('select', { id: 'pdf-stufe', 'aria-label': 'Stufe' }, h('option', { value: 'alle', text: 'Alle Stufen' }), ...STATUS.map(x => h('option', { value: x.k, text: x.l })));
  const info = h('p', { class: 'hint' }), err = h('p', { class: 'err' });
  const auswahl = () => S.personen.filter(p => {
    if (proj.value !== 'alle' && p.projekt_id !== proj.value) return false;
    if (stufe.value !== 'alle' && p.status !== stufe.value) return false;
    const d = p[feld.value] ? lok(new Date(p[feld.value])) : '';
    if (von.value && d < von.value) return false;
    if (bis.value && d > bis.value) return false;
    return true;
  });
  const zeigeAnzahl = () => { const n = auswahl().length; info.textContent = n + (n === 1 ? ' Person kommt' : ' Personen kommen') + ' ins PDF.'; go.disabled = n === 0; };
  const voreinstellung = (t, a, b) => h('button', { class: 'chip', type: 'button', text: t, onclick: () => { von.value = a; bis.value = b; zeigeAnzahl(); } });
  const heute0 = new Date(), monat1 = new Date(heute0.getFullYear(), heute0.getMonth(), 1), vor30 = new Date(heute0.getTime() - 29 * 86400000), jahr1 = new Date(heute0.getFullYear(), 0, 1);
  const go = h('button', { class: 'btn pri big', type: 'button', text: 'PDF laden' });
  go.addEventListener('click', () => {
    err.textContent = '';
    if (von.value && bis.value && von.value > bis.value) { err.textContent = 'Das Von-Datum liegt nach dem Bis-Datum.'; return; }
    try {
      const rows = auswahl().sort((a, b) => S.projekte.findIndex(x => x.id === a.projekt_id) - S.projekte.findIndex(x => x.id === b.projekt_id) || titel(a).localeCompare(titel(b), 'de', { sensitivity: 'base' }));
      const bes = [proj.value === 'alle' ? 'Alle Projekte' : 'Projekt: ' + projektTitel(proj.value), stufe.value === 'alle' ? 'Alle Stufen' : 'Stufe: ' + STATUS_L[stufe.value],
        (von.value || bis.value) ? (feld.value === 'erstellt' ? 'Angelegt' : 'Zuletzt geändert') + ': ' + (von.value ? datumDE(von.value) : 'Anfang') + ' bis ' + (bis.value ? datumDE(bis.value) : 'heute') : 'Ganzer Zeitraum'].join('   ·   ');
      const pdf = pdfTabelle(rows, { beschreibung: bes, datumFeld: feld.value });
      const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
      const a = h('a', { href: url, download: 'adress-tracker-' + heute() + '.pdf' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      sh.__close(); toast('PDF geladen');
    } catch (e) { err.textContent = 'Das PDF konnte nicht erstellt werden.'; }
  });
  [feld, proj, stufe, von, bis].forEach(el => el.addEventListener('change', zeigeAnzahl));
  const sh = sheetEl('PDF laden', h('div', { class: 'sheet-b' },
    h('div', { class: 'fg' }, frow('Projekt', proj), frow('Stufe', stufe), frow('Datum nach', feld), frow('Von', von), frow('Bis', bis)),
    h('div', { class: 'chips' }, voreinstellung('Alles', '', ''), voreinstellung('Dieser Monat', lok(monat1), lok(heute0)), voreinstellung('Letzte 30 Tage', lok(vor30), lok(heute0)), voreinstellung('Dieses Jahr', lok(jahr1), lok(heute0))),
    info, h('p', { class: 'hint', text: 'Das PDF ist eine saubere Tabelle (Querformat, scharfe Schrift). Leere Felder bei Von und Bis heißen: ohne Grenze.' }), err),
    { left: h('button', { class: 'tbtn', type: 'button', text: 'Abbrechen', onclick: () => sh.__close() }), foot: go, right: h('button', { class: 'tbtn strong', type: 'button', text: 'Laden', onclick: () => go.click() }) });
  oeffne(sh, false); zeigeAnzahl();
}

/* ---------- Profil (jeder) */
function profilSheet() {
  const admin = istAdmin();
  const out = h('div'); const err = h('p', { class: 'err' });
  const name = h('input', { id: 'p-name', value: S.me.name, maxlength: 100, autocomplete: 'off', 'aria-label': 'Mein Name' });
  const speichern = async (ev) => {
    err.textContent = '';
    const n = name.value.trim();
    if (!n) { err.textContent = 'Bitte einen Namen eintragen.'; name.focus(); return; }
    if (n === S.me.name) { toast('Der Name ist schon so eingetragen'); return; }
    ev.target.disabled = true;
    try { const r = await rpc('tr_profil_aendern', { p_code: S.code, p_name: n }); S.me.name = r.name; sh.__close(); await laden(true); toast('Name gespeichert'); }
    catch (e) { err.textContent = fehlertext(e); ev.target.disabled = false; }
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') speichern({ target: name }); });
  const profKopf = h('div', { class: 'prof' });
  const zeigeKopf = () => { profKopf.textContent = ''; profKopf.append(avatar(S.me.name, true, S.me), h('strong', { text: S.me.name }), h('span', { class: 'pill' + (admin ? ' adm' : ''), text: S.me.inhaber ? 'Inhaber' : admin ? 'Admin' : 'Mitarbeiter' })); };
  const farbRaster = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Farbe für dein Profil' });
  const zeigeFarben = () => { farbRaster.textContent = ''; AVATAR_FARBEN.forEach(([k, l]) => farbRaster.append(h('button', { class: 'sw-c fb-' + k, type: 'button', title: l, 'aria-label': l, 'aria-pressed': String(S.me.avatar_farbe === k), onclick: () => avatarSpeichern(k, S.me.avatar_bild || null) }))); };
  const bildDatei = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': 'Profilbild wählen' });
  async function avatarSpeichern(farbe, bild) {
    err.textContent = '';
    try {
      const r = await rpc('tr_profil_avatar', { p_code: S.code, p_farbe: farbe, p_bild: bild });
      S.me.avatar_farbe = r.avatar_farbe; S.me.avatar_bild = r.avatar_bild; zeigeKopf(); zeigeFarben(); aufbau();
    } catch (e) { err.textContent = fehlertext(e); }
  }
  bildDatei.addEventListener('change', async () => {
    const f = bildDatei.files[0]; bildDatei.value = ''; if (!f) return;
    try { const d = await bildQuadrat(f, 128); if (!d) throw new Error('bild'); await avatarSpeichern(S.me.avatar_farbe || null, d); }
    catch (e) { err.textContent = 'Das Foto konnte nicht gelesen werden. Bitte ein anderes nehmen.'; }
  });
  zeigeKopf(); zeigeFarben();
  const body = h('div', { class: 'sheet-b' },
    profKopf,
    h('div', { class: 'avbar' }, h('button', { class: 'btn', type: 'button', text: 'Foto wählen', onclick: () => bildDatei.click() }), h('button', { class: 'btn', type: 'button', text: 'Foto entfernen', onclick: () => avatarSpeichern(S.me.avatar_farbe || null, null) }), bildDatei),
    h('div', null, h('div', { class: 'fg-t', text: 'Farbe' }), farbRaster),
    h('div', { class: 'fg' }, frow('Name', name)),
    h('button', { class: 'btn', text: 'Namen speichern', onclick: speichern }),
    h('p', { class: 'hint', text: 'Dein Name steht bei jeder Änderung, die du machst. Alle Angemeldeten sehen dieselbe Liste, Änderungen erscheinen bei allen nach wenigen Sekunden. Teilen sich mehrere Leute einen Zugang, gilt der Name für alle.' }),
    ...(istAdmin() ? einstellungenBlock(err) : []),
    admin ? h('div', { class: 'kbar' },
      h('button', { class: 'btn', text: 'Admin-Portal', onclick: () => { sh.__close(); zugaengeSheet(); } }),
      h('button', { class: 'btn', text: 'Neuer Schlüssel für mich', onclick: async (ev) => {
        err.textContent = ''; ev.target.disabled = true;
        try { const res = await rpc('tr_zugang_aendern', { p_code: S.code, p_id: S.me.id, p_aktion: 'neuer_code' }); S.code = res.code; store(res.code); zeigeSchluessel(out, S.me.name, res.code, true); }
        catch (e) { err.textContent = fehlertext(e); } finally { ev.target.disabled = false; }
      } })) : null,
    err, out,
    h('div', { class: 'fg' }, h('button', { class: 'btn red', text: 'Abmelden', onclick: () => { store(null); S.code = null; location.reload(); } })));
  const sh = sheetEl('Profil', body, { right: h('button', { class: 'tbtn strong', text: 'Fertig', onclick: () => sh.__close() }) });
  oeffne(sh, true);
}

/* ---------- Zugaenge und Protokoll (Admin) */
const AKTION = { neu: 'Person angelegt', aendern: 'Person geändert', loeschen: 'Person gelöscht', import: 'Liste eingespielt', einrichten: 'Einrichtung', zugang_neu: 'Zugang angelegt', zugang_gesperrt: 'Zugang gesperrt', zugang_entsperrt: 'Zugang entsperrt', zugang_neuer_code: 'Neuer Schlüssel', zugang_admin: 'Zum Admin gemacht', zugang_mitarbeiter: 'Zum Mitarbeiter gemacht', profil: 'Name geändert', zugang_umbenannt: 'Zugang umbenannt', zugang_geloescht: 'Zugang gelöscht', einstellung: 'Einstellung geändert', datei_neu: 'Datei hinzugefügt', datei_weg: 'Datei gelöscht', projekt_neu: 'Projekt angelegt', projekt_aendern: 'Projekt geändert', projekt_weg: 'Projekt gelöscht' };
function zugaengeSheet() {
  const body = h('div', { class: 'sheet-b' });
  let tab = 'zugang';
  const t1 = h('button', { role: 'tab', text: 'Zugänge', onclick: () => { tab = 'zugang'; fuell(); } });
  const t2 = h('button', { role: 'tab', text: 'Protokoll', onclick: () => { tab = 'protokoll'; fuell(); } });
  const sh = sheetEl('Admin-Portal', body, { wide: true, right: h('button', { class: 'tbtn strong', text: 'Fertig', onclick: () => sh.__close() }) });
  oeffne(sh, true);
  async function fuell() {
    t1.setAttribute('aria-selected', String(tab === 'zugang')); t2.setAttribute('aria-selected', String(tab === 'protokoll'));
    body.textContent = ''; body.append(h('div', { class: 'segc', role: 'tablist' }, t1, t2), h('p', { class: 'hint', text: 'Lädt ...' }));
    try {
      if (tab === 'zugang') {
        const z = await rpc('tr_zugaenge', { p_code: S.code });
        body.textContent = ''; body.append(h('div', { class: 'segc', role: 'tablist' }, t1, t2));
        const ich = S.me || {}, inh = !!ich.inhaber;
        const nm = h('input', { id: 'z-name', placeholder: 'Name der Person', maxlength: 100, autocomplete: 'off', autocapitalize: 'words', 'aria-label': 'Name der Person' });
        const ro = h('select', { id: 'z-rolle', 'aria-label': 'Rolle' }, h('option', { value: 'mitarbeiter', text: 'Mitarbeiter (ohne Geld)' }), ...(inh ? [h('option', { value: 'admin', text: 'Admin (sieht auch Geld)' })] : []));
        const out = h('div', { 'data-out': '' }); const er = h('p', { class: 'err' });
        const anlegen = async (ev) => {
          er.textContent = ''; if (!nm.value.trim()) { er.textContent = 'Bitte einen Namen eintragen.'; nm.focus(); return; }
          ev.target.disabled = true;
          try { const r = await rpc('tr_zugang_anlegen', { p_code: S.code, p_name: nm.value.trim(), p_rolle: ro.value }); await fuell(); zeigeSchluessel(body.querySelector('[data-out]'), r.name, r.code); }
          catch (e) { er.textContent = fehlertext(e); ev.target.disabled = false; }
        };
        const addBtn = h('button', { class: 'btn pri', text: 'Zugang hinzufügen', onclick: anlegen });
        nm.addEventListener('keydown', e => { if (e.key === 'Enter') anlegen({ target: addBtn }); });
        body.append(
          h('div', { class: 'fg-t', text: 'Zugang hinzufügen' }),
          h('div', { class: 'fg' }, frow('Name', nm), frow('Rolle', ro)),
          addBtn, er, out,
          h('p', { class: 'hint', text: 'Admin sieht und ändert alles, auch alle Euro-Beträge, den Gewinn, Übersicht und Wert und das PDF. Mitarbeiter sieht und bearbeitet nur die Personen und ihre Konten, ohne Geld. ' + (inh ? 'Als Inhaber ernennst du Admins und stufst sie herab. Dich selbst kann niemand herabstufen, sperren oder löschen.' : 'Du bist Admin, aber nicht Inhaber: Du verwaltest Mitarbeiter. Admins ernennt und verwaltet nur der Inhaber.') }),
          h('p', { class: 'hint', text: 'Du bekommst einen persönlichen Link für diesen Zugang. Er wird nur einmal angezeigt. Wer ihn öffnet, ist sofort angemeldet und sieht dieselbe Liste wie alle anderen.' }),
          h('div', { class: 'fg-t', text: 'Zugänge' }));
        const grp = h('div', { class: 'fg' });
        z.forEach(r => {
          const selbst = r.id === ich.id, adminZiel = r.rolle === 'admin';
          const darfAnfassen = !r.inhaber && (inh || !adminZiel);        // Sperren, Löschen
          const darfSchluessel = selbst || darfAnfassen;                   // neuer Schlüssel
          let armed = false;
          const aktionen = [];
          if (darfAnfassen && !selbst) aktionen.push(h('button', { class: 'btn sm', text: r.gesperrt ? 'Entsperren' : 'Sperren', onclick: () => aendern(r, r.gesperrt ? 'entsperren' : 'sperren') }));
          if (inh && !r.inhaber) aktionen.push(h('button', { class: 'btn sm', text: adminZiel ? 'Zu Mitarbeiter' : 'Zu Admin', onclick: async () => {
            try { await rpc('tr_zugang_rolle', { p_code: S.code, p_id: r.id, p_rolle: adminZiel ? 'mitarbeiter' : 'admin' }); await fuell(); }
            catch (e) { toast(fehlertext(e), true); }
          } }));
          if (darfSchluessel) aktionen.push(h('button', { class: 'btn sm', text: 'Neuer Schlüssel', onclick: () => aendern(r, 'neuer_code') }));
          if (darfAnfassen && !selbst) aktionen.push(h('button', { class: 'btn sm red', text: 'Löschen', onclick: async ev => {
            if (!armed) { armed = true; ev.target.textContent = 'Wirklich löschen? Nochmal tippen'; return; }
            ev.target.disabled = true;
            try { await rpc('tr_zugang_loeschen', { p_code: S.code, p_id: r.id }); toast('Zugang gelöscht'); await fuell(); }
            catch (e) { toast(fehlertext(e), true); ev.target.disabled = false; armed = false; ev.target.textContent = 'Löschen'; }
          } }));
          grp.append(h('div', { class: 'prow' },
            h('div', { class: 'prow-top' }, avatar(r.name, false, r),
              h('div', { class: 'prow-t' }, h('strong', { text: r.name }), h('small', { text: 'Seit ' + new Date(r.erstellt).toLocaleDateString('de-DE') + ', zuletzt online ' + rel(r.zuletzt_gesehen) + (adminZiel ? ' · sieht Geld und Übersicht' : ' · nur Personen und Konten, kein Geld') })),
              r.inhaber ? h('span', { class: 'pill inh', text: 'Inhaber' }) : h('span', { class: 'pill' + (adminZiel ? ' adm' : ''), text: adminZiel ? 'Admin' : 'Mitarbeiter' }),
              h('span', { class: 'pill ' + (r.gesperrt ? 'bad' : 'ok'), text: r.gesperrt ? 'Gesperrt' : 'Aktiv' })),
            aktionen.length ? h('div', { class: 'prow-actions' }, ...aktionen) : h('p', { class: 'hint', text: r.inhaber ? 'Geschützt: Der Inhaber kann nicht herabgestuft, gesperrt oder gelöscht werden.' : 'Diesen Admin verwaltet nur der Inhaber.' })));
        });
        body.append(grp);
        async function aendern(r, aktion) {
          try {
            const res = await rpc('tr_zugang_aendern', { p_code: S.code, p_id: r.id, p_aktion: aktion });
            await fuell();
            if (aktion === 'neuer_code') {
              if (S.me && r.id === S.me.id) { S.code = res.code; store(res.code); }
              zeigeSchluessel(body.querySelector('[data-out]'), r.name, res.code, true);
            }
          } catch (e) { toast(fehlertext(e), true); }
        }
      } else {
        const p = await rpc('tr_protokoll', { p_code: S.code });
        body.textContent = ''; body.append(h('div', { class: 'segc', role: 'tablist' }, t1, t2),
          h('p', { class: 'hint', text: 'Die letzten 200 Vorgänge. Es werden nur Feldnamen protokolliert, keine Inhalte.' }));
        const grp = h('div', { class: 'fg log' });
        p.forEach(r => grp.append(h('div', { class: 'log-row' }, h('span', { text: r.wer + ': ' + (AKTION[r.aktion] || r.aktion) + (r.person_name ? ', ' + r.person_name : '') }),
          h('small', { text: new Date(r.zeit).toLocaleString('de-DE') + ((r.felder || []).length ? ' · ' + r.felder.join(', ') : '') }))));
        body.append(grp);
      }
    } catch (e) { body.textContent = ''; body.append(h('p', { class: 'err', text: fehlertext(e) })); }
  }
  fuell();
}
function zeigeSchluessel(out, name, code, rotiert) {
  out.textContent = '';
  const link = location.origin + location.pathname + '#k=' + code;
  out.append(h('div', { class: 'note' }, h('strong', { text: (rotiert ? 'Neuer Schlüssel für ' : 'Zugang für ') + name }),
    h('span', { text: 'Wird nur jetzt angezeigt. Am einfachsten schickst du den Link, er meldet die Person sofort an. Wer den Link hat, hat Zugang: nur an die richtige Person senden.' }),
    h('div', { class: 'keybox', text: code }),
    h('div', { class: 'kbar' }, h('button', { class: 'btn', text: 'Link kopieren', onclick: () => kopieren(link, 'Link kopiert') }), h('button', { class: 'btn', text: 'Schlüssel kopieren', onclick: () => kopieren(code, 'Schlüssel kopiert') }))));
}

start();
