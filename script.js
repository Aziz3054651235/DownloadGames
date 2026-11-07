
"use strict";

/* =====================================
   DOWNLOADGAMES – TESTVERSION
===================================== */

// TEST-ADMINZUGANG
const ADMIN_ID = "ADMINPOWER856545654366353";
const ADMIN_PASSWORD = "A".repeat(900);

// SPIELE
const games = [
  {
    id: "visage",
    name: "Visage",
    price: 19.99,
    points: 2000,
    genre: "Psychological Horror",
    year: 2020,
    developer: "SadSquare Studio",
    description: "Ein atmosphärisches psychologisches Horrorspiel.",
    icon: "👻",
    downloadUrl: "Actiongames/Visage.zip"
  },
  {
    id: "dark-house",
    name: "Dark House",
    price: 9.99,
    points: 1000,
    genre: "Horror",
    year: 2024,
    developer: "DownloadGames",
    description: "Erkunde ein geheimnisvolles Haus.",
    icon: "🏚️",
    downloadUrl: ""
  },
  {
    id: "lost-forest",
    name: "Lost Forest",
    price: 14.99,
    points: 1500,
    genre: "Adventure",
    year: 2024,
    developer: "DownloadGames",
    description: "Finde deinen Weg durch einen dunklen Wald.",
    icon: "🌲",
    downloadUrl: ""
  },
  {
    id: "nightmare",
    name: "Nightmare",
    price: 4.99,
    points: 500,
    genre: "Horror",
    year: 2024,
    developer: "DownloadGames",
    description: "Ein kurzes Horrorabenteuer.",
    icon: "🌙",
    downloadUrl: ""
  },
  {
    id: "deep-ocean",
    name: "Deep Ocean",
    price: 7.99,
    points: 800,
    genre: "Adventure",
    year: 2024,
    developer: "DownloadGames",
    description: "Entdecke die Geheimnisse des Ozeans.",
    icon: "🌊",
    downloadUrl: ""
  }
];

/* =====================================
   DATENSPEICHERUNG
===================================== */

