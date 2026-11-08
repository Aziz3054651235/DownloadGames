
"use strict";

/* ==========================================
   DOWNLOADGAMES – PASSWORT ZURÜCKSETZEN
   Verbindung zum SQLite-Backend

   /api/forgot -> Reset-Link per E-Mail
   /api/reset  -> Neues Passwort speichern
========================================== */

(() => {
    const RESET_MIN_LENGTH = 8;

    // --------------------------------------
    // Fenster erstellen
    // --------------------------------------

    const style = document.createElement("style");

    style.textContent = `
    .dgr {
        position: fixed;
        inset: 0;
        z-index: 10000;
        background: #000b;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
    }

    .dgr.hidden {
        display: none;
    }

    .dgr-box {
        background: var(--surface, #191b29);
        border: 1px solid var(--border, #303249);
        border-radius: 14px;
        padding: 22px;
        width: min(420px, 100%);
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .dgr-box h3 {
        margin: 0;
    }

    .dgr-box p {
        font-size: 13px;
        margin: 0;
    }

    .dgr-box input {
        width: 100%;
        box-sizing: border-box;
    }

    .dgr-message {
        min-height: 20px;
        color: var(--muted, #9aa0b8);
    }
    `;

    document.head.appendChild(style);

    const overlay = document.createElement("div");
    overlay.className = "dgr hidden";

    const box = document.createElement("div");
    box.className = "dgr-box";

    const title = document.createElement("h3");
    title.textContent = "Passwort zurücksetzen";

    const description = document.createElement("p");

    const identifier = document.createElement("input");
    identifier.placeholder = "E-Mail oder Benutzername";
    identifier.autocomplete = "username";

    const newPassword = document.createElement("input");
    newPassword.type = "password";
    newPassword.placeholder = "Neues Passwort (mind. 8 Zeichen)";
    newPassword.autocomplete = "new-password";

    const repeatPassword = document.createElement("input");
    repeatPassword.type = "password";
    repeatPassword.placeholder = "Passwort wiederholen";
    repeatPassword.autocomplete = "new-password";

    const message = document.createElement("p");
    message.className = "dgr-message";

    const sendButton = document.createElement("button");
    sendButton.textContent = "Reset-Link senden";

    const resetButton = document.createElement("button");
    resetButton.textContent = "Passwort ändern";

    const closeButton = document.createElement("button");
    closeButton.textContent = "Schließen";

    box.append(
        title,
        description,
        identifier,
        sendButton,
        newPassword,
        repeatPassword,
        resetButton,
        message,
        closeButton
    );

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // --------------------------------------
    // Ansicht wechseln
    // --------------------------------------

    let resetToken = null;

    function showRequestMode() {
        description.textContent =
            "Gib deine E-Mail-Adresse oder deinen Benutzernamen ein. " +
            "Wir senden dir einen Link zum Zurücksetzen.";

        identifier.style.display = "";
        sendButton.style.display = "";

        newPassword.style.display = "none";
        repeatPassword.style.display = "none";
        resetButton.style.display = "none";
    }

    function showResetMode() {
        description.textContent =
            "Lege jetzt ein neues Passwort für dein Konto fest.";

        identifier.style.display = "none";
        sendButton.style.display = "none";

        newPassword.style.display = "";
        repeatPassword.style.display = "";
        resetButton.style.display = "";
    }

    function openReset() {
        message.textContent = "";
        overlay.classList.remove("hidden");

        showRequestMode();

        const loginInput = document.getElementById("authUsername");

        if (loginInput) {
            identifier.value = loginInput.value.trim();
        }

        identifier.focus();
    }

    function closeReset() {
        overlay.classList.add("hidden");
        message.textContent = "";

        newPassword.value = "";
        repeatPassword.value = "";
    }

    closeButton.addEventListener("click", closeReset);

    overlay.addEventListener("click", event => {
        if (event.target === overlay) closeReset();
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeReset();
    });

    // --------------------------------------
    // 1. Reset-Link anfordern
    // --------------------------------------

    async function sendCode() {
        const id = identifier.value.trim();

        if (!id) {
            message.textContent =
                "Bitte E-Mail oder Benutzernamen eingeben.";
            return;
        }

        sendButton.disabled = true;
        message.textContent = "Anfrage wird gesendet ...";

        try {
            const response = await fetch("/api/forgot", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    identifier: id
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error || "Anfrage fehlgeschlagen."
                );
            }

            message.textContent =
                data.message ||
                "Falls ein Konto existiert, wurde eine E-Mail versendet.";

        } catch (error) {
            message.textContent =
                error.message || "Server nicht erreichbar.";

        } finally {
            sendButton.disabled = false;
        }
    }

    // --------------------------------------
    // 2. Neues Passwort speichern
    // --------------------------------------

    async function confirmReset() {
        const password = newPassword.value;
        const repeat = repeatPassword.value;

        if (!resetToken) {
            message.textContent =
                "Reset-Link fehlt. Fordere bitte einen neuen an.";
            return;
        }

        if (password.length < RESET_MIN_LENGTH) {
            message.textContent =
                "Das Passwort muss mindestens 8 Zeichen haben.";
            return;
        }

        if (password.length > 200) {
            message.textContent =
                "Das Passwort darf höchstens 200 Zeichen haben.";
            return;
        }

        if (password !== repeat) {
            message.textContent =
                "Die Passwörter stimmen nicht überein.";
            return;
        }

        resetButton.disabled = true;
        message.textContent = "Passwort wird geändert ...";

        try {
            const response = await fetch("/api/reset", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    token: resetToken,
                    password: password
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error || "Passwort konnte nicht geändert werden."
                );
            }

            message.textContent =
                data.message || "Passwort erfolgreich geändert.";

            resetToken = null;

            newPassword.value = "";
            repeatPassword.value = "";

            // Reset-Token aus der Browseradresse entfernen.
            window.history.replaceState(
                {},
                document.title,
                window.location.pathname
            );

            setTimeout(() => {
                closeReset();

                if (typeof showAuthWindow === "function") {
                    showAuthWindow();
                }
            }, 1800);

        } catch (error) {
            message.textContent =
                error.message || "Server nicht erreichbar.";

        } finally {
            resetButton.disabled = false;
        }
    }

    sendButton.addEventListener("click", sendCode);
    resetButton.addEventListener("click", confirmReset);

    // --------------------------------------
    // Link im Login-Fenster
    // --------------------------------------

    const authMessage = document.getElementById("authMessage");

    if (authMessage) {
        const link = document.createElement("a");

        link.href = "#";
        link.className = "link";
        link.textContent = "Passwort vergessen?";

        link.addEventListener("click", event => {
            event.preventDefault();

            if (typeof hideAuthWindow === "function") {
                hideAuthWindow();
            }

            openReset();
        });

        const wrapper = document.createElement("p");
        wrapper.appendChild(link);

        authMessage.after(wrapper);
    }

    // --------------------------------------
    // Reset-Link aus der E-Mail erkennen
    // --------------------------------------

    const params = new URLSearchParams(window.location.search);
    const token = params.get("reset");

    if (token) {
        resetToken = token;

        overlay.classList.remove("hidden");
        showResetMode();

        message.textContent =
            "Reset-Link erkannt. Du kannst dein neues Passwort eingeben.";

        newPassword.focus();
    }

})();
