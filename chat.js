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
        ["welche version hat das spiel|wird das spiel aktualisiert|versionsnummer", "version", "Wenn eine Version eingetragen ist, steht sie im Spielfenster unter dem Titel."]
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
        "Warum nehmen Geister keine Bahn? Weil sie lieber durch die Wand gehen. 👻",
        "Was sagt ein Gamer, der Hunger hat? „Ich brauche ein Health-Pack.“",
        "Warum lügen Skelette nie? Weil man direkt durch sie hindurchsieht.",
        "Wie nennt man einen Bumerang, der nicht zurückkommt? Stock.",
        "Warum ging der Computer zum Arzt? Er hatte einen Virus.",
        "Ich wollte einen Witz über UDP erzählen, aber ich weiß nicht, ob er ankommt.",
        "Warum sind Programmierer so schlecht im Camping? Wegen der vielen Bugs.",
        "Treffen sich zwei Pixel. Sagt der eine: „Du siehst heute gut aufgelöst aus.“",
        "Warum verlor der Gamer seinen Job? Er war zu oft AFK.",
        "Was ist grün und klopft an die Tür? Ein Klopfsalat."
    ];

    const FACTS = [
        "Pong kam 1972 heraus und gilt als eines der ersten kommerziell erfolgreichen Videospiele.",
        "Minecraft ist mit weit über 300 Millionen verkauften Exemplaren das meistverkaufte Videospiel aller Zeiten.",
        "Tetris wurde 1984 von Alexei Paschitnow in Moskau entwickelt.",
        "Das erste bekannte Easter Egg in einem Videospiel steckt in „Adventure“ für den Atari 2600 (1979).",
        "Super Mario hieß in der Entwicklung ursprünglich „Jumpman“.",
        "Ein Oktopus hat drei Herzen.",
        "Das Wort „Roboter“ stammt aus dem Tschechischen: „robota“ bedeutet Frondienst.",
        "Der erste „Bug“ war 1947 angeblich eine echte Motte in einem Relais des Computers Harvard Mark II.",
        "Bananen sind botanisch Beeren, Erdbeeren dagegen nicht.",
        "Pac-Man erschien 1980 und sollte ein Spiel sein, das auch Menschen gefällt, die keine Ballerspiele mögen."
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

        if (t.length && ranked[0].score >= 0.5)
            return { text: fillTemplate(ranked[0].e.a), score: ranked[0].score, suggestions: [] };

        if (state.lastGame && t.length === 1 && matchedIntents(t).length)
            return { text: gameAnswer([state.lastGame], t), score: 1, suggestions: [] };

        const nb = classify(ws);
        const M = MODEL;

        if (nb && nb.p >= 0.6 && (nb.unknown === 0 || nb.p >= 0.9) && !(nb.words > 14 && nb.p < 0.95)) {
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