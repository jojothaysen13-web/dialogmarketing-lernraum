/* Dialogmarketing Lernraum – application logic */
(function () {
  "use strict";

  const C = window.LR_CONTENT;
  const KEY = "dm-lernraum-v1";
  const ATTEMPT_KEY = "dm-lernraum-attempt";
  const TYPE_LABELS = { klausur: "Klausur", test: "Test", abgabe: "Abgabe", sonstiges: "Sonstiges" };
  const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
  const DAYS_SHORT = ["Mo","Di","Mi","Do","Fr","Sa","So"];
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  let state = loadState();
  let calCursor = startOfMonth(new Date());
  let selectedDay = isoDate(new Date());
  let editingEventId = null;
  let modal = null;

  /* ---------- storage ---------- */
  function defaultState() {
    return { events: [], progress: {}, mistakes: [] };
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      const s = JSON.parse(raw);
      if (!Array.isArray(s.events)) s.events = [];
      if (!s.progress || typeof s.progress !== "object") s.progress = {};
      if (!Array.isArray(s.mistakes)) s.mistakes = [];
      return s;
    } catch (e) {
      return defaultState();
    }
  }
  function saveState() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }
  function loadAttempt() {
    try { return JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) || "null"); }
    catch (e) { return null; }
  }
  function saveAttempt(a) {
    if (!a) sessionStorage.removeItem(ATTEMPT_KEY);
    else sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(a));
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function parseISO(iso) {
    const [y, m, day] = iso.split("-").map(Number);
    return new Date(y, m - 1, day);
  }
  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }
  function daysUntil(iso) {
    const t = startOfDay(new Date());
    const d = startOfDay(parseISO(iso));
    return Math.round((d - t) / 86400000);
  }
  function fmtDate(isoOrDate) {
    const d = typeof isoOrDate === "string" ? parseISO(isoOrDate) : isoOrDate;
    return d.getDate() + ". " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }
  function fmtDateShort(iso) {
    const d = parseISO(iso);
    return String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + ".";
  }
  function weekdayShort(iso) {
    const d = parseISO(iso);
    return DAYS_SHORT[(d.getDay() + 6) % 7];
  }
  function countdownLabel(iso) {
    const n = daysUntil(iso);
    if (n < 0) return { text: "überfällig seit " + Math.abs(n) + " Tag" + (Math.abs(n) === 1 ? "" : "en"), cls: "overdue" };
    if (n === 0) return { text: "heute", cls: "today" };
    if (n === 1) return { text: "noch 1 Tag", cls: "soon" };
    if (n <= 7) return { text: "noch " + n + " Tage", cls: "soon" };
    return { text: "noch " + n + " Tage", cls: "ok" };
  }
  function fmtPts(n) { return Number(n).toFixed(2).replace(".", ","); }
  function uid() {
    return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function courseById(id) { return C.courses.find(function (c) { return c.id === id; }); }
  function quizById(id) { return C.quizzes.find(function (q) { return q.id === id; }); }
  function quizzesFor(courseId) { return C.quizzes.filter(function (q) { return q.courseId === courseId; }); }
  function courseColor(id) {
    const c = courseById(id);
    return c ? c.color : "#6a737b";
  }
  function eventsOn(iso) {
    return state.events.filter(function (e) { return e.date === iso; })
      .sort(function (a, b) { return (a.time || "99:99").localeCompare(b.time || "99:99"); });
  }
  function upcomingEvents() {
    const today = isoDate(new Date());
    return state.events.slice()
      .filter(function (e) { return e.date >= today; })
      .sort(function (a, b) { return (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")); });
  }
  function eventById(id) { return state.events.find(function (e) { return e.id === id; }); }

  function courseProgress(courseId) {
    const p = state.progress[courseId] || { cards: {}, quizBest: {} };
    const cards = C.cards[courseId] || [];
    const quizzes = quizzesFor(courseId);
    let cardPart = 0;
    if (cards.length) {
      const seen = cards.filter(function (c) { return p.cards && p.cards[c.id]; }).length;
      cardPart = seen / cards.length;
    }
    let quizPart = 0;
    if (quizzes.length) {
      let sum = 0;
      quizzes.forEach(function (q) {
        const best = p.quizBest && p.quizBest[q.id];
        sum += best && best.total ? (best.score / best.total) : 0;
      });
      quizPart = sum / quizzes.length;
    }
    const pct = Math.round(((cardPart * 0.4) + (quizPart * 0.6)) * 100);
    return { pct: pct, cards: cards.length, quizzes: quizzes.length };
  }

  function studyPlan(ev) {
    if (ev.type !== "klausur") return null;
    const course = ev.courseId ? courseById(ev.courseId) : null;
    const label = course ? course.short : "das betroffene Lernfeld";
    const n = daysUntil(ev.date);
    const start = addDays(parseISO(ev.date), -14);
    if (n > 14) {
      return "Lernplan-Vorschlag: Ab dem " + fmtDate(start) + " (14 Tage vorher) täglich das Quiz zu " + label + " üben.";
    }
    if (n >= 0) {
      return "Lernplan-Vorschlag: Bis zur Klausur täglich das Quiz zu " + label + " üben.";
    }
    return null;
  }

  function icsEscape(s) {
    return String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }
  function foldIcs(line) {
    var out = "";
    while (line.length > 73) {
      out += line.slice(0, 73) + "\r\n ";
      line = line.slice(73);
    }
    return out + line;
  }
  function eventsToIcs(events) {
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Dialogmarketing Lernraum//DE",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH"
    ];
    events.forEach(function (ev) {
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      const dateCompact = ev.date.replace(/-/g, "");
      lines.push("BEGIN:VEVENT");
      lines.push("UID:" + ev.id + "@lernraum");
      lines.push("DTSTAMP:" + stamp);
      if (ev.time) {
        const t = ev.time.replace(":", "") + "00";
        lines.push("DTSTART:" + dateCompact + "T" + t);
        const [hh, mm] = ev.time.split(":").map(Number);
        const end = new Date(2000, 0, 1, hh, mm);
        end.setHours(end.getHours() + 1);
        const et = String(end.getHours()).padStart(2, "0") + String(end.getMinutes()).padStart(2, "0") + "00";
        lines.push("DTEND:" + dateCompact + "T" + et);
      } else {
        lines.push("DTSTART;VALUE=DATE:" + dateCompact);
        const next = isoDate(addDays(parseISO(ev.date), 1)).replace(/-/g, "");
        lines.push("DTEND;VALUE=DATE:" + next);
      }
      const title = (TYPE_LABELS[ev.type] ? TYPE_LABELS[ev.type] + ": " : "") + ev.title;
      lines.push(foldIcs("SUMMARY:" + icsEscape(title)));
      var desc = ev.note || "";
      const course = ev.courseId ? courseById(ev.courseId) : null;
      if (course) desc = (desc ? desc + "\n" : "") + "Kurs: " + course.title;
      const plan = studyPlan(ev);
      if (plan) desc = (desc ? desc + "\n" : "") + plan;
      if (desc) lines.push(foldIcs("DESCRIPTION:" + icsEscape(desc)));
      if (course) lines.push(foldIcs("CATEGORIES:" + icsEscape(course.short)));
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }
  function downloadIcs(events, filename) {
    const blob = new Blob([eventsToIcs(events)], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || "termine.ics";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- icons ---------- */
  function ico(d, size) {
    size = size || 18;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>";
  }
  const I = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    home: '<path d="M3 11.5L12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/>',
    dash: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    repeat: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22V15"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
    quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 114 2c-.6.6-1.5 1-1.5 2"/><path d="M12 17h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevronL: '<path d="M15 18l-6-6 6-6"/>',
    chevronR: '<path d="M9 18l6-6-6-6"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
    blocks: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16"/>'
  };

  /* ---------- routing ---------- */
  function parseRoute() {
    var hash = (location.hash || "#/dashboard").replace(/^#/, "");
    if (!hash || hash === "/") hash = "/dashboard";
    var parts = hash.split("/").filter(Boolean);
    var route = { name: parts[0] || "dashboard", parts: parts, params: {} };
    if (parts[0] === "course" && parts[1]) {
      route.name = "course";
      route.params.id = parts[1];
      route.params.section = parts[2] || "overview";
    }
    if (parts[0] === "quiz" && parts[1]) {
      route.name = "quiz";
      route.params.quizId = parts[1];
      route.params.mode = parts[2] || "intro";
    }
    return route;
  }
  function go(path) {
    if (!path.startsWith("#")) path = "#" + path;
    if (location.hash === path) render();
    else location.hash = path;
  }

  /* ---------- layout ---------- */
  function navActive(href, route) {
    var p = href.replace("#", "");
    if (p === "/dashboard") return route.name === "dashboard";
    if (p === "/home") return route.name === "home";
    if (p === "/courses") return route.name === "courses" || route.name === "course";
    if (p === "/calendar") return route.name === "calendar";
    if (p === "/review") return route.name === "review";
    if (p === "/training") return route.name === "training";
    return false;
  }

  function renderShell(route, mainHtml, crumbs, title, extras) {
    extras = extras || {};
    var showRight = extras.right !== false && (route.name === "dashboard" || route.name === "calendar" || route.name === "home");
    document.body.classList.toggle("drawer-left-open", extras.left !== false);
    document.body.classList.toggle("drawer-right-open", showRight && window.innerWidth >= 992);

    var primary = [
      ["#/home", "Startseite"],
      ["#/dashboard", "Dashboard"],
      ["#/courses", "Meine Kurse"],
      ["#/calendar", "Kalender"]
    ];
    var nav = primary.map(function (it) {
      return '<li><a href="' + it[0] + '"' + (navActive(it[0], route) ? ' class="active"' : "") + ">" + it[1] + "</a></li>";
    }).join("");

    var drawerItems = [
      ["#/dashboard", I.dash, "Dashboard"],
      ["#/courses", I.book, "Meine Kurse"],
      ["#/calendar", I.cal, "Kalender"],
      ["#/review", I.repeat, "Fehler wiederholen"],
      ["#/training", I.flag, "Prüfungstraining"]
    ];
    var dnav = drawerItems.map(function (it) {
      return '<li><a href="' + it[0] + '"' + (navActive(it[0], route) ? ' class="active"' : "") + ">" + ico(it[1]) + " " + it[2] + "</a></li>";
    }).join("");
    var courseLinks = C.courses.map(function (c) {
      var act = route.name === "course" && route.params.id === c.id ? ' class="active indent"' : ' class="indent"';
      var navLabel = ({ lf5: "Beschwerde & Zahlung", lf6: "Markt und Preisbildung", lf8: "Kaufvertragsstörungen", lf9: "Projektmanagement" })[c.id] || c.short;
      return '<li><a href="#/course/' + c.id + '"' + act + '><span class="lr-dot" style="background:' + c.color + '"></span>' + esc(c.short) + " · " + esc(navLabel) + "</a></li>";
    }).join("");

    var crumbHtml = (crumbs || []).map(function (cr, i, arr) {
      if (i < arr.length - 1 && cr.href) return "<li><a href=\"" + cr.href + "\">" + esc(cr.label) + "</a></li>";
      return "<li>" + esc(cr.label) + "</li>";
    }).join("");

    document.getElementById("app").innerHTML =
      '<header class="lr-navbar">' +
        '<button type="button" class="lr-nav-toggle" data-act="toggle-left" aria-label="Navigation öffnen">' + ico(I.menu, 22) + "</button>" +
        '<a class="lr-sitename" href="#/home">' + esc(C.siteName) + "</a>" +
        '<ul class="lr-primary-nav">' + nav + "</ul>" +
        '<div class="lr-nav-right">' +
          '<button type="button" class="lr-nav-toggle" data-act="toggle-right" aria-label="Blöcke">' + ico(I.blocks, 20) + "</button>" +
          '<span class="lr-avatar" title="Jonathan">JT</span>' +
        "</div>" +
      "</header>" +
      '<div class="lr-dim dim-left" data-act="close-left"></div>' +
      '<div class="lr-dim dim-right" data-act="close-right"></div>' +
      '<aside class="lr-drawer lr-drawer-left" id="drawer-left">' +
        '<div class="lr-drawer-section">Navigation</div>' +
        '<ul class="lr-drawer-nav">' + dnav + "</ul>" +
        '<div class="lr-drawer-section">Kursindex</div>' +
        '<ul class="lr-drawer-nav">' + courseLinks + "</ul>" +
      "</aside>" +
      '<aside class="lr-drawer lr-drawer-right" id="drawer-right">' + renderRightBlocks(route) + "</aside>" +
      '<div id="page">' +
        '<div id="page-header">' +
          '<ul class="lr-breadcrumb">' + crumbHtml + "</ul>" +
          "<h1>" + esc(title) + "</h1>" +
        "</div>" +
        '<div id="page-content">' + mainHtml + "</div>" +
        '<footer class="lr-footer">Design basiert auf Moodle (GPLv3)</footer>' +
      "</div>" +
      '<div id="modal-host"></div>';
  }

  function renderRightBlocks(route) {
    return blockTimeline() + blockCalendar(route.name === "calendar");
  }

  function blockTimeline() {
    const evs = upcomingEvents().slice(0, 8);
    var body;
    if (!evs.length) {
      body = '<div class="lr-empty"><p>Trage deine erste Klausur ein.</p>' +
        '<button type="button" class="btn btn-primary btn-sm" data-act="event-new">Termin anlegen</button></div>';
    } else {
      body = evs.map(function (ev) {
        const cd = countdownLabel(ev.date);
        const course = ev.courseId ? courseById(ev.courseId) : null;
        const plan = studyPlan(ev);
        return '<div class="timeline-item">' +
          '<div class="timeline-date"><span class="day">' + fmtDateShort(ev.date) + "</span>" + weekdayShort(ev.date) +
            (ev.time ? "<br>" + esc(ev.time) : "") + "</div>" +
          '<div class="timeline-body">' +
            '<div class="title"><span class="event-type ' + esc(ev.type) + '">' + esc(TYPE_LABELS[ev.type] || ev.type) + "</span> " + esc(ev.title) + "</div>" +
            '<div class="meta">' + (course ? esc(course.short) + " · " : "") +
              '<span class="countdown ' + cd.cls + '">' + cd.text + "</span></div>" +
            (plan ? '<div class="study-plan">' + esc(plan) + "</div>" : "") +
          "</div></div>";
      }).join("");
    }
    return '<section class="block"><div class="block-header">Zeitleiste</div><div class="block-body">' + body + "</div></section>";
  }

  function blockCalendar(isLarge) {
    return '<section class="block"><div class="block-header">Kalender</div><div class="block-body">' +
      calendarHtml(calCursor, isLarge ? "cal-large" : "") + "</div></section>";
  }

  function calendarHtml(monthDate, extraClass) {
    const y = monthDate.getFullYear();
    const m = monthDate.getMonth();
    const first = new Date(y, m, 1);
    const startIdx = (first.getDay() + 6) % 7;
    const daysIn = new Date(y, m + 1, 0).getDate();
    const prevDays = new Date(y, m, 0).getDate();
    const today = isoDate(new Date());
    var cells = [];
    var i;
    for (i = 0; i < startIdx; i++) {
      const d = prevDays - startIdx + 1 + i;
      const iso = isoDate(new Date(y, m - 1, d));
      cells.push(calCell(iso, d, true, extraClass, today));
    }
    for (i = 1; i <= daysIn; i++) {
      const iso = isoDate(new Date(y, m, i));
      cells.push(calCell(iso, i, false, extraClass, today));
    }
    while (cells.length % 7) {
      const d = cells.length - (startIdx + daysIn) + 1;
      const iso = isoDate(new Date(y, m + 1, d));
      cells.push(calCell(iso, d, true, extraClass, today));
    }
    var rows = "";
    for (i = 0; i < cells.length; i += 7) rows += "<tr>" + cells.slice(i, i + 7).join("") + "</tr>";
    const title = MONTHS[m] + " " + y;
    return '<div class="cal-nav">' +
      '<button type="button" data-act="cal-prev" aria-label="Vorheriger Monat">' + ico(I.chevronL, 18) + "</button>" +
      "<h3>" + title + "</h3>" +
      '<button type="button" data-act="cal-next" aria-label="Nächster Monat">' + ico(I.chevronR, 18) + "</button>" +
      "</div>" +
      '<table class="cal-table ' + (extraClass || "") + '"><thead><tr>' +
      DAYS_SHORT.map(function (d) { return "<th>" + d + "</th>"; }).join("") +
      "</tr></thead><tbody>" + rows + "</tbody></table>";
  }

  function calCell(iso, num, muted, extraClass, today) {
    const evs = eventsOn(iso);
    var cls = muted ? "muted" : "";
    if (iso === today) cls += " today";
    if (iso === selectedDay) cls += " selected";
    var marks;
    if (extraClass === "cal-large") {
      marks = evs.length ? '<div class="cal-pills">' + evs.slice(0, 3).map(function (e) {
        return '<div class="cal-pill" style="background:' + courseColor(e.courseId) + '">' + esc(e.title) + "</div>";
      }).join("") + (evs.length > 3 ? '<div class="cal-pill" style="background:#6a737b">+' + (evs.length - 3) + "</div>" : "") + "</div>" : "";
    } else {
      marks = evs.length ? '<div class="cal-dots">' + evs.slice(0, 4).map(function (e) {
        return '<span class="cal-dot" style="background:' + courseColor(e.courseId) + '"></span>';
      }).join("") + "</div>" : "";
    }
    return '<td class="' + cls.trim() + '" data-act="cal-day" data-date="' + iso + '"><span class="num">' + num + "</span>" + marks + "</td>";
  }

  /* ---------- pages ---------- */
  function pageHome(route) {
    const html =
      '<div class="summary-box">' +
        "<p><strong>Willkommen im " + esc(C.siteName) + ".</strong> " + esc(C.siteTagline) + "</p>" +
        "<p>Hier findest du deine Lernfelder als Kurse, Lernkarten, Tests im Stil eines Moodle-Tests und einen leeren Klausurenplaner, den du selbst füllst.</p>" +
        '<p><a class="btn btn-primary" href="#/dashboard">Zum Dashboard</a> ' +
        '<a class="btn btn-outline-primary" href="#/courses">Meine Kurse</a></p>' +
      "</div>" +
      courseGrid();
    renderShell(route, html, [{ label: "Startseite" }], "Startseite");
  }

  function courseGrid() {
    return '<div class="course-grid">' + C.courses.map(function (c) {
      const pr = courseProgress(c.id);
      return '<a class="course-card" href="#/course/' + c.id + '">' +
        '<div class="course-img" style="background-image:url(img/' + esc(c.pattern) + ");background-color:" + c.color + '"></div>' +
        '<div class="course-body">' +
          '<div class="course-short" style="color:' + c.color + '">' + esc(c.short) + "</div>" +
          "<h3>" + esc(c.title) + "</h3>" +
          '<div class="course-sub">' + esc(c.subtitle) + "</div>" +
          '<div class="progress"><div class="progress-bar" style="width:' + pr.pct + "%;background:" + c.color + '"></div></div>' +
          '<div class="progress-label">' + pr.pct + " % abgeschlossen</div>" +
        "</div></a>";
    }).join("") + "</div>";
  }

  function pageDashboard(route) {
    const evs = upcomingEvents();
    var timelineMain;
    if (!evs.length) {
      timelineMain = '<div class="lr-empty"><p><strong>Trage deine erste Klausur ein.</strong></p>' +
        "<p>Der Planer startet leer. Sobald du Termine anlegst, erscheinen sie hier in der Zeitleiste – sortiert nach Datum, mit Countdown.</p>" +
        '<button type="button" class="btn btn-primary" data-act="event-new">Erste Klausur eintragen</button></div>';
    } else {
      timelineMain = evs.map(function (ev) {
        const cd = countdownLabel(ev.date);
        const course = ev.courseId ? courseById(ev.courseId) : null;
        const plan = studyPlan(ev);
        return '<div class="timeline-item">' +
          '<div class="timeline-date"><span class="day">' + fmtDateShort(ev.date) + "</span>" + weekdayShort(ev.date) +
            (ev.time ? "<br>" + esc(ev.time) : "") + "</div>" +
          '<div class="timeline-body">' +
            '<div class="title"><span class="event-type ' + esc(ev.type) + '">' + esc(TYPE_LABELS[ev.type] || ev.type) + "</span> " +
              '<a href="#" data-act="event-edit" data-id="' + ev.id + '">' + esc(ev.title) + "</a></div>" +
            '<div class="meta">' + (course ? esc(course.title) + " · " : "") +
              '<span class="countdown ' + cd.cls + '">' + cd.text + "</span></div>" +
            (plan ? '<div class="study-plan">' + esc(plan) + "</div>" : "") +
          "</div></div>";
      }).join("");
    }

    const html =
      '<section class="block"><div class="block-header">Zeitleiste' +
        '<button type="button" class="btn btn-sm btn-outline-primary" data-act="event-new">' + ico(I.plus, 14) + " Termin</button>" +
      '</div><div class="block-body">' + timelineMain + "</div></section>" +
      '<section class="block"><div class="block-header">Meine Kurse</div>' +
      '<div class="block-body">' + courseGrid() + "</div></section>";

    renderShell(route, html, [{ href: "#/home", label: "Startseite" }, { label: "Dashboard" }], "Dashboard");
  }

  function dayDetailHtml() {
    const evs = eventsOn(selectedDay);
    var list;
    if (!evs.length) {
      list = "<p class=\"text-muted mb-2\">Keine Termine am " + fmtDate(selectedDay) + ".</p>";
    } else {
      list = '<ul class="day-list">' + evs.map(function (ev) {
        const course = ev.courseId ? courseById(ev.courseId) : null;
        return "<li><span class=\"event-type " + esc(ev.type) + "\">" + esc(TYPE_LABELS[ev.type] || ev.type) + "</span> " +
          "<strong>" + esc(ev.title) + "</strong>" +
          (ev.time ? " · " + esc(ev.time) : "") +
          (course ? "<div class=\"meta text-muted\">" + esc(course.short) + "</div>" : "") +
          ' <button type="button" class="btn btn-link btn-sm p-0" data-act="event-edit" data-id="' + ev.id + '">Bearbeiten</button></li>';
      }).join("") + "</ul>";
    }
    return '<div class="mt-3"><h3 class="h6 mb-2">Termine am ' + fmtDate(selectedDay) + "</h3>" + list +
      '<button type="button" class="btn btn-sm btn-outline-primary" data-act="event-new" data-date="' + selectedDay + '">Termin an diesem Tag</button></div>';
  }

  function pageCourses(route) {
    renderShell(route,
      "<p class=\"text-muted\">Jeder Kurs entspricht einem Lernfeld. Öffne einen Kurs für Überblick, Lernkarten, Tests und Termine.</p>" + courseGrid(),
      [{ href: "#/home", label: "Startseite" }, { label: "Meine Kurse" }],
      "Meine Kurse",
      { right: false }
    );
  }

  function pageCourse(route) {
    const course = courseById(route.params.id);
    if (!course) { go("#/courses"); return; }
    const section = route.params.section;
    const pr = courseProgress(course.id);
    const tabs = [
      ["overview", "Überblick"],
      ["cards", "Lernkarten"],
      ["quiz", "Quiz"],
      ["termine", "Termine"]
    ];
    const tabHtml = '<ul class="nav nav-tabs mb-3">' + tabs.map(function (t) {
      const act = t[0] === section ? " active" : "";
      return '<li class="nav-item"><a class="nav-link' + act + '" href="#/course/' + course.id + "/" + t[0] + '">' + t[1] + "</a></li>";
    }).join("") + "</ul>";

    var body = "";
    if (section === "overview") body = courseOverview(course, pr);
    else if (section === "cards") body = courseCards(course);
    else if (section === "quiz") body = courseQuizList(course);
    else if (section === "termine") body = courseTermine(course);
    else body = courseOverview(course, pr);

    renderShell(route, tabHtml + body,
      [{ href: "#/home", label: "Startseite" }, { href: "#/courses", label: "Meine Kurse" }, { label: course.short }],
      course.title,
      { right: false }
    );
  }

  function courseOverview(course, pr) {
    const quizzes = quizzesFor(course.id);
    const cards = C.cards[course.id] || [];
    return '<section class="course-section"><h2>Überblick</h2><div class="section-body">' +
      "<p>" + esc(course.overview) + "</p>" +
      '<div class="progress" style="height:10px"><div class="progress-bar" style="width:' + pr.pct + "%;background:" + course.color + '"></div></div>' +
      '<p class="progress-label mt-2">' + pr.pct + " % abgeschlossen · " + cards.length + " Lernkarten · " + quizzes.length + " Test" + (quizzes.length === 1 ? "" : "s") + "</p>" +
      "</div></section>" +
      '<section class="course-section"><h2>Themen</h2><div class="section-body"><ol class="topic-list">' +
      (course.topics || []).map(function (t) {
        return "<li><span class=\"nr\">" + t.nr + "</span><strong>" + esc(t.title) + "</strong>" +
          (t.source ? ' <span class="text-muted">· ' + esc(t.source) + "</span>" : "") +
          "<div>" + esc(t.summary) + "</div></li>";
      }).join("") +
      "</ol></div></section>" +
      '<section class="course-section"><h2>Aktivitäten</h2><div class="section-body">' +
        '<a class="activity-row" href="#/course/' + course.id + '/cards"><span class="activity-icon">' + ico(I.card) + "</span><div><strong>Lernkarten</strong><div class=\"text-muted\">" + cards.length + " Karten zum Umdrehen</div></div></a>" +
        quizzes.map(function (q) {
          return '<a class="activity-row" href="#/quiz/' + q.id + '"><span class="activity-icon">' + ico(I.quiz) + "</span><div><strong>" + esc(q.title) + "</strong><div class=\"text-muted\">" + q.questions.length + " Fragen</div></div></a>";
        }).join("") +
        '<a class="activity-row" href="#/course/' + course.id + '/termine"><span class="activity-icon">' + ico(I.cal) + "</span><div><strong>Termine des Kurses</strong><div class=\"text-muted\">Klausuren und Fristen zu diesem Lernfeld</div></div></a>" +
      "</div></section>";
  }

  function courseCards(course) {
    const cards = C.cards[course.id] || [];
    if (!cards.length) return "<p>Keine Lernkarten vorhanden.</p>";
    const idx = Math.min(course._cardIdx || 0, cards.length - 1);
    course._cardIdx = idx;
    const card = cards[idx];
    const flipped = !!course._flipped;
    const p = (state.progress[course.id] && state.progress[course.id].cards) || {};
    return '<p class="text-muted">Karte ' + (idx + 1) + " von " + cards.length + (p[card.id] ? " · gesehen" : "") + "</p>" +
      '<div class="card-stage">' +
        '<div class="flip-card' + (flipped ? " flipped" : "") + '" data-act="flip-card" id="flip-card">' +
          '<div class="flip-inner">' +
            '<div class="flip-face front"><div class="hint">' + esc(card.topic && card.topic !== card.front ? card.topic : "Vorderseite") + '</div><div class="text">' + esc(card.front) + "</div></div>" +
            '<div class="flip-face back"><div class="hint">Antwort</div><div class="text">' + esc(card.back) + "</div></div>" +
          "</div></div>" +
        '<div class="d-flex justify-content-between mt-3">' +
          '<button type="button" class="btn btn-outline-secondary" data-act="card-prev"' + (idx === 0 ? " disabled" : "") + ">Zurück</button>" +
          '<button type="button" class="btn btn-outline-primary" data-act="flip-card">Umdrehen</button>' +
          '<button type="button" class="btn btn-primary" data-act="card-next"' + (idx === cards.length - 1 ? " disabled" : "") + ">Weiter</button>" +
        "</div></div>";
  }

  function markCardSeen(course, cardId) {
    if (!state.progress[course.id]) state.progress[course.id] = { cards: {}, quizBest: {} };
    if (!state.progress[course.id].cards) state.progress[course.id].cards = {};
    state.progress[course.id].cards[cardId] = "seen";
    saveState();
  }

  function courseQuizList(course) {
    const quizzes = quizzesFor(course.id);
    const p = state.progress[course.id] || {};
    return '<section class="course-section"><h2>Tests</h2><div class="section-body">' +
      quizzes.map(function (q) {
        const best = p.quizBest && p.quizBest[q.id];
        return '<a class="activity-row" href="#/quiz/' + q.id + '"><span class="activity-icon">' + ico(I.quiz) + "</span><div>" +
          "<strong>" + esc(q.title) + "</strong>" +
          '<div class="text-muted">' + q.questions.length + " Fragen" +
          (best ? " · Bestes Ergebnis: " + best.score + " / " + best.total : " · noch nicht versucht") +
          "</div></div></a>";
      }).join("") +
      "</div></section>";
  }

  function courseTermine(course) {
    const evs = state.events.filter(function (e) { return e.courseId === course.id; })
      .sort(function (a, b) { return (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")); });
    var body;
    if (!evs.length) {
      body = '<div class="lr-empty"><p>Trage deine erste Klausur ein.</p>' +
        '<button type="button" class="btn btn-primary" data-act="event-new" data-course="' + course.id + '">Termin für ' + esc(course.short) + " anlegen</button></div>";
    } else {
      body = evs.map(function (ev) {
        const cd = countdownLabel(ev.date);
        const plan = studyPlan(ev);
        return '<div class="timeline-item"><div class="timeline-date"><span class="day">' + fmtDateShort(ev.date) + "</span>" +
          weekdayShort(ev.date) + (ev.time ? "<br>" + esc(ev.time) : "") + "</div>" +
          '<div class="timeline-body"><div class="title"><span class="event-type ' + esc(ev.type) + '">' + esc(TYPE_LABELS[ev.type] || ev.type) + "</span> " +
          '<a href="#" data-act="event-edit" data-id="' + ev.id + '">' + esc(ev.title) + "</a></div>" +
          '<div class="meta"><span class="countdown ' + cd.cls + '">' + cd.text + "</span></div>" +
          (plan ? '<div class="study-plan">' + esc(plan) + "</div>" : "") +
          "</div></div>";
      }).join("");
    }
    return '<section class="course-section"><h2>Termine des Kurses' +
      '<span class="ml-auto"><button type="button" class="btn btn-sm btn-outline-primary" data-act="event-new" data-course="' + course.id + '">Termin anlegen</button></span>' +
      "</h2><div class=\"section-body\">" + body + "</div></section>";
  }

  function pageCalendar(route) {
    const evs = state.events.slice().sort(function (a, b) { return (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")); });
    const html =
      '<div class="mb-3 d-flex flex-wrap" style="gap:.4rem">' +
        '<button type="button" class="btn btn-primary" data-act="event-new">Termin anlegen</button>' +
        '<button type="button" class="btn btn-outline-primary" data-act="ics-all"' + (evs.length ? "" : " disabled") + ">" + ico(I.download, 16) + " Alle als .ics exportieren</button>" +
      "</div>" +
      '<section class="block"><div class="block-header">Monatskalender</div><div class="block-body">' +
        calendarHtml(calCursor, "cal-large") + dayDetailHtml() +
      "</div></section>" +
      '<section class="block"><div class="block-header">Alle Termine</div><div class="block-body">' +
        (evs.length ? evs.map(function (ev) {
          const course = ev.courseId ? courseById(ev.courseId) : null;
          const cd = countdownLabel(ev.date);
          return '<div class="timeline-item"><div class="timeline-date"><span class="day">' + fmtDateShort(ev.date) + "</span>" + weekdayShort(ev.date) +
            (ev.time ? "<br>" + esc(ev.time) : "") + "</div>" +
            '<div class="timeline-body"><div class="title"><span class="event-type ' + esc(ev.type) + '">' + esc(TYPE_LABELS[ev.type] || ev.type) + "</span> " +
            '<a href="#" data-act="event-edit" data-id="' + ev.id + '">' + esc(ev.title) + "</a></div>" +
            '<div class="meta">' + (course ? esc(course.short) + " · " : "") + '<span class="countdown ' + cd.cls + '">' + cd.text + "</span> · " +
            '<button type="button" class="btn btn-link btn-sm p-0" data-act="ics-one" data-id="' + ev.id + '">.ics</button></div></div></div>';
        }).join("") : '<div class="lr-empty"><p>Trage deine erste Klausur ein.</p></div>') +
      "</div></section>";
    renderShell(route, html,
      [{ href: "#/home", label: "Startseite" }, { label: "Kalender" }],
      "Kalender");
  }

  /* ---------- quiz (Moodle-like) ---------- */
  function startAttempt(quiz, reviewMistakes) {
    const questions = reviewMistakes ? reviewMistakes : quiz.questions.slice();
    const attempt = {
      quizId: quiz.id,
      title: quiz.title,
      courseId: quiz.courseId,
      questions: questions,
      answers: {},
      current: 0,
      finished: false,
      startedAt: Date.now()
    };
    saveAttempt(attempt);
    go("#/quiz/" + quiz.id + "/attempt");
  }

  function pageQuiz(route) {
    const quiz = quizById(route.params.quizId);
    if (!quiz) { go("#/courses"); return; }
    const mode = route.params.mode;
    const attempt = loadAttempt();
    if (mode === "attempt" && attempt && attempt.quizId === quiz.id && !attempt.finished) {
      return pageQuizAttempt(quiz, attempt);
    }
    if (mode === "review" && attempt && attempt.quizId === quiz.id && attempt.finished) {
      return pageQuizReview(quiz, attempt);
    }
    pageQuizIntro(quiz);
  }

  function pageQuizIntro(quiz) {
    const course = courseById(quiz.courseId);
    const p = (state.progress[quiz.courseId] || {}).quizBest || {};
    const best = p[quiz.id];
    const html =
      '<section class="course-section"><h2>' + esc(quiz.title) + "</h2><div class=\"section-body\">" +
        "<p>" + esc(quiz.intro) + "</p>" +
        "<p>Dieser Test hat <strong>" + quiz.questions.length + " Fragen</strong>. Jede Frage zählt in der Regel 1,00 Punkt. Du kannst zwischen den Fragen hin- und herwechseln. Am Ende siehst du eine Überprüfungsseite mit richtig/falsch und Rückmeldung.</p>" +
        (best ? "<p>Dein bisher bestes Ergebnis: <strong>" + best.score + " / " + best.total + "</strong>.</p>" : "") +
        '<p><button type="button" class="btn btn-primary" data-act="quiz-start" data-quiz="' + quiz.id + '">Versuch jetzt starten</button> ' +
        (course ? '<a class="btn btn-link" href="#/course/' + course.id + '/quiz">Zurück zum Kurs</a>' : "") +
        "</p></div></section>";
    renderShell(parseRoute(), html,
      [{ href: "#/home", label: "Startseite" }, { href: "#/courses", label: "Meine Kurse" },
        course ? { href: "#/course/" + course.id, label: course.short } : { label: "Test" }, { label: quiz.title }],
      quiz.title, { right: false });
  }

  function gradeAttempt(attempt) {
    var score = 0, total = 0;
    attempt.questions.forEach(function (q, i) {
      const pts = q.points || 1;
      total += pts;
      if (attempt.answers[i] === q.answer) score += pts;
    });
    return { score: score, total: total };
  }

  function pageQuizAttempt(quiz, attempt) {
    const i = Math.max(0, Math.min(attempt.current, attempt.questions.length - 1));
    attempt.current = i;
    const q = attempt.questions[i];
    const chosen = attempt.answers.hasOwnProperty(i) ? attempt.answers[i] : null;
    const course = courseById(quiz.courseId);
    const que =
      '<div class="que">' +
        '<div class="info"><h3>Frage ' + (i + 1) + "</h3>" +
          '<div class="state' + (chosen != null ? " complete" : "") + '">' + (chosen != null ? "Beantwortet" : "Noch nicht beantwortet") + "</div>" +
          '<div class="grade">Erreicht: noch nicht bewertet</div>' +
          '<div class="grade">Bewertet: ' + fmtPts(q.points || 1) + "</div>" +
        "</div>" +
        '<div class="formulation"><div class="qtext">' + esc(q.prompt) + "</div>" +
          '<ul class="answer">' + q.choices.map(function (ch, ci) {
            const id = "ans-" + i + "-" + ci;
            return '<li><input type="radio" name="q" id="' + id + '" data-act="quiz-answer" data-choice="' + ci + '"' +
              (chosen === ci ? " checked" : "") + ">" +
              '<span class="letter">' + LETTERS[ci] + ".</span>" +
              '<label for="' + id + '">' + esc(ch) + "</label></li>";
          }).join("") + "</ul>" +
          (q.source ? '<p class="text-muted small mt-2 mb-0">Quelle: ' + esc(q.source) + "</p>" : "") +
        "</div></div>";

    const navBtns = attempt.questions.map(function (_, qi) {
      var cls = "qn-btn";
      if (qi === i) cls += " current";
      else if (attempt.answers.hasOwnProperty(qi)) cls += " answered";
      return '<button type="button" class="' + cls + '" data-act="quiz-goto" data-i="' + qi + '">' + (qi + 1) + "</button>";
    }).join("");

    const html =
      '<div class="quiz-layout">' +
        "<div>" + que +
          '<div class="quiz-controls">' +
            '<button type="button" class="btn btn-secondary" data-act="quiz-goto" data-i="' + (i - 1) + '"' + (i === 0 ? " disabled" : "") + ">Vorherige Seite</button>" +
            (i < attempt.questions.length - 1
              ? '<button type="button" class="btn btn-primary" data-act="quiz-goto" data-i="' + (i + 1) + '">Nächste Seite</button>'
              : '<button type="button" class="btn btn-primary" data-act="quiz-submit">Versuch abgeben</button>') +
          "</div>" +
        "</div>" +
        '<aside><section class="block qn-block"><div class="block-header">Testnavigation</div><div class="block-body">' +
          '<div class="qn-grid">' + navBtns + "</div>" +
          '<div class="qn-legend">Blau markiert: aktuelle Frage · hellblau: beantwortet.</div>' +
          '<button type="button" class="btn btn-outline-primary btn-sm btn-block mt-2" data-act="quiz-submit">Versuch abgeben</button>' +
        "</div></section></aside>" +
      "</div>";

    renderShell(parseRoute(), html,
      [{ href: "#/home", label: "Startseite" }, { href: "#/courses", label: "Meine Kurse" },
        course ? { href: "#/course/" + course.id, label: course.short } : { label: "Test" }, { label: quiz.title }],
      quiz.title, { right: false });
  }

  function finishAttempt(attempt, quiz) {
    attempt.finished = true;
    attempt.finishedAt = Date.now();
    const g = gradeAttempt(attempt);
    attempt.score = g.score;
    attempt.total = g.total;
    saveAttempt(attempt);
    if (!state.progress[quiz.courseId]) state.progress[quiz.courseId] = { cards: {}, quizBest: {} };
    const best = state.progress[quiz.courseId].quizBest[quiz.id];
    if (!best || g.score > best.score) {
      state.progress[quiz.courseId].quizBest[quiz.id] = { score: g.score, total: g.total, at: Date.now() };
    }
    attempt.questions.forEach(function (q, i) {
      if (attempt.answers[i] !== q.answer) {
        state.mistakes.push({
          id: q.id || (quiz.id + "-" + i),
          quizId: quiz.id,
          courseId: quiz.courseId,
          question: q,
          chosen: attempt.answers[i],
          at: Date.now()
        });
      }
    });
    // cap mistakes
    if (state.mistakes.length > 300) state.mistakes = state.mistakes.slice(-300);
    saveState();
    go("#/quiz/" + quiz.id + "/review");
  }

  function pageQuizReview(quiz, attempt) {
    const course = courseById(quiz.courseId);
    const g = { score: attempt.score, total: attempt.total };
    const pct = g.total ? Math.round((g.score / g.total) * 100) : 0;
    const navBtns = attempt.questions.map(function (q, qi) {
      const ok = attempt.answers[qi] === q.answer;
      return '<button type="button" class="qn-btn ' + (ok ? "correct" : "incorrect") + '" data-act="scroll-q" data-i="' + qi + '">' + (qi + 1) + "</button>";
    }).join("");

    const questions = attempt.questions.map(function (q, i) {
      const chosen = attempt.answers.hasOwnProperty(i) ? attempt.answers[i] : null;
      const ok = chosen === q.answer;
      const pts = q.points || 1;
      return '<div class="que" id="rev-q' + i + '">' +
        '<div class="info"><h3>Frage ' + (i + 1) + "</h3>" +
          '<div class="state ' + (ok ? "complete" : "") + '">' + (ok ? "Richtig" : "Falsch") + "</div>" +
          '<div class="grade">Erreicht: ' + (ok ? fmtPts(pts) : "0,00") + "</div>" +
          '<div class="grade">Bewertet: ' + fmtPts(pts) + "</div></div>" +
        '<div class="formulation"><div class="qtext">' + esc(q.prompt) + "</div>" +
          '<ul class="answer">' + q.choices.map(function (ch, ci) {
            var cls = "";
            if (ci === q.answer) cls = "correct";
            if (chosen === ci && ci !== q.answer) cls = "incorrect";
            return '<li class="' + cls + '"><span class="letter">' + LETTERS[ci] + ".</span><label>" + esc(ch) + "</label></li>";
          }).join("") + "</ul>" +
          '<div class="outcome ' + (ok ? "right" : "wrong") + '">' +
            "<strong>Rückmeldung:</strong> " + (ok ? "Die Antwort ist richtig. " : "Die Antwort ist falsch. ") +
            esc(q.feedback || "") +
            (q.source ? "<div class=\"small text-muted mt-1\">Quelle: " + esc(q.source) + "</div>" : "") +
          "</div></div></div>";
    }).join("");

    const html =
      '<div class="summary-box"><div class="score">' + g.score + " / " + g.total + " Punkte (" + pct + " %)</div>" +
        "<p class=\"mb-0\">Überprüfung des Versuchs. Richtige Antworten sind grün, falsche rot markiert. Die Rückmeldung steht unter jeder Frage.</p></div>" +
      '<div class="quiz-layout"><div>' + questions +
        '<p><button type="button" class="btn btn-primary" data-act="quiz-start" data-quiz="' + quiz.id + '">Erneuten Versuch starten</button> ' +
        (course ? '<a class="btn btn-outline-primary" href="#/course/' + course.id + '/quiz">Zurück zum Kurs</a>' : "") +
        "</p></div>" +
        '<aside><section class="block qn-block"><div class="block-header">Testnavigation</div><div class="block-body">' +
          '<div class="qn-grid">' + navBtns + "</div>" +
          '<div class="qn-legend">Grün: richtig · rot: falsch.</div>' +
        "</div></section></aside></div>";

    renderShell(parseRoute(), html,
      [{ href: "#/home", label: "Startseite" }, { href: "#/courses", label: "Meine Kurse" },
        course ? { href: "#/course/" + course.id, label: course.short } : { label: "Test" }, { label: "Überprüfung" }],
      "Überprüfung: " + quiz.title, { right: false });
  }

  function pageReview(route) {
    // unique latest mistakes by question id
    const map = {};
    state.mistakes.forEach(function (m) { map[m.id] = m; });
    const list = Object.keys(map).map(function (k) { return map[k]; });
    var html;
    if (!list.length) {
      html = '<div class="lr-empty"><p>Noch keine falschen Antworten. Starte einen Test – falsch beantwortete Fragen erscheinen danach hier.</p>' +
        '<a class="btn btn-primary" href="#/training">Zum Prüfungstraining</a></div>';
    } else {
      html = "<p>Du hast <strong>" + list.length + " unterschiedliche Fehlerfragen</strong> gesammelt. Übe sie wie in einem Moodle-Test.</p>" +
        '<p><button type="button" class="btn btn-primary" data-act="review-start">Fehlerfragen üben</button></p>' +
        "<ul class=\"list-unstyled\">" + list.slice(0, 40).map(function (m) {
          const course = courseById(m.courseId);
          return "<li class=\"mb-2\">· " + esc(m.question.prompt.slice(0, 140)) + (m.question.prompt.length > 140 ? "…" : "") +
            (course ? ' <span class="text-muted">(' + esc(course.short) + ")</span>" : "") + "</li>";
        }).join("") + "</ul>";
    }
    renderShell(route, html,
      [{ href: "#/home", label: "Startseite" }, { label: "Fehler wiederholen" }],
      "Fehler wiederholen", { right: false });
  }

  function pageTraining(route) {
    const html =
      '<section class="course-section"><h2>Prüfungstraining</h2><div class="section-body">' +
        "<p>Ein gemischter Test aus allen Lernfeldern, 20 Fragen, zufällig gezogen – im Ablauf wie ein Moodle-Test: eine Frage pro Seite, Testnavigation und Überprüfung am Ende.</p>" +
        "<p>Optional nur einzelne Kurse:</p>" +
        C.courses.map(function (c) {
          return '<div class="form-check"><input class="form-check-input" type="checkbox" id="tr-' + c.id + '" data-train="' + c.id + '" checked>' +
            '<label class="form-check-label" for="tr-' + c.id + '">' + esc(c.title) + "</label></div>";
        }).join("") +
        '<p class="mt-3"><button type="button" class="btn btn-primary" data-act="training-start">Training starten</button></p>' +
      "</div></section>";
    renderShell(route, html,
      [{ href: "#/home", label: "Startseite" }, { label: "Prüfungstraining" }],
      "Prüfungstraining", { right: false });
  }

  function startTraining() {
    const ids = Array.prototype.map.call(document.querySelectorAll("[data-train]:checked"), function (el) { return el.getAttribute("data-train"); });
    var pool = [];
    C.quizzes.forEach(function (qz) {
      if (ids.length && ids.indexOf(qz.courseId) === -1) return;
      qz.questions.forEach(function (q) { pool.push(q); });
    });
    if (!pool.length) return;
    for (var i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const pick = pool.slice(0, Math.min(20, pool.length));
    const quiz = {
      id: "training",
      courseId: ids[0] || "lf5",
      title: "Prüfungstraining",
      intro: "Gemischter Test",
      questions: pick
    };
    // register ephemeral
    startAttempt(quiz, pick);
    // startAttempt uses quiz.id for URL – need a synthetic quiz in lookup
    window._trainingQuiz = quiz;
  }

  // hook quizById for training
  const _quizById = quizById;
  function quizByIdSafe(id) {
    if (id === "training" && window._trainingQuiz) return window._trainingQuiz;
    return _quizById(id);
  }
  // rebind later in pageQuiz - actually I already used quizById. I'll overwrite by replacing calls... 
  // Simpler: patch C.quizzes temporarily or wrap.

  /* ---------- event modal ---------- */
  function openEventModal(opts) {
    opts = opts || {};
    const ev = opts.id ? eventById(opts.id) : null;
    editingEventId = ev ? ev.id : null;
    const title = ev ? ev.title : "";
    const date = ev ? ev.date : (opts.date || isoDate(new Date()));
    const time = ev ? (ev.time || "") : "";
    const courseId = ev ? (ev.courseId || "") : (opts.courseId || "");
    const type = ev ? ev.type : "klausur";
    const note = ev ? (ev.note || "") : "";
    const courseOpts = '<option value="">— kein Kurs —</option>' + C.courses.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === courseId ? " selected" : "") + ">" + esc(c.title) + "</option>";
    }).join("");
    const typeOpts = Object.keys(TYPE_LABELS).map(function (k) {
      return '<option value="' + k + '"' + (k === type ? " selected" : "") + ">" + TYPE_LABELS[k] + "</option>";
    }).join("");

    document.getElementById("modal-host").innerHTML =
      '<div class="lr-modal-backdrop" data-act="modal-close-bg">' +
        '<div class="lr-modal" role="dialog" aria-modal="true">' +
          "<header><h2>" + (ev ? "Termin bearbeiten" : "Termin anlegen") + '</h2>' +
          '<button type="button" class="close-x" data-act="modal-close" aria-label="Schließen">' + ico(I.close, 20) + "</button></header>" +
          '<form id="event-form"><div class="modal-body">' +
            '<div class="form-group"><label for="ev-title">Titel</label><input class="form-control" id="ev-title" required maxlength="120" value="' + esc(title) + '"></div>' +
            '<div class="form-row"><div class="form-group col-md-7"><label for="ev-date">Datum</label><input type="date" class="form-control" id="ev-date" required value="' + esc(date) + '"></div>' +
            '<div class="form-group col-md-5"><label for="ev-time">Uhrzeit (optional)</label><input type="time" class="form-control" id="ev-time" value="' + esc(time) + '"></div></div>' +
            '<div class="form-group"><label for="ev-course">Lernfeld / Kurs</label><select class="form-control" id="ev-course">' + courseOpts + "</select></div>" +
            '<div class="form-group"><label for="ev-type">Art</label><select class="form-control" id="ev-type">' + typeOpts + "</select></div>" +
            '<div class="form-group"><label for="ev-note">Notiz (optional)</label><textarea class="form-control" id="ev-note" rows="3">' + esc(note) + "</textarea></div>" +
          '</div><footer>' +
            (ev ? '<button type="button" class="btn btn-outline-danger mr-auto" data-act="event-delete">Löschen</button>' : "") +
            '<button type="button" class="btn btn-secondary" data-act="modal-close">Abbrechen</button>' +
            '<button type="submit" class="btn btn-primary">Speichern</button>' +
          "</footer></form></div></div>";

    document.getElementById("event-form").addEventListener("submit", function (e) {
      e.preventDefault();
      saveEventFromForm();
    });
    document.getElementById("ev-title").focus();
  }

  function closeModal() {
    const host = document.getElementById("modal-host");
    if (host) host.innerHTML = "";
    editingEventId = null;
  }

  function saveEventFromForm() {
    const title = document.getElementById("ev-title").value.trim();
    const date = document.getElementById("ev-date").value;
    const time = document.getElementById("ev-time").value;
    const courseId = document.getElementById("ev-course").value;
    const type = document.getElementById("ev-type").value;
    const note = document.getElementById("ev-note").value.trim();
    if (!title || !date) return;
    if (editingEventId) {
      const ev = eventById(editingEventId);
      if (ev) {
        ev.title = title; ev.date = date; ev.time = time; ev.courseId = courseId; ev.type = type; ev.note = note;
      }
    } else {
      state.events.push({ id: uid(), title: title, date: date, time: time, courseId: courseId, type: type, note: note });
    }
    selectedDay = date;
    calCursor = startOfMonth(parseISO(date));
    saveState();
    closeModal();
    render();
  }

  function deleteEditingEvent() {
    if (!editingEventId) return;
    if (!confirm("Diesen Termin wirklich löschen?")) return;
    state.events = state.events.filter(function (e) { return e.id !== editingEventId; });
    saveState();
    closeModal();
    render();
  }

  /* ---------- events ---------- */
  function onClick(e) {
    const t = e.target.closest("[data-act], a[href^='#']");
    if (!t) return;
    if (t.matches("a[href^='#']") && !t.getAttribute("data-act")) return; // let hash change
    const act = t.getAttribute("data-act");
    if (!act) return;
    e.preventDefault();

    if (act === "toggle-left") {
      document.body.classList.toggle("drawer-left-open");
    } else if (act === "toggle-right") {
      document.body.classList.toggle("drawer-right-open");
    } else if (act === "close-left") {
      document.body.classList.remove("drawer-left-open");
    } else if (act === "close-right") {
      document.body.classList.remove("drawer-right-open");
    } else if (act === "cal-prev") {
      calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
      render();
    } else if (act === "cal-next") {
      calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
      render();
    } else if (act === "cal-day") {
      selectedDay = t.getAttribute("data-date");
      render();
    } else if (act === "event-new") {
      openEventModal({ date: t.getAttribute("data-date") || selectedDay, courseId: t.getAttribute("data-course") || "" });
    } else if (act === "event-edit") {
      openEventModal({ id: t.getAttribute("data-id") });
    } else if (act === "event-delete") {
      deleteEditingEvent();
    } else if (act === "modal-close") {
      closeModal();
    } else if (act === "modal-close-bg") {
      if (e.target === t) closeModal();
    } else if (act === "ics-all") {
      if (state.events.length) downloadIcs(state.events, "lernraum-termine.ics");
    } else if (act === "ics-one") {
      const ev = eventById(t.getAttribute("data-id"));
      if (ev) downloadIcs([ev], (ev.title || "termin").replace(/\s+/g, "_") + ".ics");
    } else if (act === "flip-card") {
      const route = parseRoute();
      const course = courseById(route.params.id);
      if (!course) return;
      course._flipped = !course._flipped;
      const cards = C.cards[course.id] || [];
      const card = cards[course._cardIdx || 0];
      if (card) markCardSeen(course, card.id);
      render();
    } else if (act === "card-prev" || act === "card-next") {
      const route = parseRoute();
      const course = courseById(route.params.id);
      const cards = C.cards[course.id] || [];
      course._cardIdx = Math.max(0, Math.min(cards.length - 1, (course._cardIdx || 0) + (act === "card-next" ? 1 : -1)));
      course._flipped = false;
      render();
    } else if (act === "quiz-start") {
      const qid = t.getAttribute("data-quiz");
      const quiz = qid === "training" && window._trainingQuiz ? window._trainingQuiz : quizById(qid);
      if (quiz) startAttempt(quiz);
    } else if (act === "quiz-goto") {
      const attempt = loadAttempt();
      if (!attempt || attempt.finished) return;
      const ni = parseInt(t.getAttribute("data-i"), 10);
      if (ni < 0 || ni >= attempt.questions.length) return;
      attempt.current = ni;
      saveAttempt(attempt);
      render();
    } else if (act === "quiz-answer") {
      const attempt = loadAttempt();
      if (!attempt || attempt.finished) return;
      attempt.answers[attempt.current] = parseInt(t.getAttribute("data-choice"), 10);
      saveAttempt(attempt);
      render();
    } else if (act === "quiz-submit") {
      const attempt = loadAttempt();
      const quiz = attempt && (attempt.quizId === "training" && window._trainingQuiz ? window._trainingQuiz : quizById(attempt.quizId));
      if (!attempt || !quiz) return;
      const unanswered = attempt.questions.filter(function (_, i) { return !attempt.answers.hasOwnProperty(i); }).length;
      const msg = unanswered
        ? "Es sind noch " + unanswered + " Fragen unbeantwortet. Versuch trotzdem abgeben?"
        : "Versuch jetzt abgeben und zur Überprüfung gehen?";
      if (confirm(msg)) finishAttempt(attempt, quiz);
    } else if (act === "scroll-q") {
      const el = document.getElementById("rev-q" + t.getAttribute("data-i"));
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (act === "review-start") {
      const map = {};
      state.mistakes.forEach(function (m) { map[m.id] = m.question; });
      const questions = Object.keys(map).map(function (k) { return map[k]; });
      if (!questions.length) return;
      const quiz = { id: "training", courseId: "lf5", title: "Fehler wiederholen", intro: "", questions: questions };
      window._trainingQuiz = quiz;
      startAttempt(quiz, questions);
    } else if (act === "training-start") {
      startTraining();
    }
  }

  function render() {
    const route = parseRoute();
    // patch training quiz lookup
    if (route.params && route.params.quizId === "training" && !window._trainingQuiz) {
      const att = loadAttempt();
      if (att && att.quizId === "training") {
        window._trainingQuiz = { id: "training", courseId: att.courseId, title: att.title || "Prüfungstraining", intro: "", questions: att.questions };
      }
    }
    if (route.name === "home") pageHome(route);
    else if (route.name === "dashboard") pageDashboard(route);
    else if (route.name === "courses") pageCourses(route);
    else if (route.name === "course") pageCourse(route);
    else if (route.name === "calendar") pageCalendar(route);
    else if (route.name === "quiz") {
      const quiz = (route.params.quizId === "training" && window._trainingQuiz) ? window._trainingQuiz : quizById(route.params.quizId);
      if (!quiz) { pageCourses(route); return; }
      const mode = route.params.mode;
      const attempt = loadAttempt();
      if (mode === "attempt" && attempt && attempt.quizId === quiz.id && !attempt.finished) pageQuizAttempt(quiz, attempt);
      else if (mode === "review" && attempt && attempt.quizId === quiz.id && attempt.finished) pageQuizReview(quiz, attempt);
      else pageQuizIntro(quiz);
    }
    else if (route.name === "review") pageReview(route);
    else if (route.name === "training") pageTraining(route);
    else pageDashboard(route);
    document.title = (document.querySelector("#page-header h1") ? document.querySelector("#page-header h1").textContent + " | " : "") + C.siteName;
  }

  window.addEventListener("hashchange", render);
  document.addEventListener("click", onClick);
  window.addEventListener("resize", function () {
    // keep drawers sensible on resize without full remount if modal open
    const route = parseRoute();
    const showRight = route.name === "dashboard" || route.name === "calendar" || route.name === "home";
    if (window.innerWidth >= 992) {
      document.body.classList.add("drawer-left-open");
      if (showRight) document.body.classList.add("drawer-right-open");
    }
  });

  if (!location.hash) location.hash = "#/dashboard";
  else render();
})();
