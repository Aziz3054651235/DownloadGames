"use strict";

/* =====================================
   DOWNLOADGAMES – script.js
   Passt zu: index.html, style.css, games.js, downloads.js
   Alle Daten liegen in localStorage (Testversion, kein echter Server).
===================================== */

if (typeof games === "undefined" || !Array.isArray(games)) {
    throw new Error("games.js fehlt! Prüfe den Pfad in deiner index.html.");
}

/* ---------- Hilfsfunktionen ---------- */

const $ = id => document.getElementById(id);

function h(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === "class") e.className = v;
        else if (k === "text") e.textContent = v;
        else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
        else e[k] = v;
    }
    kids.flat().forEach(c => { if (c !== null && c !== undefined && c !== false) e.append(c); });
    return e;
}

function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
}

function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.error("Speichern fehlgeschlagen:", key, e); return false; }
}

const safeUrl = u => {
    try {
        const x = new URL(String(u ?? "").trim());
        return x.protocol === "https:" || x.protocol === "http:" ? x.href : "";
    } catch { return ""; }
};
const eur = n => Number(n || 0).toFixed(2).replace(".", ",") + " €";
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- Spielkatalog (games.js + Admin-Änderungen) ---------- */

const baseGames = games.map(g => ({ ...g }));

function normalize(list) {
    const seen = new Set();
    return list.filter(g => g && g.id && !seen.has(g.id) && seen.add(g.id));
}

const storedGames = load("dg_games_custom", null);
games.splice(0, games.length, ...normalize(Array.isArray(storedGames) ? storedGames : baseGames));

const saveGames = () => save("dg_games_custom", games);

/* ---------- Daten ---------- */

let accounts = load("dg_accounts", {});
let comments = load("dg_comments", {});
let keys = load("dg_keys", []);
let cart = load("dg_cart", []);
let currentUser = load("dg_currentUser", null);

if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) accounts = {};
if (!comments || typeof comments !== "object" || Array.isArray(comments)) comments = {};
if (!Array.isArray(keys)) keys = [];
if (!Array.isArray(cart)) cart = [];

Object.values(accounts).forEach(a => {
    a.points = Number(a.points) || 0;
    a.purchasedGames = Array.isArray(a.purchasedGames) ? a.purchasedGames : [];
    a.history = Array.isArray(a.history) ? a.history : [];
    a.role = a.role || "user";
});
if (currentUser && !accounts[currentUser]) currentUser = null;

/* ADMIN: Nur diese E-Mail darf den Admin-Zugang einrichten.
   Das Passwort steht nirgends im Code, es wird beim ersten Admin-Login
   gehasht im Browser gespeichert. */
const ADMIN_EMAIL = "azizdjebbitn@gmail.com";   // <- HIER DEINE E-MAIL EINTRAGEN, z. B. "name@mail.de"
let adminAcc = load("dg_admin", null);

let selectedGame = null;
let isAdmin = false;
let view = "store";
let genreFilter = "";
let editingGame = null;

const me = () => (currentUser ? accounts[currentUser] : null);
const owned = id => !!me()?.purchasedGames.includes(id);
const canDownload = g => g && !!g.downloadUrl && (g.free === true || owned(g.id));

function persist() {
    save("dg_accounts", accounts);
    save("dg_comments", comments);
    save("dg_keys", keys);
    save("dg_cart", cart);
    save("dg_currentUser", currentUser);
}

/* ---------- Zusätzliche Styles ---------- */

document.head.append(h("style", { text: `
.nav-btn.active{background:var(--primary-hover)}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px}
.chip{background:var(--surface-light);border:1px solid var(--border);padding:6px 13px;border-radius:20px}
.chip.active{background:var(--primary)}
#detailDescription,#detailInfo{white-space:pre-line}
.req-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:12px 0}
.req-grid table,table.list{width:100%;border-collapse:collapse;font-size:13px}
.req-grid td,table.list td,table.list th{padding:6px;border-bottom:1px solid var(--border);text-align:left}
.req-grid td:first-child{color:var(--muted)}
.shot-main{width:100%;max-height:300px;object-fit:cover;border-radius:9px}
.shots{display:flex;gap:6px;margin:6px 0}
.shots img{width:72px;height:44px;object-fit:cover;border-radius:5px;cursor:pointer;opacity:.6}
.shots img.active{opacity:1;outline:2px solid var(--primary)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.row>*{width:auto;flex:1 1 140px}
.stat{display:inline-block;background:var(--surface-light);padding:12px 18px;border-radius:9px;margin:4px}
.star{color:var(--gold)}
.link{color:var(--primary-hover)}
` }));

/* ---------- Passwörter (PBKDF2 mit Salt) ---------- */

const toHex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");

async function pbkdf2(password, salt) {
    if (!crypto.subtle) throw new Error("Passwortfunktion nicht verfügbar. Bitte HTTPS oder localhost verwenden.");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 150000, hash: "SHA-256" }, key, 256);
    return toHex(bits);
}

async function sha256(password) {
    return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)));
}

async function setPassword(acc, password) {
    acc.salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    acc.hash = await pbkdf2(password, acc.salt);
    delete acc.passwordHash;
}

async function verifyPassword(acc, password) {
    if (acc.salt && acc.hash) return (await pbkdf2(password, acc.salt)) === acc.hash;
    if (acc.passwordHash && (await sha256(password)) === acc.passwordHash) {
        await setPassword(acc, password); // alte Konten automatisch aufrüsten
        persist();
        return true;
    }
    return false;
}

