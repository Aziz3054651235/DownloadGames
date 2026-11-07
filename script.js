
"use strict";

/* =====================================
   DOWNLOADGAMES – VERBESSERTE TESTVERSION
===================================== */

// TEST-ADMINZUGANG
// ACHTUNG: Auf GitHub Pages sind diese Daten öffentlich!
const ADMIN_ID = "ADMINPOWER856545654366353";
const ADMIN_PASSWORD = "zizou3215698";

// Prüfen, ob games.js geladen wurde
if (typeof games === "undefined" || !Array.isArray(games)) {
    throw new Error(
        "games.js fehlt! Prüfe den Pfad in deiner index.html."
    );
}

/* =====================================
   HILFSFUNKTIONEN
===================================== */

function element(id) {
    return document.getElementById(id);
}

function load(key, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(key));
        return value ?? fallback;
    } catch (error) {
        console.error("Fehler beim Laden:", key, error);
        return fallback;
    }
}

function save(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.error("Fehler beim Speichern:", key, error);
        alert("Daten konnten nicht gespeichert werden.");
        return false;
    }
}

/* =====================================
   DATEN LADEN
===================================== */

let accounts = load("dg_accounts", {});
let comments = load("dg_comments", {});
let keys = load("dg_keys", []);
let cart = load("dg_cart", []);
let currentUser = load("dg_currentUser", null);

if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) {
    accounts = {};
}

if (!comments || typeof comments !== "object") comments = {};
if (!Array.isArray(keys)) keys = [];
if (!Array.isArray(cart)) cart = [];

let guestPoints = Number(load("dg_points", 0)) || 0;
let guestPurchased = load("dg_purchased", []);

if (!Array.isArray(guestPurchased)) {
    guestPurchased = [];
}

if (currentUser && !accounts[currentUser]) {
    currentUser = null;
}

let points = currentUser
    ? Number(accounts[currentUser].points ?? guestPoints) || 0
    : guestPoints;

let purchasedGames = currentUser
    ? accounts[currentUser].purchasedGames || []
    : guestPurchased;

if (!Array.isArray(purchasedGames)) {
    purchasedGames = [];
}

let isAdmin = false;
let selectedGame = null;

/* =====================================
   DATEN SPEICHERN
===================================== */

function saveAll() {
    if (currentUser && accounts[currentUser]) {
        accounts[currentUser].points = points;
        accounts[currentUser].purchasedGames = [...purchasedGames];
    } else {
        guestPoints = points;
        guestPurchased = [...purchasedGames];
    }

    const success =
        save("dg_accounts", accounts) &&
        save("dg_comments", comments) &&
        save("dg_keys", keys) &&
        save("dg_cart", cart) &&
        save("dg_currentUser", currentUser) &&
        save("dg_points", guestPoints) &&
        save("dg_purchased", guestPurchased);

    return success;
}

/* =====================================
   PUNKTE-SYSTEM
===================================== */

function updatePoints() {
    const output = element("points");

    if (output) {
        output.textContent =
            Math.floor(points).toLocaleString("de-DE");
    }
}

// DEMO: 500 Punkte pro Sekunde
// Für eine echte Website muss das serverseitig laufen.
setInterval(() => {
    points += 500;
    updatePoints();
    saveAll();
}, 1000);

/* =====================================
   SPIELE ANZEIGEN
===================================== */

function renderGames(filter = "") {
    const grid = element("gameGrid");

    if (!grid) return;

    grid.innerHTML = "";

    const search = String(filter).trim().toLowerCase();

    const filteredGames = games.filter(game =>
        String(game.name).toLowerCase().includes(search) ||
        String(game.genre).toLowerCase().includes(search)
    );

    if (filteredGames.length === 0) {
        grid.textContent = "Keine Spiele gefunden.";
        return;
    }

    filteredGames.forEach(game => {
        const card = document.createElement("article");
        card.className = "game-card";

        // Spielbild
        const cover = document.createElement("div");
        cover.className = "game-cover";

        if (game.image) {
            const img = document.createElement("img");
            img.src = game.image;
            img.alt = game.name;
            img.onerror = () => {
                cover.textContent = game.icon || "🎮";
            };
            cover.appendChild(img);
        } else {
            cover.textContent = game.icon || "🎮";
        }

        const title = document.createElement("h3");
        title.textContent = game.name;

        const description = document.createElement("p");
        description.textContent =
            `${game.genre} · ${game.year}`;

        const price = document.createElement("p");
        price.textContent =
            `${Number(game.price).toFixed(2)} €`;

        const button = document.createElement("button");
        button.textContent = "Details ansehen";
        button.addEventListener("click", () => openGame(game.id));

        card.append(cover, title, description, price, button);
        grid.appendChild(card);
    });
}
/* =====================================
   SPIELDETAILS
===================================== */

