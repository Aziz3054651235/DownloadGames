
"use strict";

// =====================================
// DOWNLOADGAMES - SPIELE
// =====================================

const games = [
    {
        id: "visage",
        name: "Visage",
        genre: "Psychologischer Horror",
        year: 2020,
        developer: "SadSquare Studio",
        platform: "PC",
        age: "Altersfreigabe bitte prüfen",
        price: 19.99,
        size: "Ca. 10 GB",
        os: "Windows 10 / 11",
        cpu: "Intel Core i5-3470 oder vergleichbar",
        ram: "6 GB RAM",
        gpu: "NVIDIA GTX 750 Ti oder vergleichbar",
        storage: "Mindestens 10 GB",
        image: "https://picsum.photos/seed/visage-horror/900/500",
        description: "Erkunde ein geheimnisvolles Haus. Entdecke seine dunkle Geschichte, löse Rätsel und erlebe psychologischen Horror.",
        downloadUrl: "Actiongames/Visage.zip"
    },
    {
        id: "dark-house",
        name: "Dark House",
        genre: "Horror",
        year: 2025,
        developer: "Demo Studio",
        platform: "PC",
        age: "Demoangabe",
        price: 9.99,
        size: "12 GB",
        os: "Windows 10 / 11",
        cpu: "Intel Core i5",
        ram: "8 GB RAM",
        gpu: "NVIDIA GTX 1050",
        storage: "15 GB",
        image: "https://picsum.photos/seed/darkhouse/900/500",
        description: "Erkunde ein verlassenes Haus voller Geheimnisse.",
        downloadUrl: null
    },
    {
        id: "lost-forest",
        name: "Lost Forest",
        genre: "Survival",
        year: 2024,
        developer: "Demo Studio",
        platform: "PC",
        age: "Demoangabe",
        price: 14.99,
        size: "18 GB",
        os: "Windows 10 / 11",
        cpu: "Intel Core i5",
        ram: "8 GB RAM",
        gpu: "NVIDIA GTX 1060",
        storage: "20 GB",
        image: "https://picsum.photos/seed/lostforest/900/500",
        description: "Überlebe in einem geheimnisvollen Wald.",
        downloadUrl: null
    },
    {
        id: "nightmare",
        name: "Nightmare",
        genre: "Psychologischer Horror",
        year: 2025,
        developer: "Demo Studio",
        platform: "PC",
        age: "Demoangabe",
        price: 4.99,
        size: "8 GB",
        os: "Windows 10 / 11",
        cpu: "Intel Core i3",
        ram: "8 GB RAM",
        gpu: "NVIDIA GTX 750 Ti",
        storage: "10 GB",
        image: "https://picsum.photos/seed/nightmaregame/900/500",
        description: "Eine geheimnisvolle Welt voller Rätsel.",
        downloadUrl: null
    },
    {
        id: "deep-ocean",
        name: "Deep Ocean",
        genre: "Adventure",
        year: 2024,
        developer: "Demo Studio",
        platform: "PC",
        age: "Demoangabe",
        price: 7.99,
        size: "6 GB",
        os: "Windows 10 / 11",
        cpu: "Intel Core i5",
        ram: "8 GB RAM",
        gpu: "NVIDIA GTX 950",
        storage: "8 GB",
        image: "https://picsum.photos/seed/deepocean/900/500",
        description: "Entdecke eine geheimnisvolle Unterwasserwelt.",
        downloadUrl: null
    }
];

// =====================================
// HTML-ELEMENTE
// =====================================

const gamesContainer = document.getElementById("gamesContainer");
const searchInput = document.getElementById("searchInput");
const gameCount = document.getElementById("gameCount");
const noResults = document.getElementById("noResults");

const pointsBalance = document.getElementById("pointsBalance");

const gameModal = document.getElementById("gameModal");
const closeGameModal = document.getElementById("closeGameModal");

const authModal = document.getElementById("authModal");
const loginOpenButton = document.getElementById("loginOpenButton");
const closeAuthModal = document.getElementById("closeAuthModal");