function findUser(identifier) {
    const s = String(identifier || "").trim().toLowerCase();
    return Object.entries(accounts).find(([n, a]) =>
        n.toLowerCase() === s || (a.email && a.email.toLowerCase() === s));
}

/* ---------- Bewertungen ---------- */

function ratingOf(id) {
    const rated = (comments[id] || []).filter(c => c.stars);
    return rated.length
        ? { avg: rated.reduce((s, c) => s + c.stars, 0) / rated.length, count: rated.length }
        : { avg: 0, count: 0 };
}

const popularity = id =>
    Object.values(accounts).filter(a => a.purchasedGames.includes(id)).length + (comments[id] || []).length;

/* ---------- Seitenaufbau (zusätzliche Elemente einfügen) ---------- */

const hero = document.querySelector(".hero");
const titleEl = document.querySelector(".section-title");
const gridEl = $("gameGrid");

const genreBar = h("div", { class: "chips" });
const popularGrid = h("section", { class: "game-grid" });
const newGrid = h("section", { class: "game-grid" });
const popularWrap = h("div", {}, h("h2", { class: "section-title", text: "Beliebte Spiele" }), popularGrid);
const newWrap = h("div", {}, h("h2", { class: "section-title", text: "Neue Spiele" }), newGrid);
const extraView = h("div", { class: "hidden" });

titleEl.before(popularWrap, newWrap);
gridEl.before(genreBar);
gridEl.after(extraView);

const storeEls = [hero, popularWrap, newWrap, titleEl, genreBar, gridEl];

const navBtns = {};
[["store", "Store"], ["library", "Bibliothek"], ["profile", "Profil"]].forEach(([v, label]) => {
    navBtns[v] = h("button", { class: "nav-btn", text: label, onclick: () => setView(v) });
});
document.querySelector(".header-actions").prepend(...Object.values(navBtns));

// Modal: zusätzliche Bereiche
const detailRating = h("p");
const detailExtra = h("div");
$("detailInfo").after(detailRating, detailExtra);
$("commentInput").before(h("select", { id: "ratingSelect" },
    [5, 4, 3, 2, 1].map(n => h("option", { value: String(n), text: "★".repeat(n) + ` (${n})` }))));

// Anmeldefenster: E-Mail-Feld für die Registrierung
$("authUsername").before(h("input", { id: "authEmail", type: "email", placeholder: "E-Mail (nur bei Registrierung)" }));
$("adminId").placeholder = "Admin-E-Mail";
$("adminPassword").placeholder = "Admin-Passwort (beim ersten Mal neu festlegen)";

// Warenkorb: Kauf mit Punkten
$("cartSection").append(h("button", { text: "Mit Punkten kaufen", onclick: checkout }));

// Admin-Bereich
const adminExtra = h("div", { id: "adminExtra" });
document.querySelector(".admin-content").append(adminExtra);

function setView(v) {
    if ((v === "library" || v === "profile") && !currentUser) {
        alert("Bitte zuerst anmelden.");
        showAuthWindow();
        return;
    }
    view = v;
    Object.entries(navBtns).forEach(([k, b]) => b.classList.toggle("active", k === v));
    storeEls.forEach(e => e.classList.toggle("hidden", v !== "store"));
    extraView.classList.toggle("hidden", v === "store");
    if (v === "store") renderStore();
    if (v === "library") renderLibrary();
    if (v === "profile") renderProfile();
    window.scrollTo({ top: 0 });
}

/* =====================================
   PUNKTE
===================================== */

function updatePoints() {
    const out = $("points");
    if (out) out.textContent = Math.floor(me()?.points || 0).toLocaleString("de-DE");
}

// Demo: 100 Punkte alle 10 Sekunden für angemeldete Benutzer (echtes System: Server)
setInterval(() => {
    if (!me()) return;
    me().points += 100;
    updatePoints();
    persist();
}, 10000);

/* =====================================
   STORE
===================================== */

function gameCard(g) {
    const cover = h("div", { class: "game-cover" });
    const img = safeUrl(g.image);

    if (img) {
        cover.append(h("img", {
            src: img, alt: g.name, loading: "lazy", referrerPolicy: "no-referrer",
            onerror: () => { cover.textContent = g.icon || "🎮"; }
        }));
    } else {
        cover.textContent = g.icon || "🎮";
    }

    const r = ratingOf(g.id);
    const meta = [g.genre, g.releaseDate || g.year, g.size].filter(Boolean).join(" · ")
        + (r.count ? ` · ★ ${r.avg.toFixed(1)}` : "");

    return h("article", { class: "game-card" },
        cover,
        h("h3", { text: g.name }),
        h("p", { text: meta }),
        h("p", { text: `${eur(g.price)} · ${g.points} Punkte` }),
        h("button", { text: "Details ansehen", onclick: () => openGame(g.id) }));
}

function fill(container, list, emptyText = "Keine Spiele gefunden.") {
    if (!list.length) { container.textContent = emptyText; return; }
    container.replaceChildren(...list.map(gameCard));
}