function openGame(id) {
    selectedGame = games.find(game => game.id === id);

    if (!selectedGame) {
        alert("Spiel nicht gefunden.");
        return;
    }

    const title = element("detailTitle");
    const description = element("detailDescription");
    const info = element("detailInfo");
    const price = element("detailPrice");
    const buyButton = element("buyButton");
    const cartButton = element("cartButton");
    const downloadButton = element("downloadButton");
    const modal = element("gameModal");

    if (title) title.textContent = selectedGame.name;

    if (description) {
        description.textContent = selectedGame.description;
    }

    if (info) {
        info.textContent =
            `${selectedGame.genre} · ${selectedGame.year} · Entwickler: ${selectedGame.developer}`;
    }

    if (price) {
        price.textContent =
            `${Number(selectedGame.price).toFixed(2)} € · ${selectedGame.points} Punkte`;
    }

    if (buyButton) {
        buyButton.onclick = buyGame;
    }

    if (cartButton) {
        cartButton.onclick = () => addToCart(selectedGame.id);
    }

    const ownsGame = purchasedGames.includes(selectedGame.id);

    if (downloadButton) {
        downloadButton.classList.toggle("hidden", !ownsGame);

        downloadButton.onclick = () => {
            if (!purchasedGames.includes(selectedGame.id)) {
                alert("Du musst dieses Spiel zuerst freischalten.");
                return;
            }

            if (typeof startDownload !== "function") {
                alert("downloads.js wurde nicht geladen.");
                return;
            }

            startDownload(selectedGame.id);
        };
    }

    if (modal) {
        modal.classList.remove("hidden");
    }

    renderComments();
}

function closeGame() {
    element("gameModal")?.classList.add("hidden");
}

/* =====================================
   SPIELE KAUFEN
===================================== */

function buyGame() {
    if (!selectedGame) return;

    if (!currentUser) {
        alert("Bitte zuerst anmelden.");
        showAuthWindow();
        return;
    }

    if (purchasedGames.includes(selectedGame.id)) {
        alert("Du besitzt dieses Spiel bereits!");
        return;
    }

    const price = Number(selectedGame.points);

    if (!Number.isFinite(price) || price < 0) {
        alert("Ungültiger Spielpreis.");
        return;
    }

    if (points < price) {
        alert("Du hast nicht genügend Punkte!");
        return;
    }

    points -= price;
    purchasedGames.push(selectedGame.id);

    saveAll();
    updatePoints();

    alert("Spiel erfolgreich freigeschaltet!");

    openGame(selectedGame.id);
}

/* =====================================
   WARENKORB
===================================== */

function addToCart(id) {
    const game = games.find(item => item.id === id);

    if (!game) return;

    if (cart.includes(id)) {
        alert("Dieses Spiel ist bereits im Warenkorb.");
        return;
    }

    cart.push(id);

    saveAll();
    renderCart();

    alert("Spiel wurde zum Warenkorb hinzugefügt.");
}

function renderCart() {
    const container = element("cartItems");
    const totalElement = element("cartTotal");

    if (!container || !totalElement) return;

    container.innerHTML = "";

    let total = 0;

    cart.forEach(id => {
        const game = games.find(item => item.id === id);

        if (!game) return;

        total += Number(game.price) || 0;

        const item = document.createElement("div");

        const name = document.createElement("span");
        name.textContent =
            `${game.name} – ${Number(game.price).toFixed(2)} €`;

        const remove = document.createElement("button");
        remove.textContent = "Entfernen";

        remove.onclick = () => {
            cart = cart.filter(itemId => itemId !== id);
            saveAll();
            renderCart();
        };

        item.append(name, remove);
        container.appendChild(item);
    });

    totalElement.textContent =
        total.toFixed(2).replace(".", ",") + " €";
}

function toggleCart() {
    element("cartSection")?.classList.toggle("hidden");
    renderCart();
}

function clearCart() {
    cart = [];
    saveAll();
    renderCart();
}

/* =====================================
   PASSWORT-HASHING
===================================== */

