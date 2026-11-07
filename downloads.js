
"use strict";

function startDownload(gameId) {
    const game = games.find(g => g.id === gameId);

    if (!game || !game.downloadUrl) {
        alert("Kein Download für dieses Spiel verfügbar!");
        return;
    }

    try {
        const url = new URL(game.downloadUrl, window.location.href);

        if (url.protocol !== "https:" && url.protocol !== "http:") {
            throw new Error("Ungültiges Protokoll");
        }

        window.location.assign(url.href);
    } catch {
        alert("Der Downloadlink ist ungültig!");
    }
}
