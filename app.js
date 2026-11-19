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
  einst: { standardwert: 40, zaehlt_ab: 'veraltet' }, esig: '',
  f: { status: 'alle', q: '', state: 'alle', haken: 'alle', sort: 'neu' },
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
function normState(s) {
  if (s == null) return null;
  const t = String(s).trim(); if (!t) return null;
  const up = t.toUpperCase(); if (STATES[up]) return up;
  const low = t.toLowerCase();
  for (const [k, v] of Object.entries(STATES)) if (v.toLowerCase() === low) return k;
  return t;
}
function normStatus(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return null;
  if (['erledigt', 'gruen', 'grün', 'green', 'fertig', 'done'].includes(t)) return 'erledigt';
  if (['zu erledigen', 'zu_erledigen', 'offen', 'open', 'in arbeit', 'in_arbeit', 'problem'].includes(t)) return 'zu_erledigen';
  if (['übernommen', 'uebernommen', 'veraltet', 'alt', 'outdated', 'old'].includes(t)) return 'veraltet';
  if (['test', 'testen', 'probe'].includes(t)) return 'test';
  if (['leer', 'kein auftrag', 'leer, kein auftrag', 'blank', 'neu', 'new'].includes(t)) return 'leer';
  return null;
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
function avatar(n, big) { let x = 0; for (const c of String(n)) x = (x * 31 + c.charCodeAt(0)) % 6; return h('div', { class: 'av av' + x + (big ? ' big' : ''), 'aria-hidden': 'true', text: initialen(n) }); }

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
/* 'exakt' = gleicher Name (auch mit vertauschter Reihenfolge), 'aehnlich' = Tippfehler oder gleicher Nachname mit aehnlichem Vornamen */
function aehnlich(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return null;
  if (na === nb) return 'exakt';
  const A = toks(a), B = toks(b);
  const sa = A.slice().sort().join(' '), sb = B.slice().sort().join(' ');
  if (sa === sb) return 'exakt';
  const lim = Math.max(na.length, nb.length) <= 8 ? 1 : 2;
  if (lev(na, nb) <= lim || lev(sa, sb) <= lim) return 'aehnlich';
  if (A.length >= 2 && B.length >= 2) {
    const fa = A[0], fb = B[0], la = A[A.length - 1], lb = B[B.length - 1];
    if (la === lb && (fa === fb || fa.startsWith(fb) || fb.startsWith(fa) || lev(fa, fb) <= 2)) return 'aehnlich';
    if (fa === fb && lev(la, lb) <= 2) return 'aehnlich';
  }
  return null;
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
    S.me = r.ich; S.stand = r.stand; S.online = true;
    const sig = JSON.stringify(r.personen), esig = JSON.stringify(r.einstellungen || null);
    const changed = sig !== S.sig || esig !== S.esig;
    S.personen = r.personen; S.sig = sig; S.esig = esig;
    if (r.einstellungen) S.einst = r.einstellungen;
    if (first || !$('#rows')) aufbau(); else { setSub(); if (changed) zeichne(); }
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
  const app = $('#app'); app.textContent = '';
  const side = h('aside', { class: 'side', 'aria-label': 'Filter' },
    h('div', { class: 'side-brand' }, logoImg(30), h('span', { class: 'side-title', text: 'Adress-Tracker' })),
    h('div', { class: 'side-scroll' },
      h('button', { class: 'nav-item', onclick: uebersichtSheet }, ic('sum'), h('span', { class: 'nl', text: 'Übersicht und Wert' })),
      h('div', { class: 'side-label', text: 'Stufe' }), h('div', { id: 'sideStatus' }),
      h('div', { class: 'side-label', text: 'Dazurechnen' }), h('div', { id: 'sideHaken' }),
      h('div', { class: 'side-label', text: 'State' }), h('div', { id: 'sideStates' })),
    h('button', { class: 'side-me', onclick: profilSheet, 'aria-label': 'Profil öffnen' }, avatar(S.me.name),
      h('span', { class: 'me-t' }, h('strong', { text: S.me.name }), h('small', { text: istAdmin() ? 'Admin' : 'Mitarbeiter' })), ic('chevron')));

  const search = h('div', { class: 'search' }, ic('search'),
    h('input', { id: 'q', type: 'search', placeholder: 'E-Mail-Adresse suchen', 'aria-label': 'Suchen nach E-Mail-Adresse, Name, Adressnummer, Nummer oder Adresse', value: S.f.q, autocomplete: 'off', oninput: e => { S.f.q = e.target.value; zeichne(); } }));
  const sortSel = h('select', { class: 'btn sortsel only-desk', 'aria-label': 'Sortierung', onchange: e => { S.f.sort = e.target.value; zeichne(); } },
    ...SORTS.map(([v, t]) => h('option', { value: v, text: t })));
  sortSel.value = S.f.sort;
  const topbar = h('header', { class: 'topbar' },
    h('div', { class: 'tb-row' },
      h('div', { class: 'tb-title' }, h('h1', { id: 'title', text: 'Personen' }), h('div', { class: 'sub', id: 'sub' })),
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
  items.push({ label: 'Übersicht und Wert', icon: 'sum', fn: uebersichtSheet });
  if (istAdmin()) items.push({ label: 'Liste einfügen', icon: 'list', fn: importSheet }, { label: 'CSV laden', icon: 'down', fn: exportCsv }, { label: 'Zugänge', icon: 'people', fn: zugaengeSheet }, '-');
  items.push({ label: 'Profil', icon: 'person', fn: profilSheet });
  popMenu(anchor, items);
}

/* ------------------------------------------------------------------ Filter, Sortierung, Liste */
function passtOhneStatus(p) {
  const f = S.f;
  if (f.haken === 'offen' && p.zaehlt) return false;
  if (f.haken === 'ja' && !p.zaehlt) return false;
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
  const n = S.lastN, total = S.personen.length;
  el.textContent = '';
  el.append(h('span', { text: n === total ? total + (total === 1 ? ' Person' : ' Personen') : n + ' von ' + total }),
    h('span', { class: 'dot' + (S.online ? '' : ' off'), 'aria-hidden': 'true' }),
    h('span', { text: S.online ? 'Live, Stand ' + new Date(S.stand).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : 'Keine Verbindung' }));
}
function zeichne() {
  const base = S.personen.filter(passtOhneStatus);
  const cnt = { alle: base.length, ...Object.fromEntries(STATUS.map(s => [s.k, 0])) };
  base.forEach(p => { if (p.status in cnt) cnt[p.status]++; });
  const rows = sortiere(base.filter(p => S.f.status === 'alle' || p.status === S.f.status));
  S.lastN = rows.length;
  $('#title').textContent = S.f.status === 'alle' ? 'Personen' : STATUS_L[S.f.status];
  setSub();

  // Seitenleiste
  const ss = $('#sideStatus'); ss.textContent = '';
  ss.append(navItem('Alle', cnt.alle, S.f.status === 'alle', () => { S.f.status = 'alle'; zeichne(); }, ''));
  STATUS.forEach(s => ss.append(navItem(s.l, cnt[s.k], S.f.status === s.k, () => { S.f.status = s.k; zeichne(); }, s.k)));
  const sh = $('#sideHaken'); sh.textContent = '';
  [['alle', 'Alle'], ['offen', 'Nicht dazugerechnet'], ['ja', 'Dazugerechnet']].forEach(([k, l]) => sh.append(navItem(l, null, S.f.haken === k, () => { S.f.haken = k; zeichne(); })));
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
  const b = (S.f.state !== 'alle') + (S.f.haken !== 'alle');
  const badge = $('#fbadge'); if (badge) { badge.hidden = !b; badge.textContent = b; }

  // Zeilen
  const box = $('#rows'); box.textContent = '';
  if (!S.personen.length) {
    box.append(h('div', { class: 'group' }, h('div', { class: 'empty' }, h('h2', { text: 'Noch keine Personen' }),
      h('p', { text: 'Lege die erste Person an. Es reicht ein einziges Feld, zum Beispiel nur die E-Mail oder nur die Nummer. Den Rest trägst du später nach.' }),
      h('button', { class: 'btn pri', onclick: () => personSheet(null) }, ic('plus'), 'Person hinzufügen'))));
    return;
  }
  if (!rows.length) {
    box.append(h('div', { class: 'group' }, h('div', { class: 'empty' }, h('h2', { text: 'Nichts gefunden' }), h('p', { text: 'Kein Eintrag passt zu den gewählten Filtern.' }),
      h('button', { class: 'btn', text: 'Filter zurücksetzen', onclick: () => { S.f = { status: 'alle', q: '', state: 'alle', haken: 'alle', sort: S.f.sort }; $('#q').value = ''; zeichne(); } }))));
    return;
  }
  const grp = h('div', { class: 'group' }, h('div', { class: 'colhead' }, h('span'), h('span', { text: 'Person' }), h('span', { text: 'State' }), h('span', { text: 'Stufe' }), h('span', { text: 'Zuletzt' })));
  rows.forEach(p => grp.append(zeile(p)));
  box.append(grp, h('div', { class: 'foot', text: rows.length + ' von ' + S.personen.length + ' angezeigt, ' + S.personen.filter(p => p.zaehlt).length + ' dazugerechnet' }));
}
function zeile(p) {
  const tv = titelVon(p);
  const stsel = h('select', { class: 'pillsel', 'data-s': p.status, 'aria-label': 'Stufe von ' + tv.t, onchange: e => quick(p.id, { status: e.target.value }) },
    ...STATUS.map(s => h('option', { value: s.k, text: s.l })));
  stsel.value = p.status;
  const sub = h('div', { class: 'subline' },
    tv.k === 'nummer' ? null : p.nummer ? h('span', { class: 'ph', text: p.nummer }) : h('span', { class: 'none', text: 'Nummer fehlt' }),
    tv.k === 'email' ? null : p.email ? h('span', { text: p.email }) : h('span', { class: 'none', text: 'E-Mail fehlt' }),
    p.adresse && tv.k !== 'adresse' ? h('span', { text: p.adresse }) : null,
    p.zustaendig ? h('span', { text: 'Zuständig: ' + p.zustaendig }) : null);
  const subm = h('div', { class: 'sub-m', text: [p.state ? p.state + (STATES[p.state] ? ' · ' + STATES[p.state] : '') : 'Ohne State'].join(' · ') });
  return h('div', { class: 'row', 'data-id': p.id },
    h('label', { class: 'cb' }, h('input', { class: 'cbx', type: 'checkbox', checked: !!p.zaehlt, 'aria-label': 'Dazurechnen: ' + tv.t, title: 'Dazurechnen', onchange: e => quick(p.id, { zaehlt: e.target.checked }) })),
    h('div', { class: 'c-main' }, h('div', { class: 'nmline' }, h('button', { class: 'nm', text: tv.t, onclick: () => personSheet(p.id) }), p.adressnummer ? h('span', { class: 'nr', title: 'Adressnummer', text: 'Nr. ' + p.adressnummer }) : null, p.dateien ? h('span', { class: 'nr', title: 'Dateien', text: p.dateien + (p.dateien === 1 ? ' Datei' : ' Dateien') }) : null), sub, subm),
    p.state ? h('div', { class: 'c-state', title: STATES[p.state] || p.state, text: p.state }) : h('div', { class: 'c-state leer', text: 'ohne' }),
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
  const selO = h('select', { id: 'f-sort', 'aria-label': 'Sortierung', onchange: e => { S.f.sort = e.target.value; zeichne(); } }, ...SORTS.map(([v, t]) => h('option', { value: v, text: t })));
  selO.value = S.f.sort;
  const sh = sheetEl('Filter', h('div', { class: 'sheet-b' },
    h('div', { class: 'fg' }, h('label', { class: 'fr' }, h('span', { class: 'fl', text: 'State' }), selS), h('label', { class: 'fr' }, h('span', { class: 'fl', text: 'Dazurechnen' }), selH), h('label', { class: 'fr' }, h('span', { class: 'fl', text: 'Sortierung' }), selO)),
    h('button', { class: 'btn', text: 'Zurücksetzen', onclick: () => { S.f = { status: 'alle', q: S.f.q, state: 'alle', haken: 'alle', sort: 'neu' }; zeichne(); sh.__close(); } })),
    { left: h('button', { class: 'tbtn', text: 'Schließen', onclick: () => sh.__close() }), right: h('button', { class: 'tbtn strong', text: 'Fertig', onclick: () => sh.__close() }) });
  oeffne(sh, true);
}

/* ---------- Person anlegen und bearbeiten */
function frow(label, control, extra, tall) {
  return h('label', { class: 'fr' + (tall ? ' tall' : '') }, h('span', { class: 'fl', text: label }), control, extra || null);
}
function personSheet(id) {
  const neu = id == null;
  const p = neu ? { name: '', adressnummer: '', state: null, nummer: '', email: '', adresse: '', status: 'leer', zaehlt: false, wert: null, zustaendig: '', notiz: '' } : S.personen.find(x => x.id === id);
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

  const relevant = () => neu || name.value.trim() !== p.name || email.value.trim() !== (p.email || '') || nummer.value.trim() !== (p.nummer || '') || anr.value.trim() !== (p.adressnummer || '');
  function treffer() {
    if (!relevant()) return [];
    const n = name.value.trim(), em = email.value.trim().toLowerCase(), ph = nummer.value.replace(/\D/g, ''), an = anr.value.trim().toLowerCase();
    const out = [];
    for (const x of S.personen) {
      if (x.id === id) continue;
      const gruende = []; const a = n ? aehnlich(n, x.name) : null;
      if (a === 'exakt') gruende.push('Name gleich'); else if (a) gruende.push('Name sehr ähnlich');
      if (em && x.email && x.email.toLowerCase() === em) gruende.push('Gleiche E-Mail');
      if (ph.length >= 7 && x.nummer && x.nummer.replace(/\D/g, '') === ph) gruende.push('Gleiche Nummer');
      if (an && x.adressnummer && x.adressnummer.trim().toLowerCase() === an) gruende.push('Gleiche Adressnummer');
      if (gruende.length) out.push({ p: x, gruende, exakt: a === 'exakt' });
    }
    out.sort((a, b) => (b.exakt - a.exakt) || (b.gruende.length - a.gruende.length));
    return out.slice(0, 3);
  }
  function zeigeWarnung(list) {
    warnBox.textContent = ''; warnBox.hidden = !list.length; if (!list.length) return;
    const mine = { name: name.value.trim(), adressnummer: anr.value.trim(), state: st.value, nummer: nummer.value.trim(), email: email.value.trim(), adresse: adresse.value.trim(), status: status.value };
    warnBox.append(h('h3', { text: list.some(t => t.exakt) ? 'Diese Person gibt es schon' : 'Diese Person gibt es vielleicht schon' }),
      h('p', { text: 'Bitte vergleiche beide. Wenn du trotzdem sicherst, steht die Person doppelt in der Liste.' }));
    list.forEach(t => {
      const x = t.p;
      const val = (k, a, b) => { const same = a && b && norm(a) === norm(b); return [h('div', { class: 'v' + (same ? ' same' : (a || b ? ' diff' : '')), text: a || '–' }), h('div', { class: 'v' + (same ? ' same' : (a || b ? ' diff' : '')), text: b || '–' })]; };
      const rows = [['Name', mine.name, x.name], ['Adressnr.', mine.adressnummer, x.adressnummer || ''], ['State', mine.state, x.state || ''], ['Nummer', mine.nummer, x.nummer || ''], ['E-Mail', mine.email, x.email || ''], ['Adresse', mine.adresse, x.adresse || ''], ['Stufe', STATUS_L[mine.status], STATUS_L[x.status]]];
      const grid = h('div', { class: 'cmp' }, h('div', { class: 'h' }), h('div', { class: 'h', text: 'Dein Eintrag' }), h('div', { class: 'h', text: 'Schon in der Liste' }));
      rows.forEach(([k, a, b]) => grid.append(h('div', { class: 'k', text: k }), ...val(k, a, b)));
      warnBox.append(h('div', { class: 'cmp-card' },
        h('div', { class: 'cmp-top' }, ...t.gruende.map(g => h('span', { class: 'tag', text: g }))),
        grid,
        h('div', { class: 'meta', text: 'Angelegt von ' + (x.erstellt_von || 'unbekannt') + ', ' + rel(x.erstellt) }),
        h('div', { class: 'warn-actions' }, h('button', { class: 'btn sm', type: 'button', text: 'Vorhandene öffnen', onclick: () => { sh.__close(); personSheet(x.id); } }))));
    });
    warnBox.append(h('div', { class: 'warn-actions' }, h('button', { class: 'btn', type: 'button', text: 'Zurück zum Bearbeiten', onclick: () => { name.focus(); } })));
  }
  function pruefeLive() {
    const list = treffer();
    if (bestaetigt) { bestaetigt = false; setLabel('Sichern', false); warnBox.hidden = true; }
    if (list.length) { soft.hidden = false; soft.textContent = 'Ähnlich in der Liste: ' + list.map(t => titel(t.p) + (t.p.state ? ' (' + t.p.state + ')' : '')).join(', '); }
    else soft.hidden = true;
  }
  let tmr = null; const live = () => { clearTimeout(tmr); tmr = setTimeout(pruefeLive, 250); };
  [name, email, nummer, anr].forEach(el => el.addEventListener('input', live));

  const sichern = h('button', { class: 'tbtn strong', type: 'button', text: 'Sichern' });
  const fuss = h('button', { class: 'btn pri big', type: 'button', text: 'Sichern', onclick: () => sichern.click() });
  function setLabel(t, warn) { sichern.textContent = t; sichern.classList.toggle('warn', warn); fuss.textContent = t; fuss.classList.toggle('warnbtn', warn); }
  sichern.addEventListener('click', async () => {
    err.textContent = '';
    const nm = name.value.trim();
    if (![nm, anr.value, st.value, nummer.value, email.value, adresse.value, zust.value, notiz.value].some(v => v && v.trim())) { err.textContent = 'Bitte mindestens ein Feld ausfüllen.'; name.focus(); return; }
    const wz = wert.value.trim() === '' ? null : parseEuro(wert.value);
    if (Number.isNaN(wz)) { err.textContent = 'Bitte beim Wert eine Zahl eintragen, zum Beispiel 40 oder 35,50.'; wert.focus(); return; }
    const list = treffer();
    if (list.length && !bestaetigt) {
      zeigeWarnung(list); bestaetigt = true; setLabel('Trotzdem sichern', true);
      warnBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return;
    }
    const neuF = { name: nm, adressnummer: anr.value.trim(), state: st.value || null, nummer: nummer.value.trim(), email: email.value.trim(), adresse: adresse.value.trim(), status: status.value, zaehlt: haken.checked, wert: wz, zustaendig: zust.value.trim(), notiz: notiz.value.trim() };
    let felder = {};
    if (neu) { for (const [k, v] of Object.entries(neuF)) if (v !== '' && v !== null && !(k === 'zaehlt' && v === false) && !(k === 'status' && v === 'leer')) felder[k] = v; }
    else {
      for (const [k, v] of Object.entries(neuF)) { const o = p[k] == null ? (k === 'zaehlt' ? false : '') : p[k]; const n = v == null ? '' : v; if (o !== n) felder[k] = v; }
      if (!Object.keys(felder).length) { sh.__close(); return; }
    }
    sichern.disabled = true; fuss.disabled = true;
    try {
      const r = await enqueue(id || 'neu', () => rpc('tr_person_speichern', { p_code: S.code, p_id: id, p_felder: felder }));
      einsetzen(r); sh.__close(); zeichne(); toast(neu ? 'Person angelegt' : 'Gespeichert');
      if (neu && bereich.wartend()) {
        const u = await bereich.hochladen(r.id); await laden(false);
        toast(u.fehler ? u.ok + ' Dateien gespeichert, ' + u.fehler + ' nicht: ' + u.grund : u.ok + (u.ok === 1 ? ' Datei hochgeladen' : ' Dateien hochgeladen'), !!u.fehler);
      }
    } catch (e) { err.textContent = fehlertext(e); sichern.disabled = false; fuss.disabled = false; if (e.message === 'nicht_gefunden') laden(false); }
  });

  let armed = false;
  const del = istAdmin() && !neu ? h('div', { class: 'fg' }, h('button', { class: 'btn red', type: 'button', text: 'Person löschen', onclick: async (ev) => {
    if (!armed) { armed = true; ev.target.classList.add('armed'); ev.target.textContent = 'Wirklich löschen? Nochmal tippen'; return; }
    ev.target.disabled = true;
    try { await rpc('tr_person_loeschen', { p_code: S.code, p_id: id }); S.personen = S.personen.filter(x => x.id !== id); S.sig = JSON.stringify(S.personen); sh.__close(); zeichne(); toast('Gelöscht'); }
    catch (e) { err.textContent = fehlertext(e); ev.target.disabled = false; }
  } })) : null;

  const body = h('div', { class: 'sheet-b' },
    warnBox,
    h('div', { class: 'fg' }, frow('Name', name), soft, frow('Adressnr.', anr), frow('State', st)),
    h('div', { class: 'fg' }, frow('Stufe', status), frow('Wert (€)', wert), h('label', { class: 'fr sw-row' }, h('span', { class: 'fl', text: 'Dazurechnen' }), haken)),
    h('div', { class: 'fg' }, frow('Nummer', nummer, cp(() => nummer.value)), frow('E-Mail', email, cp(() => email.value)), frow('Adresse', adresse, cp(() => adresse.value), true)),
    h('div', { class: 'fg' }, frow('Zuständig', zust), frow('Notiz', notiz, null, true)),
    h('div', null, h('div', { class: 'fg-t', text: 'Dateien und Fotos' }), bereich.el),
    !neu && p.geaendert_von ? h('p', { class: 'meta', text: 'Zuletzt geändert von ' + p.geaendert_von + ', ' + rel(p.geaendert) + '. Angelegt von ' + (p.erstellt_von || 'unbekannt') + '.' }) : null,
    err, del);
  const sh = sheetEl(neu ? 'Neue Person' : 'Person', body, { left: h('button', { class: 'tbtn', type: 'button', text: 'Abbrechen', onclick: () => sh.__close() }), right: sichern, foot: fuss });
  oeffne(sh, false);
  (neu ? name : status).focus();
}

/* ---------- Dateien an einer Person (Klicken oder Reinziehen) */
const DATEI_MAX = 5 * 1024 * 1024, DATEI_ANZ = 20;
const BILD_OK = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
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
    h('strong', { text: 'Dateien oder Fotos hinzufügen' }), h('span', { text: 'Hier tippen oder Dateien hineinziehen. Bis 5 MB je Datei, Fotos werden verkleinert.' }));
  const el = h('div', { class: 'fg dz-box' }, zone, input, grid, msg);

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
    msg.textContent = '';
    for (const f of files) {
      if (liste.length + wartend.length + laeuft >= DATEI_ANZ) { msg.textContent = FEHLER.zu_viele_dateien; break; }
      if (f.size > DATEI_MAX && !f.type.startsWith('image/')) { msg.textContent = '"' + f.name + '": ' + FEHLER.datei_zu_gross; continue; }
      if (!personId) { wartend.push(f); zeige(); continue; }
      laeuft++; zeige();
      try { liste.push(await dateiHochladen(personId, f)); } catch (e) { msg.textContent = '"' + f.name + '": ' + fehlertext(e); }
      laeuft--; zeige();
    }
    if (personId) laden(false);
  }
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { const f = [...input.files]; input.value = ''; neue(f); });
  ['dragenter', 'dragover'].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.add('over'); }));
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); neue([...(e.dataTransfer ? e.dataTransfer.files : [])]); });
  if (personId) {
    grid.append(h('p', { class: 'hint', text: 'Lädt ...' }));
    rpc('tr_dateien', { p_code: S.code, p_person: personId }).then(r => { liste = r; zeige(); }).catch(e => { grid.textContent = ''; msg.textContent = fehlertext(e); });
  }
  return {
    el,
    wartend: () => wartend.length > 0,
    async hochladen(id) {
      let ok = 0, fehler = 0, grund = '';
      for (const f of wartend) { try { await dateiHochladen(id, f); ok++; } catch (e) { fehler++; grund = fehlertext(e); } }
      wartend = []; return { ok, fehler, grund };
    },
  };
}
/* Dateien, die auf die Seite fallen, sollen nie die Seite verlassen. */
['dragover', 'drop'].forEach(t => window.addEventListener(t, e => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) e.preventDefault(); }));

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
function uebersichtSheet() {
  const P = S.personen;
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
  const sh = sheetEl('Übersicht und Wert', h('div', { class: 'sheet-b' },
    h('div', { class: 'ue-grid' },
      karte('main', 'Angekommen', eur(summe(jetzt)), jetzt.length + (jetzt.length === 1 ? ' Person' : ' Personen')),
      karte('', 'Angehakt, wartet noch', eur(summe(wartet)), wartet.length + (wartet.length === 1 ? ' Person' : ' Personen') + ', zählt ab ' + abL),
      karte('', 'Nicht dazugerechnet', String(nein.length), nein.length === 1 ? 'Person bekommt keinen Wert' : 'Personen bekommen keinen Wert')),
    h('div', { class: 'fg table-wrap' }, tb),
    h('p', { class: 'hint', text: 'Standardwert ' + eur(S.einst.standardwert) + ' je Person, zählt ab Stufe "' + abL + '", und nur bei Personen mit "Dazurechnen". ' + P.length + (P.length === 1 ? ' Person' : ' Personen') + ' insgesamt.' }),
    h('button', { class: 'btn', text: 'Einstellungen ändern', onclick: () => { sh.__close(); profilSheet(); } })),
  { right: h('button', { class: 'tbtn strong', text: 'Fertig', onclick: () => sh.__close() }), wide: true });
  oeffne(sh, true);
}