function renderStore() {
    const q = ($("searchInput")?.value || "").trim().toLowerCase();

    const filtered = games.filter(g =>
        (!genreFilter || g.genre === genreFilter) &&
        (!q || [g.name, g.genre, g.developer, g.year, g.releaseDate]
            .some(v => String(v ?? "").toLowerCase().includes(q))));

    const genres = [...new Set(games.map(g => g.genre).filter(Boolean))];
    genreBar.replaceChildren(
        h("button", { class: "chip" + (!genreFilter ? " active" : ""), text: "Alle",
            onclick: () => { genreFilter = ""; renderStore(); } }),
        ...genres.map(gn => h("button", { class: "chip" + (genreFilter === gn ? " active" : ""), text: gn,
            onclick: () => { genreFilter = gn; renderStore(); } })));

    const filtering = !!q || !!genreFilter;
    popularWrap.classList.toggle("hidden", filtering || view !== "store");
    newWrap.classList.toggle("hidden", filtering || view !== "store");
    titleEl.textContent = filtering ? `Ergebnisse (${filtered.length})` : "Alle Spiele";

    fill(popularGrid, [...games].sort((a, b) => popularity(b.id) - popularity(a.id)).slice(0, 4));
    fill(newGrid, [...games]
        .sort((a, b) => String(b.releaseDate || b.year).localeCompare(String(a.releaseDate || a.year)))
        .slice(0, 4));
    fill(gridEl, filtered);
}

const renderGames = renderStore;

$("searchInput")?.addEventListener("input", () => {
    if (view !== "store") setView("store"); else renderStore();
});

/* =====================================
   SPIELDETAILS
===================================== */

function reqTable(title, data) {
    const rows = [["Betriebssystem", "os"], ["CPU", "cpu"], ["RAM", "ram"], ["Grafikkarte", "gpu"], ["Speicher", "storage"]];
    return h("div", {}, h("b", { text: title }),
        h("table", {}, rows.map(([label, key]) =>
            h("tr", {}, h("td", { text: label }), h("td", { text: data?.[key] || "–" })))));
}

function updateRating(g) {
    const r = ratingOf(g.id);
    detailRating.textContent = r.count
        ? `Bewertung: ★ ${r.avg.toFixed(1)} (${r.count} ${r.count === 1 ? "Bewertung" : "Bewertungen"})`
        : "Noch keine Bewertungen.";
}

function renderDetailExtra(g) {
    detailExtra.replaceChildren();

    const shots = (Array.isArray(g.screenshots) && g.screenshots.length ? g.screenshots : [g.image])
        .map(safeUrl).filter(Boolean);

    if (shots.length) {
        const main = h("img", { class: "shot-main", src: shots[0], alt: g.name, referrerPolicy: "no-referrer" });
        const thumbs = h("div", { class: "shots" });

        shots.forEach((s, i) => {
            const t = h("img", {
                src: s, alt: "", referrerPolicy: "no-referrer", class: i ? "" : "active",
                onclick: () => {
                    main.src = s;
                    thumbs.querySelectorAll("img").forEach(x => x.classList.remove("active"));
                    t.classList.add("active");
                }
            });
            thumbs.append(t);
        });

        detailExtra.append(main);
        if (shots.length > 1) detailExtra.append(thumbs);
    }

    if (g.requirements) {
        detailExtra.append(h("div", { class: "req-grid" },
            reqTable("Mindestanforderungen", g.requirements.minimum),
            reqTable("Empfohlen", g.requirements.recommended)));
    }

    const links = h("div", { class: "button-row" });

    const store = safeUrl(g.storeUrl);
    if (store) {
        links.append(h("a", { class: "link", href: store, target: "_blank", rel: "noopener noreferrer",
            text: "Offizielle Seite / Shop ↗" }));
    }

    if (g.developer) {
        links.append(h("button", { text: `Mehr von ${g.developer}`, onclick: () => {
            closeGame();
            $("searchInput").value = g.developer;
            setView("store");
        } }));
    }

    detailExtra.append(links);

    if (owned(g.id) && !canDownload(g)) {
        detailExtra.append(h("p", { text: "Für dieses Spiel gibt es hier keinen Direkt-Download. Nutze die offizielle Seite." }));
    }
}

function openGame(id) {
    const g = games.find(x => x.id === id);

    if (!g) { alert("Spiel nicht gefunden."); return; }

    selectedGame = g;

    $("detailTitle").textContent = g.name;
    $("detailDescription").textContent = g.description || "";
    $("detailInfo").textContent = [
        g.genre,
        `Veröffentlicht: ${g.releaseDate || g.year}`,
        g.version && `Version ${g.version}`,
        g.size && `Größe: ${g.size}`,
        g.developer && `Entwickler: ${g.developer}`
    ].filter(Boolean).join(" · ");
    $("detailPrice").textContent = `${eur(g.price)} · ${g.points} Punkte`;

    updateRating(g);
    renderDetailExtra(g);

    const own = owned(g.id);

    $("buyButton").classList.toggle("hidden", own);
    $("cartButton").classList.toggle("hidden", own);
    $("buyButton").onclick = buyGame;
    $("cartButton").onclick = () => addToCart(g.id);

    const dl = $("downloadButton");
    dl.classList.toggle("hidden", !(own && canDownload(g)));
    dl.onclick = () => {
        if (!owned(g.id)) { alert("Du musst dieses Spiel zuerst freischalten."); return; }
        if (typeof startDownload !== "function") { alert("downloads.js wurde nicht geladen."); return; }
        startDownload(g.id);
    };

    $("gameModal").classList.remove("hidden");
    renderComments();
}