const showLoginButton = document.getElementById("showLoginButton");
const showRegisterButton = document.getElementById("showRegisterButton");

const authForm = document.getElementById("authForm");
const authUsername = document.getElementById("authUsername");
const authPassword = document.getElementById("authPassword");
const authTitle = document.getElementById("authTitle");
const authSubmitButton = document.getElementById("authSubmitButton");
const authMessage = document.getElementById("authMessage");

const cartButton = document.getElementById("cartButton");
const cartSection = document.getElementById("cartSection");
const closeCartButton = document.getElementById("closeCartButton");
const cartItems = document.getElementById("cartItems");
const cartCount = document.getElementById("cartCount");
const cartTotal = document.getElementById("cartTotal");

const buyButton = document.getElementById("buyButton");
const downloadButton = document.getElementById("downloadButton");
const addCartButton = document.getElementById("addCartButton");
const buyMessage = document.getElementById("buyMessage");

const commentInput = document.getElementById("commentInput");
const commentButton = document.getElementById("commentButton");
const commentsList = document.getElementById("commentsList");
const commentForm = document.getElementById("commentForm");
const commentLoginMessage = document.getElementById("commentLoginMessage");

// =====================================
// LOGIN-FENSTER SICHTBARKEIT
// =====================================

// Diese beiden Funktionen umgehen auch CSS-Regeln,
// die das HTML-Attribut hidden überschreiben könnten.

function hideAuthWindow() {
    authModal.hidden = true;
    authModal.style.display = "none";
}

function showAuthWindow() {
    authModal.hidden = false;
    authModal.style.removeProperty("display");
}

// Login-Fenster direkt beim Laden schließen
hideAuthWindow();

// =====================================
// DATEN LADEN
// =====================================

function loadData(key, fallback) {
    try {
        const saved = localStorage.getItem(key);
        return saved ? JSON.parse(saved) : fallback;
    } catch (error) {
        console.error("Fehler beim Laden:", error);
        return fallback;
    }
}

let points = loadData("dg_points", 0);
let purchasedGames = loadData("dg_purchased", []);
let cart = loadData("dg_cart", []);
let accounts = loadData("dg_accounts", {});
let allComments = loadData("dg_comments", []);

let currentUser = localStorage.getItem("dg_currentUser");
let selectedGame = null;
let authMode = "login";

// =====================================
// DATEN SPEICHERN
// =====================================