/* ---------- Liste einfuegen (Admin) */
const HEAD = {
  name: ['name', 'person', 'vorname nachname'], adressnummer: ['adressnummer', 'adress-nummer', 'adressnr', 'adress-nr', 'adress nr', 'adr-nr', 'adrnr'], state: ['state', 'bundesstaat', 'staat'],
  nummer: ['nummer', 'telefon', 'phone', 'tel', 'handy', 'number', 'telefonnummer'], email: ['email', 'e-mail', 'mail'],
  adresse: ['adresse', 'address'], status: ['status'], zustaendig: ['zuständig', 'zustaendig', 'owner', 'verantwortlich'],
  notiz: ['notiz', 'notizen', 'note', 'notes', 'bemerkung'],
};
function parseListe(text) {
  const lines = text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  const rows = [], fehler = [];
  if (!lines.length) return { rows, fehler };
  let d = lines.some(l => l.includes('\t')) ? '\t' : lines.some(l => l.includes(';')) ? ';' : null;
  let cols = ['name', 'state', 'nummer', 'email', 'adresse'], start = 0;
  const fd = d || (lines[0].includes(',') ? ',' : null);
  if (fd) {
    const cells = lines[0].split(fd).map(x => x.trim().replace(/^"|"$/g, '').toLowerCase());
    if (cells.some(c => HEAD.name.includes(c))) { cols = cells.map(c => Object.keys(HEAD).find(k => HEAD[k].includes(c)) || null); start = 1; d = fd; }
  }
  for (let i = start; i < lines.length; i++) {
    const cells = (d ? lines[i].split(d) : [lines[i]]).map(x => x.trim().replace(/^"(.*)"$/, '$1'));
    const o = {};
    cols.forEach((c, j) => { if (c && cells[j]) o[c] = cells[j]; });
    if (o.state) o.state = normState(o.state);
    if (o.status) { const s = normStatus(o.status); if (s) o.status = s; else delete o.status; }
    if (!o.name) { fehler.push('Zeile ' + (i + 1) + ': kein Name'); continue; }
    rows.push(o);
  }
  return { rows, fehler };
}
function importSheet() {
  const ta = h('textarea', { id: 'imp', rows: 8, placeholder: 'Anna Beispiel\nBen Muster\n\noder aus Excel oder Sheets kopieren: Name, State, Nummer, E-Mail, Adresse', 'aria-label': 'Liste' });
  const skip = h('input', { id: 'imp-skip', class: 'sw', type: 'checkbox', role: 'switch', checked: true });
  const prev = h('div'); const err = h('p', { class: 'err' });
  const go = h('button', { class: 'tbtn strong', type: 'button', text: 'Einspielen', disabled: true });
  let parsed = { rows: [], fehler: [] };
  ta.addEventListener('input', () => {
    parsed = parseListe(ta.value); prev.textContent = '';
    go.disabled = !parsed.rows.length;
    if (!ta.value.trim()) return;
    const vorhanden = new Set(S.personen.map(x => toks(x.name).sort().join(' ')));
    const schon = parsed.rows.filter(r => vorhanden.has(toks(r.name).sort().join(' '))).length;
    prev.append(h('p', { class: 'hint', text: parsed.rows.length + ' Personen erkannt' + (schon ? ', davon ' + schon + ' schon in der Liste' : '') + (parsed.fehler.length ? ', ' + parsed.fehler.length + ' Zeilen ohne Name übersprungen' : '') + '. Vorschau der ersten 5:' }));
    const tb = h('table', { class: 'pv' }, h('thead', null, h('tr', null, ...['Name', 'State', 'Nummer', 'E-Mail', 'Adresse', 'Stufe'].map(t => h('th', { text: t })))));
    const body = h('tbody'); parsed.rows.slice(0, 5).forEach(r => body.append(h('tr', null, ...['name', 'state', 'nummer', 'email', 'adresse', 'status'].map(k => h('td', { text: r[k] ? (k === 'status' ? STATUS_L[r[k]] : r[k]) : '' })))));
    tb.append(body); prev.append(h('div', { class: 'fg table-wrap' }, tb));
  });
  go.addEventListener('click', async () => {
    err.textContent = ''; go.disabled = true; let neu = 0, ueb = 0;
    try {
      for (let i = 0; i < parsed.rows.length; i += 200) {
        const r = await rpc('tr_import', { p_code: S.code, p_zeilen: parsed.rows.slice(i, i + 200), p_doppelte_ueberspringen: skip.checked });
        neu += r.neu; ueb += r.uebersprungen;
      }
      await laden(false); sh.__close(); toast(neu + ' Personen eingespielt' + (ueb ? ', ' + ueb + ' Doppelte übersprungen' : ''));
    } catch (e) { err.textContent = fehlertext(e) + (neu ? ' (' + neu + ' waren schon drin)' : ''); go.disabled = false; laden(false); }
  });
  const sh = sheetEl('Liste einfügen', h('div', { class: 'sheet-b' },
    h('p', { class: 'hint', text: 'Eine Person pro Zeile. Nur Namen geht. Mit mehreren Spalten (Tab, Semikolon, oder Komma mit Kopfzeile) gilt die Reihenfolge Name, State, Nummer, E-Mail, Adresse. Oder die Kopfzeile bestimmt die Spalten (Name, State, Nummer, E-Mail, Adresse, Status, Zuständig, Notiz).' }),
    h('div', { class: 'fg' }, h('label', { class: 'fr one' }, ta)),
    h('div', { class: 'fg' }, h('label', { class: 'fr sw-row' }, h('span', { class: 'fl', text: 'Namen überspringen, die schon in der Liste sind' }), skip)),
    prev, err), { wide: true, left: h('button', { class: 'tbtn', type: 'button', text: 'Abbrechen', onclick: () => sh.__close() }), right: go });
  oeffne(sh, false); ta.focus();
}