// Nur für die lokale Testversion.
// SHA-256 allein ist keine sichere Passwortspeicherung.
async function hashPassword(password) {
    if (!crypto.subtle) {
        throw new Error(
            "Passwortfunktion nicht verfügbar. Bitte HTTPS verwenden."
        );
    }

    const data = new TextEncoder().encode(password);
    const hash = await crypto.subtle.digest("SHA-256", data);

    return Array.from(new Uint8Array(hash))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

/* =====================================
   REGISTRIERUNG UND LOGIN
===================================== */

function showAuthWindow() {
    element("authModal")?.classList.remove("hidden");
}

function hideAuthWindow() {
    element("authModal")?.classList.add("hidden");
}

async function register() {
    const username =
        element("authUsername")?.value.trim() || "";

    const password =
        element("authPassword")?.value || "";

    const message = element("authMessage");

    if (!message) return;

    if (username.length < 3 || password.length < 6) {
        message.textContent =
            "Benutzername: mindestens 3 Zeichen. Passwort: mindestens 6 Zeichen.";
        return;
    }

    if (Object.prototype.hasOwnProperty.call(accounts, username)) {
        message.textContent =
            "Dieser Benutzername ist bereits vergeben.";
        return;
    }

    try {
        accounts[username] = {
            passwordHash: await hashPassword(password),
            points: 0,
            purchasedGames: []
        };

        saveAll();

        message.textContent =
            "Registrierung erfolgreich! Du kannst dich jetzt anmelden.";

    } catch (error) {
        message.textContent = error.message;
    }
}

async function login() {
    const username =
        element("authUsername")?.value.trim() || "";

    const password =
        element("authPassword")?.value || "";

    const message = element("authMessage");

    if (!message) return;

    if (!Object.prototype.hasOwnProperty.call(accounts, username)) {
        message.textContent = "Benutzerkonto nicht gefunden.";
        return;
    }

    try {
        const hash = await hashPassword(password);

        if (hash !== accounts[username].passwordHash) {
            message.textContent = "Falsches Passwort.";
            return;
        }

        // Vor dem Kontowechsel den bisherigen Stand sichern.
        saveAll();

        currentUser = username;
        points = Number(accounts[username].points) || 0;

        purchasedGames = Array.isArray(accounts[username].purchasedGames)
            ? [...accounts[username].purchasedGames]
            : [];

        saveAll();
        updatePoints();
        updateLoginDisplay();
        renderGames();
        renderCart();
        hideAuthWindow();

        message.textContent = "";

    } catch (error) {
        message.textContent = error.message;
    }
}

function updateLoginDisplay() {
    const button = element("loginButton");

    if (!button) return;

    if (currentUser) {
        button.textContent = `Logout (${currentUser})`;
        button.onclick = logout;
    } else {
        button.textContent = "Login";
        button.onclick = showAuthWindow;
    }
}

function logout() {
    saveAll();

    currentUser = null;
    points = guestPoints;
    purchasedGames = [...guestPurchased];

    saveAll();

    updatePoints();
    updateLoginDisplay();
    renderGames();
}

/* =====================================
   KOMMENTARE
===================================== */

function renderComments() {
    const container = element("comments");

    if (!container) return;

    container.innerHTML = "";

    if (!selectedGame) return;

    const list = comments[selectedGame.id] || [];

    if (list.length === 0) {
        container.textContent = "Noch keine Kommentare vorhanden.";
        return;
    }

    list.forEach(comment => {
        const p = document.createElement("p");
        p.textContent = `${comment.user}: ${comment.text}`;
        container.appendChild(p);
    });
}

function addComment() {
    if (!currentUser) {
        alert("Bitte melde dich zuerst an.");
        return;
    }

    if (!selectedGame) return;

    const input = element("commentInput");
    if (!input) return;

    const text = input.value.trim();

    if (!text) return;

    if (text.length > 500) {
        alert("Kommentare dürfen maximal 500 Zeichen lang sein.");
        return;
    }

    comments[selectedGame.id] ??= [];

    comments[selectedGame.id].push({
        user: currentUser,
        text: text
    });

    input.value = "";

    saveAll();
    renderComments();
}

/* =====================================
   ADMIN-LOGIN
===================================== */

function showAdminLogin() {
    element("adminLoginModal")?.classList.remove("hidden");
}

function closeAdminLogin() {
    element("adminLoginModal")?.classList.add("hidden");
}

function adminLogin() {
    const id = element("adminId")?.value || "";
    const password = element("adminPassword")?.value || "";
    const message = element("adminLoginMessage");

    if (!message) return;

    if (id !== ADMIN_ID || password !== ADMIN_PASSWORD) {
        message.textContent = "Admin-ID oder Passwort falsch.";
        return;
    }

    isAdmin = true;
    message.textContent = "";

    closeAdminLogin();
    openAdminDashboard();
}

/* =====================================
   ADMIN-DASHBOARD
===================================== */

function openAdminDashboard() {
    if (!isAdmin) return;

    const select = element("adminGameSelect");

    if (!select) return;

    select.innerHTML = "";

    games.forEach(game => {
        const option = document.createElement("option");
        option.value = game.id;
        option.textContent = game.name;
        select.appendChild(option);
    });

    element("adminDashboard")?.classList.remove("hidden");

    renderAdminKeys();
    renderAdminGames();
}

function adminLogout() {
    isAdmin = false;
    element("adminDashboard")?.classList.add("hidden");
}

/* =====================================
   PRODUKTSCHLÜSSEL ERSTELLEN
===================================== */

function randomKey() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const random = new Uint32Array(20);

    crypto.getRandomValues(random);

    return Array.from(random, number =>
        chars[number % chars.length]
    ).join("").match(/.{1,5}/g).join("-");
}

