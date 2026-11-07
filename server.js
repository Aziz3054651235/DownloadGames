
"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

const ROOT = __dirname;
const MEMORY_DIR = path.join(ROOT, "data", "chat-memory");

const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const MODEL = "qwen3:4b";

app.use(express.json({ limit: "5mb" }));
app.use(express.static(ROOT));

// Speicherordner für Chat-Erinnerungen
fs.mkdirSync(MEMORY_DIR, { recursive: true });

// Diese Ordner werden NICHT gelesen
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".Backup",
  ".vscode",
  "Actiongames",
  "data",
  "dist",
  "build"
]);

// Nur diese Dateitypen darf die KI lesen
const ALLOWED_EXTENSIONS = new Set([
  ".html",
  ".css",
  ".js",
  ".json",
  ".md",
  ".txt"
]);

// Sicherheitsgrenzen
const MAX_FILE_SIZE = 40000;
const MAX_PROJECT_CONTEXT = 120000;
const MAX_HISTORY = 30;

// Projektdateien automatisch lesen
function readProjectFiles() {
  let result = "";
  let totalSize = 0;

  function scan(directory) {
    if (totalSize >= MAX_PROJECT_CONTEXT) return;

    let entries;

    try {
      entries = fs.readdirSync(directory, {
        withFileTypes: true
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (totalSize >= MAX_PROJECT_CONTEXT) break;

      const fullPath = path.join(directory, entry.name);

      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        scan(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const extension = path.extname(entry.name).toLowerCase();

      if (!ALLOWED_EXTENSIONS.has(extension)) continue;

      // Keine geheimen Konfigurationsdateien lesen
      if (
        entry.name.startsWith(".env") ||
        entry.name.includes("secret") ||
        entry.name.includes("password")
      ) {
        continue;
      }

      try {
        const stat = fs.statSync(fullPath);

        if (stat.size > MAX_FILE_SIZE) continue;

        const content = fs.readFileSync(fullPath, "utf8");
        const relativePath = path.relative(ROOT, fullPath);

        const section =
          "\n\n========== DATEI: " +
          relativePath +
          " ==========\n" +
          content;

        if (totalSize + section.length > MAX_PROJECT_CONTEXT) {
          continue;
        }

        result += section;
        totalSize += section.length;
      } catch (error) {
        console.error("Datei übersprungen:", entry.name);
      }
    }
  }

  scan(ROOT);

  return result;
}

// Gesprächs-ID prüfen
function validSessionId(id) {
  return (
    typeof id === "string" &&
    /^[a-zA-Z0-9_-]{8,80}$/.test(id)
  );
}

// Frühere Unterhaltung laden
function loadMemory(sessionId) {
  const file = path.join(MEMORY_DIR, sessionId + ".json");

  try {
    if (!fs.existsSync(file)) return [];

    const data = JSON.parse(fs.readFileSync(file, "utf8"));

    if (!Array.isArray(data)) return [];

    return data.filter(item =>
      item &&
      ["user", "assistant"].includes(item.role) &&
      typeof item.content === "string"
    ).slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

// Unterhaltung dauerhaft speichern
function saveMemory(sessionId, history) {
  const file = path.join(MEMORY_DIR, sessionId + ".json");

  const safeHistory = history.slice(-MAX_HISTORY);

  fs.writeFileSync(
    file,
    JSON.stringify(safeHistory, null, 2),
    "utf8"
  );
}

// KI-Antwort bereinigen
function cleanAnswer(answer) {
  return String(answer || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
}

// Haupt-Chat
app.post("/api/chat", async (req, res) => {
  try {
    const {
      message,
      history,
      userName,
      games,
      sessionId
    } = req.body || {};

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        answer: "Bitte schreibe zuerst eine Nachricht."
      });
    }

    if (!validSessionId(sessionId)) {
      return res.status(400).json({
        answer: "Ungültige Chat-ID. Bitte lade die Website neu."
      });
    }

    // Dauerhafte Erinnerung laden
    let oldHistory = loadMemory(sessionId);

    // Falls noch keine gespeicherte Unterhaltung existiert,
    // den bisherigen Verlauf aus dem Browser übernehmen.
    if (
      oldHistory.length === 0 &&
      Array.isArray(history)
    ) {
      oldHistory = history
        .filter(item =>
          item &&
          ["user", "assistant"].includes(item.role) &&
          typeof item.content === "string"
        )
        .slice(-MAX_HISTORY);
    }

    // Website-Dateien frisch einlesen
    const projectContext = readProjectFiles();

    // Spieleinformationen übernehmen
    const gamesContext = JSON.stringify(
      games || [],
      null,
      2
    ).slice(0, 50000);

    const systemPrompt = `
Du bist die offizielle KI von DownloadGames.

DEINE AUFGABEN:
- Hilf Besuchern bei Fragen über DownloadGames.
- Verstehe normale Sprache und unterschiedliche Formulierungen.
- Beantworte Fragen anhand der tatsächlichen Projektdateien.
- Nutze die Spieleinformationen für Fragen über Spiele.
- Erinnere dich an den bisherigen Gesprächsverlauf.
- Erkläre technische Probleme Schritt für Schritt.
- Erfinde keine Funktionen, Preise, Spiele oder Systemanforderungen.
- Wenn eine Information nicht vorhanden ist, sage das ehrlich.
- Behaupte niemals, etwas ausgeführt oder verändert zu haben,
  wenn du es nicht tatsächlich getan hast.
- Antworte auf Deutsch, wenn der Besucher Deutsch schreibt.

BENUTZER:
${String(userName || "Besucher").slice(0, 80)}

SPIELE-DATEN:
${gamesContext}

QUELLCODE UND INFORMATIONEN DER WEBSITE:
${projectContext}
`;

    // Aktuelle Nachricht ergänzen
    const conversation = [
      ...oldHistory,
      {
        role: "user",
        content: message.trim().slice(0, 10000)
      }
    ].slice(-MAX_HISTORY);

    const ollamaMessages = [
      {
        role: "system",
        content: systemPrompt
      },
      ...conversation
    ];

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      180000
    );

    let ollamaResponse;

    try {
      ollamaResponse = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          messages: ollamaMessages,
          stream: false,
          think: false
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!ollamaResponse.ok) {
      throw new Error(
        "Ollama antwortete mit HTTP " +
        ollamaResponse.status
      );
    }

    const result = await ollamaResponse.json();

    const answer = cleanAnswer(
      result.message?.content
    );

    if (!answer) {
      throw new Error("Die KI hat keine Antwort geliefert.");
    }

    // Antwort zur Erinnerung hinzufügen
    const updatedHistory = [
      ...conversation,
      {
        role: "assistant",
        content: answer
      }
    ].slice(-MAX_HISTORY);

    saveMemory(sessionId, updatedHistory);

    res.json({ answer });

  } catch (error) {
    console.error("Chat-Fehler:", error);

    const message =
      error.name === "AbortError"
        ? "Die KI braucht zu lange. Bitte versuche es erneut."
        : "Die KI ist momentan nicht erreichbar. Prüfe, ob Ollama läuft.";

    res.status(500).json({
      answer: message
    });
  }
});

// Prüfen, ob Server und Ollama erreichbar sind
app.get("/api/status", async (req, res) => {
  try {
    const response = await fetch(
      "http://127.0.0.1:11434/api/tags"
    );

    const data = await response.json();

    res.json({
      server: "online",
      ollama: "online",
      model: MODEL,
      modelInstalled: (data.models || []).some(
        item => item.name.startsWith(MODEL)
      )
    });
  } catch {
    res.json({
      server: "online",
      ollama: "offline",
      model: MODEL
    });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log("--------------------------------");
  console.log("DownloadGames KI läuft!");
  console.log("Website: http://localhost:" + PORT);
  console.log("KI-Modell: " + MODEL);
  console.log("Projektdateien werden eingelesen.");
  console.log("Chat-Erinnerungen sind aktiviert.");
  console.log("--------------------------------");
});
