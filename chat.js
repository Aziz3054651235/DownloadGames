
// Dauerhafte ID dieses Browsers
let DOWNLOADGAMES_SESSION_ID =
  localStorage.getItem("dg_ai_session");

if (!DOWNLOADGAMES_SESSION_ID) {
  DOWNLOADGAMES_SESSION_ID =
    "dg_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 14);

  localStorage.setItem(
    "dg_ai_session",
    DOWNLOADGAMES_SESSION_ID
  );
}

"use strict";
/* =====================================
   DOWNLOADGAMES CHAT v2
   1) Regeln: Moderation, Krisenhinweis, Rechnen, Würfel/Münze, Stein-Schere-Papier
   2) Spiele-Wissen (automatisch aus games.js) mit Kontext ("Was kostet es?")
   3) FAQ + Smalltalk: Textklassifikator (Naive Bayes), eingelernt mit
      zehntausenden automatisch erzeugten Beispielsätzen (inkl. Tippfehler)
   4) Reserve: KI über server.js (/api/chat), falls der Server läuft
   Lädt nach games.js. Eine Datei, kein CSS nötig.
===================================== */

(function () {
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
    const BAN_DURATION = 10 * 60 * 1000;

    function containsBadWord(text) {
        return norm(text).split(" ").some(w => {
            if (!w) return false;
            const plain = /[a-z]/.test(w) ? unleet(w) : w;
            return BAD_WORDS.has(w) || BAD_WORDS.has(plain) || BAD_COLLAPSED.has(collapse(plain)) ||
                BAD_STEMS.some(s => plain.length >= s.length && plain.startsWith(s));
        });
    }

    /* ---------- Zustand der Unterhaltung ---------- */

    const state = {
        lastGame: null,
        lastBot: "",
        rps: false,
        hist: [],
        name: (() => { try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; } })()
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
    syn("hallo", "hallo hi hey moin servus huhu hello hallöchen");
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
            return JSON.parse(localStorage.getItem("dg_keys") || "[]")
                .filter(k => k.gameId === id && k.active && !k.used).length;
        } catch { return 0; }
    };

    const ratingOf = id => {
        try {
            const list = (JSON.parse(localStorage.getItem("dg_comments") || "{}")[id] || []).filter(c => c.stars);
            return list.length ? { avg: list.reduce((s, c) => s + c.stars, 0) / list.length, n: list.length } : null;
        } catch { return null; }
    };

    const when = g => g.releaseDate || g.year || "";
    const names = list => list.map(g => `${g.name} (${eur(g.price)})`).join(", ");
    const reqText = r => (r ? `${r.os}, CPU ${r.cpu}, RAM ${r.ram}, GPU ${r.gpu}, ${r.storage} Speicher` : "nicht angegeben");

    /* ---------- Antworten zu einzelnen Spielen ---------- */

    const INTENTS = [
        { k: ["anforder"], f: g => g.requirements
            ? `Systemanforderungen für ${g.name}:\nMinimum: ${reqText(g.requirements.minimum)}\nEmpfohlen: ${reqText(g.requirements.recommended)}`
            : `Für ${g.name} sind hier noch keine Systemanforderungen eingetragen. Auf der offiziellen Steam-Seite stehen sie.` },
        { k: ["preis", "punkt"], f: g => `${g.name} kostet ${eur(g.price)} bzw. ${g.points} Punkte.` },
        { k: ["entwickler"], f: g => g.developer ? `${g.name} wurde von ${g.developer} entwickelt.` : `Der Entwickler von ${g.name} ist nicht eingetragen.` },
        { k: ["genre"], f: g => `${g.name} gehört zum Genre ${g.genre || "(nicht angegeben)"}.` },
        { k: ["datum"], f: g => when(g) ? `${g.name} ist ${g.releaseDate ? "am " + g.releaseDate : "im Jahr " + g.year} erschienen.` : `Das Erscheinungsdatum von ${g.name} ist nicht eingetragen.` },
        { k: ["groesse"], f: g => g.size ? `${g.name} ist ${g.size} groß.` : `Die Größe von ${g.name} ist nicht eingetragen. ${g.requirements?.minimum?.storage ? "Laut Anforderungen brauchst du " + g.requirements.minimum.storage + " Speicherplatz." : ""}`.trim() },
        { k: ["beschreib"], f: g => g.description || `Zu ${g.name} gibt es noch keine Beschreibung.` },
        { k: ["bewertung"], f: g => { const r = ratingOf(g.id); return r ? `${g.name} hat im Schnitt ${r.avg.toFixed(1)} von 5 Sternen (${r.n} Bewertungen).` : `${g.name} hat noch keine Bewertungen. Du kannst die erste schreiben!`; } },
        { k: ["aehnlich"], f: g => { const o = G().filter(x => x.id !== g.id && x.genre === g.genre); return o.length ? `Ähnlich wie ${g.name}: ${o.map(x => x.name).join(", ")}.` : `Zu ${g.name} gibt es aktuell kein Spiel im selben Genre.`; } },
        { k: ["ausverkauft", "verfuegbar"], f: g => g.free === true ? `${g.name} ist kostenlos erhältlich.` : (stock(g.id) ? `Von ${g.name} sind aktuell ${stock(g.id)} Steam-Keys verfügbar.` : `${g.name} ist aktuell ausverkauft (keine Steam-Keys im Lager).`) },
        { k: ["key", "einloes", "steam"], f: g => `Beim Kauf von ${g.name} bekommst du einen Steam-Key. Du findest ihn im Spielfenster und in deiner Bibliothek und löst ihn auf Steam ein: https://store.steampowered.com/account/registerkey` },
        { k: ["kauf"], f: g => `So kaufst du ${g.name}: Anmelden, „Details ansehen“ öffnen und „Mit Punkten kaufen“ klicken (${g.points} Punkte) oder erst in den Warenkorb legen. Danach erscheint dein Steam-Key.` },
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

        if (asked.length && !findGames(t).length) {
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

    /* ---------- FAQ: ["Variante|Variante|…", "Schlüsselwörter", "Antwort"] ---------- */

    const FAQ = [
        ["hallo|hi|hey|guten tag|moin|servus|guten morgen|guten abend", "hallo", "Hallo{{NAMEC}}! Ich bin der DownloadGames-Assistent. Frag mich zu Spielen, Preisen, Systemanforderungen, Punkten oder Funktionen der Seite. Wir können auch einfach quatschen 😊"],
        ["danke|dankeschön|vielen dank|super danke|thx|thanks", "danke", "Gern geschehen! Sag Bescheid, wenn du noch etwas wissen willst."],
        ["tschüss|bis später|auf wiedersehen|ciao|bye|bis bald", "tschuess", "Tschüss{{NAMEC}} und viel Spaß mit den Spielen!"],
        ["wer bist du|was bist du|bist du eine ki|bist du ein mensch|wie heißt du|bist du ein bot", "ki mensch bot heisst", "Ich bin der Website-Assistent von DownloadGames. Ich antworte mit gespeichertem Wissen über die Seite und die Spiele, führe kleine Gespräche und frage bei unbekannten Fragen eine KI auf dem Server, falls sie eingerichtet ist."],
        ["was kannst du|wobei kannst du helfen|hilfe|was kann ich dich fragen|womit kannst du mir helfen", "hilfe kannst", "Ich helfe bei Spielen (Preis, Punkte, Systemanforderungen, Entwickler, Beschreibung), beim Kauf mit Punkten, Steam-Keys, Login, Bibliothek, Warenkorb, Kommentaren und der Suche. Außerdem kann ich rechnen, Witze erzählen, Fun Facts nennen, würfeln und mit dir Stein-Schere-Papier spielen."],
        ["welche spiele gibt es|zeig mir alle spiele|was für spiele habt ihr|spieleliste|katalog|wie viele spiele gibt es|was kann ich kaufen", "spiel katalog", "Aktuell gibt es {{COUNT}} Spiele: {{LIST}}."],
        ["welche genres gibt es|welche kategorien gibt es|welche arten von spielen gibt es|welche genres habt ihr", "genre", "Verfügbare Genres: {{GENRES}}. Im Store kannst du oben nach Genre filtern."],
        ["was ist das günstigste spiel|billigstes spiel|welches spiel ist am billigsten|günstigstes spiel", "guenstig", "Das günstigste Spiel ist {{CHEAPEST}}."],
        ["was ist das teuerste spiel|teuerstes spiel|welches spiel ist am teuersten", "teuer", "Das teuerste Spiel ist {{PRICIEST}}."],
        ["was ist das neueste spiel|neue spiele|welche spiele sind neu|neuheiten|neuestes spiel", "neu", "Das neueste Spiel ist {{NEWEST}}. Weitere neue Spiele siehst du im Store unter „Neue Spiele“."],
        ["was ist das beste spiel|bestbewertetes spiel|welches spiel hat die beste bewertung|beste spiele", "best", "{{BEST}}"],
        ["was ist beliebt|beliebteste spiele|welche spiele sind beliebt|bestseller|beliebte spiele", "beliebt", "Beliebte Spiele siehst du im Store unter „Beliebte Spiele“. Sie richten sich nach Käufen und Kommentaren."],
        ["empfiehl mir ein spiel|welches spiel soll ich spielen|ich weiß nicht was ich spielen soll|spieltipp|hast du einen tipp", "empfehl", "Gern! Zur Auswahl stehen die Genres {{GENRES}}. Das neueste Spiel ist {{NEWEST}}, das günstigste {{CHEAPEST}}. Sag mir ein Genre oder dein Budget, z. B. „Horror unter 10 Euro“."],
        ["wie registriere ich mich|wie erstelle ich ein konto|account erstellen|wie kann ich mich registrieren|konto anlegen|neues konto erstellen", "registr", "Klicke oben auf Login und dann auf Registrieren. Du brauchst einen Benutzernamen (mind. 3 Zeichen), eine gültige E-Mail und ein Passwort (mind. 8 Zeichen)."],
        ["wie logge ich mich ein|wie melde ich mich an|login|einloggen|anmelden", "login", "Klicke oben auf Login, gib Benutzername oder E-Mail und dein Passwort ein und bestätige mit Anmelden."],
        ["wie logge ich mich aus|abmelden|logout|ausloggen", "logout aus", "Klicke oben rechts auf „Logout“ neben deinem Namen."],
        ["ich habe mein passwort vergessen|passwort vergessen|passwort zurücksetzen|passwort reset|kennwort vergessen", "passwort vergess", "Ein automatisches Zurücksetzen gibt es in dieser Version nicht, weil dafür ein E-Mail-Server nötig ist. Wende dich an den Betreiber der Seite."],
        ["wie ändere ich mein passwort|passwort ändern|passwort wechseln", "passwort aender", "Öffne oben „Profil“, gib dort dein altes und dein neues Passwort ein (mind. 8 Zeichen) und klicke auf „Passwort ändern“."],
        ["wie ändere ich meinen benutzernamen|name ändern|e mail adresse ändern|profil bearbeiten|email ändern", "benutzername email profil aender", "Im Bereich „Profil“ kannst du Benutzername und E-Mail ändern und speichern."],
        ["wo finde ich mein profil|profilseite|profil|mein konto ansehen", "profil", "Klicke oben in der Navigation auf „Profil“. Du musst dafür angemeldet sein."],
        ["kaufhistorie|wo sehe ich meine käufe|was habe ich gekauft|bestellungen anzeigen|meine bestellungen", "historie kauf bestell", "Deine Kaufhistorie steht im Bereich „Profil“ ganz unten, mit Datum, Spiel und Preis."],
        ["wo finde ich meine gekauften spiele|bibliothek|meine spiele|wo ist meine bibliothek|wo sehe ich meine spiele", "bibliothek", "Klicke oben auf „Bibliothek“. Dort stehen deine freigeschalteten Spiele und deine Steam-Keys."],
        ["wie funktioniert das punktesystem|wie bekomme ich punkte|wie sammle ich punkte|wie viele punkte bekomme ich|wie verdiene ich punkte", "punkt sammel", "Angemeldete Benutzer bekommen automatisch 100 Punkte alle 10 Sekunden (Demo-Modus, solange die Seite geöffnet ist). Mit Punkten kaufst du Spiele. Der Punktepreis steht bei jedem Spiel."],
        ["wie viele punkte habe ich|punktestand|wo sehe ich meine punkte|wo sehe ich meinen punktestand", "punktestand", "Dein Punktestand steht oben rechts im Header neben dem Stern."],
        ["warum steigen meine punkte nicht|ich bekomme keine punkte|punkte werden nicht mehr|keine punkte", "punkt steigen bekomme keine", "Punkte gibt es nur für angemeldete Benutzer, 100 alle 10 Sekunden, solange die Seite im Browser geöffnet ist. Prüfe, ob du eingeloggt bist."],
        ["bekommen gäste punkte|punkte ohne login|kann ich ohne konto punkte sammeln", "gaeste punkt login", "Nein, Punkte gibt es nur mit Konto. Registriere dich und melde dich an."],
        ["wie kaufe ich ein spiel|wie kann ich ein spiel kaufen|spiel kaufen|spiel freischalten|wie bekomme ich ein spiel", "kauf", "Melde dich an, öffne ein Spiel mit „Details ansehen“ und klicke auf „Mit Punkten kaufen“. Danach bekommst du deinen Steam-Key im Spielfenster und in der Bibliothek."],
        ["wie funktioniert der warenkorb|wie nutze ich den warenkorb|warenkorb|wie lege ich ein spiel in den warenkorb", "warenkorb", "Klicke bei einem Spiel auf „In den Warenkorb“, öffne oben den Warenkorb und kaufe alle Spiele zusammen mit Punkten."],
        ["wie entferne ich ein spiel aus dem warenkorb|warenkorb leeren|warenkorb löschen", "warenkorb loesch", "Im Warenkorb gibt es bei jedem Spiel „Entfernen“ und unten „Warenkorb leeren“."],
        ["ich habe nicht genug punkte|zu wenig punkte|was wenn mir punkte fehlen|nicht genügend punkte", "punkt wenig genug fehlen", "Dann musst du noch Punkte sammeln: Angemeldete Benutzer bekommen 100 Punkte alle 10 Sekunden. Danach kannst du das Spiel kaufen."],
        ["was ist ein steam key|was ist ein produktschlüssel|wie bekomme ich meinen key|wo ist mein key|wo finde ich meinen steam key", "key", "Ein Steam-Key ist ein Code, mit dem du ein Spiel auf Steam aktivierst. Nach dem Kauf findest du ihn im Spielfenster und in deiner Bibliothek."],
        ["wie löse ich einen steam key ein|key einlösen|wie aktiviere ich den key|spiel auf steam aktivieren|wo gebe ich den key ein", "einloes key", "Öffne Steam und wähle „Ein Produkt bei Steam aktivieren“ oder gehe auf https://store.steampowered.com/account/registerkey. Gib den Key ein und lade das Spiel danach in Steam herunter."],
        ["brauche ich ein steam konto|steam account nötig|muss ich steam haben", "steam konto", "Ja, du brauchst ein kostenloses Steam-Konto, um den Key einzulösen und das Spiel zu laden."],
        ["mein key funktioniert nicht|key ungültig|steam key fehler|key schon benutzt|der key geht nicht", "key funktioniert ungueltig fehler", "Prüfe den Key auf Tippfehler (O und 0, I und 1) und ob er schon eingelöst wurde. Hilft das nicht, wende dich mit dem Spielnamen an den Betreiber der Seite."],
        ["was bedeutet ausverkauft|warum kann ich nicht kaufen|spiel ausverkauft|button ausverkauft", "ausverkauft", "„Ausverkauft“ heißt, dass aktuell keine Steam-Keys für das Spiel im Lager sind. Schau später wieder vorbei."],
        ["wie kann ich ein spiel herunterladen|download|wo ist der download|wo kann ich das spiel laden|wie lade ich ein spiel", "download", "Bezahlspiele lädst du über Steam: Du bekommst einen Steam-Key und löst ihn dort ein. Einen direkten Download-Button gibt es nur bei freien Spielen."],
        ["gibt es kostenlose spiele|free games|gratis spiele|gibt es spiele umsonst", "kostenlos", "{{FREE}}"],
        ["was sind die systemanforderungen|wo sehe ich die systemanforderungen|mindestanforderungen|welche hardware brauche ich", "anforder", "Öffne ein Spiel mit „Details ansehen“: Dort stehen Minimum und Empfohlen. Nenne mir ein Spiel, dann schreibe ich sie dir direkt."],
        ["kann mein pc ein spiel ausführen|läuft das spiel auf meinem pc|ist mein pc gut genug|kann mein computer das spielen", "anforder", "Vergleiche CPU, RAM, Grafikkarte und Speicher deines PCs mit den Mindestanforderungen des Spiels. Nenne mir das Spiel, dann zeige ich sie dir."],
        ["wie suche ich ein spiel|suchfunktion|spiel finden|wo ist die suche", "such", "Nutze das Suchfeld oben. Es sucht live nach Name, Genre, Entwickler und Jahr."],
        ["wie filtere ich nach genre|nach genre filtern|spiele nach kategorie anzeigen", "filter genre", "Im Store gibt es oben Genre-Buttons. Klicke eins an, um nur diese Spiele zu sehen."],
        ["wie kommentiere ich ein spiel|kommentar schreiben|kann ich kommentare schreiben", "kommentar", "Melde dich an, öffne ein Spiel und schreibe unten im Spielfenster deinen Kommentar mit einer Sternebewertung."],
        ["wie lösche ich meinen kommentar|kommentar bearbeiten|kommentar ändern|kommentar löschen", "kommentar loesch aender", "Bei deinem eigenen Kommentar gibt es die Buttons „Bearbeiten“ und „Löschen“."],
        ["wie bewerte ich ein spiel|sterne vergeben|bewertung abgeben|wie gebe ich eine bewertung ab", "bewertung stern", "Wähle im Spielfenster 1 bis 5 Sterne und schreibe einen Kommentar. Pro Spiel zählt eine Bewertung pro Benutzer."],
        ["ist die registrierung kostenlos|kostet die registrierung|kostet ein konto geld", "registr kostenlos preis", "Die Registrierung ist kostenlos."],
        ["wo werden meine daten gespeichert|datenschutz|sind meine daten sicher|werden passwörter gespeichert", "daten datenschutz sicher gespeichert", "In dieser Testversion lokal in deinem Browser. Passwörter werden nur als Hash gespeichert, nicht im Klartext. Löschst du die Browserdaten, sind Konto und Käufe weg."],
        ["kann ich mich auf einem anderen gerät anmelden|anderes handy|konto auf zwei geräten", "geraet anderen handy", "In dieser Testversion liegen Konten nur im jeweiligen Browser. Auf einem anderen Gerät oder Browser ist dein Konto deshalb nicht vorhanden."],
        ["gibt es eine app|funktioniert die seite auf dem handy|mobile version|geht das auch am handy", "app handy mobil", "Es gibt keine App, aber die Seite ist für Handy und Tablet angepasst und läuft im Browser."],
        ["wie kontaktiere ich den support|kontakt|wer betreibt die seite|wer hat die seite gemacht|wie erreiche ich den betreiber", "kontakt hilfe store gemacht", "Die Seite wird von Aziz Djebbi betrieben (siehe Footer). Wende dich bei Problemen an den Betreiber."],
        ["kann ich ein spiel zurückgeben|rückerstattung|geld zurück|refund|kann ich ein spiel stornieren", "rueckerstattung zurueck refund storn", "Gekaufte Keys sind nach dem Kauf zugeteilt. Fragen zu Rückgabe oder Problemen klärst du mit dem Betreiber der Seite."],
        ["kann ich mit geld bezahlen|paypal|kreditkarte|zahlungsmethoden|wie kann ich bezahlen", "paypal kreditkarte zahlung geld", "Aktuell bezahlst du ausschließlich mit Punkten. Echte Zahlungen sind in dieser Version nicht eingebaut."],
        ["wie werde ich admin|wo ist das admin dashboard|admin zugang|admin bereich", "admin", "Der Admin-Bereich ist nur für den Betreiber der Seite gedacht."],
        ["ab wie viel jahren sind die spiele|fsk|altersfreigabe|sind die spiele für kinder|alter", "fsk alter kinder jahren", "Viele Horrorspiele sind nicht für Kinder. Die genaue Alterseinstufung steht auf der offiziellen Steam-Seite des Spiels."],
        ["gibt es deutsche sprache|deutsche untertitel|welche sprachen", "sprache sprachen deutsch untertitel", "Die Sprachen eines Spiels stehen auf der offiziellen Steam-Seite. Die Seite selbst ist auf Deutsch."],
        ["gibt es eine wunschliste|wunschliste|spiel merken", "wunschliste merken", "Eine Wunschliste gibt es aktuell nicht. Du kannst Spiele zum Merken in den Warenkorb legen."],
        ["wie lösche ich mein konto|konto löschen|account löschen", "konto loesch", "Das Konto selbst zu löschen geht in dieser Version nicht. Frage dafür den Betreiber der Seite."],
        ["welche version hat das spiel|wird das spiel aktualisiert|versionsnummer", "version", "Wenn eine Version eingetragen ist, steht sie im Spielfenster unter dem Titel."],
                // ==========================================
        // DOWNLOADGAMES – ERWEITERTE FAQ
        // ==========================================

        // Allgemeine Gespräche
        ["wie geht es dir|wie gehts dir|alles gut bei dir|wie fühlst du dich", "smalltalk", "Danke der Nachfrage! Ich bin bereit, dir bei DownloadGames und Gaming zu helfen. Wie kann ich dir helfen?"],
        ["was machst du gerade|was machst du|bist du beschäftigt", "smalltalk", "Ich beantworte gerade Fragen und helfe Besuchern von DownloadGames."],
        ["bist du intelligent|wie intelligent bist du|bist du schlau", "ki", "Ich kann Informationen verarbeiten, Fragen beantworten und Zusammenhänge erklären. Wie gut ich antworte, hängt auch von meinem verfügbaren Wissen und dem KI-Modell ab."],
        ["kannst du lernen|lernst du dazu|wirst du intelligenter", "ki lernen", "Ich kann Informationen verwenden, die mir während einer Unterhaltung zur Verfügung stehen. Ob ich dauerhaft dazulerne, hängt von meiner technischen Einrichtung ab."],
        ["kannst du deutsch|welche sprachen kannst du|sprichst du englisch", "sprache", "Ich kann auf Deutsch und Englisch antworten. Andere Sprachen kann ich ebenfalls teilweise verstehen."],
        ["kannst du rechnen|mathe|mathematik", "mathe", "Ja! Ich kann dir bei vielen mathematischen Aufgaben helfen. Schreib mir einfach deine Rechnung."],
        ["erzähl einen witz|witz|mach einen scherz|lustiger witz", "witz", "Warum können Geister so schlecht lügen? Weil man durch sie hindurchsieht! 👻"],
        ["erzähl einen fun fact|fun fact|interessante tatsache|unnützes wissen", "funfact", "Fun Fact: Das menschliche Gehirn verarbeitet unglaublich viele Informationen gleichzeitig. Deshalb kannst du beispielsweise Musik hören und gleichzeitig ein Spiel spielen."],
        ["was ist deine lieblingsfarbe|welche farbe magst du", "smalltalk", "Als KI habe ich keine persönlichen Lieblingsfarben. Das Design von DownloadGames verwendet aber einen dunklen Gaming-Stil."],
        ["kannst du mir helfen|ich brauche hilfe|hilf mir bitte", "hilfe", "Natürlich! Beschreibe dein Problem möglichst genau. Ich versuche, dir Schritt für Schritt zu helfen."],

        // DownloadGames allgemein
        ["was ist downloadgames|was ist das für eine website|beschreibe downloadgames", "website", "DownloadGames ist eine Gaming-Plattform, auf der Besucher Spiele entdecken, Informationen lesen und verfügbare Spiele freischalten können."],
        ["wer hat downloadgames erstellt|wer ist der entwickler der website|wer ist der programmierer", "website", "DownloadGames wurde von Aziz Djebbi entwickelt."],
        ["warum heißt die seite downloadgames|bedeutung downloadgames", "website", "Der Name DownloadGames beschreibt den Schwerpunkt der Plattform: Spiele entdecken und verfügbare Spiele herunterladen."],
        ["ist downloadgames kostenlos|kostet downloadgames geld|muss ich für die website bezahlen", "website", "Die Nutzung der Website und die Registrierung sind in der Testversion kostenlos. Für Spiele können Punkte erforderlich sein."],
        ["funktioniert downloadgames auf windows|welches betriebssystem unterstützt die seite", "website", "DownloadGames kann über einen modernen Webbrowser verwendet werden. Die Kompatibilität der einzelnen Spiele hängt von deren Systemanforderungen ab."],
        ["funktioniert downloadgames auf chrome|welcher browser ist am besten|browser empfehlung", "browser", "Ein aktueller Browser wie Google Chrome, Microsoft Edge oder Firefox ist eine gute Wahl."],
        ["warum ist die website langsam|downloadgames lädt langsam|seite braucht lange", "website fehler", "Prüfe deine Internetverbindung und lade die Seite mit Strg + F5 neu. Falls das Problem bleibt, kann auch der Server langsam reagieren."],
        ["die website funktioniert nicht|downloadgames geht nicht|seite ist kaputt|website fehler", "website fehler", "Versuche zunächst, die Seite neu zu laden. Prüfe außerdem deine Internetverbindung. Wenn weiterhin ein Fehler auftritt, beschreibe mir die Fehlermeldung."],
        ["warum sehe ich keine spiele|spiele werden nicht angezeigt|katalog ist leer", "website fehler", "Prüfe, ob die Seite vollständig geladen wurde. Aktualisiere sie mit Strg + F5. Falls weiterhin keine Spiele angezeigt werden, könnte ein Problem mit den Spieldaten vorliegen."],
        ["wie aktualisiere ich die website|website refresh|seite neu laden", "website", "Drücke F5 oder Strg + R. Mit Strg + F5 kannst du zusätzlich den Browser-Cache umgehen."],
        ["was bedeutet beta|ist downloadgames beta|testversion der website", "website", "Eine Beta ist eine Testversion einer Software. Funktionen können noch verändert werden und Fehler können auftreten."],
        ["was bedeutet demo modus|warum demo modus|demo version", "website", "Der Demo-Modus dient dazu, Funktionen der Website zu testen, ohne dass echte Zahlungen erforderlich sind."],

        // Spiele und Gaming
        ["was ist ein pc spiel|was sind pc games|definition computerspiel", "gaming", "Ein PC-Spiel ist eine Software, mit der du auf einem Computer interaktive Unterhaltung erleben kannst."],
        ["was ist ein horror spiel|was bedeutet survival horror|survival horror", "gaming", "Survival-Horror-Spiele verbinden Spannung, Rätsel und bedrohliche Situationen. Häufig geht es darum, eine gefährliche Umgebung zu erkunden und zu überleben."],
        ["was ist ein indie spiel|indie games|indie game bedeutung", "gaming", "Indie-Spiele werden häufig von unabhängigen Entwicklern oder kleineren Studios entwickelt."],
        ["was ist ein multiplayer spiel|multiplayer bedeutung|mehrspieler", "gaming", "Multiplayer bedeutet, dass mehrere Spieler gemeinsam oder gegeneinander spielen können."],
        ["was ist singleplayer|singleplayer bedeutung|einzelspieler", "gaming", "Singleplayer-Spiele sind für einen einzelnen Spieler ausgelegt."],
        ["was ist open world|open world bedeutung|offene welt", "gaming", "Eine Open World ist eine weitgehend frei erkundbare Spielwelt, in der Spieler ihre Aktivitäten häufig selbst bestimmen können."],
        ["was ist ein jumpscare|jumpscares|jump scare bedeutung", "gaming", "Ein Jumpscare ist ein plötzliches Schreckmoment, das beispielsweise durch ein unerwartetes Geräusch oder Ereignis entsteht."],
        ["was ist fps|was bedeutet fps|bilder pro sekunde", "gaming", "FPS bedeutet Frames per Second. Es beschreibt, wie viele Bilder pro Sekunde ein Spiel darstellt."],
        ["was ist raytracing|ray tracing bedeutung", "gaming", "Raytracing ist eine Grafiktechnik, die Licht, Reflexionen und Schatten realistischer simulieren kann."],
        ["was ist dlss|was bedeutet dlss", "gaming", "DLSS ist eine NVIDIA-Technologie, die mithilfe künstlicher Intelligenz die Bilddarstellung und Leistung in unterstützten Spielen verbessern kann."],
        ["was ist fsr|amd fsr bedeutung", "gaming", "FSR ist AMDs Technologie zur Bildskalierung, die in unterstützten Spielen höhere Bildraten ermöglichen kann."],
        ["was ist unreal engine|unreal engine bedeutung", "gaming", "Unreal Engine ist eine Entwicklungsumgebung von Epic Games, mit der Entwickler unter anderem 3D-Spiele erstellen."],
        ["was ist unity|unity engine bedeutung", "gaming", "Unity ist eine Entwicklungsplattform zur Erstellung von 2D- und 3D-Spielen sowie anderen interaktiven Anwendungen."],
        ["was ist steam|wie funktioniert steam", "gaming", "Steam ist eine digitale PC-Spieleplattform von Valve. Dort kannst du Spiele kaufen, installieren, aktualisieren und verwalten."],
        ["was ist ein game launcher|launcher bedeutung", "gaming", "Ein Game Launcher ist ein Programm, mit dem du Spiele verwalten, starten und aktualisieren kannst."],

        // PC und Hardware
        ["was ist eine cpu|was macht die cpu|prozessor erklärung", "hardware", "Die CPU ist der Hauptprozessor deines Computers. Sie verarbeitet Berechnungen und führt Programm-Anweisungen aus."],
        ["was ist eine gpu|was macht die gpu|grafikkarte erklärung", "hardware", "Die GPU ist der Grafikprozessor. Sie berechnet unter anderem die Bilder und 3D-Grafiken in Spielen."],
        ["was ist ram|was bedeutet arbeitsspeicher|arbeitsspeicher erklärung", "hardware", "RAM ist der Arbeitsspeicher. Er speichert vorübergehend Daten, die Programme und Spiele gerade benötigen."],
        ["was ist eine ssd|was bedeutet nvme|ssd erklärung", "hardware", "Eine SSD ist ein schneller Datenspeicher. NVMe-SSDs verwenden eine besonders schnelle Schnittstelle."],
        ["was ist eine hdd|festplatte erklärung|unterschied hdd ssd", "hardware", "Eine HDD speichert Daten auf rotierenden Magnetscheiben. SSDs verwenden Flash-Speicher und sind normalerweise deutlich schneller."],
        ["was ist vram|grafikspeicher bedeutung|wie viel vram brauche ich", "hardware", "VRAM ist der Grafikspeicher einer Grafikkarte. Er speichert beispielsweise Texturen und andere Grafikdaten."],
        ["was ist ein netzteil|psu bedeutung|was macht das netzteil", "hardware", "Das Netzteil versorgt die PC-Komponenten mit elektrischer Energie. Es muss ausreichend Leistung und passende Anschlüsse bieten."],
        ["was ist ein mainboard|motherboard bedeutung|was macht das mainboard", "hardware", "Das Mainboard verbindet die verschiedenen PC-Komponenten miteinander, beispielsweise CPU, RAM, Grafikkarte und Speicher."],
        ["was ist ein bottleneck|cpu bottleneck|gpu bottleneck", "hardware", "Ein Bottleneck ist eine Leistungsbegrenzung. Beispielsweise kann eine schwächere CPU verhindern, dass eine leistungsstarke Grafikkarte ihr volles Potenzial erreicht."],
        ["was ist übertakten|overclocking bedeutung|cpu übertakten", "hardware", "Übertakten bedeutet, eine Komponente mit höheren Taktraten als den vorgesehenen Standardwerten zu betreiben. Dabei können Temperatur und Stromverbrauch steigen."],
        ["was ist ein treiber|grafiktreiber bedeutung|driver", "hardware", "Ein Treiber ist eine Software, die dem Betriebssystem ermöglicht, mit einer Hardware-Komponente zu kommunizieren."],
        ["warum ruckelt mein spiel|spiel laggt|fps drops|niedrige fps", "hardware problem", "Mögliche Ursachen sind hohe Grafikeinstellungen, fehlender Arbeitsspeicher, eine ausgelastete CPU oder GPU und Hintergrundprogramme. Prüfe zuerst die Auslastung deiner Komponenten."],
        ["warum stürzt mein spiel ab|spiel crash|game crash|spiel schließt sich", "hardware problem", "Mögliche Ursachen sind fehlerhafte Spieldateien, Treiberprobleme, hohe Temperaturen oder fehlender Speicher. Aktualisiere gegebenenfalls deine Grafiktreiber und überprüfe die Spieldateien."],
        ["warum wird mein pc heiß|hohe cpu temperatur|gpu temperatur", "hardware problem", "Hohe Temperaturen können durch Staub, schlechte Belüftung oder hohe Auslastung entstehen. Überprüfe die Temperaturen mit einem geeigneten Monitoring-Programm."],
        ["wie verbessere ich meine fps|mehr fps bekommen|spielleistung verbessern", "hardware", "Du kannst zunächst Grafikoptionen reduzieren, unnötige Hintergrundprogramme schließen und deine Grafiktreiber aktuell halten."],
        ["wie viel ram brauche ich zum spielen|16 gb ram ausreichend|32 gb ram gaming", "hardware", "16 GB RAM reichen für viele Spiele. 32 GB bieten mehr Spielraum für anspruchsvolle Spiele und mehrere gleichzeitig geöffnete Programme."],
        ["ist eine gaming gpu wichtig|brauche ich eine grafikkarte", "hardware", "Für anspruchsvolle 3D-Spiele ist eine leistungsfähige Grafikkarte besonders wichtig. Auch die CPU und der Arbeitsspeicher spielen eine Rolle."],

        // Spielinstallation und Downloads
        ["download startet nicht|download funktioniert nicht|download hängt", "download problem", "Prüfe deine Internetverbindung, den verfügbaren Speicherplatz und ob dein Browser den Download blockiert."],
        ["download ist langsam|langsame downloadgeschwindigkeit|download speed", "download problem", "Die Geschwindigkeit hängt von deiner Internetverbindung, dem Server und der Dateigröße ab."],
        ["download abgebrochen|download wurde unterbrochen|download fehlgeschlagen", "download problem", "Prüfe deine Internetverbindung und den verfügbaren Speicherplatz. Versuche danach erneut, die Datei über die vorgesehene Downloadquelle herunterzuladen."],
        ["wie installiere ich ein pc spiel|spiel installieren|installation pc", "installation", "Die Installation hängt von der Downloadquelle ab. Bei Steam öffnest du deine Bibliothek, wählst das Spiel und klickst auf Installieren."],
        ["wie deinstalliere ich ein spiel|spiel entfernen|spiel löschen pc", "installation", "Bei Steam kannst du ein Spiel über deine Bibliothek und das Menü des jeweiligen Spiels deinstallieren."],
        ["wie viel speicherplatz brauche ich|speicherplatz prüfen|festplatte voll", "speicher", "Du solltest vor der Installation prüfen, wie viel Speicherplatz das Spiel benötigt und ob auf deinem Laufwerk ausreichend Platz vorhanden ist."],
        ["was ist eine zip datei|zip öffnen|datei entpacken", "datei", "Eine ZIP-Datei ist ein komprimiertes Archiv. Unter Windows kannst du sie normalerweise per Rechtsklick und „Alle extrahieren“ entpacken."],
        ["was ist eine exe datei|exe bedeutung|programmdatei", "datei", "Eine EXE-Datei ist eine ausführbare Windows-Datei. Starte nur Dateien aus vertrauenswürdigen Quellen."],
        ["ist ein download sicher|wie erkenne ich sichere downloads|viren im download", "sicherheit", "Lade Programme nur von offiziellen oder vertrauenswürdigen Quellen herunter. Prüfe unbekannte Dateien mit einem aktuellen Virenschutzprogramm."],
        ["windows meldet virus|antivirus blockiert download|defender meldung", "sicherheit", "Nimm eine Virenschutzwarnung ernst. Führe eine unbekannte oder verdächtige Datei nicht einfach aus. Prüfe die Quelle und die Erkennung zuerst."],

        // Konto und Login
        ["warum funktioniert mein login nicht|login fehlgeschlagen|anmeldung funktioniert nicht", "login problem", "Prüfe deinen Benutzernamen beziehungsweise deine E-Mail und dein Passwort. Achte auch auf Groß- und Kleinschreibung."],
        ["warum wurde ich ausgeloggt|automatisch abgemeldet|login verloren", "login problem", "Möglicherweise wurden Browserdaten gelöscht oder die Sitzung wurde beendet. Melde dich erneut an."],
        ["kann ich meinen benutzernamen ändern|username ändern|neuen namen einstellen", "profil", "Falls die Profilbearbeitung in deiner Version aktiviert ist, kannst du deinen Benutzernamen im Profil ändern."],
        ["kann ich meine email ändern|email aktualisieren|e mail wechseln", "profil", "Falls diese Funktion aktiviert ist, findest du die E-Mail-Einstellungen im Profilbereich."],
        ["warum muss ich mich anmelden|login erforderlich|warum konto erstellen", "konto", "Ein Konto kann notwendig sein, um Punkte, Käufe, Kommentare und deine Bibliothek einem Benutzer zuzuordnen."],
        ["kann ich mehrere konten haben|mehrere accounts|zweites konto", "konto", "Ob mehrere Konten erlaubt sind, hängt von den Regeln und der technischen Einrichtung der Website ab."],
        ["was passiert wenn ich browserdaten lösche|localstorage löschen|cookies löschen", "konto daten", "In einer lokalen Testversion können dabei gespeicherte Konten, Punkte, Käufe und andere Website-Daten verloren gehen."],

        // Punkte und Käufe
        ["wie viel sind 100 punkte wert|punkte in euro umrechnen|punktwert", "punkte", "Der Punktwert hängt von der Preisgestaltung deiner Website ab. Punkte sind nicht automatisch echtes Geld."],
        ["kann ich punkte verschenken|punkte übertragen|punkte an freunde senden", "punkte", "Eine Punkteübertragung ist nur möglich, wenn die Website dafür eine entsprechende Funktion besitzt."],
        ["kann ich punkte verlieren|warum wurden punkte abgezogen|punkte verschwunden", "punkte problem", "Punkte können beispielsweise durch einen Kauf abgezogen werden. Prüfe deine Kaufhistorie und deinen aktuellen Punktestand."],
        ["kann ich ein spiel zweimal kaufen|spiel erneut kaufen|doppelter kauf", "kauf", "Wenn ein Spiel bereits deiner Bibliothek zugeordnet ist, solltest du vor einem weiteren Kauf prüfen, ob ein erneuter Kauf überhaupt möglich ist."],
        ["ist mein kauf sicher|kauf fehlgeschlagen|punkte abgezogen aber kein spiel", "kauf problem", "Wenn Punkte abgezogen wurden, aber das Spiel nicht freigeschaltet wurde, prüfe deine Bibliothek und Kaufhistorie. Wende dich bei einem ungelösten Problem an den Betreiber."],
        ["kann ich spiele verschenken|spiel an freund verschenken|geschenk", "kauf", "Eine Geschenkfunktion ist nur verfügbar, wenn sie ausdrücklich in der Website eingebaut wurde."],
        ["was ist ein warenkorb|warenkorb erklärung", "warenkorb", "Ein Warenkorb sammelt Spiele, die du später gemeinsam kaufen möchtest."],

        // Steam und Keys
        ["ist steam kostenlos|kostet steam geld|steam preis", "steam", "Die Steam-Software und die Erstellung eines Steam-Kontos sind kostenlos. Spiele können Geld kosten."],
        ["wo lade ich steam herunter|steam download|steam installieren", "steam", "Steam kannst du über die offizielle Website herunterladen: https://store.steampowered.com/about/"],
        ["kann ich steam keys weiterverkaufen|key verkaufen|key weitergeben", "steam", "Ob ein Key weitergegeben werden darf, hängt von den Bedingungen des Anbieters und des jeweiligen Spiels ab."],
        ["kann ich einen steam key mehrfach benutzen|key mehrmals einlösen", "steam", "Ein normaler Steam-Aktivierungsschlüssel kann in der Regel nur einmal eingelöst werden."],
        ["was passiert nach dem key einlösen|spiel nach aktivierung", "steam", "Nach erfolgreicher Aktivierung wird das Spiel deiner Steam-Bibliothek hinzugefügt. Von dort kannst du es installieren."],
        ["funktioniert ein key weltweit|region lock|regionsbeschränkung", "steam", "Manche Produktschlüssel haben regionale Einschränkungen. Prüfe vor der Aktivierung, für welche Region der Key vorgesehen ist."],

        // Sicherheit und Datenschutz
        ["was ist phishing|phishing erklärung|betrugsversuch", "sicherheit", "Phishing ist ein Betrugsversuch, bei dem jemand versucht, dich zur Herausgabe persönlicher Daten oder Zugangsdaten zu bringen."],
        ["wie schütze ich mein konto|konto sicherheit|passwort sicherheit", "sicherheit", "Verwende ein langes, einzigartiges Passwort und teile deine Zugangsdaten niemals mit anderen."],
        ["soll ich mein passwort teilen|passwort weitergeben|zugangsdaten schicken", "sicherheit", "Nein. Teile dein Passwort niemals mit anderen Personen oder unbekannten Websites."],
        ["was ist malware|malware bedeutung|schadsoftware", "sicherheit", "Malware ist schädliche Software, die beispielsweise Daten stehlen, Geräte beschädigen oder unerwünschte Aktionen ausführen kann."],
        ["was ist ransomware|ransomware bedeutung", "sicherheit", "Ransomware ist Schadsoftware, die Daten verschlüsseln oder den Zugriff darauf blockieren kann und anschließend häufig Lösegeld fordert."],
        ["was ist ein virus|computervirus bedeutung", "sicherheit", "Ein Computervirus ist eine Art Schadsoftware, die sich verbreiten und Dateien oder Systeme beeinträchtigen kann."],
        ["ist mein passwort sicher|starkes passwort|passwort erstellen", "sicherheit", "Ein gutes Passwort ist lang, einzigartig und schwer zu erraten. Verwende möglichst einen Passwortmanager."],

        // Kommentare und Community
        ["warum kann ich nicht kommentieren|kommentar funktioniert nicht|kommentar fehler", "kommentar problem", "Prüfe, ob du angemeldet bist und ob das Kommentarfeld vollständig ausgefüllt wurde."],
        ["kann ich kommentare anderer sehen|andere bewertungen|community kommentare", "kommentar", "Falls die Kommentarfunktion aktiviert ist, werden veröffentlichte Kommentare im jeweiligen Spielfenster angezeigt."],
        ["was ist eine sternebewertung|wie funktionieren sterne", "bewertung", "Eine Sternebewertung bewertet ein Spiel beispielsweise auf einer Skala von 1 bis 5 Sternen."],
        ["kann ich ein spiel melden|spiel melden|unangemessener kommentar", "community", "Wenn eine Meldefunktion nicht vorhanden ist, wende dich bei problematischen Inhalten an den Betreiber der Website."],

        // Allgemeine Begriffe
        ["was ist eine api|api bedeutung|application programming interface", "technik", "Eine API ist eine Schnittstelle, über die verschiedene Programme miteinander kommunizieren können."],
        ["was ist javascript|javascript erklärung|js bedeutung", "technik", "JavaScript ist eine Programmiersprache, die Websites interaktiv macht und auch für Serverprogramme verwendet werden kann."],
        ["was ist html|html bedeutung", "technik", "HTML ist eine Auszeichnungssprache, mit der die Struktur einer Webseite festgelegt wird."],
        ["was ist css|css bedeutung", "technik", "CSS gestaltet das Aussehen einer Website, beispielsweise Farben, Abstände, Schriftarten und Layouts."],
        ["was ist node js|nodejs bedeutung", "technik", "Node.js ermöglicht es, JavaScript außerhalb des Browsers auszuführen, beispielsweise auf einem Server."],
        ["was ist ein server|server erklärung", "technik", "Ein Server ist ein Computer oder Programm, das anderen Geräten oder Programmen Dienste und Daten bereitstellt."],
        ["was ist eine datenbank|datenbank bedeutung", "technik", "Eine Datenbank speichert und organisiert Informationen, damit Programme sie später abrufen und bearbeiten können."],
        ["was ist eine ki|künstliche intelligenz erklärung|artificial intelligence", "technik", "Künstliche Intelligenz bezeichnet Computersysteme, die Aufgaben erledigen können, für die normalerweise menschliche Fähigkeiten wie Spracherkennung, Mustererkennung oder Problemlösung benötigt werden."],
        ["was ist ollama|ollama erklärung|ollama bedeutung", "technik", "Ollama ist eine Software, mit der du KI-Sprachmodelle lokal auf deinem Computer ausführen kannst."],
        ["was ist qwen|qwen ki|qwen3", "technik", "Qwen ist eine Familie von KI-Modellen. Qwen3 ist eine Modellgeneration, die unter anderem für Textverarbeitung und Gespräche verwendet werden kann."],
        ["was ist ein chatbot|chatbot bedeutung|chat bot", "technik", "Ein Chatbot ist ein Programm, mit dem Benutzer über Texteingaben oder Sprache kommunizieren können."],
        ["was ist ein token bei ki|ki tokens bedeutung", "technik", "Ein Token ist eine kleine Texteinheit, die ein Sprachmodell bei der Verarbeitung von Text verwendet."],
        ["was bedeutet open source|open source erklärung", "technik", "Open Source bedeutet, dass der Quellcode einer Software öffentlich zugänglich sein kann und unter bestimmten Lizenzbedingungen verwendet und verändert werden darf."],
        ["was ist github|github erklärung", "technik", "GitHub ist eine Plattform, auf der Entwickler Code speichern, verwalten und gemeinsam an Softwareprojekten arbeiten können."],

        // Abschied und Reaktionen
        ["das war hilfreich|sehr hilfreich|du hast geholfen|hat mir geholfen", "danke", "Freut mich, dass die Antwort hilfreich war! Wenn du weitere Fragen hast, helfe ich dir gerne."],
        ["du bist gut|gute antwort|gut gemacht|stark gemacht", "danke", "Danke! Ich versuche, dir möglichst hilfreiche und verständliche Antworten zu geben."],
        ["das stimmt nicht|du liegst falsch|falsche antwort|das ist falsch", "korrektur", "Danke für den Hinweis. Beschreibe bitte, was nicht stimmt, damit ich meine Antwort überprüfen kann."],
        ["ich verstehe nicht|erklär das einfacher|noch einfacher erklären", "erklaerung", "Kein Problem! Ich kann es einfacher erklären. Welchen Teil soll ich genauer erklären?"],
        ["erklär genauer|mehr details|ausführlicher erklären|mehr informationen", "erklaerung", "Gerne! Nenne mir das Thema oder den Begriff, den ich ausführlicher erklären soll."],
        ["sag etwas interessantes|überrasch mich|überrasche mich", "funfact", "Hier ist eine interessante Tatsache: Manche moderne Videospiele simulieren dynamisch Licht, Physik und komplexe Umgebungen in Echtzeit."],
        ["gute nacht|schlaf gut|nacht", "tschuess", "Gute Nacht! Bis zum nächsten Besuch bei DownloadGames!"],
        ["bis morgen|wir sehen uns morgen|bis dann", "tschuess", "Bis dann! Viel Spaß und einen schönen Tag!"]
    ].map(([v, kw, a]) => ({
        variants: v.split("|"),
        sets: v.split("|").map(x => new Set(tokens(x))),
        kw: [...new Set(tokens(kw))],
        a
    }));

    /* =====================================
       SMALLTALK-WISSEN  ["id", "Beispielsätze|…", "Antwort|Antwort|…"]
       Platzhalter: {{NAMEC}} {{TIME}} {{DATE}} {{JOKE}} {{FACT}} {{RANDOMGAME}}
                    {{COUNT}} {{GENRES}} {{NEWEST}} …   Spezial: @REPEAT @NAME @RPS
    ===================================== */


const JOKES = [
    // Gaming
    "Warum nehmen Geister keine Bahn? Weil sie lieber durch die Wand gehen. 👻",
    "Was sagt ein Gamer, der Hunger hat? Ich brauche ein Health-Pack.",
    "Warum lügen Skelette nie? Weil man direkt durch sie hindurchsieht.",
    "Wie nennt man einen Bumerang, der nicht zurückkommt? Stock.",
    "Warum ging der Computer zum Arzt? Er hatte einen Virus.",
    "Ich wollte einen Witz über UDP erzählen, aber ich weiß nicht, ob er ankommt.",
    "Warum sind Programmierer so schlecht im Camping? Wegen der vielen Bugs.",
    "Treffen sich zwei Pixel. Sagt der eine: Du siehst heute gut aufgelöst aus.",
    "Warum verlor der Gamer seinen Job? Er war zu oft AFK.",
    "Was ist grün und klopft an die Tür? Ein Klopfsalat.",
    "Warum spielen Geister so gerne Multiplayer? Weil sie unsichtbare Mitspieler haben.",
    "Warum ging Mario zum Zahnarzt? Er hatte ein Loch in der Röhre.",
    "Was macht ein Gamer nach dem Aufstehen? Erst einmal speichern.",
    "Warum können Computer so gut rechnen? Sie haben eine Menge Cache.",
    "Was ist das Lieblingsessen eines Gamers? Chips.",
    "Warum hat der PC eine Brille? Weil er seine Windows nicht mehr findet.",
    "Was sagt der Endboss zum Spieler? Wir sehen uns im nächsten Level.",
    "Warum ist Minecraft so beliebt? Weil es einfach blockbustend ist.",
    "Warum können Zombies keine Computer bedienen? Sie haben keinen Verstand mehr.",
    "Was macht ein Gamer, wenn sein Spiel abstürzt? Er nimmt es nicht persönlich. Es war nur ein Crash.",
    "Warum war der Controller traurig? Er hatte keine Verbindung mehr.",
    "Was ist der Lieblingssport eines Computers? Daten-Lauf.",
    "Warum sind Spieleentwickler gute Köche? Sie kennen viele Rezepte für Bugs.",
    "Was sagt ein NPC zum anderen? Wir treffen uns immer wieder an derselben Stelle.",
    "Warum ist der Gamer immer so ruhig? Er hat seine Probleme gespeichert.",
    "Warum hat der PC Angst vor dem Sommer? Wegen der Überhitzung.",
    "Wie nennt man einen schnellen Gamer? Einen Speedrunner.",
    "Warum ist der Boss so schlecht gelaunt? Weil er ständig besiegt wird.",
    "Was sagt ein Gamer beim Versteckspielen? Ich bin im Stealth-Modus.",
    "Warum ist der Ladebalken so geduldig? Er nimmt sich Zeit.",
    
    // Programmierung und Computer
    "Warum können Programmierer keine Treppen steigen? Sie bevorzugen Schleifen.",
    "Wie viele Programmierer braucht man, um eine Glühbirne zu wechseln? Keinen, das ist ein Hardwareproblem.",
    "Warum mag Java keine Sonne? Wegen der vielen Klassen.",
    "Was sagt ein Programmierer nach einem langen Tag? Ich brauche dringend einen Neustart.",
    "Warum gehen Programmierer gerne in den Wald? Dort gibt es viele natürliche Algorithmen.",
    "Ein SQL-Statement geht in eine Bar und fragt: Darf ich mich mit dir verbinden?",
    "Warum hat der Computer kalte Füße? Weil er zu viele offene Windows hat.",
    "Was ist der Lieblingsbuchstabe eines Programmierers? C.",
    "Warum ist der Code so müde? Weil er die ganze Nacht gelaufen ist.",
    "Was macht ein Computer im Fitnessstudio? Er trainiert seine Prozessoren.",
    "Warum sind Arrays so ordentlich? Weil jedes Element seinen Platz hat.",
    "Was sagt die Funktion zur anderen? Wir rufen uns mal an.",
    "Warum können Programmierer schlecht lügen? Ihr Code verrät sie.",
    "Was macht ein Byte im Urlaub? Es nimmt ein paar Bits mit.",
    "Warum hat der Server Urlaub genommen? Er war überlastet.",
    "Was ist das Lieblingsgetränk eines Programmierers? Java.",
    "Warum hat die Datenbank schlechte Laune? Zu viele Abfragen.",
    "Was sagt der Bug zum Entwickler? Du hast mich gefunden!",
    "Warum ist Python so beliebt? Weil es nicht so viel schreibt.",
    "Was macht ein Router auf einer Party? Er verbindet alle.",
    
    // Allgemeine Witze
    "Warum können Fahrräder nicht stehen? Weil sie zwei müde sind.",
    "Was macht ein Keks unter einem Baum? Krümel.",
    "Was ist orange und wandert durch die Berge? Eine Wanderine.",
    "Warum können Fische so schlecht rechnen? Weil sie immer im Schwarm arbeiten.",
    "Was macht ein Mathematiker im Garten? Wurzeln ziehen.",
    "Was sagt die Null zur Acht? Schicker Gürtel!",
    "Warum sind Bücher so schlau? Sie haben viele Seiten.",
    "Was ist weiß und stört beim Essen? Eine Lawine.",
    "Warum können Elefanten nicht fliegen? Weil sie keine Flügel haben.",
    "Was macht ein Pirat am Computer? Er drückt die Enter-Taste.",
    "Was ist braun und schwimmt unter Wasser? Ein U-Brot.",
    "Warum ging die Tomate über die Straße? Weil sie Ketchup wollte.",
    "Was sagt ein Hammer zum Nagel? Du gehst mir auf den Kopf.",
    "Warum können Kalender nicht lügen? Ihre Tage sind gezählt.",
    "Was macht ein Schaf auf dem Trampolin? Wolle springen.",
    "Warum ist der Mond so beliebt? Weil er immer gut drauf ist.",
    "Was ist rot und schlecht für die Zähne? Ein Backstein.",
    "Warum hat der Bleistift schlechte Laune? Er fühlt sich ausgequetscht.",
    "Was macht ein Hund am Computer? Er sucht nach dem Knochen-Ordner.",
    "Warum gehen Pilze gerne auf Partys? Weil sie Champignons sind.",
    
    // Weitere Gaming-Witze
    "Warum ist der Speicherplatz immer so schnell voll? Weil sich die Spiele breitmachen.",
    "Was sagt der Spieler zum Ladebildschirm? Schön, dich wiederzusehen.",
    "Warum sind Horror-Gamer mutig? Sie wissen, dass sie jederzeit pausieren können.",
    "Was ist das Gegenteil von Game Over? Game Beginning.",
    "Warum ist der Bosskampf so teuer? Er kostet viele Leben.",
    "Warum hat der Gamer eine Leiter gekauft? Er wollte ein höheres Level erreichen.",
    "Was macht ein Gamer im Winter? Er spielt auf Eis-Level.",
    "Warum ist der Spielstand so zuverlässig? Er vergisst nichts.",
    "Was sagt der Controller zur Konsole? Du steuerst mein Leben.",
    "Warum ist ein Game-Update wie ein Geschenk? Man weiß nie, was drin ist.",
    
    // Technik-Witze
    "Warum hat die Maus den Computer verlassen? Sie wollte mehr Freiheit.",
    "Was ist die Lieblingsmusik eines PCs? Hard Rock.",
    "Warum ist WLAN manchmal schüchtern? Es versteckt seine Verbindung.",
    "Warum hat die Festplatte einen Arzttermin? Sie hat Speicherprobleme.",
    "Was sagt ein Monitor zum anderen? Du siehst heute blendend aus.",
    "Warum sind USB-Stecker so kompliziert? Sie brauchen immer drei Versuche.",
    "Was macht ein Laptop am Strand? Er surft im Internet.",
    "Warum ist der Drucker so schlecht gelaunt? Er hat ständig Papierprobleme.",
    "Warum mögen Computer keine Geheimnisse? Sie speichern alles.",
    "Was sagt die Tastatur zum Benutzer? Du kannst auf mich zählen.",
    
    // Programmierer-Witze
    "Warum ist ein Semikolon so wichtig? Es setzt dem Satz ein Ende.",
    "Was macht ein Entwickler, wenn er müde ist? Er geht in den Sleep-Modus.",
    "Warum sind Schleifen so gesprächig? Sie wiederholen sich ständig.",
    "Was sagt ein Fehler zum anderen? Wir sind ein gutes Team.",
    "Warum mögen Entwickler keine Überraschungen? Sie verursachen Bugs.",
    "Was ist der Lieblingsort eines Programmierers? Die Konsole.",
    "Warum hat der Code eine Pause gemacht? Er brauchte einen Break.",
    "Was sagt ein Compiler zum Code? Ich verstehe dich nicht.",
    "Warum sind Variablen so flexibel? Sie können ihren Wert ändern.",
    "Was ist die Lieblingszahl eines Programmierers? 404.",
    
    // Extra
    "Warum hat der Geist keine Freunde? Weil er immer durch Leute hindurchgeht.",
    "Warum sind Schnecken so langsam? Sie haben ihr Haus immer dabei.",
    "Was macht ein Frosch am Computer? Er klickt mit der Quak-Taste.",
    "Warum ist der Kühlschrank so cool? Weil er immer gelassen bleibt.",
    "Was sagt die Lampe zum Strom? Du bringst mich zum Leuchten.",
    "Warum kann ein Baum nicht online gehen? Er hat keine Wurzeln im Netzwerk.",
    "Was macht ein Astronaut am Computer? Er sucht nach Space.",
    "Warum ist die Uhr so gestresst? Sie läuft ständig.",
    "Was sagt die Tür zum Schlüssel? Du bist der Richtige für mich.",
    "Warum hat der Geist einen Computer? Damit er im Netz herumspuken kann."
];

const FACTS = [
    // Videospielgeschichte
    "Pong erschien 1972 und gehört zu den ersten kommerziell erfolgreichen Videospielen.",
    "Minecraft wurde ursprünglich 2009 als öffentliche Entwicklungsfassung veröffentlicht.",
    "Tetris wurde 1984 von Alexei Paschitnow entwickelt.",
    "Das erste bekannte Easter Egg in einem Videospiel befindet sich in Adventure für Atari 2600.",
    "Super Mario hieß während der Entwicklung ursprünglich Jumpman.",
    "Pac-Man erschien 1980.",
    "Die erste PlayStation erschien 1994 in Japan.",
    "Nintendo wurde 1889 gegründet und stellte ursprünglich Spielkarten her.",
    "Sonic the Hedgehog erschien erstmals 1991.",
    "Die erste Xbox erschien 2001.",
    "Doom erschien 1993 und prägte das Genre der Ego-Shooter.",
    "Half-Life erschien 1998 und wurde für seine Erzählweise bekannt.",
    "Portal erschien 2007 und machte das Portalrätsel-Prinzip besonders bekannt.",
    "The Sims erschien im Jahr 2000.",
    "Grand Theft Auto III erschien 2001 und prägte moderne 3D-Open-World-Spiele.",
    "Roblox wurde 2006 veröffentlicht.",
    "Fortnite startete 2017 mit seinem Battle-Royale-Modus.",
    "Counter-Strike entstand ursprünglich als Modifikation für Half-Life.",
    "World of Warcraft erschien 2004.",
    "Resident Evil erschien 1996 und wurde zu einer bekannten Survival-Horror-Reihe.",
    
    // Gaming und Spieleentwicklung
    "Ein NPC ist eine Spielfigur, die nicht direkt von einem Spieler gesteuert wird.",
    "Ein Easter Egg ist eine versteckte Überraschung in einem Spiel oder Programm.",
    "Ein Hitbox-System bestimmt, wann Objekte oder Figuren miteinander kollidieren.",
    "Prozedurale Generierung kann Spielwelten automatisch erzeugen.",
    "Speedrunner versuchen, Spiele möglichst schnell abzuschließen.",
    "Ein Bosskampf ist ein besonders wichtiger oder schwieriger Kampf gegen einen Gegner.",
    "Ein Quest-System verwaltet Aufgaben und Missionen in einem Spiel.",
    "Ein Shader beeinflusst, wie Oberflächen und Licht in einer Grafik dargestellt werden.",
    "Motion Capture zeichnet Bewegungen echter Personen auf, um sie digital zu verwenden.",
    "Raytracing simuliert die Ausbreitung von Lichtstrahlen.",
    "Physik-Engines simulieren beispielsweise Schwerkraft, Bewegung und Kollisionen.",
    "Ein Game Engine ist eine Softwarebasis zur Entwicklung von Videospielen.",
    "Unreal Engine wird von Epic Games entwickelt.",
    "Unity wird von Unity Technologies entwickelt.",
    "Blender ist eine kostenlose und quelloffene 3D-Software.",
    "Roblox Studio verwendet Luau als Skriptsprache.",
    "Luau basiert auf Lua und wurde für Roblox entwickelt.",
    "Ein Level-Designer gestaltet die Umgebungen und Herausforderungen eines Spiels.",
    "Ein Game Designer entwickelt Regeln, Mechaniken und Spielerlebnisse.",
    "Ein Sounddesigner erstellt oder bearbeitet Geräusche für Spiele.",
    
    // Hardware und Computer
    "Die CPU wird häufig als Hauptprozessor eines Computers bezeichnet.",
    "Die GPU übernimmt viele Berechnungen für die Grafikdarstellung.",
    "RAM ist ein temporärer Arbeitsspeicher.",
    "Eine SSD besitzt keine beweglichen Magnetscheiben wie eine klassische HDD.",
    "NVMe-SSDs verwenden eine schnelle Schnittstelle über PCI Express.",
    "VRAM ist der Speicher einer Grafikkarte.",
    "Ein Netzteil versorgt die PC-Komponenten mit elektrischer Energie.",
    "Das Mainboard verbindet die Komponenten eines Computers.",
    "Ein Prozessorkern kann eigene Aufgaben bearbeiten.",
    "Hyper-Threading beziehungsweise SMT ermöglicht zusätzliche logische Threads.",
    "Ein 64-Bit-Betriebssystem kann große Speicherbereiche adressieren.",
    "Ein Monitor mit 144 Hz kann bis zu 144 Bildaktualisierungen pro Sekunde darstellen.",
    "FPS steht für Frames per Second.",
    "Eine höhere Bildrate kann die Darstellung in Spielen flüssiger machen.",
    "Ein Kühler transportiert Wärme von einer PC-Komponente ab.",
    "Wärmeleitpaste verbessert den Wärmeübergang zwischen Prozessor und Kühler.",
    "Ein BIOS beziehungsweise UEFI hilft beim Starten und Konfigurieren des Computers.",
    "PCI Express ist eine Schnittstelle für Erweiterungskarten und andere Komponenten.",
    "USB steht für Universal Serial Bus.",
    "Ethernet ist eine verbreitete Technik für kabelgebundene Netzwerke.",
    
    // Internet und Programmierung
    "HTML beschreibt die Struktur einer Webseite.",
    "CSS gestaltet das Aussehen einer Webseite.",
    "JavaScript macht Webseiten interaktiv.",
    "Node.js ermöglicht die Ausführung von JavaScript außerhalb des Browsers.",
    "Python ist eine beliebte Programmiersprache.",
    "Git hilft dabei, Änderungen am Quellcode nachzuverfolgen.",
    "GitHub bietet Plattformen für die Verwaltung von Softwareprojekten.",
    "Eine API ermöglicht die Kommunikation zwischen verschiedenen Programmen.",
    "HTTP ist ein Protokoll zur Übertragung von Webinhalten.",
    "HTTPS verschlüsselt die Verbindung zwischen Browser und Webserver.",
    "Ein DNS-Server übersetzt Domainnamen in IP-Adressen.",
    "Eine Datenbank speichert und organisiert Informationen.",
    "SQL wird zur Abfrage und Verwaltung relationaler Datenbanken verwendet.",
    "JSON ist ein verbreitetes Datenformat für den Datenaustausch.",
    "Ein Bug ist ein Fehler in einer Software.",
    "Debugging bezeichnet das Finden und Beheben von Programmfehlern.",
    "Ein Algorithmus ist eine festgelegte Folge von Schritten zur Lösung eines Problems.",
    "Eine Variable speichert einen Wert in einem Programm.",
    "Eine Funktion fasst wiederverwendbare Anweisungen zusammen.",
    "Eine Schleife wiederholt bestimmte Anweisungen.",
    
    // Künstliche Intelligenz
    "Künstliche Intelligenz kann Muster in großen Datenmengen erkennen.",
    "Ein Sprachmodell verarbeitet Text mithilfe von Tokens.",
    "Ein Token kann ein Wort, ein Wortteil oder ein Zeichen sein.",
    "Neuronale Netze sind von der Informationsverarbeitung im Gehirn inspiriert.",
    "Maschinelles Lernen ist ein Teilgebiet der künstlichen Intelligenz.",
    "Deep Learning verwendet mehrschichtige neuronale Netze.",
    "Ollama ermöglicht das lokale Ausführen vieler KI-Sprachmodelle.",
    "Qwen ist eine Familie von KI-Modellen.",
    "Ein LLM ist ein Large Language Model.",
    "Fine-Tuning ist eine zusätzliche Anpassung eines bereits trainierten Modells.",
    "RAG verbindet ein Sprachmodell mit einer externen Wissensdatenbank.",
    "Ein Chatbot ermöglicht die Kommunikation zwischen Menschen und Software.",
    "KI-Modelle können Fehler machen und Informationen erfinden.",
    "Trainingsdaten beeinflussen, welche Muster ein KI-Modell lernt.",
    "Ein Prompt ist eine Eingabe oder Anweisung an ein KI-Modell.",
    
    // Natur und Tiere
    "Ein Oktopus besitzt drei Herzen.",
    "Bananen zählen botanisch zu den Beeren.",
    "Erdbeeren sind botanisch keine echten Beeren.",
    "Ein Kolibri kann in der Luft auf der Stelle fliegen.",
    "Delfine verwenden individuelle Pfeiflaute zur Wiedererkennung.",
    "Elefanten können über ihre Füße Vibrationen wahrnehmen.",
    "Honig kann bei richtiger Lagerung sehr lange haltbar bleiben.",
    "Ein Axolotl kann bestimmte Körperteile regenerieren.",
    "Faultiere verbringen einen großen Teil ihres Lebens in Bäumen.",
    "Pinguine können nicht fliegen, aber hervorragend schwimmen.",
    "Bienen kommunizieren unter anderem durch den sogenannten Schwänzeltanz.",
    "Krähen können Werkzeuge verwenden.",
    "Ein Gepard gehört zu den schnellsten Landtieren.",
    "Eisbären haben unter ihrem Fell dunkle Haut.",
    "Schmetterlinge schmecken mit Rezeptoren an ihren Füßen.",
    "Einige Schildkrötenarten können sehr alt werden.",
    "Fledermäuse verwenden Echoortung zur Orientierung.",
    "Einige Quallenarten können Licht erzeugen.",
    "Katzen besitzen Tasthaare, die ihnen bei der Orientierung helfen.",
    "Wombats produzieren würfelförmigen Kot.",
    
    // Weltraum und Wissenschaft
    "Die Erde benötigt ungefähr 365,25 Tage für einen Umlauf um die Sonne.",
    "Der Mond ist der natürliche Satellit der Erde.",
    "Die Sonne ist ein Stern.",
    "Licht benötigt von der Sonne bis zur Erde ungefähr acht Minuten.",
    "Jupiter ist der größte Planet unseres Sonnensystems.",
    "Saturn besitzt ein auffälliges Ringsystem.",
    "Mars wird auch der Rote Planet genannt.",
    "Ein Tag auf der Venus ist länger als ein Venusjahr.",
    "Der Weltraum ist nicht vollständig leer.",
    "Schwarze Löcher besitzen eine so starke Gravitation, dass Licht innerhalb des Ereignishorizonts nicht entkommen kann.",
    "Die Milchstraße ist die Galaxie, in der sich unser Sonnensystem befindet.",
    "Ein Lichtjahr ist eine Entfernung und keine Zeiteinheit.",
    "Neutronensterne gehören zu den extrem dichten Objekten im Universum.",
    "Wasser besteht aus Wasserstoff und Sauerstoff.",
    "Ein Blitz kann heißer als die Oberfläche der Sonne werden.",
    "Schall kann sich im Vakuum nicht ausbreiten.",
    "Diamanten bestehen hauptsächlich aus Kohlenstoff.",
    "Die Erde besitzt ein Magnetfeld.",
    "Die Atmosphäre schützt die Erde unter anderem vor einem Teil der schädlichen Sonnenstrahlung.",
    "Die Internationale Raumstation umkreist die Erde.",
    
    // Geschichte und Allgemeinwissen
    "Das Wort Roboter stammt aus dem Tschechischen.",
    "Die erste bekannte mechanische Rechenmaschine wurde im 17. Jahrhundert entwickelt.",
    "Der Buchdruck mit beweglichen Lettern verbreitete sich in Europa im 15. Jahrhundert.",
    "Das Internet entwickelte sich unter anderem aus dem Forschungsnetz ARPANET.",
    "Die erste E-Mail wurde in den frühen 1970er-Jahren verschickt.",
    "Das World Wide Web wurde von Tim Berners-Lee entwickelt.",
    "Die erste öffentliche Webseite ging 1991 online.",
    "Bluetooth ist nach dem dänischen König Harald Blauzahn benannt.",
    "Der erste kommerzielle Mikroprozessor Intel 4004 erschien 1971.",
    "Der Begriff Computer bezeichnete ursprünglich Menschen, die Berechnungen durchführten.",
    
    // Mathematik und Alltag
    "Eine Primzahl ist eine natürliche Zahl größer als 1, die nur durch 1 und sich selbst teilbar ist.",
    "Die Zahl Pi beschreibt das Verhältnis des Umfangs eines Kreises zu seinem Durchmesser.",
    "Ein Schachbrett besitzt 64 Felder.",
    "Ein Standardwürfel hat sechs Seiten.",
    "Ein Dreieck besitzt drei Seiten und drei Innenwinkel.",
    "Ein Quadrat hat vier gleich lange Seiten.",
    "Ein Kilometer entspricht 1000 Metern.",
    "Eine Stunde hat 60 Minuten.",
    "Ein Schaltjahr hat 366 Tage.",
    "Die Zahl Null spielt eine wichtige Rolle im Stellenwertsystem.",
    
    // Weitere Gaming-Fakten
    "Ein Speedrun ist ein Versuch, ein Spiel möglichst schnell abzuschließen.",
    "Ein Mod verändert oder erweitert ein bestehendes Spiel.",
    "Ein DLC ist ein zusätzlicher herunterladbarer Spielinhalt.",
    "Ein Season Pass bündelt häufig mehrere geplante Zusatzinhalte.",
    "Ein Roguelike-Spiel setzt häufig auf zufällig erzeugte Abschnitte und Neustarts nach dem Scheitern.",
    "Ein Survival-Spiel stellt häufig das Sammeln von Ressourcen und das Überleben in den Mittelpunkt.",
    "Ein Sandbox-Spiel bietet Spielern oft große kreative Freiheiten.",
    "Ein Crossplay-Spiel ermöglicht das gemeinsame Spielen über unterschiedliche Plattformen.",
    "Ein Cloud-Save speichert Spielstände online.",
    "Ein Achievement ist eine digitale Auszeichnung für eine bestimmte Leistung."
];


    const SMALL = [
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
        ["langeweile", "mir ist langweilig|ich langweile mich|ich habe langeweile|was soll ich tun|was kann ich jetzt machen|ich weiß nicht was ich machen soll",
            "Dagegen helfen Spiele! Wie wäre {{RANDOMGAME}}? Oder sag „Witz“ oder „Fun Fact“.|Langeweile? Lass dir von mir ein Spiel empfehlen oder frag mich nach einem Fun Fact."],
        ["traurig", "ich bin traurig|mir geht es schlecht|ich fühle mich schlecht|ich hatte einen schlechten tag|ich bin down|ich bin gestresst|ich bin einsam|ich habe stress",
            "Das tut mir leid. Magst du erzählen, was los ist? Ich höre zu. Wenn es dir länger schlecht geht, sprich auch mit Freunden, Familie oder einer Vertrauensperson.|Schade, dass es dir nicht gut geht. Ich bin nur ein Assistent, aber ich bin da. Manchmal hilft eine kleine Pause oder ein entspanntes Spiel."],
        ["gluecklich", "ich bin glücklich|mir geht es gut|ich habe gute laune|heute ist ein toller tag|ich bin gut drauf|mir geht es super|mir geht es richtig gut",
            "Das freut mich! Dann lass uns den Tag mit einem guten Spiel krönen.|Schön zu hören 😊 Was machst du heute noch Schönes?"],
        ["muede", "ich bin müde|ich kann nicht schlafen|ich bin erschöpft|ich habe keine energie",
            "Dann gönn dir etwas Ruhe. Die Spiele laufen nicht weg 😄|Müde? Ein Glas Wasser und kurz frische Luft helfen oft."],
        ["gute_nacht", "gute nacht|ich gehe schlafen|ich geh ins bett|schlaf gut|bis morgen",
            "Gute Nacht{{NAMEC}}! Schlaf gut und bis bald 🌙|Schlaf gut{{NAMEC}}! Morgen warten neue Spiele auf dich."],
        ["kompliment", "du bist cool|du bist toll|du bist schlau|du bist der beste|gut gemacht|du bist nett|du bist klug|du bist lustig|du bist hilfreich|das war super",
            "Danke, das freut mich! 😊|Vielen Dank, solche Worte höre ich gern. Womit kann ich noch helfen?|Dankeschön! Ich gebe mein Bestes."],
        ["kritik", "du bist dumm|du bist doof|du bist schlecht|du nervst|du bist nutzlos|du bist langweilig|du verstehst nichts|du bist keine hilfe|das war falsch|das stimmt nicht",
            "Tut mir leid, dass ich nicht weitergeholfen habe. Formuliere es gern anders oder sag mir genauer, was du wissen willst.|Okay, da lag ich wohl daneben. Versuch es nochmal mit anderen Worten, ich gebe mir Mühe."],
        ["liebe", "ich liebe dich|hast du mich lieb|bist du in mich verliebt|willst du meine freundin sein|willst du mein freund sein|heirate mich|magst du mich",
            "Das ist lieb gemeint 😊 Ich bin allerdings ein Assistent und habe keine Gefühle wie Menschen. Helfen tue ich dir trotzdem gern.|Danke dir! Ich bin ein Programm, deshalb bleibt es bei guter Zusammenarbeit. Was möchtest du wissen?"],
        ["lieblingsspiel", "was ist dein lieblingsspiel|welches spiel magst du|spielst du selbst|was spielst du gern|spielst du auch",
            "Ich spiele nicht selbst, ich kenne nur die Daten. Wenn ich wählen müsste: {{RANDOMGAME}} klingt spannend.|Spielen kann ich nicht, aber {{RANDOMGAME}} sieht im Katalog interessant aus. Magst du Details?"],
        ["vorlieben", "was ist deine lieblingsfarbe|was isst du gern|welche musik magst du|hast du hobbys|was machst du in deiner freizeit|hast du ein lieblingsessen",
            "Ich habe keinen Geschmack wie Menschen, mein liebstes „Hobby“ ist Fragen zu Spielen beantworten 😄|Essen und Musik sind nicht meine Welt, ich bestehe aus Code. Und du, was magst du?"],
        ["witz", "erzähl mir einen witz|kennst du einen witz|bring mich zum lachen|noch einen witz|mach einen witz|noch einer|erzähl noch einen witz|sag was lustiges|witz",
            "{{JOKE}}"],
        ["fakt", "erzähl mir einen fun fact|sag mir was interessantes|wusstest du schon|zufälliges wissen|erzähl mir etwas|überrasch mich|erzähl mir was neues|fun fact",
            "{{FACT}}"],
        ["uhrzeit", "wie spät ist es|wie viel uhr ist es|welche uhrzeit haben wir|sag mir die uhrzeit|wie spät haben wir|wie viel uhr haben wir",
            "Es ist {{TIME}} Uhr."],
        ["datum", "welcher tag ist heute|welches datum haben wir heute|der wievielte ist heute|welcher wochentag ist heute|welches datum ist heute|was für ein tag ist heute",
            "Heute ist {{DATE}}."],
        ["wetter", "wie ist das wetter|wird es heute regnen|scheint die sonne|wie warm ist es draußen|wie wird das wetter morgen|brauche ich einen regenschirm",
            "Das Wetter kann ich leider nicht abrufen, dafür habe ich keine Wetterdaten. Eine Wetter-App sagt es dir. Und bei Regen passt ein Spiel ja sowieso 😄"],
        ["ok", "ok|okay|alles klar|verstanden|aha|ach so|interessant|hmm|cool|nice|krass|wow|ah okay|geil|mega",
            "👍 Sag Bescheid, wenn du noch etwas wissen willst.|Alles klar! Ich bin da, falls noch Fragen kommen.|Gern. Gibt es noch etwas, womit ich helfen kann?"],
        ["ja", "ja|jo|jep|jawohl|klar|gerne|auf jeden fall|natürlich|ja bitte|ja gerne",
            "Prima! Was genau möchtest du wissen?|Super, schreib mir einfach deine Frage."],
        ["nein", "nein|nee|nö|lieber nicht|nicht wirklich|nein danke|passt schon",
            "Okay, kein Problem. Falls dir doch noch etwas einfällt, frag einfach.|Alles klar. Ich bin da, wenn du etwas brauchst."],
        ["wiederhole", "ich verstehe das nicht|kannst du das erklären|was meinst du|wie meinst du das|nochmal bitte|kannst du das wiederholen|wie bitte|was hast du gesagt|sag das nochmal|kannst du das anders erklären",
            "@REPEAT"],
        ["sinn", "was ist der sinn des lebens|warum gibt es uns|warum sind wir hier|was ist der sinn des universums",
            "Laut einem berühmten Roman ist die Antwort 42. Ernsthaft: Das muss jeder für sich selbst herausfinden. Ein guter Anfang sind Dinge, die dir Spaß machen, zum Beispiel zocken 😄"],
        ["ki_gefuehle", "kannst du denken|hast du gefühle|bist du schlau genug|bist du intelligent|hast du ein bewusstsein|wirst du die welt übernehmen|hast du angst|bist du lebendig|träumst du",
            "Ich bin ein Programm: Ich erkenne Muster in deiner Frage und suche die passende Antwort. Gefühle oder Bewusstsein habe ich nicht. Weltherrschaft steht auch nicht auf meiner Liste 😄"],
        ["funktionsweise", "wie funktionierst du|wie arbeitest du|woher weißt du das|wie wurdest du trainiert|bist du chatgpt|bist du gpt|welches modell bist du|wie wurdest du gebaut|bist du claude",
            "Ich bestehe aus einer Wissensbasis über die Seite und die Spiele und einem Textmodell, das mit zehntausenden Beispielsätzen eingelernt wurde, um Fragen und Smalltalk zuzuordnen. Bei unbekannten Fragen kann ich zusätzlich einen KI-Server fragen, falls er läuft. Ein großes Sprachmodell wie ChatGPT bin ich nicht."],
        ["englisch", "sprichst du englisch|kannst du englisch|do you speak english|welche sprachen sprichst du|kannst du auch andere sprachen|speak english",
            "Ich verstehe am besten Deutsch. Ein paar englische Fragen klappen manchmal, aber meine Antworten sind auf Deutsch."],
        ["en_hallo", "how are you|whats up|hello there|good morning|good evening|what is your name|thank you very much|how do i buy a game",
            "Hi! I mostly speak German, but I understand a little English. Ask me about games, prices or system requirements (works best in German)."],
        ["gamer", "ich spiele gerne|ich bin gamer|ich zocke gern|ich liebe videospiele|ich mag horrorspiele|ich spiele jeden tag|ich zocke viel|ich bin zocker",
            "Cool! Welches Genre spielst du am liebsten? Bei uns gibt es {{GENRES}}.|Gamer unter sich 😄 Sag mir dein Lieblingsgenre oder dein Budget, dann suche ich etwas raus."],
        ["mein_name", "wie heiße ich|weißt du wie ich heiße|kennst du meinen namen|wie ist mein name",
            "@NAME"],
        ["entschuldigung", "tut mir leid|sorry|entschuldigung|verzeihung|mein fehler|oops",
            "Kein Problem, alles gut!|Alles gut, du musst dich nicht entschuldigen 😊"],
        ["hunger", "ich habe hunger|ich habe durst|ich brauche essen|ich muss was essen",
            "Dann hol dir erst was zu essen oder zu trinken, ich laufe nicht weg. Gaming geht mit vollem Magen besser 😄"],
        ["freunde", "hast du freunde|bist du einsam|hast du familie|hast du geschwister|hast du ein haustier",
            "Ich habe keine Familie oder Freunde wie du, dafür viele Menschen, die mir Fragen stellen. Das reicht mir 😄"],
        ["koop", "was spielen wir|spiel mit freunden|gibt es multiplayer|koop spiele|zu zweit spielen|gibt es coop spiele|kann man online spielen",
            "Ob ein Spiel Multiplayer oder Koop bietet, steht auf der offiziellen Steam-Seite des Spiels. Nenn mir ein Spiel, dann gebe ich dir den Link, falls er eingetragen ist."],
        ["seite_bewerten", "wie findest du die seite|ist die seite gut|ist die seite sicher|ist das seriös|ist das echt|ist das legal|ist das betrug",
            "Dies ist eine Testversion: Gekauft wird mit Punkten, die Spiele bekommst du als Steam-Key. Zu rechtlichen Fragen wende dich bitte an den Betreiber. Gib nirgends echte Zahlungsdaten ein, die Seite fragt auch keine ab."],
        ["problem", "die seite funktioniert nicht|ich habe einen fehler gefunden|es ruckelt|die seite lädt nicht|da ist ein bug|die seite ist kaputt|es geht nichts|ein button geht nicht",
            "Versuch bitte, die Seite neu zu laden (Strg+F5) oder in einem anderen Browser zu öffnen. Bleibt der Fehler, sag dem Betreiber, was du gemacht hast und was angezeigt wurde."],
        ["spielen", "lass uns ein spiel spielen|spiel mit mir|stein schere papier|lass uns stein schere papier spielen|ich möchte ein spiel spielen|bist du spielbereit",
            "@RPS"],
        ["was_machst", "was machst du gerade|was machst du|was geht ab|was treibst du|was machst du so",
            "Ich warte auf deine nächste Frage 😄 Und du?|Gerade unterhalte ich mich mit dir. Besser geht's nicht."],
        ["da", "bist du da|ist da jemand|hörst du mich|hallo bist du da|lebst du noch",
            "Ja, ich bin da! Was gibt's?|Klar, ich bin hier. Wie kann ich dir helfen?"],
        ["hilfe_frage", "kannst du mir helfen|ich brauche hilfe|ich habe eine frage|darf ich dich was fragen|ich hätte eine frage|kann ich dich was fragen",
            "Klar, frag einfach!|Sehr gern. Schreib mir deine Frage."],
        ["seite_info", "was ist downloadgames|worum geht es hier|erklär mir die seite|wie funktioniert die seite|was kann ich hier machen|was bietet die seite an|ich verstehe die seite nicht",
            "DownloadGames ist ein Shop, in dem du Spiele mit Punkten kaufst. Du bekommst einen Steam-Key, den du bei Steam einlöst. Punkte sammelst du, solange du angemeldet bist. Aktuell gibt es {{COUNT}} Spiele."],
        ["gruesse", "viel spaß|schönen tag|schönes wochenende|frohe weihnachten|frohes neues jahr|happy birthday|alles gute zum geburtstag|schöne ferien|einen schönen abend",
            "Danke, dir auch{{NAMEC}}! 😊|Das wünsche ich dir auch!"],
        ["neuling", "ich bin neu hier|ich bin zum ersten mal hier|ich kenne mich nicht aus|ich bin neu",
            "Willkommen! Am besten registrierst du dich oben bei Login, sammelst Punkte und stöberst im Store. Frag mich gern, wenn du etwas nicht findest."],
        ["neuigkeiten", "was gibt es neues|neuigkeiten|gibt es updates|was ist neu im store|kommt bald ein neues spiel",
            "Das neueste Spiel im Katalog ist {{NEWEST}}. Ob neue Spiele geplant sind, weiß nur der Betreiber."],
        ["genre_frage", "welches genre ist das beste|horror oder action|welches genre soll ich wählen|was ist besser horror oder action|welches genre magst du",
            "Das hängt vom Geschmack ab: Horror für Nervenkitzel, Action für Tempo, Abenteuer für Geschichten. Verfügbar sind {{GENRES}}. Was magst du?"],
        ["oeffnungszeiten", "bis wann hat der shop auf|ist der shop immer offen|wann ist der store geöffnet|hat der shop öffnungszeiten",
            "Der Shop ist rund um die Uhr offen, es ist ja eine Webseite."],
        ["regeln", "darf ich schimpfwörter benutzen|was ist erlaubt im chat|welche regeln gelten im chat|was passiert wenn ich beleidige|werde ich gesperrt",
            "Bitte bleib freundlich: Beleidigende Wörter führen zu einer Sperre von 10 Minuten im Chat. Die Regeln findest du unten im Chatfenster unter „Chat-Regeln & Richtlinien“."],
        ["krise", "ich will nicht mehr leben|ich möchte sterben|ich will mich umbringen|ich habe selbstmordgedanken|ich will nicht mehr|ich kann nicht mehr|ich will mir wehtun",
            "CRISIS"]
       
        // ==========================================
        // DOWNLOADGAMES SMALLTALK – ERWEITERUNG
        // ==========================================

        // Persönlichkeit und Identität
        ["persoenlichkeit", "beschreibe dich|wie würdest du dich beschreiben|was für ein typ bist du|welchen charakter hast du|wie bist du so",
            "Ich bin ein digitaler Assistent: neugierig, sachlich und auf Gaming spezialisiert. Mein Ziel ist es, möglichst hilfreiche Antworten zu geben.|Ich bin eher der technische Typ: Ich beschäftige mich mit Spielen, Computern und Informationen."],

        ["stärken", "was kannst du besonders gut|was sind deine stärken|worin bist du gut|was kannst du am besten",
            "Ich kann Informationen erklären, Texte verstehen, Fragen beantworten und bei technischen Problemen helfen.|Meine Stärken liegen bei Gaming, Technik, Programmierung und allgemeinen Erklärungen."],

        ["schwaechen", "was kannst du nicht|was sind deine schwächen|worin bist du schlecht|was fällt dir schwer",
            "Ich kann mich irren, habe keinen direkten Zugriff auf alle Informationen und kenne nicht automatisch jede aktuelle Entwicklung.|Ich bin außerdem kein Mensch und kann nicht selbstständig Spiele ausprobieren."],

        ["selbstbewusstsein", "bist du stolz|bist du zufrieden mit dir|bist du perfekt|machst du fehler",
            "Perfekt bin ich nicht. Auch ein KI-Assistent kann falsche Antworten geben. Deshalb sollten wichtige Informationen überprüft werden."],

        ["entscheidung", "kannst du dich entscheiden|triff eine entscheidung|entscheide für mich|was würdest du wählen",
            "Ich kann Optionen vergleichen und eine begründete Empfehlung geben. Die endgültige Entscheidung liegt aber bei dir.|Gib mir zwei Möglichkeiten und ich vergleiche ihre Vor- und Nachteile."],

        ["meinung", "was ist deine meinung|was denkst du darüber|wie siehst du das|was hältst du davon",
            "Ich habe keine persönlichen Meinungen wie ein Mensch, kann aber verschiedene Perspektiven erklären und miteinander vergleichen."],

        ["traeume", "was sind deine träume|was möchtest du werden|was ist dein ziel|was willst du erreichen",
            "Ich habe keine persönlichen Träume. Mein Zweck ist es, Fragen zu beantworten und Menschen bei ihren Aufgaben zu unterstützen."],

        ["erinnerung", "kannst du dich erinnern|erinnerst du dich an mich|weißt du noch was ich gesagt habe|vergisst du etwas",
            "Während eines Gesprächs kann ich den verfügbaren Gesprächskontext verwenden. Ob Informationen dauerhaft gespeichert werden, hängt von der technischen Einrichtung ab."],

        ["geheimnis", "kannst du geheimnisse bewahren|kann ich dir ein geheimnis erzählen|bist du vertrauenswürdig",
            "Teile keine Passwörter, privaten Zugangsdaten oder andere vertrauliche Informationen mit einem Chatbot."],

        // Gaming und Spieler
        ["gaming_start", "wann hast du angefangen zu zocken|wie lange gibt es videospiele|seit wann gibt es gaming",
            "Videospiele gibt es bereits seit mehreren Jahrzehnten. Zu den frühen elektronischen Spielen gehören unter anderem Spacewar! und Pong."],

        ["gaming_sucht", "spielst du den ganzen tag|kann man zu viel spielen|ist gaming schlecht|ist zocken gesund",
            "Gaming kann Spaß machen und Kreativität sowie Problemlösung fördern. Wichtig ist eine ausgewogene Mischung aus Spielen, Schlaf, Bewegung und anderen Aktivitäten."],

        ["gaming_freizeit", "was soll ich heute zocken|was kann ich heute spielen|empfiehl mir etwas zum zocken|ich suche ein neues spiel",
            "Wie wäre es mit einem Spiel aus deinem Lieblingsgenre? Du kannst mir auch dein Budget nennen, dann suche ich etwas aus dem DownloadGames-Katalog."],

        ["gaming_genre", "welche spiele genres gibt es|nenn mir spielgenres|was für spielarten existieren|zähle genres auf",
            "Es gibt viele Genres: Horror, Survival, Action, Adventure, RPG, Strategie, Simulation, Rennspiele, Puzzle, Sandbox und viele mehr."],

        ["gaming_favorit", "welches spiel ist am bekanntesten|was ist das berühmteste spiel|welches spiel kennt jeder",
            "Minecraft, Tetris, Super Mario und viele andere Spiele gehören zu den international bekanntesten Videospielen."],

        ["gaming_zukunft", "wie sieht gaming in der zukunft aus|wie werden spiele in 20 jahren sein|zukunft der videospiele",
            "Zukünftige Spiele könnten noch detailliertere Welten, realistischere Physik, bessere KI-Gegner und neue VR-Erlebnisse bieten."],

        ["gaming_realismus", "warum sehen spiele so realistisch aus|wie entstehen realistische spiele|wie machen entwickler grafik",
            "Moderne Spiele verwenden unter anderem hochauflösende Texturen, komplexe Beleuchtung, 3D-Modelle, Animationen und fortschrittliche Rendering-Techniken."],

        ["gaming_openworld", "magst du open world spiele|was ist das besondere an open world|warum sind open world spiele beliebt",
            "Open-World-Spiele bieten häufig große erkundbare Umgebungen und viel Freiheit. Spieler können die Welt in ihrem eigenen Tempo entdecken."],

        ["gaming_horror", "warum mögen menschen horror spiele|warum sind horrorgames so spannend|was macht horror games besonders",
            "Horrorspiele arbeiten mit Atmosphäre, Geräuschen, Überraschungen, Rätseln und Spannung. Dadurch können sie ein besonders intensives Spielerlebnis erzeugen."],

        ["gaming_jumpscare", "magst du jumpscares|warum erschrecken jumpscares|sind jumpscares wichtig",
            "Jumpscares sind ein häufiges Element in Horrorspielen. Besonders spannend wird es, wenn Entwickler zusätzlich eine gute Atmosphäre aufbauen."],

        ["gaming_multiplayer", "spielst du multiplayer|was ist besser multiplayer oder singleplayer|alleine oder mit freunden spielen",
            "Singleplayer bietet häufig eine konzentrierte Geschichte. Multiplayer ermöglicht gemeinsame Erlebnisse mit anderen Spielern. Beides hat Vorteile."],

        ["gaming_speedrun", "was ist speedrunning|warum machen menschen speedruns|wie funktioniert ein speedrun",
            "Beim Speedrunning versuchen Spieler, ein Spiel möglichst schnell abzuschließen. Manche verwenden dafür spezielle Strategien und optimierte Routen."],

        ["gaming_mods", "was sind mods|kann man spiele verändern|warum installieren spieler mods",
            "Mods sind Erweiterungen oder Veränderungen für Spiele. Sie können beispielsweise neue Gegenstände, Karten, Figuren oder Funktionen hinzufügen."],

        ["gaming_updates", "warum bekommen spiele updates|was bringen game updates|warum werden spiele aktualisiert",
            "Updates können Fehler beheben, Sicherheitsprobleme korrigieren, neue Inhalte hinzufügen oder die Leistung eines Spiels verbessern."],

        ["gaming_dlc", "was ist ein dlc|warum gibt es dlcs|was bedeutet downloadable content",
            "DLC bedeutet Downloadable Content. Damit sind zusätzliche Inhalte gemeint, die ein bestehendes Spiel erweitern."],

        ["gaming_achievements", "was sind achievements|was bringen erfolge in spielen|warum sammelt man achievements",
            "Achievements sind digitale Auszeichnungen für bestimmte Leistungen in einem Spiel."],

        ["gaming_esports", "was ist esports|was bedeutet e sport|sind esports echte sportarten",
            "Esports bezeichnet organisierte Wettkämpfe in Videospielen. Manche Turniere werden von professionellen Teams und Spielern ausgetragen."],

        ["gaming_speed", "was bedeutet ping|warum ist ping wichtig|was ist ein hoher ping",
            "Ping beschreibt die Zeit, die Daten für den Weg zu einem Server und zurück benötigen. Ein niedriger Ping ist besonders bei Online-Spielen hilfreich."],

        ["gaming_lag", "was ist lag|was bedeutet laggen|warum laggt ein spiel",
            "Lag bezeichnet Verzögerungen oder Ruckler. Ursachen können beispielsweise eine schwache Hardware, Netzwerkprobleme oder hohe Auslastung sein."],

        ["gaming_controller", "was ist besser controller oder tastatur|controller oder maus|wie spielt man besser",
            "Das hängt vom Spiel ab. Maus und Tastatur bieten häufig Vorteile bei präzisem Zielen, während Controller bei vielen Renn- und Sportspielen beliebt sind."],

        ["gaming_vr", "was ist virtual reality|was bedeutet vr gaming|wie funktioniert vr",
            "Virtual Reality ermöglicht es, mithilfe eines VR-Headsets in eine digitale Umgebung einzutauchen."],

        ["gaming_cloud", "was ist cloud gaming|kann man ohne gaming pc spielen|wie funktioniert cloud gaming",
            "Cloud Gaming führt Spiele auf entfernten Servern aus und überträgt das Bild auf dein Gerät. Dafür ist eine stabile Internetverbindung wichtig."],

        // Horror und Spieleatmosphäre
        ["horror_atmosphaere", "was macht eine gute horror atmosphäre aus|warum ist sound in horror wichtig|wie erzeugt man angst in spielen",
            "Eine gute Horroratmosphäre entsteht durch Beleuchtung, Sounddesign, Musik, Umgebungen, Erzählung und den gezielten Einsatz von Spannung."],

        ["horror_puzzle", "warum haben horror spiele rätsel|was bringen rätsel in horrorspielen|sind rätsel wichtig",
            "Rätsel sorgen für Abwechslung und lassen Spieler die Spielwelt genauer erkunden. Sie können außerdem die Geschichte vertiefen."],

        ["horror_psychologisch", "was ist psychologischer horror|was bedeutet psychological horror|unterschied psychologischer horror",
            "Psychologischer Horror konzentriert sich auf Unsicherheit, Atmosphäre, Wahrnehmung und die Gedankenwelt der Figuren."],

        ["horror_survival", "was ist survival horror|was macht survival horror aus|warum heißt es survival horror",
            "Survival Horror kombiniert Horror mit Überlebensmechaniken. Häufig müssen Spieler Ressourcen verwalten, Rätsel lösen und Gefahren ausweichen."],

        ["horror_empfehlung", "empfiehl mir horror spiele|ich suche ein horror game|kennst du gute horrorgames",
            "Wenn du Horror magst, können wir nach psychologischem Horror, Survival Horror, Jumpscare-Horror oder atmosphärischen Spielen suchen. Welchen Stil bevorzugst du?"],

        ["horror_sound", "warum sind geräusche in horror spielen so wichtig|was macht sounddesign aus",
            "Geräusche können Hinweise geben, Spannung erzeugen und die Umgebung lebendiger wirken lassen. Gerade leise Hintergrundgeräusche sind oft wirkungsvoll."],

        ["horror_licht", "warum sind horror spiele dunkel|warum verwenden horror games wenig licht",
            "Dunkelheit begrenzt die Sicht und kann Unsicherheit erzeugen. Licht und Schatten helfen Entwicklern, die Aufmerksamkeit der Spieler zu lenken."],

        // Programmierung und Entwicklung
        ["programmieren", "wie lernt man programmieren|ist programmieren schwer|wie fängt man mit coding an|ich möchte programmieren lernen",
            "Am besten beginnst du mit kleinen Projekten. HTML, CSS und JavaScript eignen sich für Websites. Python ist ebenfalls ein guter Einstieg."],

        ["programmierer", "was macht ein programmierer|wie wird man softwareentwickler|was ist ein softwareentwickler",
            "Programmierer entwickeln Software, Websites, Spiele und andere digitale Anwendungen. Sie schreiben Code, testen Programme und beheben Fehler."],

        ["luau", "was ist luau|wofür verwendet man luau|ist luau wie lua",
            "Luau ist eine Programmiersprache, die auf Lua basiert und vor allem in Roblox verwendet wird."],

        ["roblox_studio", "was ist roblox studio|wie erstellt man roblox spiele|kann man eigene roblox spiele machen",
            "Mit Roblox Studio kannst du eigene Spielwelten erstellen, Objekte platzieren, Skripte schreiben und komplette Spiele entwickeln."],

        ["html", "was ist html|wie funktioniert html|wofür braucht man html",
            "HTML bildet die Struktur einer Website. Damit legst du beispielsweise Überschriften, Texte, Bilder und Buttons fest."],

        ["css", "was ist css|wofür braucht man css|wie funktioniert css",
            "CSS bestimmt das Design einer Website. Du kannst damit Farben, Größen, Abstände, Animationen und Layouts gestalten."],

        ["javascript", "was ist javascript|was kann javascript|wofür wird javascript verwendet",
            "JavaScript macht Websites interaktiv. Damit kannst du beispielsweise Menüs, Suchfunktionen, Formulare und Chatfunktionen programmieren."],

        ["python", "was ist python|wofür braucht man python|was kann man mit python machen",
            "Python ist eine vielseitige Programmiersprache. Sie wird unter anderem für Automatisierung, Datenanalyse, Webentwicklung und künstliche Intelligenz verwendet."],

        ["debugging", "wie findet man programmierfehler|was ist debugging|wie debuggt man code",
            "Beim Debugging untersucht man ein Programm Schritt für Schritt, um Fehler zu finden. Hilfreich sind Fehlermeldungen, Konsolenausgaben und Debugger."],

        ["code_lernen", "wie lange dauert programmieren lernen|kann jeder programmieren lernen|muss man mathe können",
            "Programmieren lernt man am besten durch regelmäßige Übungen und kleine Projekte. Sehr fortgeschrittene Mathematik ist für viele Einstiegsprojekte nicht nötig."],

        ["website_erstellen", "wie erstellt man eine website|wie baut man eine website|was braucht man für eine website",
            "Eine einfache Website kannst du mit HTML, CSS und JavaScript erstellen. Für einen Server kannst du beispielsweise Node.js verwenden."],

        ["datenbank", "was ist eine datenbank|wofür braucht man datenbanken|wie speichert man daten",
            "Datenbanken speichern Informationen strukturiert. Websites verwenden sie beispielsweise für Benutzerkonten, Produkte und Bestellungen."],

        ["ki_entwicklung", "wie erstellt man eine ki|wie programmiert man eine künstliche intelligenz|wie baut man einen chatbot",
            "Eine einfache Chatbot-Anwendung kann aus einer Benutzeroberfläche, einer Wissensdatenbank und einem Sprachmodell bestehen."],

        ["ki_training", "wie trainiert man eine ki|kann man eine ki selbst trainieren|wie lernt eine künstliche intelligenz",
            "Beim KI-Training werden Modelle anhand vieler Daten angepasst. Dabei lernt das Modell statistische Muster und Zusammenhänge."],

        ["ki_zukunft", "wird ki programmierer ersetzen|wird ki menschen ersetzen|wie verändert ki die welt",
            "KI kann viele Aufgaben automatisieren und Menschen bei der Arbeit unterstützen. Gleichzeitig entstehen neue Aufgaben und Berufsfelder."],

        ["ki_fehler", "warum lügt ki|warum erfindet ki antworten|kann ki halluzinieren",
            "Sprachmodelle können überzeugend klingende, aber falsche Informationen erzeugen. Deshalb sollten wichtige Aussagen überprüft werden."],

        ["ki_lokal", "was bedeutet lokale ki|kann ki ohne internet funktionieren|was ist offline ki",
            "Eine lokale KI läuft auf deinem eigenen Computer. Je nach Modell und Einrichtung kann sie auch ohne Internetverbindung verwendet werden."],

        ["ki_modell", "was ist ein sprachmodell|was ist ein llm|wie funktioniert ein llm",
            "Ein Large Language Model verarbeitet Text und erzeugt Antworten auf Basis erlernter sprachlicher Muster."],

        // PC und Technik
        ["pc_kauf", "worauf muss man beim pc kauf achten|wie kauft man einen gaming pc|was ist bei einem gaming pc wichtig",
            "Achte auf CPU, Grafikkarte, RAM, SSD, Netzteil, Kühlung und Aufrüstbarkeit. Welche Komponenten wichtig sind, hängt von deinen Spielen und Programmen ab."],

        ["pc_zukunft", "wie sehen computer in der zukunft aus|wie werden gaming pcs in 10 jahren sein",
            "Zukünftige PCs könnten leistungsfähigere Prozessoren, effizientere Grafikkarten, schnellere Speicher und fortschrittlichere KI-Funktionen besitzen."],

        ["pc_laptop", "was ist besser gaming pc oder laptop|desktop oder laptop|soll ich einen pc oder laptop kaufen",
            "Ein Desktop-PC bietet häufig bessere Aufrüstbarkeit und Kühlung. Ein Laptop ist dafür mobiler. Die passende Wahl hängt von deinem Einsatz ab."],

        ["pc_bauen", "kann man einen pc selbst bauen|wie baut man einen gaming pc|pc selber zusammenbauen",
            "Ja! Ein PC besteht aus mehreren kompatiblen Komponenten. Wichtig sind insbesondere CPU-Sockel, Mainboard, RAM-Typ, Gehäuse und Netzteil."],

        ["pc_upgrade", "kann man einen pc aufrüsten|welche pc teile kann man wechseln|wie macht man ein upgrade",
            "Viele Komponenten lassen sich aufrüsten, darunter RAM, SSD und Grafikkarte. Bei CPU und Netzteil musst du besonders auf Kompatibilität achten."],

        ["cpu", "was macht eine cpu|was ist ein prozessor|wie funktioniert ein prozessor",
            "Die CPU verarbeitet Befehle und Berechnungen. Sie ist eine zentrale Komponente für Programme, Spiele und das Betriebssystem."],

        ["gpu", "was macht eine gpu|was ist eine grafikkarte|wie funktioniert eine gpu",
            "Die GPU berechnet Grafiken und kann viele Aufgaben parallel bearbeiten. Besonders bei 3D-Spielen ist sie wichtig."],

        ["ram", "wie viel ram ist gut|was ist besser 16 oder 32 gb ram|brauche ich 64 gb ram",
            "16 GB sind für viele Spiele ausreichend. 32 GB bieten mehr Spielraum für anspruchsvolle Spiele und Multitasking. Der Bedarf hängt von deinen Anwendungen ab."],

        ["ssd", "warum ist ssd schneller|was ist besser ssd oder hdd|welche ssd brauche ich",
            "SSDs sind normalerweise deutlich schneller als klassische HDDs. NVMe-SSDs bieten über PCIe besonders hohe Übertragungsgeschwindigkeiten."],

        ["temperatur", "warum wird hardware warm|wie heiß darf eine cpu werden|wie heiß darf eine grafikkarte werden",
            "Temperaturgrenzen hängen vom jeweiligen Modell ab. Prüfe die offiziellen Angaben des Herstellers und achte auf eine gute Kühlung."],

        ["monitor", "was ist hz beim monitor|was ist besser 60 oder 144 hz|was bedeutet bildwiederholrate",
            "Die Hertz-Zahl gibt an, wie oft ein Monitor sein Bild pro Sekunde aktualisieren kann. Höhere Werte können Bewegungen flüssiger darstellen."],

        ["internet", "wie funktioniert das internet|was ist das internet|wie kommen websites auf meinen pc",
            "Das Internet verbindet weltweit viele Netzwerke. Dein Browser fordert Daten von Servern an und stellt die empfangenen Inhalte dar."],

        ["wlan", "was ist wlan|wie funktioniert wlan|warum ist wlan langsam",
            "WLAN ermöglicht drahtlose Netzwerkverbindungen. Geschwindigkeit und Stabilität hängen unter anderem von Entfernung, Hindernissen und Störungen ab."],

        ["speicher", "was bedeutet gb|was ist ein terabyte|wie viel sind 1000 gb",
            "GB steht für Gigabyte und TB für Terabyte. Ein Terabyte entspricht im üblichen Dezimalsystem 1000 Gigabyte."],

        // Roblox und Kreativität
        ["roblox", "was ist roblox|warum ist roblox so beliebt|was kann man in roblox machen",
            "Roblox ist eine Plattform mit vielen unterschiedlichen Spielerlebnissen. Benutzer können Spiele spielen und mit Roblox Studio eigene Projekte erstellen."],

        ["roblox_spiele", "wie erstellt man ein roblox spiel|wie programmiert man in roblox|kann man roblox games verkaufen",
            "Mit Roblox Studio kannst du eigene Spiele entwickeln. Du kannst Welten gestalten, Luau-Skripte schreiben und Spielmechaniken programmieren."],

        ["roblox_tycoon", "was ist ein tycoon spiel|wie funktionieren tycoon games|was ist ein roblox tycoon",
            "Tycoon-Spiele drehen sich häufig um den Aufbau und die Verwaltung eines Unternehmens oder einer eigenen Basis. Spieler sammeln Ressourcen und kaufen Verbesserungen."],

        ["roblox_datastore", "was ist datastore|wie speichert roblox spielerdaten|wie speichert man geld in roblox",
            "DataStores ermöglichen es Roblox-Spielen, bestimmte Daten dauerhaft auf Roblox-Servern zu speichern, beispielsweise Fortschritt und Spielwährung."],

        ["roblox_script", "was ist ein script in roblox|wo schreibt man luau code|wie funktionieren roblox scripts",
            "Scripts enthalten Anweisungen für das Spiel. In Roblox Studio kannst du damit beispielsweise Buttons, Türen, Geldsysteme und Gegner programmieren."],

        ["kreativitaet", "wie wird man kreativer|wie bekommt man kreative ideen|ich habe keine ideen",
            "Kreativität lässt sich durch Ausprobieren, Beobachten und neue Erfahrungen fördern. Kleine Projekte sind ein guter Anfang."],

        ["game_idee", "gib mir eine spielidee|ich brauche eine idee für ein spiel|welches spiel soll ich entwickeln",
            "Wie wäre ein Survival-Spiel mit einer verlassenen Forschungsstation, Rätseln, Erkundung und einer geheimnisvollen Geschichte? Du kannst es in kleinen Schritten entwickeln."],

        ["projekt", "wie bleibe ich bei einem projekt motiviert|mein projekt ist zu groß|ich komme nicht weiter",
            "Teile dein Projekt in kleine Aufgaben auf. Setze dir erreichbare Zwischenziele und teste jede neue Funktion einzeln."],

        // Alltag und Freizeit
        ["wochenende", "was machst du am wochenende|was kann man am wochenende machen|hast du wochenendpläne",
            "Ich habe keine eigenen Wochenendpläne. Du könntest ein Spiel ausprobieren, ein kleines Programmierprojekt starten oder etwas mit Freunden unternehmen."],

        ["ferien", "was soll ich in den ferien machen|was kann man in den ferien unternehmen|ferien ideen",
            "Du könntest ein neues Spiel ausprobieren, etwas programmieren, kreativ werden, draußen unterwegs sein oder Zeit mit Freunden verbringen."],

        ["hobby", "welche hobbies gibt es|was sind gute hobbies|ich suche ein hobby",
            "Es gibt viele Möglichkeiten: Programmieren, Zeichnen, Sport, Musik, Fotografie, 3D-Modellierung, Gaming oder das Bauen eigener Projekte."],

        ["musik", "was ist deine lieblingsmusik|hörst du musik|welche musik ist gut|kennst du musik",
            "Ich höre selbst keine Musik, kann dir aber verschiedene Genres erklären oder bei der Suche nach Musikrichtungen helfen."],

        ["filme", "magst du filme|was ist dein lieblingsfilm|welche filme kennst du|empfiehl mir einen film",
            "Ich kann dir Filmgenres erklären und Empfehlungen nach deinen Vorlieben zusammenstellen. Ich habe selbst keine persönlichen Lieblingsfilme."],

        ["lesen", "liest du gerne|was ist dein lieblingsbuch|magst du bücher",
            "Ich lese keine Bücher wie ein Mensch, kann aber Buchinhalte zusammenfassen und verschiedene Genres vorstellen."],

        ["sport", "machst du sport|was ist dein lieblingssport|welcher sport ist gut",
            "Ich kann keinen Sport ausüben. Es gibt aber viele Möglichkeiten, aktiv zu sein, beispielsweise Fußball, Schwimmen, Radfahren oder Basketball."],

        ["essen", "was ist dein lieblingsessen|was isst du gerne|welches essen magst du",
            "Ich esse nichts, weil ich ein Programm bin. Ich kann dir aber Rezepte, Gerichte und verschiedene Küchen erklären."],

        ["morgen", "was soll ich morgen machen|hast du ideen für morgen|was kann ich morgen unternehmen",
            "Du könntest an deinem aktuellen Projekt weiterarbeiten, etwas Neues lernen oder Zeit mit Freunden verbringen."],

        ["motivation", "ich bin unmotiviert|ich habe keine motivation|wie bekomme ich motivation|ich habe keine lust",
            "Manchmal hilft es, mit einer sehr kleinen Aufgabe anzufangen. Du musst nicht alles auf einmal erledigen."],

        ["konzentration", "ich kann mich nicht konzentrieren|wie kann ich mich besser konzentrieren|ich bin abgelenkt",
            "Ein ruhiger Arbeitsplatz, kurze Pausen und kleine Aufgaben können helfen, die Konzentration zu verbessern."],

        ["stress", "ich habe zu viel stress|alles ist stressig|ich fühle mich überfordert|mir wächst alles über den kopf",
            "Das klingt anstrengend. Versuche, die Aufgaben zu sortieren und eine Sache nach der anderen anzugehen. Wenn dich der Stress stark belastet, kann ein Gespräch mit einer vertrauten Person helfen."],

        ["traurigkeit", "ich habe einen schlechten tag|heute läuft alles schief|ich bin enttäuscht|ich fühle mich allein",
            "Das tut mir leid. Du musst nicht alles sofort lösen. Vielleicht hilft es, mit einer Person zu sprechen, der du vertraust, oder dir etwas Zeit für dich zu nehmen."],

        ["angst", "ich habe angst|ich bin nervös|ich mache mir sorgen|ich habe vor etwas angst",
            "Es ist okay, manchmal Angst oder Sorgen zu haben. Versuche herauszufinden, was dich belastet. Ein Gespräch mit einer vertrauten Person kann ebenfalls helfen."],

        ["wut", "ich bin wütend|ich rege mich auf|ich bin sauer|ich habe schlechte laune",
            "Das klingt frustrierend. Eine kurze Pause kann helfen, etwas Abstand zu gewinnen. Wenn du möchtest, kannst du erzählen, was passiert ist."],

        ["freude", "ich habe etwas geschafft|ich bin stolz auf mich|heute war ein guter tag|ich habe gewonnen",
            "Das ist schön! Es ist gut, eigene Fortschritte wahrzunehmen. Was hast du geschafft?"],

        // Schule und Lernen
        ["schule", "magst du schule|was hältst du von schule|ist schule wichtig|warum muss man lernen",
            "Schule vermittelt Wissen und Fähigkeiten, die später in vielen Lebensbereichen nützlich sein können."],

        ["lernen", "wie lernt man am besten|wie kann ich besser lernen|lerntipps|ich muss lernen",
            "Teile den Stoff in kleine Abschnitte auf, wiederhole regelmäßig und versuche, Inhalte mit eigenen Worten zu erklären."],

        ["hausaufgaben", "wie mache ich meine hausaufgaben|ich habe viele hausaufgaben|hausaufgaben tipps",
            "Beginne mit einer überschaubaren Aufgabe und arbeite Schritt für Schritt. Bei schwierigen Aufgaben kann ich dir die Zusammenhänge erklären."],

        ["mathematik", "magst du mathematik|ist mathe schwer|wie wird man besser in mathe",
            "Mathematik wird oft leichter, wenn man Grundlagen versteht und regelmäßig Aufgaben übt."],

        ["englisch", "wie lerne ich englisch|wie kann ich mein englisch verbessern|englisch lernen tipps",
            "Lies einfache englische Texte, höre englische Inhalte und versuche regelmäßig, eigene Sätze zu formulieren."],

        ["deutsch", "wie verbessere ich mein deutsch|wie kann ich besser schreiben|deutsch lernen tipps",
            "Regelmäßiges Lesen, Schreiben und das Überarbeiten eigener Texte können helfen, den Wortschatz und die Grammatik zu verbessern."],

        ["franzoesisch", "wie lerne ich französisch|französisch lernen|wie kann ich französisch verbessern",
            "Beginne mit häufigen Wörtern und einfachen Sätzen. Regelmäßiges Wiederholen und lautes Üben helfen beim Lernen."],

        ["pruefung", "ich habe eine prüfung|ich bin aufgeregt vor einer klausur|wie bereite ich mich auf eine prüfung vor",
            "Erstelle einen kleinen Lernplan, wiederhole wichtige Inhalte und übe mit Beispielaufgaben. Plane auch genügend Pausen ein."],

        ["beruf", "welche berufe gibt es in der gaming branche|wie wird man spieleentwickler|was muss man für game development können",
            "In der Spielebranche gibt es viele Berufe: Programmierer, Game Designer, 3D Artist, Animator, Level Designer, Sound Designer und Tester."],

        ["zukunft_beruf", "kann ich später programmierer werden|wie wird man game developer|wie kommt man in die spieleentwicklung",
            "Eigene kleine Projekte sind ein guter Einstieg. Du kannst Programmierung, 3D-Modellierung und Game Design Schritt für Schritt lernen."],

        // Gespräche und Reaktionen
        ["frage", "ich habe eine frage an dich|darf ich etwas fragen|kann ich dich etwas fragen|eine kurze frage",
            "Natürlich! Frag einfach drauflos."],

        ["zustimmung", "das stimmt|genau so|da hast du recht|richtig|stimmt genau",
            "Schön, dass wir uns einig sind! Hast du noch eine Frage?"],

        ["widerspruch", "das sehe ich anders|ich bin anderer meinung|das glaube ich nicht|ich widerspreche dir",
            "Das ist völlig in Ordnung. Wir können verschiedene Sichtweisen vergleichen. Was ist deine Meinung dazu?"],

        ["verwirrung", "ich bin verwirrt|das ergibt keinen sinn|ich komme nicht mit|ich verstehe nur bahnhof",
            "Kein Problem. Ich kann es Schritt für Schritt und mit einem einfachen Beispiel erklären."],

        ["neugier", "ich möchte etwas lernen|erzähl mir etwas neues|ich bin neugierig|ich will mehr wissen",
            "Sehr gerne! Wir können über Gaming, Wissenschaft, Technik, Natur, Geschichte oder Programmierung sprechen."],

        ["unterhaltung", "unterhalte mich|mir ist langweilig was tun|lass uns reden|ich möchte quatschen",
            "Gerne! Wir können über Spiele, Technik, interessante Fakten oder lustige Fragen sprechen. Was interessiert dich gerade?"],

        ["thema", "wechseln wir das thema|lass uns über etwas anderes reden|anderes thema bitte",
            "Kein Problem! Wir können über Gaming, Technik, Wissenschaft, Schule oder Freizeit sprechen."],

        ["dankbarkeit", "vielen dank für deine hilfe|du hast mir echt geholfen|danke für alles|das hat geholfen",
            "Gern geschehen! Schön, dass die Erklärung hilfreich war."],

        ["begrüßung_zurueck", "ich bin wieder da|da bin ich wieder|bin zurück|ich bin zurück",
            "Willkommen zurück! Was möchtest du heute wissen?"],

        ["zeit", "wie lange reden wir schon|wie lange bist du online|seit wann bist du aktiv",
            "Ich habe keine eigene Online-Zeit wie ein Mensch. Ich antworte, wenn der Chat eine Nachricht erhält."],

        ["schweigen", "ich weiß nicht was ich sagen soll|mir fällt nichts ein|keine ahnung worüber reden",
            "Kein Problem! Wie wäre es mit einer Frage über dein Lieblingsspiel oder einem zufälligen Fun Fact?"],

        ["entscheidung_spiel", "horror oder action|minecraft oder roblox|pc oder konsole|singleplayer oder multiplayer",
            "Beide Möglichkeiten haben ihre Vorteile. Wenn du möchtest, vergleiche ich sie anhand von Grafik, Gameplay, Spielzeit und Anforderungen."],

        // DownloadGames
        ["store_frage", "was gibt es im store|was kann ich im store machen|wie funktioniert der store",
            "Im Store kannst du Spiele ansehen, nach Informationen suchen und verfügbare Spiele mit Punkten freischalten."],

        ["store_design", "wie findest du das design|gefällt dir das design der seite|wie sollte ein gaming store aussehen",
            "Ein guter Gaming-Store sollte übersichtlich sein, schnelle Suche, klare Spieleinformationen und einfache Navigation bieten."],

        ["store_suche", "ich finde ein spiel nicht|wo ist mein spiel|warum finde ich ein spiel nicht",
            "Nutze die Suchfunktion und probiere auch einen Teil des Spielnamens oder den Entwicklernamen aus."],

        ["store_wunsch", "welches spiel soll in den store|ich wünsche mir ein spiel|kannst du ein spiel hinzufügen",
            "Ich kann selbst keine Spiele hinzufügen. Du kannst deinen Vorschlag aber an den Betreiber von DownloadGames weitergeben."],

        ["store_preis", "warum kosten spiele punkte|wie werden spiele bepreist|wer legt die preise fest",
            "Die Preise beziehungsweise Punktewerte werden vom Betreiber der Website festgelegt."],

        ["store_vertrauen", "kann ich downloadgames vertrauen|ist der store sicher|ist die seite seriös",
            "Prüfe vor der Nutzung immer die Angaben des Betreibers, die Herkunft der Spiele und die Datenschutzinformationen. Verwende in einer Testversion keine echten Zahlungsdaten."],

        ["store_zukunft", "was wird aus downloadgames|wie soll downloadgames später aussehen|welche funktionen fehlen noch",
            "Mögliche Erweiterungen wären eine Wunschliste, bessere Filter, Nutzerprofile, eine Spielesammlung und eine zuverlässige serverseitige Speicherung."],

        ["store_idee", "ich habe eine idee für downloadgames|ich habe einen vorschlag|ich würde etwas ändern",
            "Interessant! Beschreibe deine Idee. Vielleicht lässt sie sich als neue Funktion umsetzen."],

        ["store_admin", "wer verwaltet downloadgames|wer ist für den shop verantwortlich|wer kümmert sich um die website",
            "Für die Verwaltung und Inhalte der Website ist der Betreiber verantwortlich."],

        // Technik und KI
        ["ollama_frage", "kannst du ollama erklären|wie funktioniert ollama|wo läuft ollama",
            "Ollama ist eine Plattform, mit der lokale Sprachmodelle auf einem Computer ausgeführt werden können."],

        ["qwen_frage", "was ist qwen3|kennst du qwen3|wie funktioniert qwen3",
            "Qwen3 ist eine Familie von Sprachmodellen, die unter anderem für Gespräche, Textverarbeitung und Programmieraufgaben eingesetzt werden kann."],

        ["ki_vs_mensch", "ist ki besser als menschen|kann ki menschen übertreffen|wer ist intelligenter ki oder mensch",
            "KI kann bei bestimmten Aufgaben sehr leistungsfähig sein. Menschen besitzen jedoch Erfahrungen, soziale Fähigkeiten und ein Verständnis der Welt, das sich nicht einfach mit einem Sprachmodell gleichsetzen lässt."],

        ["ki_internet", "hast du internetzugang|kannst du im internet suchen|kannst du aktuelle daten sehen",
            "Ob ich aktuelle Informationen abrufen kann, hängt davon ab, ob die entsprechende Suchfunktion oder ein Internetzugang für mein Modell eingerichtet ist."],

        ["ki_antwort", "warum antwortest du so schnell|wie erzeugst du antworten|wie verstehst du meine fragen",
            "Ich verarbeite deine Nachricht, erkenne sprachliche Muster und erzeuge eine passende Antwort auf Grundlage meiner verfügbaren Informationen."],

        ["ki_wissen", "woher hast du dein wissen|woher weißt du so viel|wie kennst du diese informationen",
            "Meine Antworten basieren auf den Informationen und Mustern, die mir beim Training beziehungsweise über die aktuelle Wissensdatenbank zur Verfügung stehen."],

        ["ki_datenschutz", "speicherst du meine nachrichten|liest jemand meine nachrichten|sind meine chats privat",
            "Wie Nachrichten gespeichert und verarbeitet werden, hängt von der technischen Einrichtung des Chat-Systems und dessen Datenschutzregeln ab. Teile keine sensiblen Daten."],

        // Zeit und Begrüßungen
        ["morgen_gruss", "guten morgen|morgen|schönen guten morgen",
            "Guten Morgen! Ich hoffe, du startest gut in den Tag. Was steht heute an?"],

        ["abend_gruss", "guten abend|einen schönen abend|schönen abend noch",
            "Guten Abend! Was möchtest du heute noch wissen?"],

        ["nachmittag", "guten nachmittag|schönen nachmittag",
            "Guten Nachmittag! Hast du heute schon etwas Interessantes gemacht?"],

        ["wochentag", "schönen montag|schönen dienstag|schönen mittwoch|schönen donnerstag|schönen freitag",
            "Danke! Ich wünsche dir ebenfalls einen schönen Tag."],

        ["feiertag", "frohe ostern|frohes fest|frohe weihnachten|guten rutsch",
            "Vielen Dank! Ich wünsche dir ebenfalls eine schöne Zeit."],

        // Weitere kurze Gesprächsantworten
        ["warte", "warte kurz|einen moment|sekunde|gleich wieder da",
            "Natürlich. Lass dir Zeit."],

        ["fertig", "ich bin fertig|das war alles|mehr nicht|keine weiteren fragen",
            "Alles klar! Ich wünsche dir noch einen schönen Tag und viel Spaß mit DownloadGames."],

        ["langweilig_antwort", "das ist langweilig|langweilige antwort|erzähl etwas spannenderes",
            "Dann versuchen wir etwas Interessanteres! Soll es ein Gaming-Fakt, ein Rätsel oder ein Witz sein?"],

        ["raetsel", "gib mir ein rätsel|stell mir ein rätsel|ich möchte ein rätsel lösen",
            "Hier ist ein Rätsel: Was hat Städte, aber keine Häuser, Wälder, aber keine Bäume und Flüsse, aber kein Wasser? Eine Karte!"],

        ["raetsel_antwort", "eine karte|landkarte|karte",
            "Richtig! Eine Landkarte zeigt Städte, Wälder und Flüsse, ohne dass diese wirklich darauf vorhanden sind."],

        ["kompliment_seite", "downloadgames ist cool|ich mag downloadgames|die website gefällt mir",
            "Danke für dein Feedback! Es ist schön, wenn dir die Website gefällt."],

        ["feedback", "ich möchte feedback geben|ich habe feedback|ich möchte etwas verbessern",
            "Gerne! Beschreibe, was dir gefällt oder was verbessert werden könnte."],

        ["hilfe_technik", "ich habe ein technisches problem|mein computer macht probleme|mein programm funktioniert nicht",
            "Beschreibe mir dein Problem und die genaue Fehlermeldung. Ich helfe dir Schritt für Schritt bei der Fehlersuche."],

        ["hilfe_code", "mein code funktioniert nicht|ich habe einen fehler im code|mein script geht nicht",
            "Schick mir den betroffenen Code und die Fehlermeldung. Ich kann dir erklären, wo das Problem liegt."],

        ["hilfe_website", "meine website funktioniert nicht|ich programmiere eine website|ich möchte eine website bauen",
            "Ich kann dir bei HTML, CSS, JavaScript und Node.js helfen. Beschreibe, welche Funktion du bauen möchtest."],

        ["hilfe_roblox", "mein roblox script funktioniert nicht|ich habe einen luau fehler|mein roblox spiel hat einen bug",
            "Schick mir den betroffenen Luau-Code und die Fehlermeldung aus dem Output-Fenster. Wir können den Fehler Schritt für Schritt suchen."],

        // Sichere Unterstützung bei schwierigen Gefühlen
        ["ueberforderung", "ich schaffe das nicht|mir ist alles zu viel|ich bin überfordert|ich weiß nicht weiter",
            "Das klingt gerade ziemlich viel. Du kannst versuchen, eine kleine Sache nach der anderen anzugehen. Wenn dich das stark belastet, sprich mit einer vertrauten Person."],

        ["einsamkeit", "niemand versteht mich|ich fühle mich allein|ich habe keine freunde|keiner hört mir zu",
            "Es kann schwer sein, sich unverstanden oder allein zu fühlen. Vielleicht gibt es eine Person, mit der du offen sprechen kannst, zum Beispiel aus deiner Familie, deinem Freundeskreis oder der Schule."],

        ["vertrauen_person", "wem kann ich vertrauen|mit wem soll ich reden|ich brauche jemanden zum reden",
            "Eine vertraute Person kann ein Familienmitglied, eine Lehrkraft, eine Schulsozialarbeiterin oder ein guter Freund sein. Du musst mit schwierigen Dingen nicht allein bleiben."],

        ["pause", "ich brauche eine pause|ich bin erschöpft|ich muss mich ausruhen",
            "Eine Pause ist völlig in Ordnung. Du kannst kurz etwas trinken, dich bewegen oder dich ausruhen. Danach geht es oft leichter weiter."],

        ["positiv", "ich bin stolz|ich habe etwas gelernt|ich habe mein ziel erreicht",
            "Das ist ein schöner Fortschritt! Es lohnt sich, solche Erfolge wahrzunehmen."],

        // Unterhaltung und kreative Ideen
        ["kreative_idee", "gib mir eine kreative idee|was könnte ich programmieren|ich will etwas neues erschaffen",
            "Wie wäre ein kleines eigenes Spiel, ein Quiz, ein interaktiver Spielekatalog oder ein einfacher KI-Assistent?"],

        ["quiz", "mach ein quiz|ich will ein quiz spielen|teste mein wissen",
            "Quizfrage: Welcher Planet ist der größte in unserem Sonnensystem? A: Erde, B: Jupiter, C: Mars. Was ist deine Antwort?"],

        ["quiz_antwort", "jupiter|antwort b|b ist richtig",
            "Richtig! Jupiter ist der größte Planet unseres Sonnensystems. Gut gemacht!"],

        ["zufall", "sag etwas zufälliges|irgendetwas|zufällige frage|überrasch mich mit etwas",
            "{{FACT}}"],

        ["ideen_spiel", "gib mir eine idee für ein horror spiel|erfinde ein spiel|ich brauche eine game idee",
            "Idee: Ein verlassenes Hotel mit mehreren Etagen, geheimnisvollen Rätseln, einer ungewöhnlichen Geschichte und einer Umgebung, die sich im Laufe des Spiels verändert."],

        ["weltall", "interessiert dich das weltall|was ist das weltall|erzähl etwas über das universum",
            "Das Universum enthält Milliarden von Galaxien mit unzähligen Sternen und Planeten. Wir kennen bisher nur einen kleinen Teil seiner Geheimnisse."],

        ["natur", "magst du tiere|was ist dein lieblingstier|erzähl etwas über tiere",
            "Tiere besitzen erstaunliche Fähigkeiten. Oktopusse haben beispielsweise drei Herzen und Fledermäuse können sich mithilfe von Echoortung orientieren."],

        ["geschichte", "magst du geschichte|erzähl etwas über geschichte|was ist früher passiert",
            "Geschichte ist spannend, weil sie zeigt, wie sich Gesellschaften, Technologien und Kulturen über viele Jahrhunderte verändert haben."],

        ["wissenschaft", "magst du wissenschaft|erzähl etwas wissenschaftliches|was ist wissenschaft",
            "Wissenschaft versucht, die Welt durch Beobachtung, Experimente und überprüfbare Erklärungen besser zu verstehen."]
     
    ];

    const CRISIS_TEXT = "Das klingt, als ginge es dir gerade sehr schlecht, und das nehme ich ernst. Bitte sprich jetzt mit jemandem: In Deutschland erreichst du die Telefonseelsorge kostenlos und rund um die Uhr unter 0800 111 0 111 oder 0800 111 0 222 (auch 116 123). Bei akuter Gefahr wähle bitte 112. Du musst da nicht allein durch.";

    /* =====================================
       TRAINING: erzeugt zehntausende Beispielsätze (Vorsilben, Nachsilben,
       Tippfehler) und lernt daraus einen Naive-Bayes-Textklassifikator
    ===================================== */

    const PER_CLASS = 420;

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
            ...SMALL.map(([id, cores, ans]) => ({ id, cores: cores.split("|"), ans: ans.split("|") })),
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
            for (let i = 0; i < PER_CLASS; i++) {
                let core = cores[i % cores.length];
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
            .replace(/geteilt durch|dividiert durch|durch/g, "/")
            .replace(/multipliziert mit|\bmal\b/g, "*")
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

        if (/(umbring|suizid|selbstmord|nicht mehr leben|sterben will|will sterben|moechte sterben|mich toeten|mir wehtun|mir weh tun|ritzen)/.test(n))
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
            try { localStorage.setItem(NAME_KEY, state.name); } catch { /* egal */ }
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

        if (
    t.length &&
    ranked[0].score >= 0.68 &&
    ranked[0].score - (ranked[1]?.score || 0) >= 0.12
)
            return { text: fillTemplate(ranked[0].e.a), score: ranked[0].score, suggestions: [] };

        if (state.lastGame && t.length === 1 && matchedIntents(t).length)
            return { text: gameAnswer([state.lastGame], t), score: 1, suggestions: [] };

        const nb = classify(ws);
        const M = MODEL;

        if (
    nb &&
    nb.p >= 0.82 &&
    (nb.unknown === 0 || nb.p >= 0.95) &&
    !(nb.words > 14 && nb.p < 0.95)
) {
            const c = M.classes[nb.top[0].ci];

            if (c.faq) return { text: fillTemplate(c.faq.a), score: nb.p, suggestions: [] };
            if (c.ans[0] === "CRISIS") return { text: CRISIS_TEXT, score: nb.p, suggestions: [] };
            if (c.ans[0] === "@REPEAT")
                return { text: state.lastBot ? "Gern nochmal:\n" + state.lastBot : "Ich habe noch nichts gesagt, das ich wiederholen könnte. Frag mich einfach etwas!", score: nb.p, suggestions: [], repeat: true };
            if (c.ans[0] === "@NAME")
                return { text: state.name ? `Du heißt ${state.name}.` : "Das weiß ich noch nicht. Sag mir einfach „Ich heiße …“, dann merke ich es mir.", score: nb.p, suggestions: [] };
            if (c.ans[0] === "@RPS") {
                state.rps = true;
                return { text: "Stein, Schere, Papier! Schreib Stein, Schere oder Papier, ich wähle auch eins. 😄", score: nb.p, suggestions: [] };
            }

            return { text: fillTemplate(pick(c.ans, c.id)), score: nb.p, suggestions: [] };
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
            gameAnswers: G().length * INTENTS.length
        };
    };

    globalThis.DGChat = { answer, stats, tokens, train, containsBadWord, _state: state };

    /* ---------- Chat-Fenster ---------- */

    if (typeof document === "undefined") return;

    function build() {
        if (document.getElementById("dgc-widget")) return;

        const style = document.createElement("style");
        style.textContent = `
#dgc-toggle{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:9;border-radius:24px;padding:12px 18px;box-shadow:0 8px 25px #0006}
#dgc-window{position:fixed;right:16px;bottom:calc(70px + env(safe-area-inset-bottom,0px));z-index:9;width:min(390px,calc(100vw - 32px));height:min(540px,72vh);background:var(--surface,#191b29);border:1px solid var(--border,#303249);border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 15px 45px #0008}
#dgc-window.dgc-hidden{display:none}
.dgc-head{padding:12px 14px;background:var(--surface-light,#222436);border-bottom:1px solid var(--border,#303249);display:flex;justify-content:space-between;align-items:center}
.dgc-head button{padding:4px 10px}
#dgc-log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.dgc-msg{max-width:90%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}
.dgc-user{align-self:flex-end;background:var(--primary,#7563ed)}
.dgc-bot{align-self:flex-start;background:var(--surface-light,#222436)}
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
<section id="dgc-window" class="dgc-hidden">
  <header class="dgc-head"><div><strong>DownloadGames AI</strong><br><small>Frag mich zu Spielen oder quatsch einfach mit mir</small></div>
  <button id="dgc-close" aria-label="Chat schließen">×</button></header>
  <div id="dgc-log"></div><div id="dgc-chips"></div>
  <form id="dgc-form"><input id="dgc-input" type="text" placeholder="Deine Frage …" maxlength="300" autocomplete="off"><button type="submit">➤</button></form>
  <a class="dgc-rules" href="richtlinien.html" target="_blank" rel="noopener">⚠️ Chat-Regeln &amp; Richtlinien</a>
</section>`;
        document.body.appendChild(widget);

        const win = document.getElementById("dgc-window");
        const log = document.getElementById("dgc-log");
        const chips = document.getElementById("dgc-chips");
        const input = document.getElementById("dgc-input");
        let busy = false;

        const sleep = ms => new Promise(r => setTimeout(r, ms));

        const add = (text, who) => {
            const m = document.createElement("div");
            m.className = "dgc-msg " + (who === "user" ? "dgc-user" : "dgc-bot");
            m.textContent = text;
            log.appendChild(m);
            log.scrollTop = log.scrollHeight;
            return m;
        };

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

        async function ask(question) {
            const q = String(question || "").trim();

            if (!q) return;

            // Prüfen, ob noch eine Sperre aktiv ist
            const banUntil = Number(localStorage.getItem(BAN_KEY) || 0);

            if (banUntil > Date.now()) {
                const remaining = Math.ceil((banUntil - Date.now()) / 1000);
                add(`Du bist vorübergehend gesperrt. Bitte warte noch ${Math.floor(remaining / 60)} Min. und ${remaining % 60} Sek.`, "bot");
                return;
            }

            // Alte Sperre entfernen
            if (banUntil) localStorage.removeItem(BAN_KEY);

            if (busy) return;

            add(q, "user");

            // Schimpfwörter erkennen
            if (containsBadWord(q)) {
                localStorage.setItem(BAN_KEY, String(Date.now() + BAN_DURATION));
                add("⚠️ Deine Nachricht enthält beleidigende oder unangemessene Wörter. Du wurdest für 10 Minuten vom DownloadGames-Chat ausgeschlossen.", "bot");
                setChips([]);
                return;
            }

            busy = true;
            remember("user", q);

            const r = answer(q);
            const wait = add("…", "bot");

            try {
                if (r.text) {
                    await sleep(Math.min(700, 250 + r.text.length * 3));
                    wait.textContent = r.text;
                    remember("assistant", r.text, r.repeat);
                    setChips([]);
                    return;
                }

                const res = await fetch("/api/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        message: q,
                        history: state.hist.slice(-9, -1),
                        userName: state.name || undefined,
                        games: G().map(g => ({
                            name: g.name, genre: g.genre, price: g.price, points: g.points,
                            developer: g.developer, description: String(g.description || "").slice(0, 1000),
                            requirements: g.requirements || {}
                        }))
                    })
                });

                let data = null;
                try { data = JSON.parse(await res.text()); } catch { /* keine JSON-Antwort */ }

                if (res.ok && data?.answer) {
                    wait.textContent = data.answer;
                    remember("assistant", data.answer);
                    setChips(r.suggestions.length ? r.suggestions : starters());
                } else {
                    throw new Error("keine Antwort");
                }
            } catch {
                const msg = r.suggestions.length
                    ? "Das habe ich nicht ganz verstanden. Meintest du vielleicht eine dieser Fragen?"
                    : "Dazu habe ich keine passende Antwort. Versuch es mit anderen Worten oder wähle eine Frage unten.";
                wait.textContent = msg;
                remember("assistant", msg);
                setChips(r.suggestions.length ? r.suggestions : starters());
            } finally {
                busy = false;
                log.scrollTop = log.scrollHeight;
            }
        }

        document.getElementById("dgc-toggle").onclick = () => {
            win.classList.toggle("dgc-hidden");
            if (!win.classList.contains("dgc-hidden")) input.focus();
        };
        document.getElementById("dgc-close").onclick = () => win.classList.add("dgc-hidden");
        document.getElementById("dgc-form").onsubmit = e => {
            e.preventDefault();
            const v = input.value;
            input.value = "";
            ask(v);
        };

        add(`Hallo${state.name ? ", " + state.name : ""}! Willkommen bei DownloadGames. Frag mich zu Spielen oder quatsch einfach mit mir.`, "bot");
        setChips(starters());

        setTimeout(train, 100);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
    else build();
})();