function load(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

let points = load("dg_points", 0);
let purchasedGames = load("dg_purchased", []);
let cart = load("dg_cart", []);
let accounts = load("dg_accounts", {});
let comments = load("dg_comments", {});
let keys = load("dg_keys", []);
let currentUser = load("dg_currentUser", null);

let isAdmin = false;
let selectedGame = null;

function saveAll() {
  localStorage.setItem("dg_points", JSON.stringify(points));
  localStorage.setItem("dg_purchased", JSON.stringify(purchasedGames));
  localStorage.setItem("dg_cart", JSON.stringify(cart));
  localStorage.setItem("dg_accounts", JSON.stringify(accounts));
  localStorage.setItem("dg_comments", JSON.stringify(comments));
  localStorage.setItem("dg_keys", JSON.stringify(keys));
  localStorage.setItem("dg_currentUser", JSON.stringify(currentUser));
}

function updatePoints() {
  document.getElementById("points").textContent =
    Math.floor(points).toLocaleString("de-DE");
}

/* =====================================
   DEMO-PUNKTE
===================================== */

// +500 Punkte pro Sekunde
setInterval(() => {
  points += 500;
  updatePoints();
  saveAll();
}, 1000);

/* =====================================
   SPIELE ANZEIGEN
===================================== */

function renderGames(filter = "") {
  const grid = document.getElementById("gameGrid");
  grid.innerHTML = "";

  games
    .filter(game =>
      game.name.toLowerCase().includes(filter.toLowerCase())
    )
    .forEach(game => {

      const card = document.createElement("article");
      card.className = "game-card";

      const cover = document.createElement("div");
      cover.className = "game-cover";
      cover.textContent = game.icon;

      const title = document.createElement("h3");
      title.textContent = game.name;

      const description = document.createElement("p");
      description.textContent =
        game.genre + " · " + game.year;

      const price = document.createElement("p");
      price.textContent =
        game.price.toFixed(2) + " €";

      const button = document.createElement("button");
      button.textContent = "Details ansehen";

      button.onclick = () => openGame(game.id);

      card.append(
        cover,
        title,
        description,
        price,
        button
      );

      grid.appendChild(card);
    });
}

document.getElementById("searchInput").addEventListener(
  "input",
  event => renderGames(event.target.value)
);

/* =====================================
   SPIELDETAILS
===================================== */

function openGame(id) {

  selectedGame = games.find(game => game.id === id);

  if (!selectedGame) return;

  document.getElementById("detailTitle").textContent =
    selectedGame.name;

  document.getElementById("detailDescription").textContent =
    selectedGame.description;

  document.getElementById("detailInfo").textContent =
    selectedGame.genre + " · " +
    selectedGame.year + " · Entwickler: " +
    selectedGame.developer;

  document.getElementById("detailPrice").textContent =
    selectedGame.price.toFixed(2) +
    " € · " + selectedGame.points + " Punkte";

  document.getElementById("buyButton").onclick = buyGame;

  document.getElementById("cartButton").onclick = () =>
    addToCart(selectedGame.id);

  const downloadButton =
    document.getElementById("downloadButton");

  const ownsGame =
    purchasedGames.includes(selectedGame.id);

  downloadButton.classList.toggle(
    "hidden",
    !ownsGame
  );

  downloadButton.onclick = () => {

    if (selectedGame.downloadUrl) {
      window.open(
        selectedGame.downloadUrl,
        "_blank",
        "noopener,noreferrer"
      );
    } else {
      alert("Für dieses Spiel ist noch kein Download hinterlegt.");
    }
  };

  document.getElementById("gameModal")
    .classList.remove("hidden");

  renderComments();
}

function closeGame() {
  document.getElementById("gameModal")
    .classList.add("hidden");
}

/* =====================================
   SPIELE KAUFEN
===================================== */

function buyGame() {

  if (!selectedGame) return;

  if (!currentUser) {
    alert("Bitte zuerst anmelden.");
    return;
  }

  if (purchasedGames.includes(selectedGame.id)) {
    alert("Du besitzt dieses Spiel bereits!");
    return;
  }

  if (points < selectedGame.points) {
    alert("Du hast nicht genügend Punkte!");
    return;
  }

  points -= selectedGame.points;

  purchasedGames.push(selectedGame.id);

  accounts[currentUser].purchasedGames = [
    ...purchasedGames
  ];

  saveAll();
  updatePoints();

  alert("Spiel erfolgreich freigeschaltet!");

  openGame(selectedGame.id);
}

/* =====================================
   WARENKORB
===================================== */

function addToCart(id) {

  if (!cart.includes(id)) {
    cart.push(id);
  }

  saveAll();
  renderCart();

  alert("Spiel wurde zum Warenkorb hinzugefügt.");
}

function renderCart() {

  const container =
    document.getElementById("cartItems");

  container.innerHTML = "";

  let total = 0;

  cart.forEach(id => {

    const game = games.find(item => item.id === id);

    if (!game) return;

    total += game.price;

    const item = document.createElement("div");

    item.textContent =
      game.name + " – " +
      game.price.toFixed(2) + " € ";

    const remove = document.createElement("button");

    remove.textContent = "Entfernen";

    remove.onclick = () => {

      cart = cart.filter(itemId => itemId !== id);

      saveAll();
      renderCart();
    };

    item.appendChild(remove);

    container.appendChild(item);
  });

  document.getElementById("cartTotal").textContent =
    total.toFixed(2).replace(".", ",") + " €";
}

function toggleCart() {

  document.getElementById("cartSection")
    .classList.toggle("hidden");

  renderCart();
}

function clearCart() {

  cart = [];

  saveAll();
  renderCart();
}

/* =====================================
   PASSWORTVERSCHLÜSSELUNG
===================================== */

async function hashPassword(password) {

  if (!crypto.subtle) {
    throw new Error(
      "Bitte Website über localhost öffnen."
    );
  }

  const data = new TextEncoder().encode(password);

  const hash = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return Array.from(new Uint8Array(hash))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

/* =====================================
   BENUTZERKONTEN
===================================== */

function showAuthWindow() {
  document.getElementById("authModal")
    .classList.remove("hidden");
}

function hideAuthWindow() {
  document.getElementById("authModal")
    .classList.add("hidden");
}

async function register() {

  const username =
    document.getElementById("authUsername").value.trim();

  const password =
    document.getElementById("authPassword").value;

  const message =
    document.getElementById("authMessage");

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
    document.getElementById("authUsername").value.trim();

  const password =
    document.getElementById("authPassword").value;

  const message =
    document.getElementById("authMessage");

  if (!accounts[username]) {

    message.textContent =
      "Benutzerkonto nicht gefunden.";

    return;
  }

  try {

    const hash = await hashPassword(password);

    if (hash !== accounts[username].passwordHash) {

      message.textContent = "Falsches Passwort.";

      return;
    }

    currentUser = username;

    purchasedGames =
      accounts[username].purchasedGames || [];

    saveAll();

    updateLoginDisplay();

    hideAuthWindow();

  } catch (error) {

    message.textContent = error.message;
  }
}

function updateLoginDisplay() {

  const button =
    document.getElementById("loginButton");

  if (currentUser) {

    button.textContent =
      "Logout (" + currentUser + ")";

    button.onclick = logout;

  } else {

    button.textContent = "Login";

    button.onclick = showAuthWindow;
  }
}

function logout() {

  currentUser = null;

  purchasedGames = [];

  saveAll();

  updateLoginDisplay();
}

/* =====================================
   KOMMENTARE
===================================== */

function renderComments() {

  const container =
    document.getElementById("comments");

  container.innerHTML = "";

  if (!selectedGame) return;

  const list =
    comments[selectedGame.id] || [];

  list.forEach(comment => {

    const p = document.createElement("p");

    p.textContent =
      comment.user + ": " + comment.text;

    container.appendChild(p);
  });
}

function addComment() {

  if (!currentUser) {
    alert("Bitte melde dich zuerst an.");
    return;
  }

  if (!selectedGame) return;

  const input =
    document.getElementById("commentInput");

  const text = input.value.trim();

  if (!text) return;

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

  document.getElementById("adminLoginModal")
    .classList.remove("hidden");
}

function closeAdminLogin() {

  document.getElementById("adminLoginModal")
    .classList.add("hidden");
}

function adminLogin() {

  const id =
    document.getElementById("adminId").value;

  const password =
    document.getElementById("adminPassword").value;

  const message =
    document.getElementById("adminLoginMessage");

  if (id !== ADMIN_ID || password !== ADMIN_PASSWORD) {

    message.textContent =
      "Admin-ID oder Passwort falsch.";

    return;
  }

  isAdmin = true;

  closeAdminLogin();

  openAdminDashboard();
}

/* =====================================
   ADMIN-DASHBOARD
===================================== */

function openAdminDashboard() {

  if (!isAdmin) return;

  const select =
    document.getElementById("adminGameSelect");

  select.innerHTML = "";

  games.forEach(game => {

    const option = document.createElement("option");

    option.value = game.id;
    option.textContent = game.name;

    select.appendChild(option);
  });

  document.getElementById("adminDashboard")
    .classList.remove("hidden");

  renderAdminKeys();
  renderAdminGames();
}

function adminLogout() {

  isAdmin = false;

  document.getElementById("adminDashboard")
    .classList.add("hidden");
}

/* =====================================
   PRODUKTSCHLÜSSEL ERSTELLEN
===================================== */

function randomKey() {

  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  const random = new Uint32Array(20);

  crypto.getRandomValues(random);

  return Array.from(random, number =>
    chars[number % chars.length]
  ).join("").match(/.{1,5}/g).join("-");
}

function generateKey() {

  if (!isAdmin) return;

  const gameId =
    document.getElementById("adminGameSelect").value;

  const key = randomKey();

  keys.push({
    key: key,
    gameId: gameId,
    active: true,
    used: false,
    createdAt: new Date().toISOString()
  });

  saveAll();

  const area =
    document.getElementById("newKeyArea");

  area.innerHTML = "";

  const heading = document.createElement("h3");

  heading.textContent = "Neuer Produktschlüssel";

  const value = document.createElement("p");

  value.className = "key-text";
  value.textContent = key;

  const copy = document.createElement("button");

  copy.textContent = "Schlüssel kopieren";

  copy.onclick = () => {

    navigator.clipboard.writeText(key)
      .then(() => alert("Schlüssel kopiert."))
      .catch(() => alert("Kopieren nicht möglich."));
  };

  area.append(heading, value, copy);

  renderAdminKeys();
}

/* =====================================
   PRODUKTSCHLÜSSEL EINLÖSEN
===================================== */

function redeemKey() {

  const input =
    document.getElementById("redeemInput");

  const message =
    document.getElementById("redeemMessage");

  const value =
    input.value.trim().toUpperCase();

  if (!currentUser) {

    message.textContent =
      "Bitte zuerst anmelden.";

    return;
  }

  const key =
    keys.find(item => item.key === value);

  if (!key || !key.active || key.used) {

    message.textContent =
      "Ungültiger, deaktivierter oder bereits verwendeter Schlüssel.";

    return;
  }

  if (purchasedGames.includes(key.gameId)) {

    message.textContent =
      "Du besitzt dieses Spiel bereits.";

    return;
  }

  key.used = true;

  purchasedGames.push(key.gameId);

  accounts[currentUser].purchasedGames = [
    ...purchasedGames
  ];

  saveAll();

  input.value = "";

  message.textContent =
    "Erfolgreich eingelöst! Das Spiel wurde freigeschaltet.";

  openGame(key.gameId);
}

/* =====================================
   ADMIN: SCHLÜSSEL VERWALTEN
===================================== */

function renderAdminKeys() {

  if (!isAdmin) return;

  const container =
    document.getElementById("adminKeyList");

  container.innerHTML = "";

  keys.forEach((key, index) => {

    const game =
      games.find(item => item.id === key.gameId);

    const item = document.createElement("div");

    const info = document.createElement("p");

    info.className = "key-text";
    info.textContent = key.key;

    const status = document.createElement("p");

    status.textContent =
      (game?.name || "Unbekannt") + " · " +
      (key.used
        ? "Eingelöst"
        : key.active
          ? "Aktiv"
          : "Deaktiviert");

    item.append(info, status);

    if (key.active && !key.used) {

      const deactivate =
        document.createElement("button");

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

  const gameId =
    document.getElementById("adminGameSelect").value;

  if (!purchasedGames.includes(gameId)) {

    purchasedGames.push(gameId);
  }

  accounts[currentUser].purchasedGames = [
    ...purchasedGames
  ];

  saveAll();

  alert(
    "Spiel wurde für den aktuellen Benutzer kostenlos freigeschaltet."
  );
}

/* =====================================
   ADMIN: SPIELE ANZEIGEN
===================================== */

function renderAdminGames() {

  const container =
    document.getElementById("adminGameList");

  container.innerHTML = "";

  games.forEach(game => {

    const item = document.createElement("div");

    item.textContent =
      game.name + " – " +
      game.price.toFixed(2) + " €";

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