/* ---------- CSV (Admin) */
function exportCsv() {
  const sicher = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const kopf = ['Name', 'Adressnummer', 'State', 'Nummer', 'E-Mail', 'Adresse', 'Stufe', 'Dazurechnen', 'Wert', 'Zuständig', 'Notiz', 'Angelegt von', 'Geändert von', 'Geändert'];
  const zeilen = sortiere(S.personen).map(p => [p.name, p.adressnummer, p.state, p.nummer, p.email, p.adresse, STATUS_L[p.status], p.zaehlt ? 'ja' : 'nein', p.wert == null ? '' : String(p.wert).replace('.', ','), p.zustaendig, p.notiz, p.erstellt_von, p.geaendert_von, p.geaendert ? new Date(p.geaendert).toLocaleString('de-DE') : ''].map(sicher).join(';'));
  const blob = new Blob(['﻿' + [kopf.map(sicher).join(';'), ...zeilen].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'adress-tracker-' + heute() + '.csv' });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
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
  const body = h('div', { class: 'sheet-b' },
    h('div', { class: 'prof' }, avatar(S.me.name, true), h('strong', { text: S.me.name }), h('span', { class: 'pill' + (admin ? ' adm' : ''), text: admin ? 'Admin' : 'Mitarbeiter' })),
    h('div', { class: 'fg' }, frow('Name', name)),
    h('button', { class: 'btn', text: 'Namen speichern', onclick: speichern }),
    h('p', { class: 'hint', text: 'Dein Name steht bei jeder Änderung, die du machst. Alle Angemeldeten sehen dieselbe Liste, Änderungen erscheinen bei allen nach wenigen Sekunden. Teilen sich mehrere Leute einen Zugang, gilt der Name für alle.' }),
    ...einstellungenBlock(err),
    admin ? h('div', { class: 'kbar' },
      h('button', { class: 'btn', text: 'Leute hinzufügen', onclick: () => { sh.__close(); zugaengeSheet(); } }),
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
const AKTION = { neu: 'Person angelegt', aendern: 'Person geändert', loeschen: 'Person gelöscht', import: 'Liste eingespielt', einrichten: 'Einrichtung', zugang_neu: 'Zugang angelegt', zugang_gesperrt: 'Zugang gesperrt', zugang_entsperrt: 'Zugang entsperrt', zugang_neuer_code: 'Neuer Schlüssel', zugang_admin: 'Zum Admin gemacht', zugang_mitarbeiter: 'Zum Mitarbeiter gemacht', profil: 'Name geändert', zugang_umbenannt: 'Zugang umbenannt', einstellung: 'Einstellung geändert', datei_neu: 'Datei hinzugefügt', datei_weg: 'Datei gelöscht' };
function zugaengeSheet() {
  const body = h('div', { class: 'sheet-b' });
  let tab = 'zugang';
  const t1 = h('button', { role: 'tab', text: 'Wer hat Zugang', onclick: () => { tab = 'zugang'; fuell(); } });
  const t2 = h('button', { role: 'tab', text: 'Protokoll', onclick: () => { tab = 'protokoll'; fuell(); } });
  const sh = sheetEl('Zugänge', body, { wide: true, right: h('button', { class: 'tbtn strong', text: 'Fertig', onclick: () => sh.__close() }) });
  oeffne(sh, true);
  async function fuell() {
    t1.setAttribute('aria-selected', String(tab === 'zugang')); t2.setAttribute('aria-selected', String(tab === 'protokoll'));
    body.textContent = ''; body.append(h('div', { class: 'segc', role: 'tablist' }, t1, t2), h('p', { class: 'hint', text: 'Lädt ...' }));
    try {
      if (tab === 'zugang') {
        const z = await rpc('tr_zugaenge', { p_code: S.code });
        body.textContent = ''; body.append(h('div', { class: 'segc', role: 'tablist' }, t1, t2));
        const nm = h('input', { id: 'z-name', placeholder: 'Name der Person', maxlength: 100, autocomplete: 'off', autocapitalize: 'words', 'aria-label': 'Name der Person' });
        const ro = h('select', { id: 'z-rolle', 'aria-label': 'Rolle' }, h('option', { value: 'mitarbeiter', text: 'Mitarbeiter' }), h('option', { value: 'admin', text: 'Admin' }));
        const out = h('div', { 'data-out': '' }); const er = h('p', { class: 'err' });
        const anlegen = async (ev) => {
          er.textContent = ''; if (!nm.value.trim()) { er.textContent = 'Bitte einen Namen eintragen.'; nm.focus(); return; }
          ev.target.disabled = true;
          try { const r = await rpc('tr_zugang_anlegen', { p_code: S.code, p_name: nm.value.trim(), p_rolle: ro.value }); await fuell(); zeigeSchluessel(body.querySelector('[data-out]'), r.name, r.code); }
          catch (e) { er.textContent = fehlertext(e); ev.target.disabled = false; }
        };
        const addBtn = h('button', { class: 'btn pri', text: 'Person hinzufügen', onclick: anlegen });
        nm.addEventListener('keydown', e => { if (e.key === 'Enter') anlegen({ target: addBtn }); });
        body.append(
          h('div', { class: 'fg-t', text: 'Person hinzufügen' }),
          h('div', { class: 'fg' }, frow('Name', nm), frow('Rolle', ro)),
          addBtn, er, out,
          h('p', { class: 'hint', text: 'Du bekommst einen persönlichen Link für diese Person. Er wird nur einmal angezeigt. Wer ihn öffnet, ist sofort angemeldet und sieht dieselbe Liste wie alle anderen.' }),
          h('div', { class: 'fg-t', text: 'Wer hat Zugang' }));
        const grp = h('div', { class: 'fg' });
        z.forEach(r => grp.append(h('div', { class: 'prow' },
          h('div', { class: 'prow-top' }, avatar(r.name),
            h('div', { class: 'prow-t' }, h('strong', { text: r.name }), h('small', { text: 'Seit ' + new Date(r.erstellt).toLocaleDateString('de-DE') + ', zuletzt online ' + rel(r.zuletzt_gesehen) })),
            h('span', { class: 'pill' + (r.rolle === 'admin' ? ' adm' : ''), text: r.rolle === 'admin' ? 'Admin' : 'Mitarbeiter' }),
            h('span', { class: 'pill ' + (r.gesperrt ? 'bad' : 'ok'), text: r.gesperrt ? 'Gesperrt' : 'Aktiv' })),
          h('div', { class: 'prow-actions' },
            h('button', { class: 'btn sm', text: r.gesperrt ? 'Entsperren' : 'Sperren', onclick: () => aendern(r, r.gesperrt ? 'entsperren' : 'sperren') }),
            h('button', { class: 'btn sm', text: r.rolle === 'admin' ? 'Zu Mitarbeiter' : 'Zu Admin', onclick: async () => {
              try {
                await rpc('tr_zugang_rolle', { p_code: S.code, p_id: r.id, p_rolle: r.rolle === 'admin' ? 'mitarbeiter' : 'admin' });
                if (S.me && r.id === S.me.id) { sh.__close(); await laden(true); } else await fuell();
              } catch (e) { toast(fehlertext(e), true); }
            } }),
            h('button', { class: 'btn sm', text: 'Neuer Schlüssel', onclick: () => aendern(r, 'neuer_code') })))));
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
