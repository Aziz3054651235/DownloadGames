
"use strict";

/* ==========================================
   DOWNLOADGAMES – KI-ERINNERUNG
   - Dauerhafte Chat-ID
   - Frühere Gespräche
   - Verbindung zu Ollama
   - Projektwissen vom Server
========================================== */

window.DownloadGamesAI = (() => {

    const SESSION_KEY = "dg_ai_session";
    const HISTORY_KEY = "dg_ai_history";

    const MODEL_URL = "/api/chat";

    function getSessionId() {
        let id = localStorage.getItem(SESSION_KEY);

        if (!id) {
            id = "dg_" +
                Date.now().toString(36) +
                "_" +
                Math.random().toString(36).slice(2, 14);

            localStorage.setItem(SESSION_KEY, id);
        }

        return id;
    }

    function getHistory() {
        try {
            const history = JSON.parse(
                localStorage.getItem(HISTORY_KEY) || "[]"
            );

            return Array.isArray(history)
                ? history.slice(-30)
                : [];

        } catch {
            return [];
        }
    }

    function saveHistory(history) {
        localStorage.setItem(
            HISTORY_KEY,
            JSON.stringify(history.slice(-30))
        );
    }

    async function ask(message, options = {}) {

        if (!message || !String(message).trim()) {
            throw new Error("Die Nachricht ist leer.");
        }

        const history = getHistory();

        const response = await fetch(MODEL_URL, {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                message: String(message),
                history: history,
                sessionId: getSessionId(),
                userName: options.userName || "",
                games: options.games || []
            })
        });

        if (!response.ok) {
            throw new Error(
                "KI-Server antwortet nicht: HTTP " +
                response.status
            );
        }

        const data = await response.json();

        if (!data.answer) {
            throw new Error("Die KI hat keine Antwort geliefert.");
        }

        history.push({
            role: "user",
            content: String(message)
        });

        history.push({
            role: "assistant",
            content: String(data.answer)
        });

        saveHistory(history);

        return data.answer;
    }

    function clearHistory() {
        localStorage.removeItem(HISTORY_KEY);
        localStorage.removeItem(SESSION_KEY);
    }

    function getStatus() {
        return fetch("/api/status")
            .then(response => response.json());
    }

    return {
        ask,
        getHistory,
        clearHistory,
        getStatus,
        getSessionId
    };

})();
