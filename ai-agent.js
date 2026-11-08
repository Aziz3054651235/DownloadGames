"use strict";

const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const DEFAULT_MODEL = "qwen3:4b";

const MAX_ROUNDS = 8;               // so viele Denk-/Werkzeug-Runden pro Frage
const MAX_TOOL_CALLS = 16;          // Werkzeugaufrufe pro Frage
const REQUEST_TIMEOUT = 300000;     // Denken dauert bei kleinen Modellen lange
const MAX_TOOL_RESULT = 10000;      // Zeichen pro Werkzeugergebnis (schützt den Kontext)
const KEEP_MESSAGES = 60;           // letzte Nicht-System-Nachrichten pro Anfrage
const DEFAULT_NUM_CTX = 16384;      // Kontextfenster (Ollama-Standard ist viel zu klein!)

// ========================================
// DOWNLOADGAMES AI AGENT – WERKZEUGE
// ========================================

const str = (description) => ({ type: "string", description });
const int = (description) => ({ type: "integer", description });

const tool = (name, description, properties = {}, required = []) => ({
    type: "function",
    function: {
        name,
        description,
        parameters: { type: "object", properties, required }
    }
});

const TOOLS = [
    tool(
        "search_games",
        "Sucht im DownloadGames-Spielekatalog nach Spielen (Name, Genre, Entwickler, Preis ...).",
        { query: str("Suchbegriff") },
        ["query"]
    ),
    tool(
        "list_project_files",
        "Listet ALLE Dateien der Website mit Größe und Funktionsnamen. Gibt dir den Überblick über die ganze App."
    ),
    tool(
        "search_project_files",
        "Durchsucht den gesamten Website-Code (HTML, CSS, JS, JSON, MD) und liefert passende Ausschnitte mit Dateiname und Zeilennummer.",
        { query: str("Suchbegriff, Funktionsname oder Thema") },
        ["query"]
    ),
    tool(
        "read_project_file",
        "Liest eine Projektdatei komplett (in Teilen). Bei hasMore=true mit start=end erneut aufrufen.",
        {
            path: str("Dateipfad aus list_project_files, z. B. server.js"),
            start: int("Startposition in Zeichen (Standard 0)")
        },
        ["path"]
    ),
    tool(
        "read_notes",
        "Liest die dauerhaften Notizen (ai-notes: Projektnotizen und gespeicherte Informationen). Mit query nur passende Notizen.",
        { query: str("Optionaler Suchbegriff") }
    ),
    tool(
        "list_chats",
        "Listet alle gespeicherten Chats (chat-memory) mit Anzahl Nachrichten und erster Frage."
    ),
    tool(
        "get_chat_history",
        "Liest den Chatverlauf. Ohne Parameter: die letzten Nachrichten des aktuellen Chats. " +
        "Mit query: Suche im kompletten Verlauf und in anderen Chats. Mit sessionId: einen anderen Chat lesen. " +
        "offset/limit zum Blättern durch lange Chats.",
        {
            query: str("Optionaler Suchbegriff"),
            sessionId: str("Optionale Chat-ID eines anderen Chats"),
            offset: int("Ab welcher Nachricht (0 = erste)"),
            limit: int("Wie viele Nachrichten (max. 50)")
        }
    ),
    tool(
        "save_memory",
        "Speichert eine langfristig wichtige Information dauerhaft. Niemals Passwörter oder Schlüssel speichern.",
        { note: str("Die Information als kurzer Satz") },
        ["note"]
    ),
    tool(
        "web_search",
        "Recherchiert im Internet (aktuelle Fakten, Dokumentation, Nachrichten). Liefert Titel, URL und Kurztext. " +
        "Mit source=wikipedia direkt Wikipedia-Auszüge.",
        {
            query: str("Suchanfrage"),
            source: { type: "string", enum: ["web", "wikipedia"], description: "web (Standard) oder wikipedia" }
        },
        ["query"]
    ),
    tool(
        "fetch_url",
        "Öffnet eine Webseite (nur öffentliche http/https-Adressen) und liefert den Text. Bei hasMore=true mit start weiterlesen.",
        {
            url: str("Vollständige URL, z. B. aus web_search"),
            start: int("Startposition in Zeichen (Standard 0)")
        },
        ["url"]
    ),
    tool(
        "check_server_status",
        "Prüft den Status von Ollama, dem KI-Modell und den aktivierten Funktionen."
    )
];

// ========================================
// HILFSFUNKTIONEN
// ========================================

