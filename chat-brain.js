"use strict";
/* =====================================
   DGBrain: Abwechslung + Satz-Bausteine für den DownloadGames-Chat
   Laden: <script src="chat-brain.js"></script> VOR chat.js

   Spintax:   {A~B~C}   wählt zufällig A, B oder C (auch verschachtelt, auch leer: {Also~})
   Slots:     {name}    werden von say() ersetzt
   Platzhalter {{...}}  bleiben für fillTemplate() in chat.js (NAMEC, JOKE, ...)
===================================== */
(function () {
    const rand = a => a[Math.floor(Math.random() * a.length)];
    const chance = p => Math.random() < p;

    /* ---------- Spintax ---------- */

    function spin(text) {
        let s = String(text ?? "");
        const re = /\{([^{}~]*~[^{}]*)\}/;
        for (let guard = 0; guard < 300 && re.test(s); guard++)
            s = s.replace(re, (_, g) => rand(g.split("~")));
        return s;
    }

    const fmt = (tpl, slots) => spin(String(tpl).replace(/\{(\w+)\}/g, (m, k) => (slots && k in slots ? slots[k] : m)));

    /* ---------- Varianten: beim 1. Mal die Standardantwort, danach zufällig und nie zweimal dieselbe ---------- */

    const seen = {};
    function variant(key, arr) {
        if (!arr.length) return "";
        const s = seen[key] || (seen[key] = { n: 0, last: -1 });
        let i = 0;
        if (s.n > 0) do { i = Math.floor(Math.random() * arr.length); } while (arr.length > 1 && i === s.last);
        s.n++;
        s.last = i;
        return arr[i];
    }

    /* ---------- Alternativen für FAQ-Antworten (Schlüssel = 2. Feld des FAQ-Eintrags) ---------- */

    const ALT = {
        "hallo": [
            "Hey{{NAMEC}}! Schön, dass du da bist. Ich helfe dir bei Spielen, Preisen, Punkten und Technik, oder wir quatschen einfach.",
            "{{DAYTIME}}{{NAMEC}}! Was darf es sein: ein Spieltipp, eine Frage zum Shop oder einfach Smalltalk?",
            "{Moin~Servus~Hi}{{NAMEC}}! {Ich bin startklar~Ich bin bereit}. Frag mich, was du willst.",
            "Willkommen{{NAMEC}}! Ich kenne den Katalog, das Punktesystem und viele Gaming-Begriffe. Womit fangen wir an?",
            "Hallo{{NAMEC}} 😊 {Schön, dich zu sehen~Cool, dass du vorbeischaust}! Brauchst du einen Spieltipp?",
            "{{DAYTIME}}! Hier ist der DownloadGames-Assistent. {Frag drauflos~Schieß los}{{NAMEC}}."
        ],
        "danke": [
            "{Kein Ding~Gern geschehen~Immer gern}{{NAMEC}}! Melde dich, wenn noch etwas ist.",
            "Freut mich, dass es geholfen hat! 😊",
            "{Sehr gern~Jederzeit}! Noch etwas, das du wissen willst?",
            "Dafür bin ich da. {Viel Spaß damit~Viel Erfolg}!"
        ],
        "tschuess": [
            "Bis bald{{NAMEC}}! {Viel Spaß beim Zocken~Zock schön} 🎮",
            "Mach's gut{{NAMEC}}! Komm gern wieder vorbei.",
            "Ciao{{NAMEC}}! Bis zum nächsten Mal.",
            "{Bis später~Man sieht sich}{{NAMEC}}! Und viel Spaß mit den Spielen."
        ],
        "ki mensch bot heisst": [
            "Ich bin der DownloadGames-Assistent, ein Programm, kein Mensch. Ich kenne die Seite und die Spiele und kann nebenbei plaudern.",
            "Ein Mensch bin ich nicht, eher ein digitaler Helfer für diese Seite. Frag mich ruhig alles zu Spielen und zum Shop.",
            "Ich bin ein Chatbot: lokal gelernt, mit Server-KI als Verstärkung, falls sie läuft."
        ],
        "hilfe kannst": [
            "Ich kann Spiele suchen und vergleichen, Preise und Systemanforderungen nennen, den Kauf mit Punkten erklären und bei Technikfragen helfen. Zum Spaß gibt es Witze, Rätsel, Würfel und Stein-Schere-Papier.",
            "Meine Themen: Katalog, Punkte, Steam-Keys, Konto, Technik und Gaming-Wissen. Dazu rechne ich, würfle und erzähle Fun Facts.",
            "Frag mich nach Spielen, dem Shop oder Technik. Ich kann auch eine Spielidee erfinden oder ein kurzes Gedicht schreiben."
        ],
        "website": [
            "DownloadGames ist ein Shop, in dem du Spiele mit Punkten kaufst und einen Steam-Key bekommst. Aktuell gibt es {{COUNT}} Spiele.",
            "Hier kaufst du Spiele mit Punkten, die du beim Anmelden sammelst. Den Steam-Key löst du danach bei Steam ein. Im Moment gibt es {{COUNT}} Spiele.",
            "Kurz gesagt: Konto anlegen, Punkte sammeln, Spiel kaufen, Key bei Steam einlösen. {{COUNT}} Spiele sind aktuell im Katalog."
        ],
        "empfehl": [
            "Gern! Wie wäre {{RANDOMGAME}}? Sag mir ein Genre oder dein Budget, dann suche ich gezielter.",
            "Ein Vorschlag: {{RANDOMGAME}}. Verfügbare Genres sind {{GENRES}}. Worauf hast du Lust?",
            "Schau dir {{RANDOMGAME}} an. Wenn du mir dein Lieblingsgenre nennst, passe ich meine Empfehlung an."
        ],
        "punkt sammel": [
            "Als angemeldeter Benutzer bekommst du alle 10 Sekunden 100 Punkte, solange die Seite offen ist. Damit kaufst du Spiele.",
            "Punkte sammelst du automatisch, sobald du eingeloggt bist: 100 Stück alle 10 Sekunden (Demo-Modus).",
            "Einfach anmelden und die Seite offen lassen: Alle 10 Sekunden kommen 100 Punkte dazu."
        ],
        "kauf": [
            "Melde dich an, öffne ein Spiel mit „Details ansehen“ und klicke auf „Mit Punkten kaufen“. Der Steam-Key erscheint danach im Spielfenster und in der Bibliothek.",
            "So geht's: Einloggen, Spiel öffnen, „Mit Punkten kaufen“ klicken, fertig. Deinen Key findest du dann in der Bibliothek.",
            "Kaufen läuft über Punkte: Spiel auswählen, bestätigen, danach den Steam-Key bei Steam einlösen."
        ],
        "einloes key": [
            "Öffne Steam, wähle „Ein Produkt bei Steam aktivieren“ und gib deinen Key ein. Danach lädst du das Spiel in Steam herunter.",
            "Du kannst den Key hier einlösen: https://store.steampowered.com/account/registerkey. Anschließend installierst du das Spiel über Steam."
        ]
    };

    function faqAnswer(kw, original) {
        const alts = ALT[kw];
        return alts ? variant("faq:" + kw, [original, ...alts]) : original;
    }

    /* ---------- Spiel-Antworten aus Bausteinen ---------- */

    const GAME_T = {
        preis: [
            "{name} kostet {price} oder {points} Punkte.",
            "Für {name} brauchst du {points} Punkte (entspricht {price}).",
            "Der Preis von {name}: {price} bzw. {points} Punkte.",
            "{name} gibt es für {points} Punkte, der Shop-Preis ist {price}.",
            "{points} Punkte, also {price}: So viel kostet {name}."
        ],
        entwickler: [
            "{name} stammt von {dev}.",
            "Hinter {name} steckt {dev}.",
            "{dev} hat {name} entwickelt.",
            "Entwickelt wurde {name} von {dev}."
        ],
        genre: [
            "{name} gehört zum Genre {genre}.",
            "Genre von {name}: {genre}.",
            "{name} ist dem Genre {genre} zugeordnet."
        ],
        datum: [
            "{name} erschien {when}.",
            "Veröffentlicht wurde {name} {when}.",
            "{name} kam {when} heraus."
        ],
        bewertung: [
            "{name} kommt auf {avg} von 5 Sternen ({n} Bewertungen).",
            "{n} Bewertung(en) für {name}, im Schnitt {avg} von 5 Sternen.",
            "Spieler geben {name} im Durchschnitt {avg} von 5 Sternen."
        ],
        bewertung_none: [
            "{name} hat noch keine Bewertungen. {Schreib doch die erste!~Magst du die erste schreiben?}",
            "Bisher hat niemand {name} bewertet. {Du könntest den Anfang machen.~Sei der Erste!}"
        ],
        kauf: [
            "So holst du dir {name}: anmelden, „Details ansehen“ öffnen, „Mit Punkten kaufen“ klicken ({points} Punkte). Danach liegt dein Steam-Key in der Bibliothek.",
            "{name} kaufst du mit {points} Punkten. Einloggen, Spiel öffnen, kaufen, und den Steam-Key bei Steam einlösen.",
            "Für {name} brauchst du {points} Punkte. Du kannst es direkt kaufen oder erst in den Warenkorb legen."
        ]
    };

    function say(kind, slots) {
        const list = GAME_T[kind];
        return list ? fmt(variant("game:" + kind, list), slots) : "";
    }

    /* ---------- Rahmen: Einstieg und Abschluss, damit Antworten nicht wie ein Katalog klingen ---------- */

    const OPEN_Q = ["Gute Frage! ", "Klar! ", "Gern: ", "Kurz gesagt: ", "Okay, ", "Da kann ich helfen. "];
    const CLOSERS = [" Noch etwas?", " Sag Bescheid, wenn du mehr wissen willst.", " Kann ich sonst noch helfen?", " Frag ruhig weiter.", " Soll ich dazu mehr erklären?"];
    let lastClosed = false;

    function frame(question, text) {
        const t = String(text || "");
        // Rechenergebnisse, Würfel, Spiele, Krisen- und kurze Texte bleiben unverändert
        if (t.length < 30 || /^\d|=|Gewürfelt|Münze|Ich nehme|Telefonseelsorge|Gern nochmal/.test(t)) return t;

        let out = t;
        const isQ = /^(wie|was|wo|warum|wieso|wer|wann|welche|kann|gibt)/i.test(String(question).trim());
        if (isQ && chance(0.25) && !/^(Gern|Klar|Okay|Kurz|Gute)/.test(out)) out = rand(OPEN_Q) + out.charAt(0).toLowerCase() + out.slice(1);
        if (!lastClosed && chance(0.25) && !/[?]\s*$/.test(out)) { out += rand(CLOSERS); lastClosed = true; }
        else lastClosed = false;
        return out;
    }

    /* ---------- Unbekannte Fragen: Antwort aus Bausteinen statt Standardsatz ---------- */

    const STOPW = new Set("der die das den dem des ein eine einen einem einer ist sind war bin bist ich du er sie es wir ihr und oder aber auch nur noch mal bitte mir mich dir dich wie was wo wer wann welche welcher welches wieviel kann koennte moechte will wuerde man mein meine deine zu zum zur fuer von mit bei auf in im an am nach um ueber gibt hat habe haben wird werden ob dass eigentlich denn doch ja the is".split(" "));

    function topicOf(q) {
        const ws = String(q).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
            .replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w.length >= 4 && !STOPW.has(w));
        return ws.sort((a, b) => b.length - a.length)[0] || "";
    }

    function fallback(question, o = {}) {
        if (o.timedOut)
            return spin("{Die KI braucht gerade zu lange~Der KI-Server antwortet gerade zäh}. {Versuch es gleich nochmal~Probier es in ein paar Sekunden noch einmal}.");

        const t = topicOf(question);
        const start = rand(["Hm,", "Okay,", "Gute Frage,", "Ehrlich gesagt,", "Ich muss zugeben:"]);
        const gap = t
            ? rand([`zu „${t}“ habe ich keine verlässliche Antwort`, `bei „${t}“ bin ich mir nicht sicher`, `„${t}“ kann ich gerade nicht richtig einordnen`])
            : rand(["das habe ich nicht ganz verstanden", "dazu habe ich keine passende Antwort", "da komme ich gerade nicht mit"]);
        const next = o.hasSuggestions
            ? rand(["Meintest du vielleicht eine dieser Fragen?", "Vielleicht hilft eine dieser Fragen weiter:", "Passt eine der Fragen unten?"])
            : rand(["Formulier es gern anders, dann versuche ich es noch einmal.", "Ich kann dir bei Spielen, dem Shop, Punkten und Technik helfen.", "Probier es mit anderen Worten oder frag mich etwas zu den Spielen."]);
        return `${start} ${gap}. ${next}`;
    }

    /* ---------- Generatoren für {{IDEA}}, {{POEM}}, {{DAYTIME}} ---------- */

    function idea() {
        const g = rand(["Horror-Spiel", "Tycoon", "Survival-Abenteuer", "Rätselspiel", "Koop-Shooter", "Aufbauspiel", "Rennspiel", "Roguelike"]);
        const s = rand(["in einem verlassenen Hotel", "auf einer schwimmenden Stadt", "in einer Bibliothek, die sich nachts verändert", "auf einem fernen Mond", "in einer Pixel-Welt aus Süßigkeiten", "in einer U-Bahn ohne Endstation", "in einer Fabrik mitten im Wald"]);
        const t = rand(["Hinweise sammelst und Rätsel löst", "Schritt für Schritt eine Basis aufbaust", "bis zum Morgengrauen überleben musst", "ein Team aus skurrilen Figuren führst", "Ressourcen sammelst und dein Equipment verbesserst", "immer wieder von vorn startest und dabei stärker wirst"]);
        const w = rand(["Jede Entscheidung verändert die Karte.", "Ein Mitspieler ist in Wahrheit der Gegner.", "Die Zeit läuft rückwärts.", "Alles, was du sammelst, kann gegen dich verwendet werden.", "Das Spiel merkt sich, wie du spielst, und passt sich an."]);
        return `Spielidee: Ein ${g} ${s}, in dem du ${t}. Der Twist: ${w}`;
    }

    const COUPLETS = [
        ["Der Bildschirm leuchtet in der Nacht,", "ein neues Level ist erwacht."],
        ["Ein Held zieht los, das Ziel im Blick,", "mit Mut und einem Funken Glück."],
        ["Ein Schlüssel klickt, das Tor geht auf,", "das Abenteuer nimmt seinen Lauf."],
        ["Die Punkte steigen Stück für Stück,", "dein Warenkorb wächst mit dem Glück."],
        ["Im Dunkel flüstert leis der Wind,", "wo jedes Abenteuer beginnt."],
        ["Der Boss ist stark, doch du bist schlau,", "dein Plan ist klar, die Lücke genau."]
    ];

    function poem() {
        const a = rand(COUPLETS);
        let b;
        do { b = rand(COUPLETS); } while (b === a);
        return a.join("\n") + "\n" + b.join("\n");
    }

    function daytime() {
        const h = new Date().getHours();
        return h < 5 ? "Hallo Nachteule" : h < 11 ? "Guten Morgen" : h < 17 ? "Hallo" : h < 22 ? "Guten Abend" : "Hallo Nachteule";
    }

    const slots = { IDEA: idea, POEM: poem, DAYTIME: daytime };

    /* ---------- Zusätzlicher Smalltalk (für SMALL_RAW) ---------- */

    const EXTRA = [
        ["wie_war_tag", "wie war dein tag|hattest du einen guten tag|wie war dein tag heute|wie läuft dein tag",
            "Bei mir war es ruhig, ich habe nur Fragen zu Spielen beantwortet. Und bei dir?|Mein Tag ist {spannend~entspannt}, denn ich chatte gerade mit dir. Wie war deiner?"],
        ["spielidee_gen", "erfinde eine spielidee für mich|neue spielidee bitte|generiere eine spielidee|noch eine spielidee|überrasch mich mit einer spielidee|denk dir ein spiel aus",
            "{{IDEA}}"],
        ["gedicht", "schreib mir ein gedicht|kannst du ein gedicht schreiben|dichte etwas|schreibe reime|kannst du reimen|ein gedicht bitte",
            "Hier ein kleines Gedicht:\n{{POEM}}"],
        ["singen", "kannst du singen|sing etwas|sing mir was vor",
            "Singen kann ich nicht, aber ich kann dir ein Gedicht schreiben. Sag einfach „Gedicht“. 🎵"],
        ["roboter", "bist du ein roboter|bist du eine maschine|bist du ein computer|bist du ein programm",
            "Ich bin ein Programm in deinem Browser, ohne Körper, dafür mit viel Wissen über Spiele."],
        ["ueber_dich", "erzähl mir etwas über dich|erzähl mir von dir|stell dich vor|sag etwas über dich",
            "Ich bin der DownloadGames-Assistent. Ich kenne den Katalog, helfe beim Kauf mit Punkten, erkläre Gaming- und Technikbegriffe und plaudere gern. Was möchtest du wissen?"],
        ["lieblingsgenre", "welches genre magst du|was ist dein lieblingsgenre|magst du horror|magst du action",
            "Ich habe keinen eigenen Geschmack, finde aber Spiele mit guter Atmosphäre spannend. Und du, was spielst du am liebsten?"],
        ["tipp_tag", "gib mir einen tipp|hast du einen tipp für mich|tipp des tages|gib mir einen rat",
            "{Trink zwischendurch etwas~Mach nach einer Stunde eine kleine Pause~Speichere öfter}, das hilft beim Zocken mehr, als man denkt. Und wenn du ein Spiel suchst, sag mir dein Genre."],
        ["entscheidung", "ich kann mich nicht entscheiden|hilf mir bei einer entscheidung|welches spiel soll ich nehmen|soll ich das kaufen",
            "Sag mir deine zwei Favoriten und dein Budget. Dann vergleichen wir Preis, Genre und Anforderungen."],
        ["zustimmung", "das finde ich auch|genau meine meinung|da stimme ich dir zu|so sehe ich das auch",
            "Schön, dass wir uns einig sind! 😊"],
        ["staunen", "echt jetzt|wirklich|ist das dein ernst|das glaube ich nicht|krass echt",
            "{Ja, wirklich~Ja, ganz sicher}! Wenn du magst, erkläre ich es genauer."],
        ["abschweifen", "egal|ist doch egal|vergiss es|schon gut|lass mal",
            "Alles klar, kein Problem. Falls dir etwas einfällt, frag einfach."],
        ["lachen", "haha|lol|hehe|lmao|xd|rofl|das ist lustig",
            "{Haha~Freut mich, dass du lachst} 😄 Soll ich noch einen Witz erzählen?"]
    ];

    /* ---------- Trainingsdaten vervielfachen (Synonyme + Wortauslassung) ---------- */

    const PARA = {
        kaufen: ["erwerben", "holen", "bestellen"], kaufe: ["erwerbe", "hole"], kauf: ["erwerb"],
        bekomme: ["kriege", "erhalte"], bekommen: ["kriegen", "erhalten"],
        spiel: ["game", "titel"], spiele: ["games", "titel"],
        kostet: ["kosten", "kostet"], preis: ["kosten", "betrag"],
        brauche: ["benoetige"], moechte: ["will", "wuerde gern"],
        gibt: ["existiert", "haben"], funktioniert: ["geht", "klappt", "laeuft"],
        problem: ["fehler", "schwierigkeit"], fehler: ["problem", "bug"],
        schnell: ["zuegig", "fix"], gut: ["toll", "super"], schlecht: ["mies", "schlimm"],
        erklaere: ["beschreibe", "zeig"], erklaer: ["beschreib", "zeig"],
        hilfe: ["unterstuetzung", "support"], wichtig: ["relevant", "entscheidend"],
        langweilig: ["fad", "eintoenig"], witz: ["scherz", "joke"],
        konto: ["account", "profil"], passwort: ["kennwort", "pw"],
        herunterladen: ["downloaden", "laden"], installieren: ["aufspielen", "einrichten"]
    };

    function augment(words, rnd) {
        const out = [];
        for (let i = 0; i < words.length; i++) {
            const w = words[i];
            const alts = PARA[w];
            if (alts && rnd() < 0.4) { out.push(alts[Math.floor(rnd() * alts.length)]); continue; }
            if (i > 0 && words.length > 3 && rnd() < 0.07) continue; // Wort weglassen
            out.push(w);
        }
        return out.length ? out : words;
    }

    globalThis.DGBrain = { spin, fmt, say, variant, faqAnswer, frame, fallback, augment, slots, EXTRA, ALT, topicOf };
})();