function generateKey() {
    if (!isAdmin) return;

    const gameId = element("adminGameSelect")?.value;

    if (!games.some(game => game.id === gameId)) return;

    const key = randomKey();

    keys.push({
        key,
        gameId,
        active: true,
        used: false,
        createdAt: new Date().toISOString()
    });

    saveAll();

    const area = element("newKeyArea");

    if (area) {
        area.innerHTML = "";

        const heading = document.createElement("h3");
        heading.textContent = "Neuer Produktschlüssel";

        const value = document.createElement("p");
        value.className = "key-text";
        value.textContent = key;

        const copy = document.createElement("button");
        copy.textContent = "Schlüssel kopieren";

        copy.onclick = () => {
            if (!navigator.clipboard) {
                alert("Kopieren ist hier nicht verfügbar.");
                return;
            }

            navigator.clipboard.writeText(key)
                .then(() => alert("Schlüssel kopiert."))
                .catch(() => alert("Kopieren nicht möglich."));
        };

        area.append(heading, value, copy);
    }

    renderAdminKeys();
}

/* =====================================
   PRODUKTSCHLÜSSEL EINLÖSEN
===================================== */

function redeemKey() {
    const input = element("redeemInput");
    const message = element("redeemMessage");

    if (!input || !message) return;

    const value = input.value.trim().toUpperCase();

    if (!currentUser) {
        message.textContent = "Bitte zuerst anmelden.";
        return;
    }

    const key = keys.find(item => item.key === value);

    if (!key || !key.active || key.used) {
        message.textContent =
            "Ungültiger, deaktivierter oder bereits verwendeter Schlüssel.";
        return;
    }

    if (!games.some(game => game.id === key.gameId)) {
        message.textContent = "Das zugehörige Spiel existiert nicht.";
        return;
    }

    if (purchasedGames.includes(key.gameId)) {
        message.textContent = "Du besitzt dieses Spiel bereits.";
        return;
    }

    key.used = true;
    purchasedGames.push(key.gameId);

    saveAll();

    input.value = "";

    message.textContent =
        "Erfolgreich eingelöst! Das Spiel wurde freigeschaltet.";

    renderAdminKeys();
    openGame(key.gameId);
}

/* =====================================
   ADMIN: SCHLÜSSEL VERWALTEN
===================================== */

function renderAdminKeys() {
    if (!isAdmin) return;

    const container = element("adminKeyList");

    if (!container) return;

    container.innerHTML = "";

    keys.forEach((key, index) => {
        const game = games.find(item => item.id === key.gameId);

        const item = document.createElement("div");

        const info = document.createElement("p");
        info.className = "key-text";
        info.textContent = key.key;

        const status = document.createElement("p");

        status.textContent =
            `${game?.name || "Unbekannt"} · ` +
            (key.used
                ? "Eingelöst"
                : key.active
                    ? "Aktiv"
                    : "Deaktiviert");

        item.append(info, status);

        if (key.active && !key.used) {
            const deactivate = document.createElement("button");
            deactivate.textContent = "Deaktivieren";

            deactivate.onclick = () => {
                keys[index].active = false;
                saveAll();
                renderAdminKeys();
            };

            item.appendChild(deactivate);
        }

        container.appendChild(item);
    });

    if (keys.length === 0) {
        container.textContent =
            "Noch keine Produktschlüssel vorhanden.";
    }
}

/* =====================================
   ADMIN: SPIEL KOSTENLOS FREISCHALTEN
===================================== */

function grantFreeGame() {
    if (!isAdmin) return;

    if (!currentUser) {
        alert("Bitte zuerst als normaler Benutzer anmelden.");
        return;
    }

    const gameId = element("adminGameSelect")?.value;

    if (!games.some(game => game.id === gameId)) return;

    if (!purchasedGames.includes(gameId)) {
        purchasedGames.push(gameId);
    }

    saveAll();
    alert("Spiel wurde kostenlos freigeschaltet.");

    renderGames();
}

/* =====================================
   ADMIN: SPIELE ANZEIGEN
===================================== */

function renderAdminGames() {
    if (!isAdmin) return;

    const container = element("adminGameList");

    if (!container) return;

    container.innerHTML = "";

    games.forEach(game => {
        const item = document.createElement("div");

        item.textContent =
            `${game.name} – ${Number(game.price).toFixed(2)} €`;

        container.appendChild(item);
    });
}

/* =====================================
   WEBSITE STARTEN
===================================== */

updatePoints();
updateLoginDisplay();
renderGames();
renderCart();

console.log("DownloadGames erfolgreich gestartet.");
