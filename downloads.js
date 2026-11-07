"use strict";

async function startDownload(gameId) {
    const game = games.find(g => g.id === gameId);

    if (!game) {
        alert("Spiel nicht gefunden!");
        return;
    }

    if (!game.downloadUrl) {
        alert("Kein Downloadlink verfügbar!");
        return;
    }

    window.location.href = game.downloadUrl;
}