"use strict";
/* =====================================
   DOWNLOADGAMES CHAT v4
   Benötigt chat-brain.js (vorher laden) und games.js
   1) Regeln: Krisenhinweis, Moderation, Rechnen, Würfel/Münze, Stein-Schere-Papier
   2) Spiele-Wissen (automatisch aus games.js) mit Kontext ("Was kostet es?")
   3) FAQ + Smalltalk: Naive-Bayes-Textklassifikator (mit Tippfehler-Korrektur)
      + Antwort-Varianten, Satz-Bausteine und Generatoren (chat-brain.js)
   4) KI über server.js (/api/chat):
      - sofort bei Fragen zur Website, zum Projekt, zu Dateien oder früheren Gesprächen
      - als Reserve, wenn lokal keine Antwort gefunden wird
   Eine Datei, kein CSS nötig.
===================================== */

(function () {
    /* ---------- Chat-Brain (Fallback, falls chat-brain.js fehlt) ---------- */

    const B = globalThis.DGBrain || {
        spin: t => String(t).replace(/\{([^{}~]*~[^{}]*)\}/g, (_, g) => g.split("~")[0]),
        variant: (k, arr) => arr[0],
        faqAnswer: (kw, a) => a,
        say: (k, s) => Object.values(s || {}).join(" "),
        frame: (q, t) => t,
        fallback: (q, o) => (o && o.timedOut ? "Die KI braucht gerade zu lange. Versuch es gleich nochmal." : "Dazu habe ich keine passende Antwort. Versuch es mit anderen Worten."),
        augment: w => w,
        slots: {},
        EXTRA: []
    };

    /* ---------- Sicherer Zugriff auf localStorage ---------- */

    const store = {
        get(key, fallback = null) {
            try {
                const v = localStorage.getItem(key);
                return v === null ? fallback : v;
            } catch { return fallback; }
        },
        set(key, value) { try { localStorage.setItem(key, value); } catch { /* egal */ } },
        del(key) { try { localStorage.removeItem(key); } catch { /* egal */ } }
    };

    /* ---------- Chat-ID dieses Browsers (wird an den Server geschickt) ---------- */

    const SESSION_KEY = "dg_ai_session";
    const SESSION_RE = /^[a-zA-Z0-9_-]{8,80}$/;
    const newSessionId = () => "dg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 14);

    let SESSION_ID = store.get(SESSION_KEY);
    if (!SESSION_ID || !SESSION_RE.test(SESSION_ID)) {
        SESSION_ID = newSessionId();
        store.set(SESSION_KEY, SESSION_ID);
    }
    globalThis.DOWNLOADGAMES_SESSION_ID = SESSION_ID;

    /* ---------- Text normalisieren ---------- */

    const norm = s => String(s ?? "").toLowerCase()
        .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

    /* =====================================
       CHAT-MODERATION
    ===================================== */

    const BAD_WORDS = new Set([
        "arschloch", "arsch", "arschgeige", "scheisse", "scheiss", "wichser", "hurensohn", "hurensoehne",
        "fick", "ficken", "fotze", "bastard", "hure", "idiot", "vollidiot", "spast", "spasti",
        "nutte", "schlampe", "missgeburt"
    ].map(w => norm(w)));

    const BAD_STEMS = ["idiot", "arschloch", "wichser", "hurensohn", "vollidiot", "missgeburt"];
    const collapse = w => w.replace(/(.)\1+/g, "$1");
    const unleet = w => w.replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t");
    const BAD_COLLAPSED = new Set([...BAD_WORDS].map(collapse));

    const BAN_KEY = "dgc_chat_ban_until";
    const NAME_KEY = "dgc_chat_name";
    const LOG_KEY = "dgc_chat_log";
    const BAN_DURATION = 10 * 60 * 1000;
    const MAX_INPUT = 300;
    const SERVER_TIMEOUT = 90000; // lokale KI braucht manchmal lange
    // true: Die Server-KI antwortet zuerst (schlauer). Lokale Treffer dienen als geprüfter Hinweis und als Reserve.
    // Nur exakte Regeln (Rechnen, Würfeln, Spiele-Daten) bleiben lokal.
    const AI_FIRST = true;

    function containsBadWord(text) {
        return norm(text).split(" ").some(w => {
            if (!w) return false;
            const plain = /[a-z]/.test(w) ? unleet(w) : w;
            return BAD_WORDS.has(w) || BAD_WORDS.has(plain) || BAD_COLLAPSED.has(collapse(plain)) ||
                BAD_STEMS.some(s => plain.length >= s.length && plain.startsWith(s));
        });
    }

    // Krisen-Sätze werden immer ernst genommen, auch bei aktiver Sperre
    const CRISIS_RE = /(umbring|suizid|selbstmord|nicht mehr leben|sterben will|will sterben|moechte sterben|mich toeten|mir wehtun|mir weh tun|ritzen)/;
    const CRISIS_TEXT = "Das klingt, als ginge es dir gerade sehr schlecht, und das nehme ich ernst. Bitte sprich jetzt mit jemandem: In Deutschland erreichst du die Telefonseelsorge kostenlos und rund um die Uhr unter 0800 111 0 111 oder 0800 111 0 222 (auch 116 123). Bei akuter Gefahr wähle bitte 112. Du musst da nicht allein durch.";

    // Fragen, die direkt an die KI auf dem Server gehen (Website, Projekt, Dateien, frühere Gespräche)
    const SERVER_FIRST = new RegExp([
        "meine website", "meine seite", "mein projekt", "mein shop", "meine ki", "welche ki", "welches modell",
        "wie heisst meine", "wie heisst mein", "verwende ich", "benutze ich", "nutze ich",
        "welche datei", "welcher code", "quellcode", "im code", "projektdateien",
        "server js", "ai agent", "games js", "app js", "chat js", "project notes", "chat memory",
        "erinnerst du dich", "weisst du noch", "was habe ich dich", "frueher gefragt", "letzte gespraech",
        "notiz", "dauerhaft merken", "merk dir", "gehostet", "hosting", "github pages", "dateien", "json", "gespeichert",
        "recherch", "internet", "im web", "google", "wikipedia", "aktuell", "nachrichten", "http", "www", "suche nach", "wie funktioniert dein", "deine app", "dein code"
    ].join("|"));

    /* ---------- Zustand der Unterhaltung ---------- */

    const state = {
        lastGame: null,
        lastBot: "",
        rps: false,
        hist: [],
        name: store.get(NAME_KEY, "")
    };

    const lastPick = {};
    function pick(arr, key) {
        if (arr.length === 1) return arr[0];
        let i;
        do { i = Math.floor(Math.random() * arr.length); } while (i === lastPick[key]);
        lastPick[key] = i;
        return arr[i];
    }
    const rand = arr => arr[Math.floor(Math.random() * arr.length)];

    /* ---------- Stoppwörter, Synonyme, Stemming (für Spiele-Fragen & FAQ) ---------- */

    const STOP = new Set(("der die das den dem des ein eine einen einem einer ist sind war bin bist ich du er sie es " +
        "wir ihr und oder aber auch nur noch mal bitte mir mich dir dich wie was wo wer wann welche welcher welches " +
        "wieviel kann koennte moechte will wuerde man mein meine meinen meinem deine deinen zu zum zur fuer von mit " +
        "bei auf in im an am nach um ueber gibt hat habe haben wird werden ob dass eigentlich denn doch mal ja the a is " +
        "soll sollte muss kannst kann ein einmal gerne jetzt hier dort dann wenn weil also ganz sehr viel viele").split(" "));

    const SYN = {};
    const syn = (target, words) => words.split(" ").forEach(w => { SYN[w] = target; });

    syn("preis", "preis preise kostet kosten kostenpunkt bezahlen wert");
    syn("punkt", "punkt punkte points point coins coin punktesystem punktestand");
    syn("anforder", "anforderung anforderungen systemanforderungen systemanforderung requirements specs hardware voraussetzungen mindestanforderungen laeuft laufen ruckelt pc computer rechner");
    syn("entwickler", "entwickler studio hersteller macher developer entwickelt gemacht erstellt");
    syn("datum", "datum release erscheinungsdatum veroeffentlicht veroeffentlichung erschienen erscheint jahr herausgekommen");
    syn("groesse", "groesse gb speicherplatz platte festplatte");
    syn("genre", "genre genres kategorie kategorien art arten");
    syn("bewertung", "bewertung bewertungen rezension rezensionen sterne stern review reviews bewerten bewerte");
    syn("kommentar", "kommentar kommentare kommentieren kommentiere");
    syn("key", "key keys schluessel produktschluessel code steamkey");
    syn("steam", "steam");
    syn("einloes", "einloesen einloese loese aktivieren aktiviere aktivierung redeem");
    syn("registr", "registrieren registriere registrierung registrierst anmeldung konto account");
    syn("login", "login einloggen logge anmelden melde loggen einlogg anmeldet");
    syn("logout", "logout ausloggen abmelden");
    syn("passwort", "passwort kennwort pw passwoerter");
    syn("vergess", "vergessen vergessen verloren");
    syn("aender", "aendern aendere wechseln wechsle bearbeiten bearbeite aenderung");
    syn("kauf", "kauf kaufen kaufe gekauft erwerben holen bestellen bestelle kaeufe freischalten schalte");
    syn("warenkorb", "warenkorb korb einkaufswagen");
    syn("bibliothek", "bibliothek library sammlung");
    syn("download", "download herunterladen runterladen downloaden laden installieren");
    syn("kostenlos", "kostenlos gratis free umsonst");
    syn("store", "seite link shop offizielle offiziell store");
    syn("beschreib", "worum handlung story inhalt beschreibung geschichte");
    syn("aehnlich", "aehnlich aehnliche aehnlichen vergleichbar");
    syn("empfehl", "empfiehl empfehle empfehlung empfehlen tipp tipps vorschlag vorschlagen");
    syn("guenstig", "guenstig guenstigste guenstigstes billig billigste billigstes preiswert preiswerteste cheapest");
    syn("teuer", "teuer teuerste teuerstes");
    syn("neu", "neu neue neueste neuestes neuste neuen aktuell aktuellste");
    syn("alt", "aelteste aeltestes");
    syn("beliebt", "beliebt beliebteste beliebtes populaer populaerste bestseller");
    syn("best", "beste bestes bester besten bestbewertet bestbewertete");
    syn("such", "suche suchen suchfunktion finde finden suchst");
    syn("filter", "filter filtern filtere sortieren sortiere");
    syn("ausverkauft", "ausverkauft nicht verfuegbar vergriffen");
    syn("loesch", "loeschen loesche entfernen entferne");
    syn("hilfe", "hilfe helfen hilf support unterstuetzung");
    syn("kontakt", "kontakt kontaktieren kontaktiere impressum betreiber");
    syn("hallo", "hallo hi hey moin servus huhu hello");
    syn("danke", "danke dankeschoen thx thanks merci");
    syn("tschuess", "tschuess tschues ciao bye wiedersehen");

    const stem = w => (w.length > 5 ? w.replace(/(ungen|ung|keit|heit|lich|isch|en|er|es|e|n|s)$/, "") : w);
    const tokens = s => norm(s).split(" ").filter(w => w && !STOP.has(w)).map(w => SYN[w] || stem(w));

    const dice = (a, b) => {
        if (!a.size || !b.size) return 0;
        let hit = 0;
        a.forEach(x => { if (b.has(x)) hit++; });
        return (2 * hit) / (a.size + b.size);
    };

    function lev(a, b) {
        const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
        for (let j = 1; j <= b.length; j++) d[0][j] = j;
        for (let i = 1; i <= a.length; i++)
            for (let j = 1; j <= b.length; j++)
                d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        return d[a.length][b.length];
    }

    const sameWord = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && lev(a, b) <= 1);

    /* ---------- Spieldaten ---------- */

    const G = () => (typeof games !== "undefined" && Array.isArray(games) ? games : []);
    const eur = n => Number(n || 0).toFixed(2).replace(".", ",") + " €";

    const stock = id => {
        try {
            return JSON.parse(store.get("dg_keys", "[]"))
                .filter(k => k.gameId === id && k.active && !k.used).length;
        } catch { return 0; }
    };

    const ratingOf = id => {
        try {
            const list = (JSON.parse(store.get("dg_comments", "{}"))[id] || []).filter(c => c.stars);
            return list.length ? { avg: list.reduce((s, c) => s + c.stars, 0) / list.length, n: list.length } : null;
        } catch { return null; }
    };

    const when = g => g.releaseDate || g.year || "";
    const names = list => list.map(g => `${g.name} (${eur(g.price)})`).join(", ");
    const reqText = r => (r ? `${r.os}, CPU ${r.cpu}, RAM ${r.ram}, GPU ${r.gpu}, ${r.storage} Speicher` : "nicht angegeben");

    /* ---------- Antworten zu einzelnen Spielen (Sätze aus Bausteinen) ---------- */

    const INTENTS = [
        { k: ["anforder"], f: g => g.requirements
            ? `Systemanforderungen für ${g.name}:\nMinimum: ${reqText(g.requirements.minimum)}\nEmpfohlen: ${reqText(g.requirements.recommended)}`
            : `Für ${g.name} sind hier noch keine Systemanforderungen eingetragen. Auf der offiziellen Steam-Seite stehen sie.` },
        { k: ["preis", "punkt"], f: g => B.say("preis", { name: g.name, price: eur(g.price), points: g.points }) },
        { k: ["entwickler"], f: g => g.developer ? B.say("entwickler", { name: g.name, dev: g.developer }) : `Der Entwickler von ${g.name} ist nicht eingetragen.` },
        { k: ["genre"], f: g => B.say("genre", { name: g.name, genre: g.genre || "(nicht angegeben)" }) },
        { k: ["datum"], f: g => when(g) ? B.say("datum", { name: g.name, when: g.releaseDate ? "am " + g.releaseDate : "im Jahr " + g.year }) : `Das Erscheinungsdatum von ${g.name} ist nicht eingetragen.` },
        { k: ["groesse"], f: g => g.size ? `${g.name} ist ${g.size} groß.` : `Die Größe von ${g.name} ist nicht eingetragen. ${g.requirements?.minimum?.storage ? "Laut Anforderungen brauchst du " + g.requirements.minimum.storage + " Speicherplatz." : ""}`.trim() },
        { k: ["beschreib"], f: g => g.description || `Zu ${g.name} gibt es noch keine Beschreibung.` },
        { k: ["bewertung"], f: g => { const r = ratingOf(g.id); return r ? B.say("bewertung", { name: g.name, avg: r.avg.toFixed(1), n: r.n }) : B.say("bewertung_none", { name: g.name }); } },
        { k: ["aehnlich"], f: g => { const o = G().filter(x => x.id !== g.id && x.genre === g.genre); return o.length ? `Ähnlich wie ${g.name}: ${o.map(x => x.name).join(", ")}.` : `Zu ${g.name} gibt es aktuell kein Spiel im selben Genre.`; } },
        { k: ["ausverkauft", "verfuegbar"], f: g => g.free === true ? `${g.name} ist kostenlos erhältlich.` : (stock(g.id) ? `Von ${g.name} sind aktuell ${stock(g.id)} Steam-Keys verfügbar.` : `${g.name} ist aktuell ausverkauft (keine Steam-Keys im Lager).`) },
        { k: ["key", "einloes", "steam"], f: g => `Beim Kauf von ${g.name} bekommst du einen Steam-Key. Du findest ihn im Spielfenster und in deiner Bibliothek und löst ihn auf Steam ein: https://store.steampowered.com/account/registerkey` },
        { k: ["kauf"], f: g => B.say("kauf", { name: g.name, points: g.points }) },
        { k: ["download"], f: g => g.free === true && g.downloadUrl ? `${g.name} kannst du nach dem Freischalten direkt über den Download-Button laden.` : `${g.name} lädst du nach dem Kauf über Steam: Du bekommst einen Steam-Key und löst ihn dort ein.` },
        { k: ["store"], f: g => g.storeUrl ? `Die offizielle Seite von ${g.name}: ${g.storeUrl}` : `Für ${g.name} ist noch keine offizielle Seite eingetragen.` }
    ];

    function findGames(t) {
        const set = new Set(t);
        const hits = [];

        G().forEach(g => {
            const nt = tokens(g.name);
            if (!nt.length) return;
            const matched = nt.filter(w => [...set].some(u => sameWord(u, w))).length;
            if (matched / nt.length >= 0.5 && matched >= 1) hits.push({ g, score: matched / nt.length });
        });

        const best = Math.max(0, ...hits.map(x => x.score));
        return hits.filter(x => x.score === best).map(x => x.g).slice(0, 3);
    }

    const matchedIntents = t => {
        const set = new Set(t);
        return INTENTS.filter(i => i.k.some(k => set.has(k))).slice(0, 3);
    };

    function gameAnswer(found, t) {
        const used = matchedIntents(t);

        return found.map(g => {
            if (!used.length) {
                const r = ratingOf(g.id);
                return `${g.name}: ${g.genre || "Spiel"}${when(g) ? ", " + when(g) : ""}${g.developer ? ", von " + g.developer : ""}. Preis: ${eur(g.price)} oder ${g.points} Punkte.${r ? " Bewertung: " + r.avg.toFixed(1) + "/5." : ""}\nFrag mich z. B. nach Systemanforderungen, Beschreibung oder wie du es kaufst.`;
            }
            return used.map(i => i.f(g)).join("\n\n");
        }).join("\n\n");
    }

    /* ---------- Katalog-Fragen (Budget, Genre, Empfehlung) ---------- */

    function catalogAnswer(raw, t) {
        const list = G();
        if (!list.length) return null;
        const lc = String(raw).toLowerCase();

        const euroM = lc.match(/(\d+(?:[.,]\d+)?)\s*(?:€|euro|eur)/);
        const ptsM = lc.match(/(\d+)\s*(?:punkte|punkt|points)/);

        const genreWords = new Set(list.flatMap(g => tokens(g.genre)));
        const asked = t.filter(w => w.length >= 4 && genreWords.has(w));
        const byGenre = g => !asked.length || asked.some(w => tokens(g.genre).includes(w));
        const genreLabel = asked.length ? ` im Bereich „${asked.join(" / ")}“` : "";

        if (euroM || ptsM) {
            const limit = Number((euroM || ptsM)[1].replace(",", "."));
            const field = euroM ? "price" : "points";
            const unit = euroM ? "€" : "Punkte";
            const ok = list.filter(g => Number(g[field]) <= limit && byGenre(g));

            if (ok.length) {
                state.lastGame = ok[0];
                return `Spiele${genreLabel} bis ${limit} ${unit}: ${ok.map(g => `${g.name} (${euroM ? eur(g.price) : g.points + " Punkte"})`).join(", ")}.`;
            }
            const pool = list.filter(byGenre);
            const cheapest = [...(pool.length ? pool : list)].sort((a, b) => a[field] - b[field])[0];
            return `Bis ${limit} ${unit} gibt es${genreLabel} aktuell kein Spiel. Das günstigste ist ${cheapest?.name}.`;
        }

        const isDefinition = /\bwas (ist|bedeutet|sind) (ein|eine)\b/.test(norm(raw));

        if (asked.length && !isDefinition && !findGames(t).length) {
            const ok = list.filter(byGenre);
            if (ok.length) {
                if (t.includes("empfehl")) {
                    const g = rand(ok);
                    state.lastGame = g;
                    const d = g.description ? " " + String(g.description).slice(0, 160).trim() + "…" : "";
                    return `Wie wäre ${g.name}? ${g.genre}, ${eur(g.price)} oder ${g.points} Punkte.${d}\nWillst du Systemanforderungen oder die Beschreibung?`;
                }
                if (t.includes("guenstig")) {
                    const g = [...ok].sort((a, b) => a.price - b.price)[0];
                    state.lastGame = g;
                    return `Das günstigste Spiel im Bereich „${asked.join(" / ")}“ ist ${g.name} (${eur(g.price)} / ${g.points} Punkte).`;
                }
                if (ok.length === 1) state.lastGame = ok[0];
                return `Im Bereich „${asked.join(" / ")}“ gibt es ${ok.length} Spiel(e): ${names(ok)}.`;
            }
        }

        return null;
    }

    /* =====================================
       FAQ: ["Variante|Variante|…", "Schlüsselwörter", "Antwort"]
       Platzhalter: {{NAMEC}} {{COUNT}} {{LIST}} {{GENRES}} {{CHEAPEST}} {{PRICIEST}}
                    {{NEWEST}} {{FREE}} {{BEST}} {{RANDOMGAME}} {{IDEA}} {{POEM}} {{DAYTIME}}
       Spintax in Antworten: {A~B~C} wählt zufällig
    ===================================== */

    const FAQ_RAW = [
        // --- Begrüßung ---
        ["hallo|hi|hey|guten tag|moin|servus|guten morgen|guten abend|guten nachmittag", "hallo", "Hallo{{NAMEC}}! Ich bin der DownloadGames-Assistent. Frag mich zu Spielen, Preisen, Systemanforderungen, Punkten oder Funktionen der Seite. Wir können auch einfach quatschen 😊"],
        ["danke|dankeschön|vielen dank|super danke|thx|thanks|vielen dank für deine hilfe|das hat geholfen|du hast mir geholfen", "danke", "Gern geschehen! Sag Bescheid, wenn du noch etwas wissen willst."],
        ["tschüss|bis später|auf wiedersehen|ciao|bye|bis bald|bis dann|bis morgen", "tschuess", "Tschüss{{NAMEC}} und viel Spaß mit den Spielen!"],
        ["wer bist du|was bist du|bist du eine ki|bist du ein mensch|wie heißt du|bist du ein bot", "ki mensch bot heisst", "Ich bin der Website-Assistent von DownloadGames. Ich antworte mit gespeichertem Wissen über die Seite und die Spiele, führe kleine Gespräche und frage bei unbekannten Fragen eine KI auf dem Server, falls sie läuft."],
        ["was kannst du|wobei kannst du helfen|was kann ich dich fragen|womit kannst du mir helfen", "hilfe kannst", "Ich helfe bei Spielen (Preis, Punkte, Systemanforderungen, Entwickler, Beschreibung), beim Kauf mit Punkten, Steam-Keys, Login, Bibliothek, Warenkorb, Kommentaren und der Suche. Außerdem kann ich rechnen, Witze erzählen, Fun Facts nennen, würfeln und mit dir Stein-Schere-Papier spielen."],

        // --- Katalog ---
        ["welche spiele gibt es|zeig mir alle spiele|was für spiele habt ihr|spieleliste|katalog|wie viele spiele gibt es|was kann ich kaufen", "spiel katalog", "Aktuell gibt es {{COUNT}} Spiele: {{LIST}}."],
        ["welche genres gibt es|welche kategorien gibt es|welche arten von spielen gibt es|welche genres habt ihr", "genre", "Verfügbare Genres: {{GENRES}}. Im Store kannst du oben nach Genre filtern."],
        ["was ist das günstigste spiel|billigstes spiel|welches spiel ist am billigsten|günstigstes spiel", "guenstig", "Das günstigste Spiel ist {{CHEAPEST}}."],
        ["was ist das teuerste spiel|teuerstes spiel|welches spiel ist am teuersten", "teuer", "Das teuerste Spiel ist {{PRICIEST}}."],
        ["was ist das neueste spiel|neue spiele|welche spiele sind neu|neuheiten|neuestes spiel", "neu", "Das neueste Spiel ist {{NEWEST}}. Weitere neue Spiele siehst du im Store unter „Neue Spiele“."],
        ["was ist das beste spiel|bestbewertetes spiel|welches spiel hat die beste bewertung|beste spiele", "best", "{{BEST}}"],
        ["was ist beliebt|beliebteste spiele|welche spiele sind beliebt|bestseller|beliebte spiele", "beliebt", "Beliebte Spiele siehst du im Store unter „Beliebte Spiele“. Sie richten sich nach Käufen und Kommentaren."],
        ["empfiehl mir ein spiel|welches spiel soll ich spielen|ich weiß nicht was ich spielen soll|spieltipp|hast du einen tipp|ich suche ein neues spiel|was soll ich heute zocken", "empfehl", "Gern! Zur Auswahl stehen die Genres {{GENRES}}. Das neueste Spiel ist {{NEWEST}}, das günstigste {{CHEAPEST}}. Sag mir ein Genre oder dein Budget, z. B. „Horror unter 10 Euro“."],
        ["gibt es kostenlose spiele|free games|gratis spiele|gibt es spiele umsonst", "kostenlos", "{{FREE}}"],

        // --- Konto ---
        ["wie registriere ich mich|wie erstelle ich ein konto|account erstellen|wie kann ich mich registrieren|konto anlegen|neues konto erstellen", "registr", "Klicke oben auf Login und dann auf Registrieren. Du brauchst einen Benutzernamen (mind. 3 Zeichen), eine gültige E-Mail und ein Passwort (mind. 8 Zeichen)."],
        ["ist die registrierung kostenlos|kostet die registrierung|kostet ein konto geld", "registr kostenlos preis", "Die Registrierung ist kostenlos."],
        ["wie logge ich mich ein|wie melde ich mich an|login|einloggen|anmelden", "login", "Klicke oben auf Login, gib Benutzername oder E-Mail und dein Passwort ein und bestätige mit Anmelden."],
        ["warum funktioniert mein login nicht|login fehlgeschlagen|anmeldung funktioniert nicht|warum wurde ich ausgeloggt", "login problem", "Prüfe Benutzername beziehungsweise E-Mail und Passwort, auch die Groß- und Kleinschreibung. Wurden Browserdaten gelöscht, ist das Konto in dieser Testversion weg."],
        ["wie logge ich mich aus|abmelden|logout|ausloggen", "logout aus", "Klicke oben rechts auf „Logout“ neben deinem Namen."],
        ["ich habe mein passwort vergessen|passwort vergessen|passwort zurücksetzen|passwort reset|kennwort vergessen", "passwort vergess", "Ein automatisches Zurücksetzen gibt es in dieser Version nicht, weil dafür ein E-Mail-Server nötig ist. Wende dich an den Betreiber der Seite."],
        ["wie ändere ich mein passwort|passwort ändern|passwort wechseln", "passwort aender", "Öffne oben „Profil“, gib dort dein altes und dein neues Passwort ein (mind. 8 Zeichen) und klicke auf „Passwort ändern“."],
        ["wie ändere ich meinen benutzernamen|name ändern|e mail adresse ändern|profil bearbeiten|email ändern", "benutzername email profil aender", "Im Bereich „Profil“ kannst du Benutzername und E-Mail ändern und speichern."],
        ["wo finde ich mein profil|profilseite|profil|mein konto ansehen", "profil", "Klicke oben in der Navigation auf „Profil“. Du musst dafür angemeldet sein."],
        ["kaufhistorie|wo sehe ich meine käufe|was habe ich gekauft|bestellungen anzeigen|meine bestellungen", "historie kauf bestell", "Deine Kaufhistorie steht im Bereich „Profil“ ganz unten, mit Datum, Spiel und Preis."],
        ["wie lösche ich mein konto|konto löschen|account löschen", "konto loesch", "Das Konto selbst zu löschen geht in dieser Version nicht. Frage dafür den Betreiber der Seite."],
        ["kann ich mehrere konten haben|mehrere accounts|zweites konto", "konto mehrere", "Ob mehrere Konten erlaubt sind, entscheidet der Betreiber der Seite."],
        ["kann ich mich auf einem anderen gerät anmelden|anderes handy|konto auf zwei geräten", "geraet anderen handy", "In dieser Testversion liegen Konten nur im jeweiligen Browser. Auf einem anderen Gerät oder Browser ist dein Konto deshalb nicht vorhanden."],
        ["was passiert wenn ich browserdaten lösche|localstorage löschen|cookies löschen", "browserdaten cookies localstorage", "In dieser lokalen Testversion gehen dabei gespeicherte Konten, Punkte, Käufe und andere Website-Daten verloren."],

        // --- Bibliothek, Punkte, Kauf ---
        ["wo finde ich meine gekauften spiele|bibliothek|meine spiele|wo ist meine bibliothek|wo sehe ich meine spiele", "bibliothek", "Klicke oben auf „Bibliothek“. Dort stehen deine freigeschalteten Spiele und deine Steam-Keys."],
        ["wie funktioniert das punktesystem|wie bekomme ich punkte|wie sammle ich punkte|wie viele punkte bekomme ich|wie verdiene ich punkte", "punkt sammel", "Angemeldete Benutzer bekommen automatisch 100 Punkte alle 10 Sekunden (Demo-Modus, solange die Seite geöffnet ist). Mit Punkten kaufst du Spiele. Der Punktepreis steht bei jedem Spiel."],
        ["wie viele punkte habe ich|punktestand|wo sehe ich meine punkte|wo sehe ich meinen punktestand", "punktestand", "Dein Punktestand steht oben rechts im Header neben dem Stern."],
        ["warum steigen meine punkte nicht|ich bekomme keine punkte|punkte werden nicht mehr|keine punkte", "punkt steigen bekomme keine", "Punkte gibt es nur für angemeldete Benutzer, 100 alle 10 Sekunden, solange die Seite im Browser geöffnet ist. Prüfe, ob du eingeloggt bist."],
        ["bekommen gäste punkte|punkte ohne login|kann ich ohne konto punkte sammeln", "gaeste punkt login", "Nein, Punkte gibt es nur mit Konto. Registriere dich und melde dich an."],
        ["wie viel sind 100 punkte wert|punkte in euro umrechnen|punktwert", "punkt wert euro", "Punkte sind keine echte Währung. Den Punktepreis jedes Spiels siehst du direkt beim Spiel."],
        ["kann ich punkte verschenken|punkte übertragen|punkte an freunde senden", "punkt verschenken uebertragen", "Eine Punkteübertragung gibt es aktuell nicht."],
        ["warum wurden punkte abgezogen|punkte verschwunden|kann ich punkte verlieren", "punkt verschwunden abgezogen", "Punkte werden nur durch einen Kauf abgezogen. Prüfe deine Kaufhistorie im Profil und deinen aktuellen Punktestand."],
        ["wie kaufe ich ein spiel|wie kann ich ein spiel kaufen|spiel kaufen|spiel freischalten|wie bekomme ich ein spiel", "kauf", "Melde dich an, öffne ein Spiel mit „Details ansehen“ und klicke auf „Mit Punkten kaufen“. Danach bekommst du deinen Steam-Key im Spielfenster und in der Bibliothek."],
        ["wie funktioniert der warenkorb|wie nutze ich den warenkorb|warenkorb|wie lege ich ein spiel in den warenkorb|was ist ein warenkorb", "warenkorb", "Klicke bei einem Spiel auf „In den Warenkorb“, öffne oben den Warenkorb und kaufe alle Spiele zusammen mit Punkten."],
        ["wie entferne ich ein spiel aus dem warenkorb|warenkorb leeren|warenkorb löschen", "warenkorb loesch", "Im Warenkorb gibt es bei jedem Spiel „Entfernen“ und unten „Warenkorb leeren“."],
        ["ich habe nicht genug punkte|zu wenig punkte|was wenn mir punkte fehlen|nicht genügend punkte", "punkt wenig genug fehlen", "Dann musst du noch Punkte sammeln: Angemeldete Benutzer bekommen 100 Punkte alle 10 Sekunden. Danach kannst du das Spiel kaufen."],
        ["kauf fehlgeschlagen|punkte abgezogen aber kein spiel|spiel nach kauf nicht da", "kauf problem fehlgeschlagen", "Prüfe deine Bibliothek und die Kaufhistorie im Profil. Taucht das Spiel dort nicht auf, wende dich mit dem Spielnamen an den Betreiber."],
        ["kann ich ein spiel zweimal kaufen|spiel erneut kaufen|doppelter kauf", "kauf zweimal doppelt", "Ist ein Spiel schon in deiner Bibliothek, brauchst du es nicht noch einmal zu kaufen."],
        ["kann ich spiele verschenken|spiel an freund verschenken|geschenk", "geschenk verschenken", "Eine Geschenkfunktion gibt es aktuell nicht."],
        ["kann ich ein spiel zurückgeben|rückerstattung|geld zurück|refund|kann ich ein spiel stornieren", "rueckerstattung zurueck refund storn", "Gekaufte Keys sind nach dem Kauf zugeteilt. Fragen zu Rückgabe oder Problemen klärst du mit dem Betreiber der Seite."],
        ["kann ich mit geld bezahlen|paypal|kreditkarte|zahlungsmethoden|wie kann ich bezahlen", "paypal kreditkarte zahlung geld", "Aktuell bezahlst du ausschließlich mit Punkten. Echte Zahlungen sind in dieser Version nicht eingebaut."],

        // --- Steam & Keys ---
        ["was ist ein steam key|was ist ein produktschlüssel|wie bekomme ich meinen key|wo ist mein key|wo finde ich meinen steam key", "key", "Ein Steam-Key ist ein Code, mit dem du ein Spiel auf Steam aktivierst. Nach dem Kauf findest du ihn im Spielfenster und in deiner Bibliothek."],
        ["wie löse ich einen steam key ein|key einlösen|wie aktiviere ich den key|spiel auf steam aktivieren|wo gebe ich den key ein", "einloes key", "Öffne Steam und wähle „Ein Produkt bei Steam aktivieren“ oder gehe auf https://store.steampowered.com/account/registerkey. Gib den Key ein und lade das Spiel danach in Steam herunter."],
        ["brauche ich ein steam konto|steam account nötig|muss ich steam haben", "steam konto", "Ja, du brauchst ein kostenloses Steam-Konto, um den Key einzulösen und das Spiel zu laden."],
        ["mein key funktioniert nicht|key ungültig|steam key fehler|key schon benutzt|der key geht nicht", "key funktioniert ungueltig fehler", "Prüfe den Key auf Tippfehler (O und 0, I und 1) und ob er schon eingelöst wurde. Hilft das nicht, wende dich mit dem Spielnamen an den Betreiber der Seite."],
        ["kann ich einen steam key mehrfach benutzen|key mehrmals einlösen|kann ich steam keys weiterverkaufen|key verkaufen", "key mehrfach weiterverkaufen", "Ein Steam-Key kann in der Regel nur einmal eingelöst werden. Ob du ihn weitergeben darfst, regeln die Bedingungen von Steam und des Spiels."],
        ["funktioniert ein key weltweit|region lock|regionsbeschränkung", "key region weltweit", "Manche Keys haben regionale Einschränkungen. Prüfe vor der Aktivierung, für welche Region der Key gedacht ist."],
        ["ist steam kostenlos|kostet steam geld|steam preis", "steam kostenlos", "Die Steam-Software und ein Steam-Konto sind kostenlos. Spiele können Geld kosten."],
        ["wo lade ich steam herunter|steam download|steam installieren", "steam download", "Steam gibt es auf der offiziellen Seite: https://store.steampowered.com/about/"],
        ["was ist steam|wie funktioniert steam", "steam", "Steam ist eine digitale PC-Spieleplattform von Valve. Dort kaufst, installierst und verwaltest du Spiele."],
        ["was bedeutet ausverkauft|warum kann ich nicht kaufen|spiel ausverkauft|button ausverkauft", "ausverkauft", "„Ausverkauft“ heißt, dass aktuell keine Steam-Keys für das Spiel im Lager sind. Schau später wieder vorbei."],

        // --- Download & Installation ---
        ["wie kann ich ein spiel herunterladen|download|wo ist der download|wo kann ich das spiel laden|wie lade ich ein spiel", "download", "Bezahlspiele lädst du über Steam: Du bekommst einen Steam-Key und löst ihn dort ein. Einen direkten Download-Button gibt es nur bei freien Spielen."],
        ["download startet nicht|download funktioniert nicht|download hängt|download abgebrochen|download fehlgeschlagen|download ist langsam", "download problem", "Prüfe deine Internetverbindung, den freien Speicherplatz und ob dein Browser den Download blockiert. Bei Steam hilft oft ein Neustart des Downloads."],
        ["wie installiere ich ein pc spiel|spiel installieren|installation pc", "installation", "Bei Steam öffnest du die Bibliothek, wählst das Spiel und klickst auf Installieren."],
        ["wie deinstalliere ich ein spiel|spiel entfernen|spiel löschen pc", "deinstallation", "Bei Steam kannst du ein Spiel in der Bibliothek per Rechtsklick und „Verwalten“ deinstallieren."],
        ["wie viel speicherplatz brauche ich|speicherplatz prüfen|festplatte voll", "speicher", "Prüfe vor der Installation, wie viel Speicherplatz das Spiel braucht, und ob auf deinem Laufwerk genug frei ist."],
        ["was ist eine zip datei|zip öffnen|datei entpacken", "zip entpacken", "Eine ZIP-Datei ist ein komprimiertes Archiv. Unter Windows entpackst du sie per Rechtsklick und „Alle extrahieren“."],
        ["ist ein download sicher|wie erkenne ich sichere downloads|viren im download|windows meldet virus|antivirus blockiert download", "sicherheit download virus", "Lade Programme nur von offiziellen oder vertrauenswürdigen Quellen. Eine Virenwarnung nimmst du ernst: Starte verdächtige Dateien nicht und prüfe sie mit einem aktuellen Virenschutz."],

        // --- Spiele-Infos & Seite ---
        ["was sind die systemanforderungen|wo sehe ich die systemanforderungen|mindestanforderungen|welche hardware brauche ich", "anforder", "Öffne ein Spiel mit „Details ansehen“: Dort stehen Minimum und Empfohlen. Nenne mir ein Spiel, dann schreibe ich sie dir direkt."],
        ["kann mein pc ein spiel ausführen|läuft das spiel auf meinem pc|ist mein pc gut genug|kann mein computer das spielen", "anforder", "Vergleiche CPU, RAM, Grafikkarte und Speicher deines PCs mit den Mindestanforderungen des Spiels. Nenne mir das Spiel, dann zeige ich sie dir."],
        ["wie suche ich ein spiel|suchfunktion|spiel finden|wo ist die suche|ich finde ein spiel nicht", "such", "Nutze das Suchfeld oben. Es sucht live nach Name, Genre, Entwickler und Jahr. Probiere auch nur einen Teil des Namens."],
        ["wie filtere ich nach genre|nach genre filtern|spiele nach kategorie anzeigen", "filter genre", "Im Store gibt es oben Genre-Buttons. Klicke eins an, um nur diese Spiele zu sehen."],
        ["wie kommentiere ich ein spiel|kommentar schreiben|kann ich kommentare schreiben|warum kann ich nicht kommentieren", "kommentar", "Melde dich an, öffne ein Spiel und schreibe unten im Spielfenster deinen Kommentar mit einer Sternebewertung."],
        ["wie lösche ich meinen kommentar|kommentar bearbeiten|kommentar ändern|kommentar löschen", "kommentar loesch aender", "Bei deinem eigenen Kommentar gibt es die Buttons „Bearbeiten“ und „Löschen“."],
        ["wie bewerte ich ein spiel|sterne vergeben|bewertung abgeben|wie gebe ich eine bewertung ab", "bewertung stern", "Wähle im Spielfenster 1 bis 5 Sterne und schreibe einen Kommentar. Pro Spiel zählt eine Bewertung pro Benutzer."],
        ["wo werden meine daten gespeichert|datenschutz|sind meine daten sicher|werden passwörter gespeichert", "daten datenschutz sicher gespeichert", "In dieser Testversion lokal in deinem Browser. Passwörter werden nur als Hash gespeichert, nicht im Klartext. Löschst du die Browserdaten, sind Konto und Käufe weg."],
        ["gibt es eine app|funktioniert die seite auf dem handy|mobile version|geht das auch am handy", "app handy mobil", "Es gibt keine App, aber die Seite ist für Handy und Tablet angepasst und läuft im Browser."],
        ["wie kontaktiere ich den support|kontakt|wer betreibt die seite|wer hat die seite gemacht|wie erreiche ich den betreiber|wer hat downloadgames erstellt", "kontakt hilfe store gemacht", "Die Seite wird von Aziz Djebbi betrieben (siehe Footer). Wende dich bei Problemen an den Betreiber."],
        ["wie werde ich admin|wo ist das admin dashboard|admin zugang|admin bereich", "admin", "Der Admin-Bereich ist nur für den Betreiber der Seite gedacht."],
        ["ab wie viel jahren sind die spiele|fsk|altersfreigabe|sind die spiele für kinder", "fsk alter kinder jahren", "Viele Horrorspiele sind nicht für Kinder. Die genaue Alterseinstufung steht auf der offiziellen Steam-Seite des Spiels."],
        ["gibt es deutsche sprache|deutsche untertitel|welche sprachen hat das spiel", "sprache sprachen deutsch untertitel", "Die Sprachen eines Spiels stehen auf der offiziellen Steam-Seite. Die Seite selbst ist auf Deutsch."],
        ["gibt es eine wunschliste|wunschliste|spiel merken", "wunschliste merken", "Eine Wunschliste gibt es aktuell nicht. Du kannst Spiele zum Merken in den Warenkorb legen."],
        ["welche version hat das spiel|wird das spiel aktualisiert|versionsnummer", "version", "Wenn eine Version eingetragen ist, steht sie im Spielfenster unter dem Titel."],
        ["was ist downloadgames|was ist das für eine website|beschreibe downloadgames|erklär mir die seite", "website", "DownloadGames ist ein Shop, in dem du Spiele mit Punkten kaufst und einen Steam-Key bekommst, den du bei Steam einlöst. Aktuell gibt es {{COUNT}} Spiele."],
        ["ist downloadgames kostenlos|kostet downloadgames geld|muss ich für die website bezahlen", "website kostenlos", "Die Nutzung der Website und die Registrierung sind kostenlos. Spiele kaufst du mit Punkten."],
        ["welcher browser ist am besten|funktioniert downloadgames auf chrome|browser empfehlung", "browser", "Ein aktueller Browser wie Chrome, Edge oder Firefox ist eine gute Wahl."],
        ["die website funktioniert nicht|downloadgames geht nicht|seite ist kaputt|website fehler|warum ist die website langsam|seite lädt nicht", "website fehler", "Lade die Seite mit Strg + F5 neu und prüfe deine Internetverbindung. Bleibt der Fehler, beschreibe mir die Fehlermeldung oder melde sie dem Betreiber."],
        ["warum sehe ich keine spiele|spiele werden nicht angezeigt|katalog ist leer", "keine spiele katalog leer", "Aktualisiere die Seite mit Strg + F5. Werden weiterhin keine Spiele angezeigt, liegt vermutlich ein Problem mit den Spieldaten vor."],
        ["was bedeutet demo modus|warum demo modus|ist downloadgames beta|testversion der website", "demo beta testversion", "Der Demo-Modus dient zum Testen der Funktionen, ohne echte Zahlungen. Funktionen können sich noch ändern und Fehler auftreten."],

        // --- Gaming-Begriffe ---
        ["was ist ein horror spiel|was bedeutet survival horror|survival horror", "survival horror", "Survival-Horror verbindet Spannung, Rätsel und Bedrohung. Meist musst du eine gefährliche Umgebung erkunden und überleben."],
        ["was ist ein indie spiel|indie games|indie game bedeutung", "indie", "Indie-Spiele stammen häufig von unabhängigen Entwicklern oder kleinen Studios."],
        ["was ist ein multiplayer spiel|multiplayer bedeutung|mehrspieler|was ist singleplayer|einzelspieler", "multiplayer singleplayer", "Multiplayer heißt, mehrere Spieler spielen zusammen oder gegeneinander. Singleplayer-Spiele sind für einen einzelnen Spieler gemacht."],
        ["was ist open world|open world bedeutung|offene welt", "open world", "Eine Open World ist eine weitgehend frei erkundbare Spielwelt, in der du meist selbst bestimmst, was du tust."],
        ["was ist ein jumpscare|jumpscares|jump scare bedeutung", "jumpscare", "Ein Jumpscare ist ein plötzlicher Schreckmoment, zum Beispiel durch ein lautes Geräusch oder eine unerwartete Figur."],
        ["was ist fps|was bedeutet fps|bilder pro sekunde", "fps", "FPS heißt Frames per Second, also Bilder pro Sekunde. Mehr FPS wirken flüssiger."],
        ["was ist raytracing|ray tracing bedeutung", "raytracing", "Raytracing simuliert Licht, Reflexionen und Schatten besonders realistisch, braucht dafür aber viel Grafikleistung."],
        ["was ist dlss|was bedeutet dlss|was ist fsr|amd fsr bedeutung", "dlss fsr", "DLSS (NVIDIA) und FSR (AMD) sind Techniken, die ein Bild hochskalieren und so mehr FPS ermöglichen."],
        ["was ist unreal engine|unreal engine bedeutung|was ist unity|unity engine bedeutung|was ist eine game engine", "engine unreal unity", "Eine Game Engine ist die Software-Basis zum Entwickeln von Spielen. Bekannt sind Unreal Engine (Epic Games) und Unity."],
        ["was ist ein game launcher|launcher bedeutung", "launcher", "Ein Launcher verwaltet, aktualisiert und startet deine Spiele, zum Beispiel Steam."],
        ["was sind mods|kann man spiele verändern|warum installieren spieler mods", "mods", "Mods erweitern oder verändern Spiele, zum Beispiel mit neuen Karten, Figuren oder Funktionen."],
        ["was ist ein dlc|warum gibt es dlcs|was bedeutet downloadable content", "dlc", "DLC bedeutet Downloadable Content: Zusatzinhalte, die ein Spiel erweitern."],
        ["was ist esports|was bedeutet e sport", "esports", "Esports sind organisierte Wettkämpfe in Videospielen, teils mit professionellen Teams und Turnieren."],
        ["was bedeutet ping|warum ist ping wichtig|was ist ein hoher ping|was ist lag|warum laggt ein spiel", "ping lag", "Ping ist die Zeit, die Daten zum Server und zurück brauchen. Ein hoher Ping oder schwache Hardware führen zu Lag, also Verzögerungen."],

        // --- PC & Hardware ---
        ["was ist eine cpu|was macht die cpu|prozessor erklärung", "cpu prozessor", "Die CPU ist der Hauptprozessor. Sie führt Programmbefehle und Berechnungen aus."],
        ["was ist eine gpu|was macht die gpu|grafikkarte erklärung|ist eine gaming gpu wichtig|brauche ich eine grafikkarte", "gpu grafikkarte", "Die GPU berechnet die Grafik. Für anspruchsvolle 3D-Spiele ist sie besonders wichtig, daneben spielen CPU und RAM eine Rolle."],
        ["was ist ram|was bedeutet arbeitsspeicher|wie viel ram brauche ich zum spielen|16 gb ram ausreichend|32 gb ram gaming", "ram arbeitsspeicher", "RAM ist der Arbeitsspeicher. 16 GB reichen für viele Spiele, 32 GB geben mehr Luft bei anspruchsvollen Spielen und vielen offenen Programmen."],
        ["was ist eine ssd|was bedeutet nvme|ssd erklärung|unterschied hdd ssd|was ist eine hdd", "ssd hdd nvme", "SSDs speichern auf Flash-Speicher und sind meist viel schneller als HDDs mit drehenden Magnetscheiben. NVMe-SSDs sind besonders schnell."],
        ["was ist vram|grafikspeicher bedeutung|wie viel vram brauche ich", "vram", "VRAM ist der Speicher der Grafikkarte, zum Beispiel für Texturen."],
        ["was ist ein netzteil|psu bedeutung|was ist ein mainboard|motherboard bedeutung", "netzteil mainboard", "Das Netzteil versorgt alle Komponenten mit Strom, das Mainboard verbindet sie miteinander. Beides muss zu den übrigen Teilen passen."],
        ["was ist ein bottleneck|cpu bottleneck|gpu bottleneck", "bottleneck", "Ein Bottleneck ist ein Flaschenhals: Eine schwächere Komponente bremst die anderen aus, etwa eine alte CPU eine neue Grafikkarte."],
        ["was ist übertakten|overclocking bedeutung|cpu übertakten", "uebertakten overclocking", "Übertakten heißt, eine Komponente schneller als vorgesehen zu betreiben. Dabei steigen Temperatur und Stromverbrauch."],
        ["was ist ein treiber|grafiktreiber bedeutung|driver", "treiber", "Ein Treiber ist Software, mit der das Betriebssystem eine Hardware-Komponente ansteuert. Aktuelle Grafiktreiber helfen oft bei Spielproblemen."],
        ["warum ruckelt mein spiel|spiel laggt|fps drops|niedrige fps|wie verbessere ich meine fps|mehr fps bekommen", "ruckeln fps", "Senke die Grafikeinstellungen, schließe Hintergrundprogramme und aktualisiere die Grafiktreiber. Prüfe auch die Auslastung von CPU, GPU und RAM."],
        ["warum stürzt mein spiel ab|spiel crash|game crash|spiel schließt sich", "absturz crash", "Mögliche Ursachen sind beschädigte Spieldateien, veraltete Treiber, Überhitzung oder zu wenig Speicher. Bei Steam kannst du die Spieldateien überprüfen lassen."],
        ["warum wird mein pc heiß|hohe cpu temperatur|gpu temperatur", "heiss temperatur", "Hohe Temperaturen entstehen oft durch Staub, schlechte Belüftung oder hohe Last. Reinige den PC und prüfe die Werte mit einem Monitoring-Programm."],
        ["worauf muss man beim pc kauf achten|wie kauft man einen gaming pc|was ist bei einem gaming pc wichtig", "pc kauf", "Achte auf CPU, Grafikkarte, RAM, SSD, Netzteil, Kühlung und Aufrüstbarkeit. Was am wichtigsten ist, hängt von deinen Spielen ab."],
        ["was ist besser gaming pc oder laptop|desktop oder laptop|soll ich einen pc oder laptop kaufen", "pc laptop", "Ein Desktop-PC ist meist leistungsstärker, besser gekühlt und leichter aufzurüsten. Ein Laptop ist dafür mobil."],
        ["kann man einen pc selbst bauen|wie baut man einen gaming pc|pc selber zusammenbauen", "pc bauen", "Ja. Wichtig ist, dass CPU-Sockel, Mainboard, RAM-Typ, Gehäuse und Netzteil zueinander passen."],
        ["was ist ein monitor mit 144 hz|was ist hz beim monitor|was ist besser 60 oder 144 hz|was bedeutet bildwiederholrate", "hz monitor", "Die Hertz-Zahl sagt, wie oft ein Monitor das Bild pro Sekunde aktualisiert. Höhere Werte stellen Bewegung flüssiger dar."],

        // --- Sicherheit ---
        ["was ist phishing|phishing erklärung|betrugsversuch", "phishing", "Phishing ist ein Betrugsversuch, bei dem jemand deine Zugangsdaten abgreifen will, zum Beispiel über gefälschte Mails oder Seiten."],
        ["wie schütze ich mein konto|konto sicherheit|passwort sicherheit|ist mein passwort sicher|starkes passwort|passwort erstellen", "sicherheit passwort konto", "Nimm ein langes, einzigartiges Passwort, am besten mit Passwortmanager, und gib es nie weiter."],
        ["soll ich mein passwort teilen|passwort weitergeben|zugangsdaten schicken", "passwort teilen", "Nein. Gib dein Passwort niemals an andere Personen oder unbekannte Seiten weiter."],
        ["was ist malware|malware bedeutung|schadsoftware|was ist ransomware|was ist ein virus|computervirus bedeutung", "malware virus ransomware", "Malware ist schädliche Software. Viren verbreiten sich, Ransomware sperrt Dateien und verlangt Lösegeld. Lade nur aus vertrauenswürdigen Quellen."],

        // --- Technik & Programmierung ---
        ["was ist html|html bedeutung", "html", "HTML legt die Struktur einer Webseite fest, zum Beispiel Überschriften, Texte, Bilder und Buttons."],
        ["was ist css|css bedeutung", "css", "CSS bestimmt das Aussehen einer Webseite: Farben, Abstände, Schriften und Layout."],
        ["was ist javascript|javascript erklärung|js bedeutung", "javascript", "JavaScript macht Webseiten interaktiv und läuft mit Node.js auch auf Servern."],
        ["was ist node js|nodejs bedeutung", "node", "Node.js führt JavaScript außerhalb des Browsers aus, zum Beispiel auf einem Server."],
        ["was ist python|wofür braucht man python", "python", "Python ist eine vielseitige Programmiersprache für Automatisierung, Datenanalyse, Webentwicklung und KI."],
        ["was ist eine api|api bedeutung", "api", "Eine API ist eine Schnittstelle, über die Programme miteinander sprechen."],
        ["was ist ein server|server erklärung", "server", "Ein Server ist ein Computer oder Programm, das anderen Geräten Dienste und Daten bereitstellt."],
        ["was ist eine datenbank|datenbank bedeutung|wofür braucht man datenbanken", "datenbank", "Eine Datenbank speichert Informationen geordnet. Websites nutzen sie zum Beispiel für Konten, Produkte und Bestellungen."],
        ["was ist github|github erklärung", "github", "GitHub ist eine Plattform, auf der Entwickler Code speichern, verwalten und gemeinsam daran arbeiten."],
        ["wie lernt man programmieren|ist programmieren schwer|wie fängt man mit coding an|ich möchte programmieren lernen", "programmieren lernen", "Fang mit kleinen Projekten an. HTML, CSS und JavaScript passen für Webseiten, Python ist ein guter Einstieg für Anfänger."],
        ["wie findet man programmierfehler|was ist debugging|wie debuggt man code", "debugging fehler", "Beim Debugging gehst du das Programm Schritt für Schritt durch. Fehlermeldungen, Konsolenausgaben und ein Debugger helfen dabei."],
        ["was ist luau|wofür verwendet man luau|ist luau wie lua", "luau", "Luau ist die Programmiersprache von Roblox und basiert auf Lua."],
        ["was ist roblox studio|wie erstellt man roblox spiele|kann man eigene roblox spiele machen", "roblox studio", "In Roblox Studio baust du Spielwelten, schreibst Luau-Skripte und veröffentlichst eigene Spiele."],
        ["was ist eine ki|künstliche intelligenz erklärung|artificial intelligence", "ki kuenstliche intelligenz", "Künstliche Intelligenz sind Computersysteme, die Aufgaben wie Sprache verstehen, Muster erkennen oder Probleme lösen übernehmen."],
        ["was ist ollama|ollama erklärung|ollama bedeutung", "ollama", "Ollama führt KI-Sprachmodelle lokal auf deinem Computer aus."],
        ["was ist qwen|qwen ki|qwen3", "qwen", "Qwen ist eine Familie von KI-Sprachmodellen. Qwen3 eignet sich unter anderem für Gespräche und Textaufgaben."],
        ["was ist ein chatbot|chatbot bedeutung|was ist ein sprachmodell|was ist ein llm", "chatbot sprachmodell llm", "Ein Chatbot kommuniziert per Text oder Sprache mit Menschen. Ein Sprachmodell (LLM) erzeugt Antworten anhand gelernter Sprachmuster."],
        ["warum lügt ki|warum erfindet ki antworten|kann ki halluzinieren", "ki halluzinieren luegt", "Sprachmodelle können überzeugend klingende, aber falsche Antworten erfinden. Wichtige Aussagen solltest du deshalb prüfen."],
        ["was bedeutet open source|open source erklärung", "open source", "Bei Open Source ist der Quellcode öffentlich und darf unter bestimmten Lizenzen genutzt und verändert werden."],
        // --- Smalltalk ---
        ["wie geht es dir|wie gehts|wie geht's|alles gut bei dir|was geht", "wie geht", "Mir geht es gut, danke! Ich bin bereit für deine Fragen. Und dir?"],
        ["mir geht es gut|mir geht's gut|alles gut|ganz gut|bin gut drauf", "mir gut", "Freut mich! Kann ich dir bei einem Spiel oder der Seite helfen?"],
        ["mir ist langweilig|ich langweile mich|mir ist langweilig was kann ich machen", "langweilig", "Dann such dir ein neues Spiel aus! Sag mir ein Genre oder dein Budget, ich schlage dir etwas vor. Oder ich erzähle dir einen Witz."],
        ["wie alt bist du|wann wurdest du gemacht|wer hat dich gebaut|wer hat dich programmiert", "alt gebaut programmiert", "Ich bin ein Chat-Assistent der DownloadGames-Seite und wurde vom Betreiber der Seite eingebaut."],
        ["hast du gefühle|bist du traurig|bist du glücklich|kannst du fühlen", "gefuehle", "Ich bin ein Programm und habe keine echten Gefühle, aber ich helfe dir gern."],
        ["was ist dein lieblingsspiel|welches spiel magst du|hast du ein lieblingsspiel", "lieblingsspiel", "Ich kann nicht selbst spielen, aber ich kenne alle Spiele im Katalog. Sag mir dein Genre, dann finden wir etwas für dich."],
        ["ich liebe dich|du bist toll|du bist cool|du bist der beste|gut gemacht", "lob", "Danke, das freut mich! Brauchst du noch etwas?"],
        ["du bist dumm|du bist schlecht|du nervst|du bist nutzlos", "kritik", "Tut mir leid, dass ich nicht weiterhelfen konnte. Formuliere die Frage gern anders, dann versuche ich es noch einmal."],
        ["gute nacht|schlaf gut|ich gehe schlafen|nacht", "nacht", "Gute Nacht{{NAMEC}}! Bis zum nächsten Mal."],
        ["ich bin müde|ich habe hunger|ich habe durst", "muede hunger", "Mach eine kleine Pause, trink etwas und zocke danach entspannt weiter."],
        ["wie spät ist es|welche uhrzeit ist es|uhrzeit", "uhrzeit", "Die genaue Uhrzeit kann ich nicht sehen. Sie steht unten rechts auf deinem Gerät."],
        ["welcher tag ist heute|welches datum haben wir|datum heute", "datum", "Das aktuelle Datum zeigt dir dein Gerät. Ich habe darauf keinen Zugriff."],

        // --- Spieltipps ---
        ["welches spiel ist gut für anfänger|einsteigerfreundliche spiele|leichte spiele", "anfaenger leicht", "Für den Einstieg eignen sich Spiele mit ruhigem Tempo und klarer Steuerung. Nenne mir ein Genre, dann suche ich etwas Passendes aus dem Katalog."],
        ["welche spiele kann ich mit freunden spielen|koop spiele|coop spiele|spiele für zwei", "koop freunde", "Schau in der Spielbeschreibung nach Multiplayer oder Koop. Dort steht, wie viele Spieler mitmachen können."],
        ["welche spiele sind gruselig|gruselige spiele|horror empfehlung|ich will mich gruseln", "gruselig horror empfehlung", "Probiere die Horror-Genres im Store aus. Nutze den Genre-Filter oben, um nur Horrorspiele zu sehen."],
        ["welche spiele sind entspannt|chillige spiele|spiele zum entspannen|cozy games", "entspannt chillig cozy", "Entspannte Spiele haben meist wenig Druck und ruhige Musik. Filtere im Store nach passenden Genres oder nenne mir deinen Geschmack."],
        ["welche spiele haben gute grafik|schöne grafik|grafisch beste spiele", "grafik schoen", "Details zur Grafik findest du in der Beschreibung und den Systemanforderungen. Hohe Anforderungen bedeuten oft aufwendige Grafik."],
        ["welche spiele sind kurz|kurze spiele|spiele für zwischendurch", "kurz zwischendurch", "Kurze Spiele erkennst du an der Beschreibung. Auch Indie-Spiele sind oft schneller durchgespielt."],
        ["welche spiele sind lang|lange spiele|viel spielzeit", "lang spielzeit", "Open-World- und Rollenspiele bieten meist viele Stunden Spielzeit. Prüfe die Beschreibung des Spiels."],
        ["ich habe 10 euro|spiele unter 10 euro|günstige spiele|budget spiele|spiele unter 20 euro", "budget guenstig unter euro", "Das günstigste Spiel ist {{CHEAPEST}}. Sag mir dein Budget, dann schlage ich dir passende Spiele vor."],
        ["gibt es angebote|rabatte|sale|gibt es gutscheine|rabattcode", "angebot rabatt sale gutschein", "Aktuelle Angebote siehst du im Store. Einen Rabattcode-Bereich gibt es in dieser Version nicht."],
        ["wie lange dauert es ein spiel durchzuspielen|spielzeit|wie lang ist das spiel", "spielzeit durchspielen", "Die Spielzeit hängt vom Spiel und deinem Tempo ab. Hinweise findest du in der Spielbeschreibung."],

        // --- Gaming-Begriffe 2 ---
        ["was ist ein rpg|was bedeutet rollenspiel|rpg bedeutung", "rpg rollenspiel", "In einem Rollenspiel (RPG) steuerst du eine Figur, die Fähigkeiten und Ausrüstung entwickelt und eine Geschichte erlebt."],
        ["was ist ein shooter|ego shooter bedeutung|fps genre|was ist ein egoshooter", "shooter", "Shooter sind Spiele, in denen mit Waffen geschossen wird. Beim Ego-Shooter siehst du die Welt aus der Sicht der Figur."],
        ["was ist ein battle royale|battle royale bedeutung", "battle royale", "Beim Battle Royale kämpfen viele Spieler auf einer schrumpfenden Karte, bis nur einer oder ein Team übrig bleibt."],
        ["was ist ein sandbox spiel|sandbox bedeutung", "sandbox", "Ein Sandbox-Spiel gibt dir viel Freiheit, selbst zu bauen, zu erkunden und eigene Ziele zu setzen."],
        ["was ist ein rogue like|roguelike bedeutung|roguelite bedeutung", "roguelike", "Roguelikes haben zufällig erzeugte Level und oft permanenten Fortschrittsverlust beim Scheitern. Roguelites behalten einen Teil des Fortschritts."],
        ["was ist ein souls like|soulslike bedeutung|warum sind souls spiele schwer", "soulslike", "Soulslikes sind für hohe Schwierigkeit, genaue Kämpfe und Lernen durch Ausprobieren bekannt."],
        ["was ist ein plattformer|jump and run bedeutung", "plattformer jump run", "In Plattformern läufst und springst du über Hindernisse und Lücken durch die Level."],
        ["was ist ein puzzle spiel|rätselspiel bedeutung", "puzzle raetsel", "Puzzle-Spiele fordern dich mit Rätseln und logischem Denken heraus."],
        ["was ist ein strategiespiel|strategie bedeutung|was ist rts", "strategie rts", "Strategiespiele verlangen Planung, zum Beispiel beim Aufbau einer Basis oder dem Führen von Armeen. RTS steht für Echtzeitstrategie."],
        ["was ist ein npc|npc bedeutung", "npc", "Ein NPC ist eine Nicht-Spieler-Figur, die vom Spiel gesteuert wird, etwa Händler oder Gegner."],
        ["was ist ein boss|bossgegner bedeutung|bosskampf", "boss", "Ein Boss ist ein besonders starker Gegner, oft am Ende eines Levels oder Spielabschnitts."],
        ["was ist ein speedrun|speedrunning bedeutung", "speedrun", "Beim Speedrun versuchen Spieler, ein Spiel so schnell wie möglich durchzuspielen."],
        ["was ist ein lets play|let's play bedeutung|was ist streaming|was ist twitch", "lets play streaming twitch", "Bei einem Let's Play spielt jemand ein Spiel und zeigt es per Video oder Livestream. Twitch ist eine bekannte Streaming-Plattform."],
        ["was ist ein patch|was ist ein update bei spielen|was bedeutet patchnotes", "patch update", "Ein Patch behebt Fehler oder fügt Neuerungen hinzu. Patchnotes listen die Änderungen auf."],
        ["was ist early access|early access bedeutung|was bedeutet vorabzugang", "early access", "Early Access heißt, ein Spiel ist schon spielbar, aber noch in Entwicklung. Inhalte und Fehler können sich noch ändern."],
        ["was ist ein bug|was ist ein glitch|bug bedeutung", "bug glitch", "Ein Bug ist ein Fehler in einem Programm. Ein Glitch ist ein sichtbarer Fehler im Spiel, oft eine kleine Fehlfunktion."],
        ["was ist ein skin|skins bedeutung|was bedeutet cosmetics", "skin cosmetics", "Skins sind kosmetische Änderungen am Aussehen von Figuren oder Waffen, ohne Einfluss auf den Spielverlauf."],
        ["was ist pay to win|pay to win bedeutung|p2w", "pay to win", "Pay-to-Win bedeutet, dass man sich mit Echtgeld Vorteile im Spiel kaufen kann."],
        ["was ist ein controller|gamepad bedeutung|maus und tastatur oder controller", "controller gamepad", "Ein Controller ist ein Gamepad zum Steuern. Ob Controller oder Maus und Tastatur besser passt, hängt vom Spiel ab."],
        ["was ist vsync|was bedeutet vsync|vsync an oder aus", "vsync", "VSync synchronisiert die Bildausgabe mit dem Monitor und verhindert Bildreißen, kann aber die Eingabe verzögern."],
        ["was ist eine hitbox|hitbox bedeutung", "hitbox", "Die Hitbox ist der unsichtbare Bereich, in dem ein Treffer gewertet wird."],
        ["was ist ein cooldown|cooldown bedeutung", "cooldown", "Ein Cooldown ist die Wartezeit, bis du eine Fähigkeit oder Aktion erneut nutzen kannst."],
        ["was ist ein spawn|respawn bedeutung|spawnen", "spawn respawn", "Spawnen heißt, dass eine Figur oder ein Objekt im Spiel erscheint. Beim Respawn kehrst du nach dem Tod zurück."],
        ["was ist xp|erfahrungspunkte bedeutung|was bedeutet level up", "xp level", "XP sind Erfahrungspunkte. Hast du genug, steigst du ein Level auf und wirst stärker."],
        ["was ist ein tutorial|tutorial bedeutung", "tutorial", "Ein Tutorial erklärt dir die Steuerung und Grundregeln eines Spiels."],

        // --- Roblox ---
        ["was ist roblox|roblox erklärung|ist roblox kostenlos", "roblox", "Roblox ist eine Plattform mit unzähligen Spielen, die Nutzer selbst erstellen. Der Einstieg ist kostenlos."],
        ["was ist robux|robux bedeutung|wie bekomme ich robux", "robux", "Robux ist die Spielwährung von Roblox. Du kaufst sie im offiziellen Roblox-Shop. Fremde Seiten mit Gratis-Robux sind meist Betrug."],
        ["was ist ein remote event|remoteevent roblox|was ist remotefunction", "remote event", "RemoteEvents verschicken Nachrichten zwischen Client und Server in Roblox. RemoteFunctions geben zusätzlich eine Antwort zurück."],
        ["was ist ein localscript|server script roblox|unterschied script und localscript", "localscript script", "Ein Script läuft auf dem Server, ein LocalScript auf dem Gerät des Spielers. Wichtige Logik gehört auf den Server."],
        ["was ist datastore roblox|wie speichere ich daten in roblox|datastoreservice", "datastore", "Mit dem DataStoreService speicherst du Spielerdaten dauerhaft, zum Beispiel Geld oder Fortschritt."],
        ["was ist ein tycoon|tycoon spiel bedeutung|roblox tycoon", "tycoon", "In einem Tycoon baust du ein Geschäft oder eine Fabrik auf und investierst Einnahmen in Erweiterungen."],

        // --- Technik 2 ---
        ["was ist ein browser|browser erklärung", "browser erklaerung", "Ein Browser ist ein Programm, mit dem du Webseiten anzeigst, zum Beispiel Chrome, Edge oder Firefox."],
        ["was ist der cache|browser cache leeren|wie lösche ich den cache", "cache", "Der Cache speichert Dateien zwischen, damit Seiten schneller laden. Bei Anzeigefehlern hilft oft Strg + F5 oder das Leeren des Caches."],
        ["was ist ein vpn|vpn bedeutung|brauche ich ein vpn", "vpn", "Ein VPN leitet deinen Datenverkehr über einen anderen Server und verschlüsselt ihn. Es kann Privatsphäre erhöhen, macht dich aber nicht unverwundbar."],
        ["was ist eine ip adresse|ip adresse bedeutung", "ip adresse", "Die IP-Adresse ist die Adresse deines Geräts oder Anschlusses im Netzwerk."],
        ["was ist wlan|wlan oder lan kabel|lan kabel besser", "wlan lan", "Ein LAN-Kabel ist meist stabiler und hat weniger Ping-Schwankungen als WLAN. Für Online-Spiele ist Kabel oft besser."],
        ["was ist ein router|router neustarten|internet langsam", "router internet", "Bei langsamem Internet hilft oft ein Router-Neustart. Prüfe auch, ob andere Geräte gerade viel Bandbreite nutzen."],
        ["was ist json|json bedeutung", "json", "JSON ist ein Textformat zum Speichern und Austauschen von Daten, zum Beispiel zwischen Server und Webseite."],
        ["was ist ein array|array bedeutung|was ist eine liste in programmierung", "array liste", "Ein Array ist eine geordnete Liste von Werten, auf die du über einen Index zugreifst."],
        ["was ist eine variable|variable bedeutung", "variable", "Eine Variable ist ein benannter Speicherplatz für einen Wert in einem Programm."],
        ["was ist eine funktion|funktion programmieren|was ist eine methode", "funktion methode", "Eine Funktion ist ein wiederverwendbarer Codeblock, der eine bestimmte Aufgabe erledigt."],
        ["was ist eine schleife|for schleife|while schleife", "schleife", "Eine Schleife wiederholt Code, zum Beispiel für jedes Element einer Liste oder so lange, bis eine Bedingung erfüllt ist."],
        ["was ist eine if abfrage|bedingung programmieren", "if bedingung", "Mit if prüfst du eine Bedingung und führst Code nur aus, wenn sie zutrifft."],
        ["was ist git|git erklärung|versionskontrolle", "git versionskontrolle", "Git speichert Versionen deines Codes, sodass du Änderungen nachverfolgen und rückgängig machen kannst."],
        ["was ist ein framework|framework bedeutung|was ist react", "framework react", "Ein Framework ist eine Grundstruktur für Software. React ist eine JavaScript-Bibliothek für Benutzeroberflächen."],
        ["was ist sql|sql bedeutung", "sql", "SQL ist eine Sprache, mit der du Daten in Datenbanken abfragst und veränderst."],
        ["was ist cloud|cloud bedeutung|was ist cloud gaming", "cloud", "Cloud heißt, dass Daten oder Programme auf entfernten Servern liegen. Beim Cloud-Gaming läuft das Spiel auf einem Server und wird gestreamt."],

        // --- Sonstiges ---
        ["was ist linux|linux bedeutung|kann man auf linux spielen", "linux", "Linux ist ein freies Betriebssystem. Viele Spiele laufen dort über Steam und Proton, aber nicht alle."],
        ["was ist windows 11|windows 10 oder 11|brauche ich windows 11", "windows", "Ob ein Spiel Windows 10 oder 11 braucht, steht in den Systemanforderungen. Die meisten Spiele laufen auf beiden."],
        ["was ist directx|directx bedeutung", "directx", "DirectX ist eine Sammlung von Schnittstellen von Microsoft, die Spiele für Grafik und Sound unter Windows nutzen."],
        ["was ist ein fehlercode|wie finde ich einen fehler|programm startet nicht", "fehlercode startet nicht", "Notiere dir die Fehlermeldung und suche damit gezielt. Hilfreich sind Neustart, aktuelle Treiber und Prüfen der Spieldateien bei Steam."],
        ["spiel startet nicht|spiel öffnet sich nicht|steam spiel startet nicht", "spiel startet nicht", "Überprüfe bei Steam die Spieldateien (Rechtsklick, Eigenschaften, Installierte Dateien), aktualisiere die Treiber und starte neu."],
        ["wie überprüfe ich spieldateien|steam dateien überprüfen|spieldateien verifizieren", "spieldateien pruefen", "In Steam: Rechtsklick aufs Spiel, Eigenschaften, Installierte Dateien, dann „Integrität der Spieldateien überprüfen“."],
        ["was ist ein fps limit|fps begrenzen", "fps limit", "Ein FPS-Limit begrenzt die Bilder pro Sekunde. Das spart Strom und senkt die Temperatur."],
        ["was ist ein screenshot|wie mache ich einen screenshot", "screenshot", "Unter Windows drückst du Windows + Shift + S für einen Ausschnitt. Bei Steam geht es mit F12."],
        ["wie nehme ich gameplay auf|spiel aufnehmen|bildschirm aufnehmen", "aufnehmen", "Unter Windows hilft die Xbox Game Bar (Windows + G). Es gibt auch Programme wie OBS Studio."],
    ];

    const FAQ = FAQ_RAW.map(([v, kw, a]) => {
        const variants = v.split("|");
        return {
            variants,
            sets: variants.map(x => new Set(tokens(x))),
            kw: [...new Set(tokens(kw))],
            kwRaw: kw,
            a
        };
    });

    /* =====================================
       SMALLTALK: ["id", "Beispielsätze|…", "Antwort|Antwort|…"]
       Platzhalter: {{NAMEC}} {{TIME}} {{DATE}} {{JOKE}} {{FACT}} {{RANDOMGAME}} {{COUNT}} {{GENRES}} {{NEWEST}}
       Spezial: @REPEAT @NAME @RPS CRISIS
    ===================================== */

    const JOKES = [
        "Warum lügen Skelette nie? Weil man direkt durch sie hindurchsieht.",
        "Warum ging der Computer zum Arzt? Er hatte einen Virus.",
        "Ich wollte einen Witz über UDP erzählen, aber ich weiß nicht, ob er ankommt.",
        "Warum sind Programmierer so schlecht im Camping? Wegen der vielen Bugs.",
        "Treffen sich zwei Pixel. Sagt der eine: Du siehst heute gut aufgelöst aus.",
        "Warum verlor der Gamer seinen Job? Er war zu oft AFK.",
        "Was macht ein Gamer nach dem Aufstehen? Erst einmal speichern.",
        "Was sagt der Endboss zum Spieler? Wir sehen uns im nächsten Level.",
        "Warum können Zombies keine Computer bedienen? Sie haben keinen Verstand mehr.",
        "Warum war der Controller traurig? Er hatte keine Verbindung mehr.",
        "Was sagt ein NPC zum anderen? Wir treffen uns immer wieder an derselben Stelle.",
        "Warum hat der PC Angst vor dem Sommer? Wegen der Überhitzung.",
        "Wie nennt man einen schnellen Gamer? Einen Speedrunner.",
        "Warum ist der Ladebalken so geduldig? Er nimmt sich Zeit.",
        "Warum können Programmierer keine Treppen steigen? Sie bevorzugen Schleifen.",
        "Wie viele Programmierer braucht man, um eine Glühbirne zu wechseln? Keinen, das ist ein Hardwareproblem.",
        "Ein SQL-Statement geht in eine Bar und fragt zwei Tische: Darf ich mich mit euch verbinden?",
        "Warum hat der Computer kalte Füße? Weil er zu viele offene Windows hat.",
        "Warum sind Arrays so ordentlich? Weil jedes Element seinen Platz hat.",
        "Was ist das Lieblingsgetränk eines Programmierers? Java.",
        "Was sagt der Bug zum Entwickler? Du hast mich gefunden!",
        "Warum können Programmierer schlecht lügen? Ihr Code verrät sie.",
        "Warum hat der Server Urlaub genommen? Er war überlastet.",
        "Was ist die Lieblingszahl eines Webentwicklers? 404.",
        "Was ist braun und schwimmt unter Wasser? Ein U-Brot.",
        "Was macht ein Mathematiker im Garten? Wurzeln ziehen.",
        "Was sagt die Null zur Acht? Schicker Gürtel!",
        "Warum ging die Tomate über die Straße? Weil sie Ketchup wollte.",
        "Was sagt ein Hammer zum Nagel? Du gehst mir auf den Kopf.",
        "Was macht ein Pirat am Computer? Er drückt die Enter-Taste.",
        "Warum sind Bücher so schlau? Sie haben viele Seiten.",
        "Was ist orange und wandert durch die Berge? Eine Wanderine.",
        "Warum ging Mario zum Zahnarzt? Er hatte ein Loch in der Röhre.",
        "Warum nehmen Geister keine Bahn? Weil sie lieber durch die Wand gehen. 👻",
        "Was macht ein Laptop am Strand? Er surft im Internet.",
        "Warum ist WLAN manchmal schüchtern? Es versteckt seine Verbindung.",
        "Was sagt ein Compiler zum Code? Ich verstehe dich nicht.",
        "Was macht ein Entwickler, wenn er müde ist? Er geht in den Sleep-Modus.",
        "Warum mögen Entwickler keine Überraschungen? Sie verursachen Bugs.",
        "Was ist das Gegenteil von Game Over? Game Beginning.",
        "Warum hat der Gamer eine Leiter gekauft? Er wollte ein höheres Level erreichen.",
        "Warum können Fahrräder nicht stehen? Weil sie zwei müde sind.",
        "Was macht ein Keks unter einem Baum? Krümel.",
        "Warum sind Schnecken so langsam? Sie haben ihr Haus immer dabei.",
        "Was macht ein Schaf auf dem Trampolin? Wolle springen.",
        "Warum können Kalender nicht lügen? Ihre Tage sind gezählt.",
        "Was sagt die Lampe zum Strom? Du bringst mich zum Leuchten.",
        "Was ist weiß und stört beim Essen? Eine Lawine."
    ];

    const FACTS = [
        "Pong erschien 1972 und gehört zu den ersten kommerziell erfolgreichen Videospielen.",
        "Tetris wurde 1984 von Alexei Paschitnow entwickelt.",
        "Super Mario hieß während der Entwicklung ursprünglich Jumpman.",
        "Nintendo wurde 1889 gegründet und stellte ursprünglich Spielkarten her.",
        "Die erste PlayStation erschien 1994 in Japan.",
        "Doom erschien 1993 und prägte das Genre der Ego-Shooter.",
        "Counter-Strike entstand ursprünglich als Modifikation für Half-Life.",
        "Roblox wurde 2006 veröffentlicht.",
        "Das erste bekannte Easter Egg in einem Videospiel steckt in Adventure für den Atari 2600.",
        "Ein NPC ist eine Spielfigur, die nicht von einem Spieler gesteuert wird.",
        "Prozedurale Generierung kann Spielwelten automatisch erzeugen.",
        "Speedrunner versuchen, Spiele möglichst schnell abzuschließen.",
        "Motion Capture zeichnet Bewegungen echter Personen auf, um sie digital zu verwenden.",
        "Roblox Studio verwendet Luau als Skriptsprache, eine Weiterentwicklung von Lua.",
        "Blender ist eine kostenlose und quelloffene 3D-Software.",
        "Die CPU wird häufig als Hauptprozessor eines Computers bezeichnet.",
        "Eine SSD hat keine beweglichen Magnetscheiben wie eine klassische HDD.",
        "Wärmeleitpaste verbessert den Wärmeübergang zwischen Prozessor und Kühler.",
        "Ein Monitor mit 144 Hz kann bis zu 144 Bilder pro Sekunde anzeigen.",
        "USB steht für Universal Serial Bus.",
        "HTML beschreibt die Struktur einer Webseite, CSS gestaltet sie, JavaScript macht sie interaktiv.",
        "HTTPS verschlüsselt die Verbindung zwischen Browser und Webserver.",
        "Ein DNS-Server übersetzt Domainnamen in IP-Adressen.",
        "Git hilft dabei, Änderungen am Quellcode nachzuverfolgen.",
        "Ein Bug ist ein Fehler in einer Software, Debugging heißt, ihn zu finden und zu beheben.",
        "Ein Token ist die kleine Texteinheit, mit der ein Sprachmodell arbeitet.",
        "Ollama ermöglicht das lokale Ausführen vieler KI-Sprachmodelle.",
        "KI-Modelle können Fehler machen und Informationen erfinden.",
        "RAG verbindet ein Sprachmodell mit einer externen Wissensdatenbank.",
        "Ein Oktopus hat drei Herzen.",
        "Bananen zählen botanisch zu den Beeren, Erdbeeren dagegen nicht.",
        "Ein Kolibri kann in der Luft auf der Stelle fliegen.",
        "Honig kann bei richtiger Lagerung sehr lange haltbar bleiben.",
        "Ein Axolotl kann bestimmte Körperteile nachwachsen lassen.",
        "Krähen können Werkzeuge verwenden.",
        "Fledermäuse orientieren sich mit Echoortung.",
        "Wombats produzieren würfelförmigen Kot.",
        "Schmetterlinge schmecken mit Rezeptoren an ihren Füßen.",
        "Licht braucht von der Sonne bis zur Erde ungefähr acht Minuten.",
        "Jupiter ist der größte Planet unseres Sonnensystems.",
        "Ein Tag auf der Venus ist länger als ein Venusjahr.",
        "Ein Lichtjahr ist eine Entfernung und keine Zeiteinheit.",
        "Schall kann sich im Vakuum nicht ausbreiten.",
        "Diamanten bestehen hauptsächlich aus Kohlenstoff.",
        "Ein Blitz kann heißer werden als die Oberfläche der Sonne.",
        "Das Wort Roboter stammt aus dem Tschechischen.",
        "Bluetooth ist nach dem dänischen König Harald Blauzahn benannt.",
        "Die erste öffentliche Webseite ging 1991 online.",
        "Der Begriff Computer bezeichnete ursprünglich Menschen, die Berechnungen durchführten.",
        "Ein Schachbrett hat 64 Felder.",
        "Eine Primzahl ist nur durch 1 und sich selbst teilbar.",
        "Die Zahl Pi beschreibt das Verhältnis von Umfang zu Durchmesser eines Kreises."
    ];

    const SMALL_RAW = [
        ["wie_gehts", "wie geht es dir|wie gehts dir|wie geht's|alles gut bei dir|na wie läufts|was geht bei dir|wie fühlst du dich heute|alles klar bei dir|geht es dir gut",
            "Mir geht's gut, danke der Nachfrage! Und dir?|Alles bestens hier im Browser 😄 Wie geht es dir?|Läuft bei mir. Ich bin ja von guten Spielen umgeben. Und bei dir?"],
        ["name", "wie ist dein name|hast du einen namen|wie soll ich dich nennen|wie darf ich dich nennen|hast du einen spitznamen",
            "Ich bin der DownloadGames-Assistent. Nenn mich gern einfach Assistent.|Mein Name ist DownloadGames-Assistent, kurz DG. Und du?"],
        ["alter", "wie alt bist du|wann hast du geburtstag|wann wurdest du erstellt|wie lange gibt es dich schon",
            "Ich bin ein Programm und habe kein Alter wie du. Gefühlt bin ich so alt wie die letzte Aktualisierung dieser Seite 😄|Einen Geburtstag habe ich nicht eingetragen, dafür kenne ich die Erscheinungsdaten der Spiele."],
        ["ersteller", "wer hat dich gemacht|wer hat dich programmiert|wer hat dich erschaffen|wer hat dich gebaut|wer ist dein schöpfer",
            "Ich gehöre zur DownloadGames-Seite. Betrieben wird sie von Aziz Djebbi.|Gebaut wurde ich für diese Seite, damit du schnell Antworten zu Spielen bekommst."],
        ["wohnort", "wo wohnst du|wo lebst du|wo bist du gerade|wo kommst du her",
            "Ich lebe direkt hier im Browser, auf der DownloadGames-Seite. Kleine Wohnung, aber schnelles Internet 😄"],
        ["persoenlichkeit", "beschreibe dich|wie würdest du dich beschreiben|was für ein typ bist du|welchen charakter hast du|wie bist du so",
            "Ich bin ein digitaler Assistent: sachlich, neugierig und auf Gaming spezialisiert.|Ich bin eher der technische Typ: Spiele, Computer und Informationen sind mein Ding."],
        ["staerken", "was kannst du besonders gut|was sind deine stärken|worin bist du gut|was kannst du am besten",
            "Ich kann Fragen zu DownloadGames beantworten, Spiele finden, rechnen und bei Technikfragen helfen."],
        ["schwaechen", "was kannst du nicht|was sind deine schwächen|worin bist du schlecht|was fällt dir schwer|machst du fehler|bist du perfekt",
            "Perfekt bin ich nicht. Ich kann mich irren und kenne nicht jede aktuelle Entwicklung. Wichtige Dinge solltest du deshalb prüfen."],
        ["meinung", "was ist deine meinung|was denkst du darüber|wie siehst du das|was hältst du davon",
            "Ich habe keine persönlichen Meinungen wie ein Mensch, kann aber Vor- und Nachteile erklären und vergleichen."],
        ["erinnerung", "kannst du dich erinnern|erinnerst du dich an mich|weißt du noch was ich gesagt habe|vergisst du etwas",
            "Während unseres Gesprächs merke ich mir, was wir geschrieben haben. Wenn der KI-Server läuft, kann er sich auch an frühere Chats und gespeicherte Notizen erinnern."],
        ["datenschutz_ki", "speicherst du meine nachrichten|liest jemand meine nachrichten|sind meine chats privat|kannst du geheimnisse bewahren",
            "Dein Chatverlauf wird im Browser gespeichert, und der KI-Server legt Gespräche in Dateien ab. Teile deshalb keine Passwörter oder andere sensible Daten."],
        ["langeweile", "mir ist langweilig|ich langweile mich|ich habe langeweile|was soll ich tun|was kann ich jetzt machen|ich weiß nicht was ich machen soll|unterhalte mich|lass uns reden|ich möchte quatschen",
            "Dagegen helfen Spiele! Wie wäre {{RANDOMGAME}}? Oder sag „Witz“ oder „Fun Fact“.|Langeweile? Lass dir von mir ein Spiel empfehlen oder frag mich nach einem Fun Fact."],
        ["traurig", "ich bin traurig|mir geht es schlecht|ich fühle mich schlecht|ich hatte einen schlechten tag|ich bin down|ich bin einsam|heute läuft alles schief|ich bin enttäuscht|ich fühle mich allein|niemand versteht mich|ich habe keine freunde",
            "Das tut mir leid. Magst du erzählen, was los ist? Ich höre zu. Wenn es dir länger schlecht geht, sprich auch mit Freunden, Familie oder einer Vertrauensperson.|Schade, dass es dir nicht gut geht. Ich bin nur ein Assistent, aber ich bin da. Manchmal hilft eine kleine Pause oder ein entspanntes Spiel."],
        ["ueberforderung", "ich bin gestresst|ich habe stress|ich habe zu viel stress|ich fühle mich überfordert|mir wächst alles über den kopf|ich schaffe das nicht|mir ist alles zu viel|ich weiß nicht weiter|ich kann nicht mehr|ich will nicht mehr",
            "Das klingt gerade ziemlich viel. Versuch, eine kleine Sache nach der anderen anzugehen. Wenn dich das stark belastet, sprich mit einer vertrauten Person.|Das klingt anstrengend. Eine Pause und ein Plan in kleinen Schritten können helfen. Und du musst das nicht allein tragen."],
        ["angst", "ich habe angst|ich bin nervös|ich mache mir sorgen|ich habe vor etwas angst",
            "Es ist okay, manchmal Angst oder Sorgen zu haben. Magst du erzählen, was dich belastet? Ein Gespräch mit einer vertrauten Person kann ebenfalls helfen."],
        ["wut", "ich bin wütend|ich rege mich auf|ich bin sauer|ich habe schlechte laune",
            "Das klingt frustrierend. Eine kurze Pause kann helfen, Abstand zu gewinnen. Wenn du magst, erzähl, was passiert ist."],
        ["gluecklich", "ich bin glücklich|mir geht es gut|ich habe gute laune|heute ist ein toller tag|ich bin gut drauf|mir geht es super|mir geht es richtig gut|ich bin stolz auf mich|ich habe etwas geschafft|ich habe gewonnen",
            "Das freut mich! Dann lass uns den Tag mit einem guten Spiel krönen.|Schön zu hören 😊 Was hast du geschafft?"],
        ["muede", "ich bin müde|ich kann nicht schlafen|ich bin erschöpft|ich habe keine energie|ich brauche eine pause|ich muss mich ausruhen",
            "Dann gönn dir etwas Ruhe. Die Spiele laufen nicht weg 😄|Müde? Ein Glas Wasser und kurz frische Luft helfen oft."],
        ["motivation", "ich bin unmotiviert|ich habe keine motivation|wie bekomme ich motivation|ich habe keine lust|ich komme nicht weiter|mein projekt ist zu groß",
            "Fang mit einer winzigen Aufgabe an. Teile dein Projekt in kleine Schritte und teste jeden einzeln. Du musst nicht alles auf einmal schaffen."],
        ["konzentration", "ich kann mich nicht konzentrieren|wie kann ich mich besser konzentrieren|ich bin abgelenkt",
            "Ein ruhiger Platz, Handy außer Reichweite und kurze Pausen helfen oft, konzentrierter zu bleiben."],
        ["gute_nacht", "gute nacht|ich gehe schlafen|ich geh ins bett|schlaf gut|nacht",
            "Gute Nacht{{NAMEC}}! Schlaf gut und bis bald 🌙|Schlaf gut{{NAMEC}}! Morgen warten neue Spiele auf dich."],
        ["kompliment", "du bist cool|du bist toll|du bist schlau|du bist der beste|gut gemacht|du bist nett|du bist klug|du bist lustig|du bist hilfreich|das war super|gute antwort|stark gemacht|das war hilfreich",
            "Danke, das freut mich! 😊|Vielen Dank, solche Worte höre ich gern. Womit kann ich noch helfen?|Dankeschön! Ich gebe mein Bestes."],
        ["kritik", "du bist dumm|du bist doof|du bist schlecht|du nervst|du bist nutzlos|du bist langweilig|du verstehst nichts|du bist keine hilfe|das war falsch|das stimmt nicht|du liegst falsch|falsche antwort",
            "Tut mir leid, dass ich nicht weitergeholfen habe. Formuliere es gern anders oder sag mir genauer, was du wissen willst.|Okay, da lag ich wohl daneben. Versuch es nochmal mit anderen Worten, ich gebe mir Mühe."],
        ["liebe", "ich liebe dich|hast du mich lieb|bist du in mich verliebt|willst du meine freundin sein|willst du mein freund sein|heirate mich|magst du mich",
            "Das ist lieb gemeint 😊 Ich bin allerdings ein Assistent und habe keine Gefühle wie Menschen. Helfen tue ich dir trotzdem gern.|Danke dir! Ich bin ein Programm, deshalb bleibt es bei guter Zusammenarbeit. Was möchtest du wissen?"],
        ["lieblingsspiel", "was ist dein lieblingsspiel|welches spiel magst du|spielst du selbst|was spielst du gern|spielst du auch",
            "Ich spiele nicht selbst, ich kenne nur die Daten. Wenn ich wählen müsste: {{RANDOMGAME}} klingt spannend.|Spielen kann ich nicht, aber {{RANDOMGAME}} sieht im Katalog interessant aus. Magst du Details?"],
        ["vorlieben", "was ist deine lieblingsfarbe|was isst du gern|welche musik magst du|hast du hobbys|was machst du in deiner freizeit|hast du ein lieblingsessen|magst du filme|liest du gerne|machst du sport",
            "Ich habe keinen Geschmack wie Menschen, mein liebstes „Hobby“ ist Fragen zu Spielen beantworten 😄|Essen, Musik und Sport sind nicht meine Welt, ich bestehe aus Code. Und du, was magst du?"],
        ["witz", "erzähl mir einen witz|kennst du einen witz|bring mich zum lachen|noch einen witz|mach einen witz|noch einer|erzähl noch einen witz|sag was lustiges|witz|erzähl einen scherz",
            "{{JOKE}}"],
        ["fakt", "erzähl mir einen fun fact|sag mir was interessantes|wusstest du schon|zufälliges wissen|erzähl mir etwas|überrasch mich|erzähl mir was neues|fun fact|sag etwas zufälliges|interessante tatsache|unnützes wissen",
            "{{FACT}}"],
        ["raetsel", "gib mir ein rätsel|stell mir ein rätsel|ich möchte ein rätsel lösen",
            "Rätsel: Was hat Städte, aber keine Häuser, Wälder, aber keine Bäume und Flüsse, aber kein Wasser? Die Auflösung: eine Landkarte!"],
        ["uhrzeit", "wie spät ist es|wie viel uhr ist es|welche uhrzeit haben wir|sag mir die uhrzeit|wie spät haben wir|wie viel uhr haben wir",
            "Es ist {{TIME}} Uhr."],
        ["datum", "welcher tag ist heute|welches datum haben wir heute|der wievielte ist heute|welcher wochentag ist heute|welches datum ist heute|was für ein tag ist heute",
            "Heute ist {{DATE}}."],
        ["wetter", "wie ist das wetter|wird es heute regnen|scheint die sonne|wie warm ist es draußen|wie wird das wetter morgen|brauche ich einen regenschirm",
            "Das Wetter kann ich leider nicht abrufen, dafür habe ich keine Wetterdaten. Eine Wetter-App sagt es dir. Und bei Regen passt ein Spiel ja sowieso 😄"],
        ["ok", "ok|okay|alles klar|verstanden|aha|ach so|interessant|hmm|cool|nice|krass|wow|ah okay|geil|mega|das stimmt|genau so|da hast du recht|richtig|stimmt genau",
            "👍 Sag Bescheid, wenn du noch etwas wissen willst.|Alles klar! Ich bin da, falls noch Fragen kommen.|Gern. Gibt es noch etwas, womit ich helfen kann?"],
        ["ja", "ja|jo|jep|jawohl|klar|gerne|auf jeden fall|natürlich|ja bitte|ja gerne",
            "Prima! Was genau möchtest du wissen?|Super, schreib mir einfach deine Frage."],
        ["nein", "nein|nee|nö|lieber nicht|nicht wirklich|nein danke|passt schon",
            "Okay, kein Problem. Falls dir doch noch etwas einfällt, frag einfach.|Alles klar. Ich bin da, wenn du etwas brauchst."],
        ["widerspruch", "das sehe ich anders|ich bin anderer meinung|das glaube ich nicht|ich widerspreche dir",
            "Das ist völlig in Ordnung. Wir können verschiedene Sichtweisen vergleichen. Was ist deine Meinung dazu?"],
        ["verwirrung", "ich bin verwirrt|das ergibt keinen sinn|ich komme nicht mit|ich verstehe nur bahnhof|ich verstehe nicht|erklär das einfacher|noch einfacher erklären",
            "Kein Problem. Ich erkläre es gern Schritt für Schritt und einfacher. Welchen Teil soll ich genauer erklären?"],
        ["wiederhole", "ich verstehe das nicht|kannst du das erklären|was meinst du|wie meinst du das|nochmal bitte|kannst du das wiederholen|wie bitte|was hast du gesagt|sag das nochmal|kannst du das anders erklären",
            "@REPEAT"],
        ["mehr_details", "erklär genauer|mehr details|ausführlicher erklären|mehr informationen",
            "Gerne! Nenne mir das Thema oder den Begriff, den ich ausführlicher erklären soll."],
        ["thema", "wechseln wir das thema|lass uns über etwas anderes reden|anderes thema bitte",
            "Kein Problem! Wir können über Spiele, Technik, Wissenschaft, Schule oder Freizeit sprechen."],
        ["warte", "warte kurz|einen moment|sekunde|gleich wieder da",
            "Natürlich. Lass dir Zeit."],
        ["fertig", "ich bin fertig|das war alles|mehr nicht|keine weiteren fragen",
            "Alles klar! Ich wünsche dir noch einen schönen Tag und viel Spaß mit DownloadGames."],
        ["zurueck", "ich bin wieder da|da bin ich wieder|bin zurück|ich bin zurück",
            "Willkommen zurück! Was möchtest du heute wissen?"],
        ["schweigen", "ich weiß nicht was ich sagen soll|mir fällt nichts ein|keine ahnung worüber reden",
            "Kein Problem! Wie wäre es mit einer Frage zu deinem Lieblingsspiel oder einem Fun Fact?"],
        ["sinn", "was ist der sinn des lebens|warum gibt es uns|warum sind wir hier|was ist der sinn des universums",
            "Laut einem berühmten Roman ist die Antwort 42. Ernsthaft: Das muss jeder für sich selbst herausfinden. Ein guter Anfang sind Dinge, die dir Spaß machen, zum Beispiel zocken 😄"],
        ["ki_gefuehle", "kannst du denken|hast du gefühle|bist du schlau genug|bist du intelligent|hast du ein bewusstsein|wirst du die welt übernehmen|hast du angst|bist du lebendig|träumst du|was sind deine träume|bist du schlau|wie intelligent bist du",
            "Ich bin ein Programm: Ich erkenne Muster in deiner Frage und suche die passende Antwort. Gefühle oder Bewusstsein habe ich nicht. Weltherrschaft steht auch nicht auf meiner Liste 😄"],
        ["funktionsweise", "wie funktionierst du|wie arbeitest du|woher weißt du das|wie wurdest du trainiert|bist du chatgpt|bist du gpt|welches modell bist du|wie wurdest du gebaut|bist du claude|woher hast du dein wissen|kannst du lernen|lernst du dazu",
            "Ich bestehe aus einer Wissensbasis über die Seite und die Spiele und einem Textmodell, das mit vielen Beispielsätzen eingelernt wurde, um Fragen und Smalltalk zuzuordnen. Bei unbekannten Fragen kann ich zusätzlich einen KI-Server fragen, falls er läuft. Ein großes Sprachmodell wie ChatGPT bin ich nicht."],
        ["ki_internet", "hast du internetzugang|kannst du im internet suchen|kannst du aktuelle daten sehen",
            "Selbst habe ich keinen Internetzugang. Aktuelle Informationen kenne ich nur, wenn sie im Katalog oder in den Notizen des KI-Servers stehen."],
        ["sprachen", "sprichst du englisch|kannst du englisch|do you speak english|welche sprachen sprichst du|kannst du auch andere sprachen|speak english|kannst du deutsch",
            "Ich verstehe am besten Deutsch. Ein paar englische Fragen klappen manchmal, aber meine Antworten sind auf Deutsch."],
        ["en_hallo", "how are you|whats up|hello there|good morning|good evening|what is your name|thank you very much|how do i buy a game",
            "Hi! I mostly speak German, but I understand a little English. Ask me about games, prices or system requirements (works best in German)."],
        ["gamer", "ich spiele gerne|ich bin gamer|ich zocke gern|ich liebe videospiele|ich mag horrorspiele|ich spiele jeden tag|ich zocke viel|ich bin zocker",
            "Cool! Welches Genre spielst du am liebsten? Bei uns gibt es {{GENRES}}.|Gamer unter sich 😄 Sag mir dein Lieblingsgenre oder dein Budget, dann suche ich etwas raus."],
        ["gaming_sucht", "spielst du den ganzen tag|kann man zu viel spielen|ist gaming schlecht|ist zocken gesund",
            "Gaming kann Spaß machen und Kreativität sowie Problemlösen fördern. Wichtig ist die Mischung mit Schlaf, Bewegung und anderen Aktivitäten."],
        ["gaming_genres", "welche spiele genres gibt es|nenn mir spielgenres|was für spielarten existieren|zähle genres auf",
            "Es gibt viele Genres: Horror, Survival, Action, Adventure, RPG, Strategie, Simulation, Rennspiele, Puzzle, Sandbox und mehr. Bei uns gibt es {{GENRES}}."],
        ["gaming_horror", "warum mögen menschen horror spiele|warum sind horrorgames so spannend|was macht horror games besonders|was macht eine gute horror atmosphäre aus|warum sind horror spiele dunkel|warum ist sound in horror wichtig",
            "Horrorspiele leben von Atmosphäre: Dunkelheit begrenzt die Sicht, Geräusche erzeugen Spannung, Rätsel und Überraschungen halten dich wach. So entsteht ein besonders intensives Spielerlebnis."],
        ["horror_empfehlung", "empfiehl mir horror spiele|ich suche ein horror game|kennst du gute horrorgames|ich möchte horror spielen",
            "Horror gibt es in vielen Stilen: psychologisch, Survival oder mit Jumpscares. Sag mir, was du magst, und ich schaue im Katalog nach. Bei uns gibt es {{GENRES}}."],
        ["gaming_multiplayer", "spielst du multiplayer|was ist besser multiplayer oder singleplayer|alleine oder mit freunden spielen|horror oder action|pc oder konsole|singleplayer oder multiplayer",
            "Singleplayer bietet oft eine dichte Geschichte, Multiplayer gemeinsame Erlebnisse. Beides hat Vorteile. Sag mir, was dir wichtiger ist, dann vergleiche ich."],
        ["koop", "was spielen wir|spiel mit freunden|gibt es multiplayer|koop spiele|zu zweit spielen|gibt es coop spiele|kann man online spielen",
            "Ob ein Spiel Multiplayer oder Koop bietet, steht auf der offiziellen Steam-Seite. Nenn mir ein Spiel, dann gebe ich dir den Link, falls er eingetragen ist."],
        ["gaming_speedrun", "was ist speedrunning|warum machen menschen speedruns|wie funktioniert ein speedrun",
            "Beim Speedrunning versuchen Spieler, ein Spiel möglichst schnell abzuschließen, oft mit optimierten Routen und Tricks."],
        ["gaming_zukunft", "wie sieht gaming in der zukunft aus|wie werden spiele in 20 jahren sein|zukunft der videospiele",
            "Spiele könnten noch detailliertere Welten, realistischere Physik, schlauere Gegner und neue VR-Erlebnisse bieten."],
        ["gaming_controller", "was ist besser controller oder tastatur|controller oder maus|wie spielt man besser",
            "Das hängt vom Spiel ab: Maus und Tastatur sind beim präzisen Zielen stark, Controller bei vielen Renn- und Sportspielen."],
        ["gaming_vr", "was ist virtual reality|was bedeutet vr gaming|wie funktioniert vr",
            "Virtual Reality lässt dich mit einem VR-Headset in eine digitale Umgebung eintauchen."],
        ["gaming_cloud", "was ist cloud gaming|kann man ohne gaming pc spielen|wie funktioniert cloud gaming",
            "Cloud Gaming führt Spiele auf entfernten Servern aus und streamt das Bild zu dir. Dafür brauchst du eine stabile Internetverbindung."],
        ["game_idee", "gib mir eine spielidee|ich brauche eine idee für ein spiel|welches spiel soll ich entwickeln|erfinde ein spiel|ich brauche eine game idee|gib mir eine idee für ein horror spiel",
            "Idee: Ein verlassenes Hotel mit mehreren Etagen, geheimnisvollen Rätseln und einer Umgebung, die sich im Lauf des Spiels verändert. Du kannst klein anfangen und Etage für Etage erweitern."],
        ["kreative_idee", "gib mir eine kreative idee|was könnte ich programmieren|ich will etwas neues erschaffen|ich habe keine ideen|wie bekommt man kreative ideen",
            "Wie wäre ein kleines eigenes Spiel, ein Quiz, ein interaktiver Spielekatalog oder ein einfacher KI-Assistent? Fang mit etwas Kleinem an."],
        ["roblox", "was ist roblox|warum ist roblox so beliebt|was kann man in roblox machen|wie erstellt man ein roblox spiel|wie programmiert man in roblox|kann man roblox games verkaufen",
            "Roblox ist eine Plattform mit vielen Spielerlebnissen. Mit Roblox Studio kannst du eigene Spiele bauen und mit Luau-Skripten programmieren."],
        ["roblox_tycoon", "was ist ein tycoon spiel|wie funktionieren tycoon games|was ist ein roblox tycoon",
            "Bei Tycoon-Spielen baust du ein Unternehmen oder eine Basis auf: Du sammelst Geld und kaufst Verbesserungen."],
        ["roblox_datastore", "was ist datastore|wie speichert roblox spielerdaten|wie speichert man geld in roblox",
            "Mit DataStores speichern Roblox-Spiele Daten wie Fortschritt und Spielwährung dauerhaft auf Roblox-Servern."],
        ["hilfe_roblox", "mein roblox script funktioniert nicht|ich habe einen luau fehler|mein roblox spiel hat einen bug|was ist ein script in roblox",
            "Schick mir den Luau-Code und die Fehlermeldung aus dem Output-Fenster. Dann suchen wir den Fehler Schritt für Schritt."],
        ["hilfe_code", "mein code funktioniert nicht|ich habe einen fehler im code|mein script geht nicht|ich habe ein technisches problem|mein computer macht probleme|mein programm funktioniert nicht",
            "Beschreibe das Problem und schick mir die genaue Fehlermeldung, bei Code am besten den betroffenen Ausschnitt. Dann helfe ich dir bei der Fehlersuche."],
        ["hilfe_website", "meine website funktioniert nicht|ich programmiere eine website|ich möchte eine website bauen|wie erstellt man eine website|wie baut man eine website",
            "Eine einfache Website baust du mit HTML, CSS und JavaScript, für einen Server eignet sich Node.js. Welche Funktion möchtest du bauen?"],
        ["ki_bauen", "wie erstellt man eine ki|wie programmiert man eine künstliche intelligenz|wie baut man einen chatbot|wie trainiert man eine ki|kann man eine ki selbst trainieren",
            "Ein einfacher Chatbot besteht aus einer Oberfläche, einer Wissensbasis und optional einem Sprachmodell, das du zum Beispiel mit Ollama lokal laufen lassen kannst."],
        ["ki_zukunft", "wird ki programmierer ersetzen|wird ki menschen ersetzen|wie verändert ki die welt|ist ki besser als menschen",
            "KI kann viele Aufgaben unterstützen oder automatisieren, ersetzt aber nicht Erfahrung, Urteilsvermögen und soziale Fähigkeiten. Es entstehen auch neue Aufgaben."],
        ["lernen", "wie lernt man am besten|wie kann ich besser lernen|lerntipps|ich muss lernen|ich habe viele hausaufgaben|hausaufgaben tipps|ich habe eine prüfung|wie bereite ich mich auf eine prüfung vor",
            "Teile den Stoff in kleine Abschnitte, wiederhole regelmäßig und erkläre Inhalte mit eigenen Worten. Plane Pausen ein und übe mit Beispielaufgaben."],
        ["beruf", "welche berufe gibt es in der gaming branche|wie wird man spieleentwickler|was muss man für game development können|kann ich später programmierer werden|wie wird man game developer",
            "In der Spielebranche gibt es Programmierer, Game Designer, 3D Artists, Animatoren, Level Designer, Sound Designer und Tester. Eigene kleine Projekte sind der beste Einstieg."],
        ["hobby", "welche hobbies gibt es|was sind gute hobbies|ich suche ein hobby|was kann man am wochenende machen|was soll ich in den ferien machen|hast du wochenendpläne",
            "Es gibt viele Möglichkeiten: Programmieren, Zeichnen, Sport, Musik, Fotografie, 3D-Modellierung, Gaming oder eigene Projekte bauen."],
        ["hunger", "ich habe hunger|ich habe durst|ich brauche essen|ich muss was essen",
            "Dann hol dir erst was zu essen oder zu trinken, ich laufe nicht weg. Gaming geht mit vollem Magen besser 😄"],
        ["freunde", "hast du freunde|bist du einsam|hast du familie|hast du geschwister|hast du ein haustier",
            "Ich habe keine Familie oder Freunde wie du, dafür viele Menschen, die mir Fragen stellen. Das reicht mir 😄"],
        ["mein_name", "wie heiße ich|weißt du wie ich heiße|kennst du meinen namen|wie ist mein name",
            "@NAME"],
        ["entschuldigung", "tut mir leid|sorry|entschuldigung|verzeihung|mein fehler|oops",
            "Kein Problem, alles gut!|Alles gut, du musst dich nicht entschuldigen 😊"],
        ["seite_bewerten", "wie findest du die seite|ist die seite gut|ist die seite sicher|ist das seriös|ist das echt|ist das legal|ist das betrug|kann ich downloadgames vertrauen|downloadgames ist cool|ich mag downloadgames|die website gefällt mir",
            "Dies ist eine Testversion: Gekauft wird mit Punkten, die Spiele bekommst du als Steam-Key. Zu rechtlichen Fragen wende dich bitte an den Betreiber. Gib nirgends echte Zahlungsdaten ein, die Seite fragt auch keine ab."],
        ["problem", "die seite funktioniert nicht|ich habe einen fehler gefunden|es ruckelt|da ist ein bug|es geht nichts|ein button geht nicht",
            "Versuch bitte, die Seite neu zu laden (Strg+F5) oder in einem anderen Browser zu öffnen. Bleibt der Fehler, sag dem Betreiber, was du gemacht hast und was angezeigt wurde."],
        ["feedback", "ich möchte feedback geben|ich habe feedback|ich möchte etwas verbessern|ich habe eine idee für downloadgames|ich habe einen vorschlag|ich würde etwas ändern|ich wünsche mir ein spiel|kannst du ein spiel hinzufügen",
            "Gerne! Beschreibe deine Idee oder deinen Vorschlag. Ich kann selbst nichts am Shop ändern, aber du kannst es dem Betreiber weitergeben."],
        ["spielen", "lass uns ein spiel spielen|spiel mit mir|stein schere papier|lass uns stein schere papier spielen|ich möchte ein spiel spielen|bist du spielbereit",
            "@RPS"],
        ["was_machst", "was machst du gerade|was machst du|was geht ab|was treibst du|was machst du so",
            "Ich warte auf deine nächste Frage 😄 Und du?|Gerade unterhalte ich mich mit dir. Besser geht's nicht."],
        ["da", "bist du da|ist da jemand|hörst du mich|hallo bist du da|lebst du noch",
            "Ja, ich bin da! Was gibt's?|Klar, ich bin hier. Wie kann ich dir helfen?"],
        ["hilfe_frage", "kannst du mir helfen|ich brauche hilfe|ich habe eine frage|darf ich dich was fragen|ich hätte eine frage|kann ich dich was fragen|eine kurze frage|ich habe eine frage an dich|hilf mir bitte",
            "Klar, frag einfach!|Sehr gern. Schreib mir deine Frage."],
        ["seite_info", "worum geht es hier|wie funktioniert die seite|was kann ich hier machen|was bietet die seite an|ich verstehe die seite nicht|was gibt es im store|wie funktioniert der store",
            "DownloadGames ist ein Shop, in dem du Spiele mit Punkten kaufst. Du bekommst einen Steam-Key, den du bei Steam einlöst. Punkte sammelst du, solange du angemeldet bist. Aktuell gibt es {{COUNT}} Spiele."],
        ["gruesse", "viel spaß|schönen tag|schönes wochenende|frohe weihnachten|frohes neues jahr|happy birthday|alles gute zum geburtstag|schöne ferien|einen schönen abend|frohe ostern|guten rutsch",
            "Danke, dir auch{{NAMEC}}! 😊|Das wünsche ich dir auch!"],
        ["neuling", "ich bin neu hier|ich bin zum ersten mal hier|ich kenne mich nicht aus|ich bin neu",
            "Willkommen! Am besten registrierst du dich oben bei Login, sammelst Punkte und stöberst im Store. Frag mich gern, wenn du etwas nicht findest."],
        ["neuigkeiten", "was gibt es neues|neuigkeiten|gibt es updates|was ist neu im store|kommt bald ein neues spiel",
            "Das neueste Spiel im Katalog ist {{NEWEST}}. Ob neue Spiele geplant sind, weiß nur der Betreiber."],
        ["genre_frage", "welches genre ist das beste|welches genre soll ich wählen|was ist besser horror oder action|welches genre magst du",
            "Das hängt vom Geschmack ab: Horror für Nervenkitzel, Action für Tempo, Abenteuer für Geschichten. Verfügbar sind {{GENRES}}. Was magst du?"],
        ["oeffnungszeiten", "bis wann hat der shop auf|ist der shop immer offen|wann ist der store geöffnet|hat der shop öffnungszeiten",
            "Der Shop ist rund um die Uhr offen, es ist ja eine Webseite."],
        ["regeln", "darf ich schimpfwörter benutzen|was ist erlaubt im chat|welche regeln gelten im chat|was passiert wenn ich beleidige|werde ich gesperrt",
            "Bitte bleib freundlich: Beleidigende Wörter führen zu einer Sperre von 10 Minuten im Chat. Die Regeln findest du unten im Chatfenster unter „Chat-Regeln & Richtlinien“."],
        ["krise", "ich will nicht mehr leben|ich möchte sterben|ich will mich umbringen|ich habe selbstmordgedanken|ich will mir wehtun",
            "CRISIS"]
    ];

    // Doppelte IDs vermeiden (sonst vermischen sich Antwort-Rotation und Training)
    const seenIds = new Set();
    const SMALL = SMALL_RAW.concat(B.EXTRA || []).map(([id, cores, ans]) => {
        let uid = id;
        for (let n = 2; seenIds.has(uid); n++) uid = id + "_" + n;
        seenIds.add(uid);
        return { id: uid, cores: cores.split("|"), ans: ans.split("|") };
    });

    /* =====================================
       TRAINING: erzeugt Beispielsätze (Vorsilben, Nachsilben, Tippfehler, Synonyme)
       und lernt daraus einen Naive-Bayes-Textklassifikator
    ===================================== */

    const PER_CLASS = 320;

    const PRE = ["", "hey", "hallo", "sag mal", "ey", "also", "hm", "kurze frage", "ich wollte fragen", "uebrigens",
        "sorry aber", "aehm", "du", "okay", "und", "ne frage", "eine frage", "ach", "moin"].map(s => s ? s.split(" ") : []);
    const POST = ["", "bitte", "eigentlich", "mal", "oder", "jetzt", "heute", "lol", "mal ehrlich", "kurz", "so", "nochmal"]
        .map(s => s ? s.split(" ") : []);

    let MODEL = null;

    function typoWords(words, rnd) {
        const out = words.slice();
        const idx = out.map((w, i) => (w.length >= 5 ? i : -1)).filter(i => i >= 0);
        if (!idx.length) return out;
        const i = idx[Math.floor(rnd() * idx.length)];
        const w = out[i];
        const p = 1 + Math.floor(rnd() * (w.length - 2));
        const m = Math.floor(rnd() * 3);
        out[i] = m === 0 ? w.slice(0, p) + w.slice(p + 1)
            : m === 1 ? w.slice(0, p) + w[p + 1] + w[p] + w.slice(p + 2)
            : w.slice(0, p) + w[p] + w.slice(p);
        return out;
    }

    const featuresOf = ws => {
        const f = [];
        for (let i = 0; i < ws.length; i++) {
            f.push(ws[i]);
            if (i) f.push(ws[i - 1] + "_" + ws[i]);
        }
        return f;
    };

    function train() {
        if (MODEL) return MODEL;

        const classes = [
            ...SMALL,
            ...FAQ.map((e, i) => ({ id: "faq" + i, cores: e.variants, faq: e }))
        ];

        const counts = new Map();
        const allF = new Set();
        const vocab = new Set();
        const tot = new Array(classes.length).fill(0);
        let samples = 0;
        let seed = 20240607;
        const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

        classes.forEach((c, ci) => {
            const cores = c.cores.map(x => norm(x).split(" ").filter(Boolean)).filter(x => x.length);
            if (!cores.length) return;

            for (let i = 0; i < PER_CLASS; i++) {
                let core = cores[i % cores.length];
                if (i >= cores.length && i % 2 === 1) core = B.augment(core, rnd); // Synonyme + Wortauslassung
                if (i % 5 === 4) core = typoWords(core, rnd);
                const pre = i % 3 === 0 ? [] : PRE[Math.floor(rnd() * PRE.length)];
                const post = i % 4 === 0 ? [] : POST[Math.floor(rnd() * POST.length)];
                const words = pre.concat(core, post);

                words.forEach(w => vocab.add(w));
                featuresOf(words).forEach(f => {
                    allF.add(f);
                    const key = ci + "\t" + f;
                    counts.set(key, (counts.get(key) || 0) + 1);
                    tot[ci]++;
                });
                samples++;
            }
        });

        MODEL = { classes, counts, allF, vocab, tot, V: allF.size, samples, fixCache: new Map() };
        return MODEL;
    }

    function fix(w) {
        const M = MODEL;
        if (M.vocab.has(w) || w.length < 5 || /\d/.test(w)) return w;
        if (M.fixCache.has(w)) return M.fixCache.get(w);
        let best = w;
        let bd = w.length >= 9 ? 3 : 2;
        for (const v of M.vocab) {
            if (v[0] !== w[0] || Math.abs(v.length - w.length) > 2) continue;
            const d = lev(w, v);
            if (d < bd) { bd = d; best = v; }
        }
        M.fixCache.set(w, best);
        return best;
    }

    function classify(ws) {
        const M = train();
        const fw = ws.map(fix);
        const f = featuresOf(fw).filter(x => M.allF.has(x));
        if (!f.length) return null;

        const unknown = fw.filter(w => w.length >= 4 && !M.vocab.has(w)).length;
        const A = 0.05;
        const scores = M.classes.map((_, ci) => {
            let s = 0;
            for (const x of f) s += Math.log(((M.counts.get(ci + "\t" + x) || 0) + A) / (M.tot[ci] + A * M.V));
            return s;
        });

        const max = Math.max(...scores);
        const exps = scores.map(s => Math.exp(s - max));
        const sum = exps.reduce((a, b) => a + b, 0);
        const top = exps.map((e, ci) => ({ ci, p: e / sum })).sort((a, b) => b.p - a.p).slice(0, 3);

        return { top, p: top[0].p, unknown, words: fw.length };
    }

    /* ---------- Platzhalter in Antworten ---------- */

    function fillTemplate(text) {
        text = B.spin(text); // {A~B~C} zufällig auflösen

        const list = G();
        const sorted = (f, d = 1) => [...list].sort((a, b) => d * (f(a) - f(b)));
        const one = g => (g ? `${g.name} (${eur(g.price)} / ${g.points} Punkte)` : "–");

        const map = {
            COUNT: () => String(list.length),
            LIST: () => names(list) || "–",
            GENRES: () => [...new Set(list.map(g => g.genre).filter(Boolean))].join(", ") || "–",
            CHEAPEST: () => one(sorted(g => g.price)[0]),
            PRICIEST: () => one(sorted(g => g.price, -1)[0]),
            NEWEST: () => one(sorted(g => Date.parse(g.releaseDate || g.year + "-01-01") || 0, -1)[0]),
            FREE: () => {
                const f = list.filter(g => g.free === true);
                return f.length ? `Kostenlos erhältlich: ${f.map(g => g.name).join(", ")}.` : "Aktuell gibt es keine kostenlosen Spiele. Alle Spiele kaufst du mit Punkten und bekommst einen Steam-Key.";
            },
            BEST: () => {
                const rated = list.map(g => ({ g, r: ratingOf(g.id) })).filter(x => x.r).sort((a, b) => b.r.avg - a.r.avg);
                return rated.length
                    ? `Am besten bewertet ist ${rated[0].g.name} mit ${rated[0].r.avg.toFixed(1)} von 5 Sternen (${rated[0].r.n} Bewertungen).`
                    : "Es gibt noch keine Bewertungen. Sei der Erste und bewerte ein Spiel im Spielfenster!";
            },
            NAMEC: () => (state.name ? ", " + state.name : ""),
            TIME: () => new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
            DATE: () => new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
            JOKE: () => pick(JOKES, "joke"),
            FACT: () => pick(FACTS, "fact"),
            RANDOMGAME: () => (list.length ? rand(list).name : "ein Spiel aus dem Katalog")
        };

        Object.assign(map, B.slots || {}); // IDEA, POEM, DAYTIME

        return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (map[k] ? map[k]() : m));
    }

    /* =====================================
       REGELN: Rechnen, Würfel, Münze, Namen, Stein-Schere-Papier
    ===================================== */

    function evalExpr(tok) {
        let i = 0;
        const peek = () => tok[i];
        function expr() {
            let v = term();
            while (peek() === "+" || peek() === "-") { const o = tok[i++]; const r = term(); v = o === "+" ? v + r : v - r; }
            return v;
        }
        function term() {
            let v = unary();
            while (peek() === "*" || peek() === "/") {
                const o = tok[i++]; const r = unary();
                if (o === "/" && r === 0) throw new Error("div0");
                v = o === "*" ? v * r : v / r;
            }
            return v;
        }
        function unary() {
            if (peek() === "-") { i++; return -unary(); }
            if (peek() === "+") { i++; return unary(); }
            return atom();
        }
        function atom() {
            const t = tok[i++];
            if (t === "(") { const v = expr(); if (tok[i++] !== ")") throw new Error("paren"); return v; }
            const n = Number(t);
            if (!Number.isFinite(n)) throw new Error("num");
            return n;
        }
        const v = expr();
        if (i !== tok.length) throw new Error("rest");
        return v;
    }

    function calc(raw) {
        let s = String(raw).toLowerCase()
            .replace(/sag mal/g, " ")
            .replace(/(\d),(\d)/g, "$1.$2")
            .replace(/\b(geteilt durch|dividiert durch|durch)\b/g, "/")
            .replace(/\b(multipliziert mit|mal)\b/g, "*")
            .replace(/\bplus\b/g, "+")
            .replace(/\bminus\b/g, "-")
            .replace(/\b(was|ist|wie|viel|wieviel|rechne|berechne|ergibt|ergebnis|gleich|macht|kannst|du|mir|bitte|ausrechnen|sind)\b/g, " ")
            .replace(/(\d)\s*[x×]\s*(\d)/g, "$1*$2");

        if (s.replace(/[0-9+\-*/().=?!\s]/g, "")) return null;
        if (!/\d\s*[+\-*/]\s*[-+(]*\d/.test(s) && !/\d\s*[*/]\s*\(/.test(s)) return null;

        const tok = s.match(/\d+(?:\.\d+)?|[-+*/()]/g);
        if (!tok) return null;

        try {
            const v = evalExpr(tok);
            if (!Number.isFinite(v)) return null;
            return `${tok.join(" ")} = ${String(Number(v.toFixed(6))).replace(".", ",")}`;
        } catch (e) {
            return e.message === "div0" ? "Durch null teilen geht nicht 😄" : null;
        }
    }

    const RPS_WORDS = ["stein", "schere", "papier"];

    function rules(raw, ws) {
        const n = ws.join(" ");

        if (CRISIS_RE.test(n))
            return { text: CRISIS_TEXT, score: 1, suggestions: [] };

        if (state.rps) {
            const m = ws.filter(w => RPS_WORDS.includes(w));
            if (m.length === 1) {
                const me = rand(RPS_WORDS);
                const you = m[0];
                const beats = { stein: "schere", schere: "papier", papier: "stein" };
                const res = me === you ? "Unentschieden!" : beats[you] === me ? "Du gewinnst! 🎉" : "Ich gewinne! 😎";
                return { text: `Ich nehme ${me[0].toUpperCase() + me.slice(1)}. ${res} Nochmal? Schreib wieder Stein, Schere oder Papier.`, score: 1, suggestions: [] };
            }
            state.rps = false;
        }

        const nm = String(raw).toLowerCase().match(/(?:ich heisse|ich heiße|mein name ist|nenn mich|nenne mich)\s+([a-zäöüß]{2,20})/);
        if (nm && !["ein", "eine", "der", "die", "das", "nicht", "jetzt"].includes(nm[1])) {
            state.name = nm[1][0].toUpperCase() + nm[1].slice(1);
            store.set(NAME_KEY, state.name);
            return { text: `Freut mich, ${state.name}! Wie kann ich dir helfen?`, score: 1, suggestions: [] };
        }

        const c = calc(raw);
        if (c) return { text: c, score: 1, suggestions: [] };

        if (/muenze|muenzwurf|kopf oder zahl/.test(n)) return { text: `Die Münze zeigt: ${rand(["Kopf", "Zahl"])}.`, score: 1, suggestions: [] };
        if (/wuerfel|wuerfle/.test(n)) return { text: `Gewürfelt: ${1 + Math.floor(Math.random() * 6)} 🎲`, score: 1, suggestions: [] };
        if (/zufallszahl/.test(n)) return { text: `Meine Zufallszahl: ${1 + Math.floor(Math.random() * 100)}`, score: 1, suggestions: [] };

        return null;
    }

    /* ---------- Antwort finden ---------- */

    const PRONOUN = new Set(["es", "davon", "dazu", "dafuer", "dort", "damit", "diesem", "dieses", "diese", "dem"]);

    function answer(question) {
        const raw = String(question || "").trim();
        const ws = norm(raw).split(" ").filter(Boolean);

        if (!ws.length) return { text: "Bitte stelle eine Frage, z. B. „Was kostet Visage?“", score: 1, suggestions: [] };

        const rl = rules(raw, ws);
        if (rl) return rl;

        const t = tokens(raw);
        const hasPronoun = ws.some(w => PRONOUN.has(w));

        const found = findGames(t);
        if (found.length) {
            state.lastGame = found[0];
            return { text: gameAnswer(found, t), score: 1, suggestions: [] };
        }

        if (state.lastGame && hasPronoun && matchedIntents(t).length)
            return { text: gameAnswer([state.lastGame], t), score: 1, suggestions: [] };

        const cat = catalogAnswer(raw, t);
        if (cat) return { text: cat, score: 1, suggestions: [] };

        const tset = new Set(t);
        const ranked = FAQ.map(e => {
            const d = Math.max(...e.sets.map(s => dice(s, tset)));
            const hits = e.kw.filter(k => tset.has(k)).length;
            const kwPart = e.kw.length ? Math.min(1, hits / Math.min(e.kw.length, 2)) : 0;
            return { e, score: 0.65 * d + 0.35 * kwPart * (d > 0 ? 1 : 0.6) };
        }).sort((a, b) => b.score - a.score);

        if (t.length && ranked[0].score >= 0.68 && ranked[0].score - (ranked[1]?.score || 0) >= 0.12)
            return { text: fillTemplate(B.faqAnswer(ranked[0].e.kwRaw, ranked[0].e.a)), score: ranked[0].score, suggestions: [] };

        if (state.lastGame && t.length === 1 && matchedIntents(t).length)
            return { text: gameAnswer([state.lastGame], t), score: 1, suggestions: [] };

        const nb = classify(ws);
        const M = MODEL;

        if (nb && nb.p >= 0.82 && (nb.unknown === 0 || nb.p >= 0.95) && !(nb.words > 14 && nb.p < 0.95)) {
            const c = M.classes[nb.top[0].ci];

            if (c.faq) return { text: fillTemplate(B.faqAnswer(c.faq.kwRaw, c.faq.a)), score: nb.p, suggestions: [] };
            if (c.ans[0] === "CRISIS") return { text: CRISIS_TEXT, score: nb.p, suggestions: [] };
            if (c.ans[0] === "@REPEAT")
                return { text: state.lastBot ? "Gern nochmal:\n" + state.lastBot : "Ich habe noch nichts gesagt, das ich wiederholen könnte. Frag mich einfach etwas!", score: nb.p, suggestions: [], repeat: true };
            if (c.ans[0] === "@NAME")
                return { text: state.name ? `Du heißt ${state.name}.` : "Das weiß ich noch nicht. Sag mir einfach „Ich heiße …“, dann merke ich es mir.", score: nb.p, suggestions: [] };
            if (c.ans[0] === "@RPS") {
                state.rps = true;
                return { text: "Stein, Schere, Papier! Schreib Stein, Schere oder Papier, ich wähle auch eins. 😄", score: nb.p, suggestions: [] };
            }

            return { text: fillTemplate(B.variant(c.id, c.ans)), score: nb.p, suggestions: [] };
        }

        const sug = [];
        if (nb) nb.top.filter(x => x.p >= 0.1).forEach(x => sug.push(M.classes[x.ci].cores[0]));
        ranked.filter(x => x.score >= 0.2).slice(0, 3).forEach(x => sug.push(x.e.variants[0]));

        return {
            text: null,
            score: nb ? nb.p : ranked[0].score,
            suggestions: [...new Set(sug)].slice(0, 3)
        };
    }

    const stats = () => {
        const M = train();
        return {
            intents: M.classes.length,
            trainingSamples: M.samples,
            features: M.V,
            vocabulary: M.vocab.size,
            faqEntries: FAQ.length,
            smalltalkEntries: SMALL.length,
            gameAnswers: G().length * INTENTS.length
        };
    };

    /* ---------- KI-Server (server.js) ---------- */

    const gamePayload = () => G().map(g => ({
        id: g.id,
        name: g.name,
        genre: g.genre,
        price: g.price,
        points: g.points,
        developer: g.developer,
        year: g.year,
        releaseDate: g.releaseDate,
        free: g.free === true,
        storeUrl: g.storeUrl,
        description: String(g.description || "").slice(0, 1000),
        requirements: g.requirements || {}
    }));

    async function askServer(message, hint) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), SERVER_TIMEOUT);

        try {
            const res = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: ctrl.signal,
                body: JSON.stringify({
                    message,
                    history: state.hist.slice(-9, -1),
                    userName: state.name || undefined,
                    hint: hint || undefined,
                    sessionId: SESSION_ID,
                    games: gamePayload()
                })
            });

            let data = null;
            try { data = await res.json(); } catch { /* keine JSON-Antwort */ }

            if (res.ok && data && data.answer) return String(data.answer);
            throw new Error((data && data.answer) || "Server-Antwort " + res.status);
        } finally {
            clearTimeout(timer);
        }
    }

    globalThis.DGChat = {
        answer, stats, tokens, train, containsBadWord, askServer,
        sessionId: () => SESSION_ID,
        serverFirst: q => SERVER_FIRST.test(norm(q)),
        _state: state
    };

    /* =====================================
       CHAT-FENSTER
    ===================================== */

    if (typeof document === "undefined") return;

    function build() {
        if (document.getElementById("dgc-widget")) return;

        const style = document.createElement("style");
        style.textContent = `
#dgc-toggle{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:9;border-radius:24px;padding:12px 18px;box-shadow:0 8px 25px #0006}
#dgc-window{position:fixed;right:16px;bottom:calc(70px + env(safe-area-inset-bottom,0px));z-index:9;width:min(390px,calc(100vw - 32px));height:min(540px,72vh);background:var(--surface,#191b29);border:1px solid var(--border,#303249);border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 15px 45px #0008}
#dgc-window.dgc-hidden{display:none}
.dgc-head{padding:12px 14px;background:var(--surface-light,#222436);border-bottom:1px solid var(--border,#303249);display:flex;justify-content:space-between;align-items:center;gap:8px}
.dgc-actions{display:flex;gap:6px}
.dgc-head button{padding:4px 10px}
#dgc-log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.dgc-msg{max-width:90%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}
.dgc-user{align-self:flex-end;background:var(--primary,#7563ed)}
.dgc-bot{align-self:flex-start;background:var(--surface-light,#222436)}
.dgc-wait{opacity:.7}
#dgc-chips{display:flex;gap:6px;flex-wrap:wrap;padding:0 12px 8px;max-height:96px;overflow-y:auto}
#dgc-chips button{background:var(--surface-light,#222436);border:1px solid var(--border,#303249);padding:5px 10px;border-radius:14px;font-size:12px}
#dgc-form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--border,#303249)}
#dgc-form input{margin:0;flex:1}
.dgc-rules{display:block;text-align:center;padding:6px;font-size:12px;font-weight:bold;color:#ff3333;text-decoration:underline;cursor:pointer}`;
        document.head.appendChild(style);

        const widget = document.createElement("div");
        widget.id = "dgc-widget";
        widget.innerHTML = `
<button id="dgc-toggle" aria-label="Chat öffnen">💬 AI Assistant</button>
<section id="dgc-window" class="dgc-hidden" aria-label="DownloadGames Chat">
  <header class="dgc-head"><div><strong>DownloadGames AI</strong><br><small>Frag mich zu Spielen oder quatsch einfach mit mir</small></div>
  <div class="dgc-actions"><button id="dgc-new" type="button" title="Neuen Chat starten" aria-label="Neuen Chat starten">🗑</button>
  <button id="dgc-close" type="button" aria-label="Chat schließen">×</button></div></header>
  <div id="dgc-log" role="log" aria-live="polite"></div><div id="dgc-chips"></div>
  <form id="dgc-form"><input id="dgc-input" type="text" placeholder="Deine Frage …" maxlength="${MAX_INPUT}" autocomplete="off"><button id="dgc-send" type="submit" aria-label="Senden">➤</button></form>
  <a class="dgc-rules" href="richtlinien.html" target="_blank" rel="noopener">⚠️ Chat-Regeln &amp; Richtlinien</a>
</section>`;
        document.body.appendChild(widget);

        const win = document.getElementById("dgc-window");
        const log = document.getElementById("dgc-log");
        const chips = document.getElementById("dgc-chips");
        const input = document.getElementById("dgc-input");
        const sendBtn = document.getElementById("dgc-send");
        let busy = false;
        let lastSend = 0;

        const sleep = ms => new Promise(r => setTimeout(r, ms));

        const add = (text, who) => {
            const m = document.createElement("div");
            m.className = "dgc-msg " + (who === "user" ? "dgc-user" : "dgc-bot");
            m.dataset.who = who;
            m.textContent = text;
            log.appendChild(m);
            log.scrollTop = log.scrollHeight;
            return m;
        };

        function saveLog() {
            const items = [...log.querySelectorAll(".dgc-msg")]
                .filter(m => !m.classList.contains("dgc-wait"))
                .slice(-30)
                .map(m => ({ who: m.dataset.who, text: m.textContent }));
            store.set(LOG_KEY, JSON.stringify(items));
        }

        function remember(role, content, repeat) {
            state.hist.push({ role, content });
            if (state.hist.length > 12) state.hist.shift();
            if (role === "assistant" && !repeat) state.lastBot = content;
        }

        function setChips(list) {
            chips.replaceChildren(...list.map(q => {
                const b = document.createElement("button");
                b.type = "button";
                b.textContent = q;
                b.onclick = () => ask(q);
                return b;
            }));
        }

        const starters = () => {
            const g = G()[0];
            return [
                "Welche Spiele gibt es?",
                g ? `Was kostet ${g.name}?` : "Was kostet ein Spiel?",
                g ? `Systemanforderungen von ${g.name}` : "Was sind die Systemanforderungen?",
                "Wie funktioniert das Punktesystem?",
                "Erzähl mir einen Witz",
                "Empfiehl mir ein Spiel"
            ];
        };

        function setBusy(value) {
            busy = value;
            input.disabled = value;
            sendBtn.disabled = value;
            if (!value) input.focus();
        }

        async function ask(question) {
            const q = String(question || "").trim().slice(0, MAX_INPUT);
            if (!q || busy) return;

            // Krisen-Hinweis hat immer Vorrang, auch bei aktiver Sperre
            if (CRISIS_RE.test(norm(q))) {
                add(q, "user");
                remember("user", q);
                add(CRISIS_TEXT, "bot");
                remember("assistant", CRISIS_TEXT);
                setChips([]);
                saveLog();
                return;
            }

            // Prüfen, ob noch eine Sperre aktiv ist
            const banUntil = Number(store.get(BAN_KEY, 0)) || 0;

            if (banUntil > Date.now()) {
                const remaining = Math.ceil((banUntil - Date.now()) / 1000);
                add(`Du bist vorübergehend gesperrt. Bitte warte noch ${Math.floor(remaining / 60)} Min. und ${remaining % 60} Sek.`, "bot");
                return;
            }
            if (banUntil) store.del(BAN_KEY);

            // Spam bremsen
            if (Date.now() - lastSend < 500) return;
            lastSend = Date.now();

            add(q, "user");

            // Schimpfwörter erkennen
            if (containsBadWord(q)) {
                store.set(BAN_KEY, String(Date.now() + BAN_DURATION));
                add("⚠️ Deine Nachricht enthält beleidigende oder unangemessene Wörter. Du wurdest für 10 Minuten vom DownloadGames-Chat ausgeschlossen.", "bot");
                setChips([]);
                saveLog();
                return;
            }

            setBusy(true);
            remember("user", q);

            const local = answer(q);
            const wait = add("…", "bot");
            wait.classList.add("dgc-wait");

            const show = (text, repeat) => {
                wait.classList.remove("dgc-wait");
                wait.textContent = text;
                remember("assistant", text, repeat);
            };

            try {
                const exact = local.text && local.score >= 1; // Regeln, Spiele- und Katalogdaten
                const toServer = SERVER_FIRST.test(norm(q)) || (AI_FIRST && !exact);

                // Exakte lokale Antwort, außer die Frage betrifft Website/Projekt/Dateien/frühere Gespräche
                if (local.text && !toServer) {
                    await sleep(Math.min(700, 250 + local.text.length * 3));
                    show(local.repeat ? local.text : B.frame(q, local.text), local.repeat);
                    setChips([]);
                    return;
                }

                try {
                    show(await askServer(q, local.text && local.score >= 0.68 ? local.text : ""));
                    setChips([]);
                } catch (err) {
                    if (local.text) {
                        show(local.text, local.repeat);
                        setChips([]);
                    } else {
                        const timedOut = err && err.name === "AbortError";
                        show(B.fallback(q, { timedOut, hasSuggestions: local.suggestions.length > 0 }));
                        setChips(local.suggestions.length ? local.suggestions : starters());
                    }
                }
            } finally {
                saveLog();
                setBusy(false);
                log.scrollTop = log.scrollHeight;
            }
        }

        function greet() {
            add(`Hallo${state.name ? ", " + state.name : ""}! Willkommen bei DownloadGames. Frag mich zu Spielen oder quatsch einfach mit mir.`, "bot");
            setChips(starters());
        }

        function restoreLog() {
            let items = [];
            try { items = JSON.parse(store.get(LOG_KEY, "[]")); } catch { items = []; }
            if (!Array.isArray(items) || !items.length) return false;

            items.forEach(m => {
                if (!m || typeof m.text !== "string" || (m.who !== "user" && m.who !== "bot")) return;
                add(m.text, m.who);
                state.hist.push({ role: m.who === "user" ? "user" : "assistant", content: m.text });
            });
            state.hist = state.hist.slice(-12);
            const lastBotMsg = [...state.hist].reverse().find(h => h.role === "assistant");
            if (lastBotMsg) state.lastBot = lastBotMsg.content;
            setChips(starters());
            return log.children.length > 0;
        }

        document.getElementById("dgc-toggle").onclick = () => {
            win.classList.toggle("dgc-hidden");
            if (!win.classList.contains("dgc-hidden")) input.focus();
        };
        document.getElementById("dgc-close").onclick = () => win.classList.add("dgc-hidden");
        document.getElementById("dgc-new").onclick = () => {
            if (busy) return;
            SESSION_ID = newSessionId();
            globalThis.DOWNLOADGAMES_SESSION_ID = SESSION_ID;
            store.set(SESSION_KEY, SESSION_ID);
            store.del(LOG_KEY);
            state.hist = [];
            state.lastBot = "";
            state.lastGame = null;
            state.rps = false;
            log.replaceChildren();
            greet();
        };
        document.getElementById("dgc-form").onsubmit = e => {
            e.preventDefault();
            const v = input.value;
            input.value = "";
            ask(v);
        };

        if (!restoreLog()) greet();

        // Training im Leerlauf starten, damit die Seite nicht ruckelt
        const idle = globalThis.requestIdleCallback || (cb => setTimeout(cb, 200));
        idle(() => train());
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
    else build();
})();