function closeGame() {
    $("gameModal").classList.add("hidden");
}

/* =====================================
   KAUFEN
===================================== */

function addHistory(acc, game, cost, type) {
    acc.history.push({ date: new Date().toISOString(), gameId: game.id, name: game.name, cost, type });
}

function buyGame() {
    if (!selectedGame) return;

    if (!me()) { alert("Bitte zuerst anmelden."); showAuthWindow(); return; }
    if (owned(selectedGame.id)) { alert("Du besitzt dieses Spiel bereits!"); return; }

    const price = Number(selectedGame.points);

    if (!Number.isFinite(price) || price < 0) { alert("Ungültiger Spielpreis."); return; }
    if (me().points < price) { alert("Du hast nicht genügend Punkte!"); return; }

    me().points -= price;
    me().purchasedGames.push(selectedGame.id);
    addHistory(me(), selectedGame, price, "Punkte");
    cart = cart.filter(id => id !== selectedGame.id);

    persist();
    updatePoints();
    renderCart();
    alert("Spiel erfolgreich freigeschaltet!");
    openGame(selectedGame.id);
}

/* =====================================
   WARENKORB
===================================== */

function addToCart(id) {
    if (!games.some(g => g.id === id)) return;
    if (cart.includes(id)) { alert("Dieses Spiel ist bereits im Warenkorb."); return; }

    cart.push(id);
    persist();
    renderCart();
    alert("Spiel wurde zum Warenkorb hinzugefügt.");
}

function renderCart() {
    const container = $("cartItems");
    let euro = 0;
    let pts = 0;

    cart = cart.filter(id => games.some(g => g.id === id));
    container.replaceChildren();

    cart.forEach(id => {
        const g = games.find(x => x.id === id);
        euro += Number(g.price) || 0;
        pts += Number(g.points) || 0;

        container.append(h("div", {},
            h("span", { text: `${g.name} – ${eur(g.price)} · ${g.points} Punkte ` }),
            h("button", { text: "Entfernen", onclick: () => {
                cart = cart.filter(x => x !== id);
                persist();
                renderCart();
            } })));
    });

    $("cartTotal").textContent = `${eur(euro)} · ${pts} Punkte`;

    const headerCartBtn = document.querySelector('button[onclick="toggleCart()"]');
    if (headerCartBtn) headerCartBtn.textContent = `🛒 Warenkorb (${cart.length})`;
}

function checkout() {
    if (!me()) { alert("Bitte zuerst anmelden."); showAuthWindow(); return; }

    const items = cart.map(id => games.find(g => g.id === id)).filter(g => g && !owned(g.id));

    if (!items.length) { alert("Der Warenkorb ist leer."); return; }

    const total = items.reduce((s, g) => s + Number(g.points), 0);

    if (me().points < total) { alert("Du hast nicht genügend Punkte!"); return; }

    me().points -= total;
    items.forEach(g => {
        me().purchasedGames.push(g.id);
        addHistory(me(), g, g.points, "Punkte");
    });
    cart = [];

    persist();
    updatePoints();
    renderCart();
    alert("Kauf abgeschlossen!");
    setView("library");
}

function toggleCart() {
    $("cartSection").classList.toggle("hidden");
    renderCart();
}

function clearCart() {
    cart = [];
    persist();
    renderCart();
}

/* =====================================
   KOMMENTARE & BEWERTUNGEN
===================================== */

function renderComments() {
    const box = $("comments");
    box.replaceChildren();

    if (!selectedGame) return;

    const list = comments[selectedGame.id] || [];

    if (!list.length) { box.textContent = "Noch keine Kommentare vorhanden."; return; }

    const moderator = isAdmin;

    list.forEach(c => {
        const p = h("p", {},
            h("b", { text: c.user }), " ",
            c.stars ? h("span", { class: "star", text: "★".repeat(c.stars) }) : "", " ",
            h("small", { text: c.date ? new Date(c.date).toLocaleDateString("de-DE") : "" }),
            h("br"), c.text);

        if (c.user === currentUser) {
            p.append(" ", h("button", { text: "Bearbeiten", onclick: () => {
                $("commentInput").value = c.text;
                if (c.stars) $("ratingSelect").value = String(c.stars);
                $("commentInput").focus();
            } }));
        }

        if (c.user === currentUser || moderator) {
            p.append(" ", h("button", { text: "Löschen", onclick: () => deleteComment(selectedGame.id, c) }));
        }

        box.append(p);
    });
}

function addComment() {
    if (!me()) { alert("Bitte melde dich zuerst an."); return; }
    if (!selectedGame) return;

    const input = $("commentInput");
    const text = input.value.trim();

    if (!text) return;
    if (text.length > 500) { alert("Kommentare dürfen maximal 500 Zeichen lang sein."); return; }

    const list = (comments[selectedGame.id] ??= []);
    const entry = {
        id: uid(), user: currentUser, text,
        stars: Number($("ratingSelect").value) || 0,
        date: new Date().toISOString()
    };

    const i = list.findIndex(c => c.user === currentUser);

    if (i >= 0) list[i] = { ...entry, id: list[i].id || entry.id }; // 1 Bewertung pro Benutzer, wird aktualisiert
    else list.push(entry);

    input.value = "";
    persist();
    renderComments();
    updateRating(selectedGame);
    renderStore();
}

