"use strict";

function startDownload(gameId) {
    const game = games.find(g => g.id === gameId);

    if (!game) {
        alert("Spiel nicht gefunden!");
        return;
    }

    if (!game.downloadUrl) {
        alert("Für dieses Spiel ist noch kein Download verfügbar!");
        return;
    }

    let url;

    try {
        url = new URL(game.downloadUrl);
    } catch {
        alert("Der Downloadlink ist ungültig!");
        return;
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
        alert("Dieser Link ist nicht erlaubt!");
        return;
    }

    window.location.assign(url.href);
}