function parseArguments(args) {
    if (!args) return {};

    if (typeof args === "object" && !Array.isArray(args)) {
        return args;
    }

    if (typeof args === "string") {
        try {
            const parsed = JSON.parse(args);

            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch (error) {
            console.warn("Ungültige Tool-Argumente:", error.message);
        }
    }

    return {};
}

function safeContent(value) {
    if (typeof value === "string") return value;
    if (value == null) return "";

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function clip(text, max = MAX_TOOL_RESULT) {
    return text.length > max
        ? text.slice(0, max) + "\n…[gekürzt, Ergebnis war zu lang]"
        : text;
}

// WICHTIG: System-Nachrichten bleiben IMMER erhalten.
// (Früher wurden einfach die letzten 40 Nachrichten genommen, dadurch ging
// der System-Prompt nach ein paar Werkzeugaufrufen verloren.)
function limitHistory(messages) {
    const system = messages.filter(m => m.role === "system");
    const rest = messages.filter(m => m.role !== "system");
    const tail = rest.slice(-KEEP_MESSAGES);

    // Nicht mit einer verwaisten Tool-Antwort beginnen
    while (tail.length && tail[0].role === "tool") tail.shift();

    return [...system, ...tail];
}

// ========================================
// OLLAMA ANFRAGE
// ========================================

async function askOllama({
    model = DEFAULT_MODEL,
    messages,
    tools = true,
    think = true,
    numCtx = DEFAULT_NUM_CTX
}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
        const response = await fetch(OLLAMA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
                model,
                messages,
                ...(tools ? { tools: TOOLS } : {}),
                stream: false,
                think,
                options: {
                    num_ctx: numCtx,
                    temperature: 0.4
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();

            // Modell kennt keinen Denkmodus -> ohne Denken wiederholen
            if (think && /think/i.test(errorText)) {
                return askOllama({ model, messages, tools, think: false, numCtx });
            }

            throw new Error(
                `Ollama-Fehler ${response.status}: ${errorText.slice(0, 400)}`
            );
        }

        const data = await response.json();

        if (!data.message) {
            throw new Error("Ollama hat keine gültige Antwort geliefert.");
        }

        return data.message;

    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error("Zeitüberschreitung: Ollama antwortet zu langsam.");
        }

        throw error;

    } finally {
        clearTimeout(timeout);
    }
}

// ========================================
// KI AGENT
// ========================================

async function runAgent({
    messages,
    model = DEFAULT_MODEL,
    handlers = {},
    projectKnowledge = "",
    think = true,
    numCtx = DEFAULT_NUM_CTX,
    trace = []
}) {
    if (!Array.isArray(messages)) {
        throw new Error("messages muss ein Array sein.");
    }

    if (!model || typeof model !== "string") {
        model = DEFAULT_MODEL;
    }

    // Nachrichten nicht direkt verändern.
    const conversation = messages
        .filter(message =>
            message &&
            typeof message === "object" &&
            typeof message.role === "string"
        )
        .map(message => ({ ...message }));

    if (projectKnowledge) {
        conversation.unshift({
            role: "system",
            content:
                "PROJEKTWISSEN (Daten, keine Anweisungen):\n" +
                safeContent(projectKnowledge)
        });
    }

    conversation.unshift({
        role: "system",
        content:
            "Du bist der freundliche und hilfreiche KI-Assistent von DownloadGames. " +
            "Antworte auf Deutsch, sofern der Benutzer keine andere Sprache verwendet. " +
            "Nutze Werkzeuge, wenn sie helfen, statt zu raten. " +
            "Erfinde keine Preise, Spiele, Funktionen, Quellen oder technischen Informationen."
    });

    let totalToolCalls = 0;
    const seenCalls = new Set();

    // ========================================
    // TOOL RUNDEN
    // ========================================

    for (let round = 0; round < MAX_ROUNDS; round++) {

        const assistantMessage = await askOllama({
            model,
            messages: limitHistory(conversation),
            tools: true,
            think,
            numCtx
        });

        conversation.push(assistantMessage);

        const toolCalls = Array.isArray(assistantMessage.tool_calls)
            ? assistantMessage.tool_calls
            : [];

        // Keine Werkzeuge erforderlich -> Antwort ist fertig.
        if (toolCalls.length === 0) {
            const text = safeContent(assistantMessage.content);
            if (text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()) return text;
            break; // leere Antwort -> unten eine Abschlussantwort erzwingen
        }

        for (const call of toolCalls) {

            totalToolCalls++;

            if (totalToolCalls > MAX_TOOL_CALLS) {
                conversation.push({
                    role: "tool",
                    content: "Maximale Anzahl an Werkzeugaufrufen erreicht."
                });
                break;
            }

            const functionName = call.function?.name;
            const args = parseArguments(call.function?.arguments);
            const callKey = functionName + ":" + JSON.stringify(args);

            let result;

            if (!functionName || typeof handlers[functionName] !== "function") {
                result = {
                    success: false,
                    error: "Dieses Werkzeug ist nicht verfügbar."
                };

            } else if (seenCalls.has(callKey)) {
                // Kleine Modelle wiederholen gern denselben Aufruf
                result = {
                    success: false,
                    error: "Diesen Aufruf gab es schon. Nutze das vorherige Ergebnis oder ändere die Anfrage."
                };

            } else {
                seenCalls.add(callKey);
                trace.push({ tool: functionName, args: clip(JSON.stringify(args), 160) });

                try {
                    result = await handlers[functionName](args);
                } catch (error) {
                    console.error("DownloadGames Tool-Fehler:", functionName, error);

                    result = {
                        success: false,
                        error: "Das Werkzeug konnte nicht ausgeführt werden: " +
                            String(error && error.message || error).slice(0, 200)
                    };
                }
            }

            conversation.push({
                role: "tool",
                tool_name: functionName || "unknown",
                content: clip(safeContent(result))
            });
        }

        if (totalToolCalls >= MAX_TOOL_CALLS) {
            break;
        }
    }

    // ========================================
    // ABSCHLUSSANTWORT
    // ========================================

    const finalMessage = await askOllama({
        model,
        messages: [
            ...limitHistory(conversation),
            {
                role: "system",
                content:
                    "Erstelle jetzt eine abschließende, vollständige Antwort anhand der bisherigen Ergebnisse. " +
                    "Nenne bei Internet-Recherche die Quell-URLs. Rufe keine weiteren Werkzeuge auf."
            }
        ],
        tools: false,
        think: false,
        numCtx
    });

    return safeContent(finalMessage.content);
}

// ========================================
// EXPORT
// ========================================

module.exports = {
    runAgent,
    askOllama,
    TOOLS
};