function deleteComment(gameId, comment) {
    if (!confirm("Kommentar wirklich löschen?")) return;

    comments[gameId] = (comments[gameId] || []).filter(c => c !== comment);
    persist();

    if (selectedGame) { renderComments(); updateRating(selectedGame); }
    renderStore();
    if (isAdmin) renderAdminExtra();
}

/* =====================================
   REGISTRIERUNG UND LOGIN
===================================== */

function showAuthWindow() { $("authModal").classList.remove("hidden"); }
function hideAuthWindow() { $("authModal").classList.add("hidden"); }

async function register() {
    const username = $("authUsername").value.trim();
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    const msg = $("authMessage");

    if (username.length < 3 || password.length < 8) {
        msg.textContent = "Benutzername: mind. 3 Zeichen. Passwort: mind. 8 Zeichen.";
        return;
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) { msg.textContent = "Bitte eine gültige E-Mail angeben."; return; }

    if (findUser(username) || findUser(email)) {
        msg.textContent = "Benutzername oder E-Mail ist bereits vergeben.";
        return;
    }

    try {
        const acc = {
            email, points: 0, purchasedGames: [], history: [],
            role: "user",
            created: new Date().toISOString()
        };

        await setPassword(acc, password);
        accounts[username] = acc;
        persist();

        msg.textContent = "Registrierung erfolgreich! Du kannst dich jetzt anmelden.";
    } catch (e) {
        msg.textContent = e.message;
    }
}

async function login() {
    const found = findUser($("authUsername").value);
    const msg = $("authMessage");

    if (!found) { msg.textContent = "Benutzerkonto nicht gefunden."; return; }

    try {
        if (!(await verifyPassword(found[1], $("authPassword").value))) {
            msg.textContent = "Falsches Passwort.";
            return;
        }

        currentUser = found[0];
        persist();
        msg.textContent = "";
        $("authPassword").value = "";
        hideAuthWindow();
        refreshAll();
    } catch (e) {
        msg.textContent = e.message;
    }
}

function logout() {
    currentUser = null;
    isAdmin = false;
    $("adminDashboard").classList.add("hidden");
    persist();
    refreshAll();
}

function updateLoginDisplay() {
    const b = $("loginButton");
    b.textContent = currentUser ? `Logout (${currentUser})` : "Login";
    b.onclick = currentUser ? logout : showAuthWindow;
}

function refreshAll() {
    updatePoints();
    updateLoginDisplay();
    renderCart();
    if ((view === "library" || view === "profile") && !currentUser) view = "store";
    setView(view);
}

/* =====================================
   BIBLIOTHEK
===================================== */

function renderLibrary() {
    const u = me();
    if (!u) return;

    const grid = h("section", { class: "game-grid" });
    fill(grid, games.filter(g => u.purchasedGames.includes(g.id)), "Noch keine Spiele in der Bibliothek.");

    extraView.replaceChildren(
        h("h2", { class: "section-title", text: "Meine Bibliothek" }),
        grid,
        h("div", { class: "panel" },
            h("h3", { text: "Produktschlüssel einlösen" }),
            h("input", { id: "libRedeem", placeholder: "XXXXX-XXXXX-XXXXX-XXXXX" }),
            h("button", { text: "Einlösen", onclick: () => redeemKey("libRedeem", "libRedeemMsg") }),
            h("p", { id: "libRedeemMsg" })));
}

/* =====================================
   PROFIL
===================================== */

function renameUser(oldName, newName) {
    accounts[newName] = accounts[oldName];
    delete accounts[oldName];

    Object.values(comments).forEach(list => list.forEach(c => { if (c.user === oldName) c.user = newName; }));
    keys.forEach(k => { if (k.usedBy === oldName) k.usedBy = newName; });

    if (currentUser === oldName) currentUser = newName;
}