function saveData(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

// =====================================
// PUNKTE
// =====================================

function updatePoints() {
    pointsBalance.textContent = points.toLocaleString("de-DE");
    saveData("dg_points", points);
}

updatePoints();

// 500 Punkte pro Sekunde
setInterval(() => {
    points += 500;
    updatePoints();
}, 1000);

function getPointCost(game) {
    return Math.round(game.price * 100);
}

// =====================================
// PREIS FORMATIEREN
// =====================================

function formatPrice(price) {
    return price.toFixed(2).replace(".", ",") + " €";
}

// =====================================
// SPIELE ANZEIGEN
// =====================================

function displayGames(search = "") {
    gamesContainer.innerHTML = "";

    const filteredGames = games.filter(game => {
        return (
            game.name.toLowerCase().includes(search.toLowerCase()) ||
            game.genre.toLowerCase().includes(search.toLowerCase())
        );
    });

    gameCount.textContent = filteredGames.length + " Spiele";
    noResults.hidden = filteredGames.length !== 0;

    filteredGames.forEach(game => {
        const card = document.createElement("article");
        card.className = "game-card";

        const image = document.createElement("img");
        image.className = "game-image";
        image.src = game.image;
        image.alt = game.name;
        image.loading = "lazy";

        const information = document.createElement("div");
        information.className = "game-information";

        const title = document.createElement("h3");
        title.textContent = game.name;

        const description = document.createElement("p");
        description.textContent = game.description;

        const genre = document.createElement("span");
        genre.className = "game-genre";
        genre.textContent = game.genre;

        const price = document.createElement("span");
        price.className = "card-price";
        price.textContent = getPointCost(game) + " Punkte";

        information.append(title, description, genre, price);
        card.append(image, information);

        card.addEventListener("click", () => {
            openGame(game);
        });

        gamesContainer.appendChild(card);
    });
}

// =====================================
// SPIEL ÖFFNEN
// =====================================

function openGame(game) {
    selectedGame = game;

    document.getElementById("modalTitle").textContent = game.name;
    document.getElementById("modalDescription").textContent = game.description;
    document.getElementById("modalGenre").textContent = game.genre;
    document.getElementById("modalYear").textContent = game.year;
    document.getElementById("modalDeveloper").textContent = game.developer;
    document.getElementById("modalPlatform").textContent = game.platform;
    document.getElementById("modalAge").textContent = game.age;
    document.getElementById("modalOS").textContent = game.os;
    document.getElementById("modalCPU").textContent = game.cpu;
    document.getElementById("modalRAM").textContent = game.ram;
    document.getElementById("modalGPU").textContent = game.gpu;
    document.getElementById("modalStorage").textContent = game.storage;
    document.getElementById("modalSize").textContent = game.size;
    document.getElementById("modalImage").src = game.image;
    document.getElementById("modalPrice").textContent =
        getPointCost(game) + " Punkte";

    buyMessage.textContent = "";

    updatePurchaseButtons();
    renderComments();

    gameModal.hidden = false;
}

// =====================================
// SPIELFENSTER SCHLIESSEN
// =====================================

closeGameModal.addEventListener("click", () => {
    gameModal.hidden = true;
});

gameModal.addEventListener("click", event => {
    if (event.target === gameModal) {
        gameModal.hidden = true;
    }
});

// =====================================
// KAUFSTATUS
// =====================================

function isPurchased(game) {
    return purchasedGames.includes(game.id);
}

function updatePurchaseButtons() {
    if (!selectedGame) return;

    const purchased = isPurchased(selectedGame);

    buyButton.disabled = purchased;
    buyButton.textContent = purchased
        ? "Bereits gekauft ✓"
        : "Mit Punkten kaufen";

    downloadButton.hidden = !purchased;
}

// =====================================
// SPIEL KAUFEN
// =====================================

buyButton.addEventListener("click", () => {
    if (!selectedGame) return;

    if (isPurchased(selectedGame)) {
        buyMessage.textContent = "Du hast dieses Spiel bereits gekauft.";
        return;
    }

    const cost = getPointCost(selectedGame);

    if (points < cost) {
        buyMessage.textContent = "Du hast noch nicht genügend Punkte.";
        return;
    }

    points -= cost;
    purchasedGames.push(selectedGame.id);

    updatePoints();
    saveData("dg_purchased", purchasedGames);
    updatePurchaseButtons();

    buyMessage.textContent =
        "Kauf erfolgreich! Du kannst das Spiel jetzt herunterladen.";
});

// =====================================
// DOWNLOAD
// =====================================

downloadButton.addEventListener("click", () => {
    if (!selectedGame) return;

    if (!isPurchased(selectedGame)) {
        buyMessage.textContent = "Du musst das Spiel zuerst kaufen.";
        return;
    }

    if (!selectedGame.downloadUrl) {
        buyMessage.textContent =
            "Für dieses Spiel ist noch kein Download verfügbar.";
        return;
    }

    const link = document.createElement("a");
    link.href = selectedGame.downloadUrl;
    link.download = "";

    document.body.appendChild(link);
    link.click();
    link.remove();
});

// =====================================
// WARENKORB
// =====================================

function renderCart() {
    cartItems.innerHTML = "";

    let total = 0;

    cart.forEach((gameId, index) => {
        const game = games.find(item => item.id === gameId);
        if (!game) return;

        total += game.price;

        const item = document.createElement("div");
        item.className = "cart-item";

        const name = document.createElement("span");
        name.className = "cart-item-name";
        name.textContent = game.name;

        const price = document.createElement("span");
        price.className = "cart-item-price";
        price.textContent = formatPrice(game.price);

        const remove = document.createElement("button");
        remove.className = "remove-button";
        remove.textContent = "Entfernen";

        remove.addEventListener("click", () => {
            cart.splice(index, 1);
            saveData("dg_cart", cart);
            renderCart();
        });

        item.append(name, price, remove);
        cartItems.appendChild(item);
    });

    cartCount.textContent = cart.length;
    cartTotal.textContent = formatPrice(total);

    if (cart.length === 0) {
        cartItems.textContent = "Dein Warenkorb ist leer.";
    }
}

addCartButton.addEventListener("click", () => {
    if (!selectedGame) return;

    if (cart.includes(selectedGame.id)) {
        buyMessage.textContent =
            "Dieses Spiel ist bereits im Warenkorb.";
        return;
    }

    cart.push(selectedGame.id);
    saveData("dg_cart", cart);
    renderCart();

    buyMessage.textContent =
        "Spiel wurde in den Warenkorb gelegt.";
});

cartButton.addEventListener("click", () => {
    cartSection.hidden = !cartSection.hidden;

    if (!cartSection.hidden) {
        renderCart();

        cartSection.scrollIntoView({
            behavior: "smooth"
        });
    }
});

closeCartButton.addEventListener("click", () => {
    cartSection.hidden = true;
});

// =====================================
// LOGIN-FENSTER ÖFFNEN
// =====================================

loginOpenButton.addEventListener("click", () => {
    if (currentUser) {
        const shouldLogout = confirm(
            "Du bist als " + currentUser +
            " angemeldet.\nMöchtest du dich ausloggen?"
        );

        if (shouldLogout) {
            logout();
        }

        return;
    }

    setAuthMode("login");
    showAuthWindow();
});

// X-BUTTON
closeAuthModal.addEventListener("click", () => {
    hideAuthWindow();
});

// Klick außerhalb des Fensters
authModal.addEventListener("click", event => {
    if (event.target === authModal) {
        hideAuthWindow();
    }
});

// =====================================
// LOGIN ODER REGISTRIERUNG AUSWÄHLEN
// =====================================

function setAuthMode(mode) {
    authMode = mode;
    authMessage.textContent = "";

    if (mode === "login") {
        authTitle.textContent = "Willkommen zurück!";
        authSubmitButton.textContent = "Einloggen";

        showLoginButton.classList.add("active");
        showRegisterButton.classList.remove("active");

        authPassword.autocomplete = "current-password";
    } else {
        authTitle.textContent = "Konto erstellen";
        authSubmitButton.textContent = "Registrieren";

        showRegisterButton.classList.add("active");
        showLoginButton.classList.remove("active");

        authPassword.autocomplete = "new-password";
    }
}

showLoginButton.addEventListener("click", () => {
    setAuthMode("login");
});

showRegisterButton.addEventListener("click", () => {
    setAuthMode("register");
});

// =====================================
// PASSWORT-HASHING FÜR LOKALE DEMO
// =====================================

async function hashPassword(password, salt) {
    const data = new TextEncoder().encode(salt + password);

    const hash = await crypto.subtle.digest("SHA-256", data);

    return Array.from(new Uint8Array(hash))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

// =====================================
// REGISTRIEREN UND EINLOGGEN
// =====================================

authForm.addEventListener("submit", async event => {
    event.preventDefault();

    const username = authUsername.value.trim();
    const password = authPassword.value;
    const usernameKey = username.toLowerCase();

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        authMessage.textContent =
            "Benutze 3–20 Buchstaben, Zahlen oder Unterstriche.";
        return;
    }

    if (password.length < 8) {
        authMessage.textContent =
            "Das Passwort muss mindestens 8 Zeichen haben.";
        return;
    }

    if (!crypto.subtle) {
        authMessage.textContent =
            "Bitte öffne die Website über VS Code mit Live Server.";
        return;
    }

    authSubmitButton.disabled = true;

    try {
        // REGISTRIERUNG
        if (authMode === "register") {
            if (accounts[usernameKey]) {
                authMessage.textContent =
                    "Dieser Benutzername ist bereits vergeben.";
                return;
            }

            const salt = crypto.randomUUID();

            const passwordHash = await hashPassword(password, salt);

            accounts[usernameKey] = {
                username: username,
                salt: salt,
                passwordHash: passwordHash
            };

            saveData("dg_accounts", accounts);

            // Direkt nach Registrierung anmelden
            currentUser = username;

            localStorage.setItem("dg_currentUser", currentUser);

            authPassword.value = "";

            hideAuthWindow();
            updateLoginDisplay();

            return;
        }

        // LOGIN
        const account = accounts[usernameKey];

        if (!account) {
            authMessage.textContent =
                "Benutzername oder Passwort falsch.";
            return;
        }

        const passwordHash = await hashPassword(
            password,
            account.salt
        );

        if (passwordHash !== account.passwordHash) {
            authMessage.textContent =
                "Benutzername oder Passwort falsch.";
            return;
        }

        currentUser = account.username;

        localStorage.setItem("dg_currentUser", currentUser);

        authPassword.value = "";

        hideAuthWindow();
        updateLoginDisplay();

    } catch (error) {
        console.error(error);

        authMessage.textContent =
            "Es gab einen Fehler. Bitte versuche es erneut.";

    } finally {
        authSubmitButton.disabled = false;
    }
});

// =====================================
// AUSLOGGEN
// =====================================

function logout() {
    currentUser = null;

    localStorage.removeItem("dg_currentUser");

    // Sicherheitshalber auch das Login-Fenster schließen
    hideAuthWindow();

    updateLoginDisplay();
}

// =====================================
// LOGIN-ANZEIGE AKTUALISIEREN
// =====================================

function updateLoginDisplay() {
    const account = currentUser
        ? accounts[currentUser.toLowerCase()]
        : null;

    if (!account) {
        currentUser = null;
        localStorage.removeItem("dg_currentUser");
    }

    loginOpenButton.textContent = currentUser
        ? "👤 " + currentUser + " · Ausloggen"
        : "Einloggen";

    commentForm.hidden = !currentUser;
    commentLoginMessage.hidden = Boolean(currentUser);

    renderComments();
}

// =====================================
// KOMMENTARE ANZEIGEN
// =====================================

function renderComments() {
    if (!selectedGame) return;

    commentsList.innerHTML = "";

    const gameComments = allComments.filter(
        comment => comment.gameId === selectedGame.id
    );

    if (gameComments.length === 0) {
        commentsList.textContent = "Noch keine Kommentare.";
        return;
    }

    gameComments.forEach(comment => {
        const item = document.createElement("div");
        item.className = "comment-item";

        const author = document.createElement("div");
        author.className = "comment-author";
        author.textContent = comment.username;

        const message = document.createElement("p");
        message.className = "comment-text";
        message.textContent = comment.text;

        item.append(author, message);
        commentsList.appendChild(item);
    });
}

// =====================================
// KOMMENTAR HINZUFÜGEN
// =====================================

commentButton.addEventListener("click", () => {
    if (!currentUser) {
        commentLoginMessage.textContent =
            "Du musst eingeloggt sein, um zu kommentieren.";
        return;
    }

    if (!selectedGame) return;

    const text = commentInput.value.trim();

    if (text.length < 2) {
        commentLoginMessage.textContent =
            "Dein Kommentar ist zu kurz.";
        return;
    }

    allComments.push({
        gameId: selectedGame.id,
        username: currentUser,
        text: text,
        date: new Date().toISOString()
    });

    saveData("dg_comments", allComments);

    commentInput.value = "";

    commentLoginMessage.textContent =
        "Kommentar erfolgreich hinzugefügt!";

    renderComments();
});

// =====================================
// SUCHE
// =====================================

searchInput.addEventListener("input", () => {
    displayGames(searchInput.value.trim());
});

// =====================================
// TASTATUR
// =====================================

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        gameModal.hidden = true;
        hideAuthWindow();
    }
});

// =====================================
// START
// =====================================

// Login-Fenster beim Start sicher schließen
hideAuthWindow();

renderCart();
displayGames();
updateLoginDisplay();