function saveProfile() {
    const u = me();
    const name = $("pfName").value.trim();
    const email = $("pfEmail").value.trim();
    const msg = $("pfMsg");

    if (name.length < 3) { msg.textContent = "Benutzername: mind. 3 Zeichen."; return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { msg.textContent = "Ungültige E-Mail."; return; }

    const other = u2 => u2 && u2[1] !== u;
    if (other(findUser(name)) || other(findUser(email))) { msg.textContent = "Name oder E-Mail bereits vergeben."; return; }

    u.email = email;
    if (name !== currentUser) renameUser(currentUser, name);

    persist();
    updateLoginDisplay();
    msg.textContent = "Gespeichert.";
}

async function changePassword() {
    const msg = $("pwMsg");
    const next = $("pwNew").value;

    if (next.length < 8) { msg.textContent = "Neues Passwort: mind. 8 Zeichen."; return; }

    try {
        if (!(await verifyPassword(me(), $("pwOld").value))) { msg.textContent = "Altes Passwort ist falsch."; return; }

        await setPassword(me(), next);
        persist();
        $("pwOld").value = "";
        $("pwNew").value = "";
        msg.textContent = "Passwort geändert.";
    } catch (e) {
        msg.textContent = e.message;
    }
}

function renderProfile() {
    const u = me();
    if (!u) return;

    const history = [...u.history].reverse();

    extraView.replaceChildren(
        h("h2", { class: "section-title", text: "Mein Profil" }),
        h("div", { class: "panel" },
            h("p", { text: `Punkte: ${Math.floor(u.points).toLocaleString("de-DE")} · Spiele: ${u.purchasedGames.length} · Rolle: ${u.role}` }),
            h("input", { id: "pfName", value: currentUser, placeholder: "Benutzername" }),
            h("input", { id: "pfEmail", type: "email", value: u.email || "", placeholder: "E-Mail" }),
            h("button", { text: "Speichern", onclick: saveProfile }),
            h("p", { id: "pfMsg" })),
        h("div", { class: "panel" },
            h("h3", { text: "Passwort ändern" }),
            h("input", { id: "pwOld", type: "password", placeholder: "Altes Passwort" }),
            h("input", { id: "pwNew", type: "password", placeholder: "Neues Passwort (mind. 8 Zeichen)" }),
            h("button", { text: "Passwort ändern", onclick: changePassword }),
            h("p", { id: "pwMsg" }),
            h("p", { text: "„Passwort vergessen“ braucht einen Server, der E-Mails verschickt. Das geht mit reinem JavaScript nicht." })),
        h("div", { class: "panel" },
            h("h3", { text: "Kaufhistorie" }),
            history.length
                ? h("table", { class: "list" }, history.map(e => h("tr", {},
                    h("td", { text: new Date(e.date).toLocaleString("de-DE") }),
                    h("td", { text: e.name }),
                    h("td", { text: e.type === "Punkte" ? `${e.cost} Punkte` : e.type }))))
                : h("p", { text: "Noch keine Käufe." })));
}

/* =====================================
   PRODUKTSCHLÜSSEL
===================================== */

function randomKey() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const r = crypto.getRandomValues(new Uint32Array(20));
    return Array.from(r, n => chars[n % chars.length]).join("").match(/.{5}/g).join("-");
}

function redeemKey(inputId = "redeemInput", msgId = "redeemMessage") {
    const input = $(inputId);
    const msg = $(msgId);

    if (!input || !msg) return;

    if (!me()) { msg.textContent = "Bitte zuerst anmelden."; return; }

    const key = keys.find(k => k.key === input.value.trim().toUpperCase());

    if (!key || !key.active || key.used) { msg.textContent = "Ungültiger, deaktivierter oder bereits verwendeter Schlüssel."; return; }

    const g = games.find(x => x.id === key.gameId);

    if (!g) { msg.textContent = "Das zugehörige Spiel existiert nicht."; return; }
    if (owned(g.id)) { msg.textContent = "Du besitzt dieses Spiel bereits."; return; }

    key.used = true;
    key.usedBy = currentUser;
    me().purchasedGames.push(g.id);
    addHistory(me(), g, 0, "Schlüssel");

    persist();
    input.value = "";
    msg.textContent = "Erfolgreich eingelöst! Das Spiel wurde freigeschaltet.";

    if (isAdmin) renderAdminKeys();
    if (view === "library") renderLibrary();
}

/* =====================================
   ADMIN-LOGIN (Konto mit Rolle "admin")
===================================== */

function showAdminLogin() {
    $("adminLoginMessage").textContent = adminAcc
        ? ""
        : "Erster Admin-Login: Das Passwort, das du jetzt eingibst, wird in diesem Browser gespeichert.";
    $("adminLoginModal").classList.remove("hidden");
}
function closeAdminLogin() { $("adminLoginModal").classList.add("hidden"); }

async function adminLogin() {
    const msg = $("adminLoginMessage");
    const email = $("adminId").value.trim().toLowerCase();
    const password = $("adminPassword").value;

    try {
        if (!adminAcc) {
            // Erster Admin-Login: nur die eingetragene E-Mail darf das Passwort festlegen
            if (!ADMIN_EMAIL) {
                msg.textContent = "Trage zuerst deine E-Mail in script.js bei ADMIN_EMAIL ein.";
                return;
            }
            if (email !== ADMIN_EMAIL.toLowerCase()) {
                msg.textContent = "Diese E-Mail ist nicht als Admin eingetragen.";
                return;
            }
            if (password.length < 8) { msg.textContent = "Passwort: mind. 8 Zeichen."; return; }

            const acc = { email };
            await setPassword(acc, password);
            adminAcc = acc;
            save("dg_admin", adminAcc);
        } else if (email !== adminAcc.email || !(await verifyPassword(adminAcc, password))) {
            msg.textContent = "E-Mail oder Passwort falsch.";
            return;
        }

        isAdmin = true;
        msg.textContent = "";
        $("adminPassword").value = "";
        closeAdminLogin();
        openAdminDashboard();
    } catch (e) {
        msg.textContent = e.message;
    }
}

function openAdminDashboard() {
    if (!isAdmin) return;
    $("adminDashboard").classList.remove("hidden");
    renderAdmin();
}

function adminLogout() {
    isAdmin = false;
    $("adminDashboard").classList.add("hidden");
}

function renderAdmin() {
    if (!isAdmin) return;

    const select = $("adminGameSelect");
    const previous = select.value;

    select.replaceChildren(...games.map(g => h("option", { value: g.id, text: g.name })));
    if (games.some(g => g.id === previous)) select.value = previous;

    renderAdminKeys();
    renderAdminGames();
    renderAdminExtra();
}

/* ---------- Admin: Schlüssel ---------- */

function generateKey() {
    if (!isAdmin) return;

    const gameId = $("adminGameSelect").value;

    if (!games.some(g => g.id === gameId)) return;

    const key = randomKey();

    keys.push({ key, gameId, active: true, used: false, createdAt: new Date().toISOString() });
    persist();

    $("newKeyArea").replaceChildren(
        h("h3", { text: "Neuer Produktschlüssel" }),
        h("p", { class: "key-text", text: key }),
        h("button", { text: "Schlüssel kopieren", onclick: () => {
            if (!navigator.clipboard) { alert("Kopieren ist hier nicht verfügbar."); return; }
            navigator.clipboard.writeText(key).then(() => alert("Schlüssel kopiert.")).catch(() => alert("Kopieren nicht möglich."));
        } }));

    renderAdminKeys();
}

function renderAdminKeys() {
    if (!isAdmin) return;

    const box = $("adminKeyList");
    box.replaceChildren();

    if (!keys.length) { box.textContent = "Noch keine Produktschlüssel vorhanden."; return; }

    keys.forEach(k => {
        const g = games.find(x => x.id === k.gameId);
        const status = k.used ? `Eingelöst${k.usedBy ? " von " + k.usedBy : ""}` : k.active ? "Aktiv" : "Deaktiviert";

        const item = h("div", {},
            h("p", { class: "key-text", text: k.key }),
            h("p", { text: `${g?.name || "Unbekannt"} · ${status}` }));

        if (k.active && !k.used) {
            item.append(h("button", { text: "Deaktivieren", onclick: () => { k.active = false; persist(); renderAdminKeys(); } }));
        }

        box.append(item);
    });
}

function grantFreeGame() {
    if (!isAdmin) return;
    if (!me()) { alert("Bitte zuerst als normaler Benutzer anmelden."); return; }

    const g = games.find(x => x.id === $("adminGameSelect").value);

    if (!g) return;

    if (!owned(g.id)) {
        me().purchasedGames.push(g.id);
        addHistory(me(), g, 0, "Admin");
    }

    persist();
    alert("Spiel wurde kostenlos freigeschaltet.");
}

/* ---------- Admin: Spiele ---------- */

function renderAdminGames() {
    if (!isAdmin) return;

    $("adminGameList").replaceChildren(...games.map(g => h("div", {},
        h("span", { text: `${g.name} – ${eur(g.price)} · ${g.points} Punkte ` }),
        h("button", { text: "Bearbeiten", onclick: () => { editingGame = g.id; renderAdminExtra(); $("adminExtra").scrollIntoView(); } }),
        " ",
        h("button", { text: "Löschen", onclick: () => deleteGame(g.id) }))));
}

function deleteGame(id) {
    const g = games.find(x => x.id === id);

    if (!g || !confirm(`„${g.name}“ wirklich löschen?`)) return;

    games.splice(games.indexOf(g), 1);
    delete comments[id];
    cart = cart.filter(x => x !== id);
    if (editingGame === id) editingGame = null;

    saveGames();
    persist();
    renderAdmin();
    renderCart();
    renderStore();
}

const FIELDS = [
    ["name", "Name"], ["genre", "Genre"], ["year", "Jahr"], ["releaseDate", "Veröffentlichungsdatum (JJJJ-MM-TT)"],
    ["price", "Preis (€)"], ["points", "Punktepreis"], ["developer", "Entwickler"], ["version", "Version"],
    ["size", "Spielgröße (z. B. 10 GB)"], ["icon", "Emoji"], ["image", "Bild-URL"],
    ["screenshots", "Screenshot-URLs (mit Komma getrennt)"], ["storeUrl", "Offizielle Shop-URL"],
    ["downloadUrl", "Download-URL (nur für freie Spiele)"],
    ["minReq", "Minimum: OS | CPU | RAM | GPU | Speicher"], ["recReq", "Empfohlen: OS | CPU | RAM | GPU | Speicher"]
];

const reqToText = r => (r ? [r.os, r.cpu, r.ram, r.gpu, r.storage].join(" | ") : "");

function fieldValue(g, key) {
    if (!g) return "";
    if (key === "screenshots") return (g.screenshots || []).join(", ");
    if (key === "minReq") return reqToText(g.requirements?.minimum);
    if (key === "recReq") return reqToText(g.requirements?.recommended);
    return g[key] ?? "";
}

function field(label, input) {
    return h("label", { style: "display:block;color:var(--muted);font-size:13px;margin-top:6px" }, label, input);
}

function saveGameForm() {
    const v = k => $("gf_" + k).value.trim();
    const name = v("name");

    if (!name) { alert("Name fehlt."); return; }

    const price = Number(v("price").replace(",", "."));
    const points = Number(v("points"));

    if (!Number.isFinite(price) || price < 0 || !Number.isInteger(points) || points < 0) {
        alert("Preis und Punktepreis müssen gültige Zahlen sein.");
        return;
    }

    for (const k of ["image", "storeUrl", "downloadUrl"]) {
        if (v(k) && !safeUrl(v(k))) { alert(`Ungültige URL im Feld „${k}“.`); return; }
    }

    const parse = s => {
        if (!s) return undefined;
        const p = s.split("|").map(x => x.trim());
        return { os: p[0] || "–", cpu: p[1] || "–", ram: p[2] || "–", gpu: p[3] || "–", storage: p[4] || "–" };
    };

    const data = {
        name, genre: v("genre"), year: Number(v("year")) || new Date().getFullYear(),
        releaseDate: v("releaseDate"), price, points, developer: v("developer"), version: v("version"),
        size: v("size"), icon: v("icon") || "🎮", image: v("image"),
        screenshots: v("screenshots").split(",").map(s => s.trim()).filter(Boolean),
        storeUrl: v("storeUrl"), downloadUrl: v("downloadUrl"),
        free: $("gf_free").checked, description: $("gf_description").value.trim()
    };

    const min = parse(v("minReq"));
    const rec = parse(v("recReq"));
    const existing = editingGame ? games.find(g => g.id === editingGame) : null;

    if (existing) {
        Object.assign(existing, data);
        if (min || rec) existing.requirements = { minimum: min, recommended: rec };
        else delete existing.requirements;
    } else {
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "spiel";
        const g = { id: `${slug}-${uid().slice(-4)}`, ...data };
        if (min || rec) g.requirements = { minimum: min, recommended: rec };
        games.push(g);
    }

    editingGame = null;
    saveGames();
    renderAdmin();
    renderStore();
}

function renderAdminExtra() {
    if (!isAdmin) return;

    const g = editingGame ? games.find(x => x.id === editingGame) : null;

    /* Formular */
    const form = h("div", { class: "panel" },
        h("h3", { text: g ? `Spiel bearbeiten: ${g.name}` : "Neues Spiel hinzufügen" }),
        FIELDS.map(([k, label]) => field(label, h("input", { id: "gf_" + k, value: String(fieldValue(g, k)) }))),
        field("Beschreibung", h("textarea", { id: "gf_description", value: g?.description || "" })),
        h("label", {}, h("input", { id: "gf_free", type: "checkbox", checked: g?.free === true, style: "width:auto;margin-right:8px" }),
            "Freies Spiel (Download über downloadUrl erlaubt – nur für Spiele, deren Verbreitung erlaubt ist)"),
        h("div", { class: "button-row" },
            h("button", { text: g ? "Änderungen speichern" : "Spiel hinzufügen", onclick: saveGameForm }),
            g ? h("button", { text: "Abbrechen", onclick: () => { editingGame = null; renderAdminExtra(); } }) : "",
            h("button", { text: "Katalog auf games.js zurücksetzen", onclick: () => {
                if (!confirm("Alle Admin-Änderungen am Katalog verwerfen?")) return;
                localStorage.removeItem("dg_games_custom");
                games.splice(0, games.length, ...normalize(baseGames.map(x => ({ ...x }))));
                editingGame = null;
                renderAdmin();
                renderStore();
            } })));

    /* Benutzer */
    const users = h("div", { class: "panel" }, h("h3", { text: "Benutzer verwalten" }),
        h("table", { class: "list" }, Object.entries(accounts).map(([name, a]) => h("tr", {},
            h("td", { text: `${name} (${a.email || "keine E-Mail"})` }),
            h("td", { text: `${a.role} · ${Math.floor(a.points)} P · ${a.purchasedGames.length} Spiele` }),
            h("td", {},
                h("button", { text: "+1000 P", onclick: () => { a.points += 1000; persist(); updatePoints(); renderAdminExtra(); } }),
                name !== currentUser ? [
                    " ", h("button", { text: "Löschen", onclick: () => { if (confirm(`Konto „${name}“ löschen?`)) { delete accounts[name]; persist(); renderAdminExtra(); } } })
                ] : "")))));

    /* Kommentare */
    const all = Object.entries(comments).flatMap(([gid, list]) => list.map(c => ({ gid, c })));
    const moderation = h("div", { class: "panel" }, h("h3", { text: "Kommentare moderieren" }),
        all.length ? all.map(({ gid, c }) => h("p", {},
            h("b", { text: `${games.find(x => x.id === gid)?.name || gid} – ${c.user} ` }),
            c.stars ? h("span", { class: "star", text: "★".repeat(c.stars) }) : "", h("br"), c.text, " ",
            h("button", { text: "Löschen", onclick: () => deleteComment(gid, c) })))
            : "Keine Kommentare.");

    /* Statistiken */
    const purchases = Object.values(accounts).reduce((s, a) => s + a.history.length, 0);
    const top = [...games].sort((a, b) => popularity(b.id) - popularity(a.id)).slice(0, 5);
    const stats = h("div", { class: "panel" }, h("h3", { text: "Statistiken" }),
        h("span", { class: "stat", text: `Benutzer: ${Object.keys(accounts).length}` }),
        h("span", { class: "stat", text: `Spiele: ${games.length}` }),
        h("span", { class: "stat", text: `Käufe/Einlösungen: ${purchases}` }),
        h("span", { class: "stat", text: `Kommentare: ${all.length}` }),
        h("span", { class: "stat", text: `Schlüssel: ${keys.filter(k => k.used).length}/${keys.length} eingelöst` }),
        h("p", { text: "Beliebteste: " + (top.map(x => `${x.name} (${popularity(x.id)})`).join(", ") || "–") }));

    adminExtra.replaceChildren(h("hr"), form, users, moderation, stats);
}

/* =====================================
   TASTATUR & START
===================================== */

document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    closeGame();
    hideAuthWindow();
    closeAdminLogin();
});

updatePoints();
updateLoginDisplay();
renderCart();
setView("store");

console.log("DownloadGames erfolgreich gestartet.");