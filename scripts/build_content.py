#!/usr/bin/env python3
"""Extract quiz questions and topics from existing Lernzettel sources into js/content.js."""
from __future__ import annotations

import ast
import json
import re
from html import unescape
from pathlib import Path

ROOT = Path("/home/box/Jonathan/02_Berufsschule_Lernzettel/_quellen_mc")
OUT = Path("/workspace/lernraum/js/content.js")


def strip_html(s: str) -> str:
    if not s:
        return ""
    s = unescape(str(s))
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</p>\s*<p[^>]*>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _const(node):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.List):
        return [_const(e) for e in node.elts]
    if isinstance(node, ast.Tuple):
        return tuple(_const(e) for e in node.elts)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -_const(node.operand)
    if isinstance(node, ast.Name) and node.id == "None":
        return None
    if isinstance(node, ast.JoinedStr):
        parts = []
        for v in node.values:
            if isinstance(v, ast.Constant):
                parts.append(str(v.value))
            # skip formatted values (OFF etc.) – only appear in open questions
        return "".join(parts)
    if isinstance(node, ast.FormattedValue):
        return ""
    if isinstance(node, ast.Name):
        return ""
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        return str(_const(node.left)) + str(_const(node.right))
    raise ValueError(f"unsupported ast {type(node).__name__}")


def extract_list_after(src: str, name: str):
    m = re.search(rf"\b{name}\s*=\s*\[", src)
    if not m:
        return None
    start = m.end() - 1
    depth = 0
    for i, ch in enumerate(src[start:], start):
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                tree = ast.parse(src[start : i + 1], mode="eval")
                return _const(tree.body)
    return None


def parse_topics(path: Path):
    src = path.read_text(encoding="utf-8")
    # (nr, "title", "pages", "keywords", COLOR, ...)
    topics = []
    # Match tuples starting with a number and a quoted title
    for m in re.finditer(
        r"\(\s*(\d+)\s*,\s*(\"((?:\\.|[^\"])*)\"|'((?:\\.|[^'])*)')\s*,\s*(\"((?:\\.|[^\"])*)\"|'((?:\\.|[^'])*)')\s*,\s*(\"((?:\\.|[^\"])*)\"|'((?:\\.|[^'])*)')",
        src,
    ):
        nr = int(m.group(1))
        title = m.group(3) if m.group(3) is not None else m.group(4)
        pages = m.group(6) if m.group(6) is not None else m.group(7)
        kw = m.group(9) if m.group(9) is not None else m.group(10)
        topics.append(
            {
                "nr": nr,
                "title": title,
                "source": pages,
                "summary": strip_html(kw),
            }
        )
    # unique by nr, keep first
    seen = set()
    out = []
    for t in topics:
        if t["nr"] in seen:
            continue
        seen.add(t["nr"])
        out.append(t)
    return sorted(out, key=lambda t: t["nr"])


def letter_to_index(letter: str) -> int:
    letter = str(letter).strip().upper()
    if letter and letter[0] in "ABCD":
        return ord(letter[0]) - 65
    return 0


def mc_from_questions_py(path: Path, default_topic: str, source_label: str):
    items = extract_list_after(path.read_text(encoding="utf-8"), "Q") or []
    out = []
    for row in items:
        if len(row) < 5:
            continue
        topic, question, options, correct, expl = row[:5]
        out.append(
            {
                "id": "",
                "topic": topic,
                "prompt": strip_html(question),
                "choices": [strip_html(o) for o in options],
                "answer": letter_to_index(correct),
                "feedback": strip_html(expl),
                "source": source_label,
                "points": 1,
            }
        )
    return out


def mc_from_selbsttest(path: Path, topic_names: dict, source_label: str):
    items = extract_list_after(path.read_text(encoding="utf-8"), "ITEMS") or []
    out = []
    for row in items:
        if not row or row[0] != "mc":
            continue
        typ, thema, question, options, points, loesung, expl, page = (list(row) + [""] * 8)[:8]
        topic = topic_names.get(thema, f"Thema {thema}")
        src = f"{source_label}"
        if page:
            src = f"{source_label}, {strip_html(str(page))}"
        out.append(
            {
                "id": "",
                "topic": topic,
                "prompt": strip_html(question),
                "choices": [strip_html(o) for o in options],
                "answer": letter_to_index(loesung),
                "feedback": strip_html(expl),
                "source": src,
                "points": int(points) if str(points).isdigit() else 1,
            }
        )
    return out


# --- LF8 questions from existing Lernzettel (Buch Band 2 + Unterricht + HOT) ---
LF8_QUESTIONS = [
    {
        "topic": "Zahlungsverzug · Voraussetzungen",
        "prompt": "Wann liegt Zahlungsverzug nach § 286 BGB typischerweise vor?",
        "choices": [
            "Sobald die Ware geliefert wurde, unabhängig vom Zahlungstermin",
            "Wenn die Forderung fällig ist und eine Mahnung vorliegt oder die Mahnung entbehrlich ist",
            "Erst nach Ablauf der Verjährungsfrist von drei Jahren",
            "Nur wenn bereits ein Vollstreckungsbescheid erlassen wurde",
        ],
        "answer": 1,
        "feedback": "Prüfschema A–B: Erst die Fälligkeit, dann Mahnung oder ein Fall, in dem die Mahnung entbehrlich ist (z. B. kalendermäßig bestimmter Termin oder 30-Tage-Regel).",
        "source": "Buch Band 2, S. 218–219 · § 286 BGB",
        "points": 1,
    },
    {
        "topic": "Zahlungsverzug · Fälligkeit",
        "prompt": "Was gilt nach § 271 BGB, wenn kein Zahlungszeitpunkt vereinbart wurde?",
        "choices": [
            "Die Forderung wird erst nach 30 Tagen fällig",
            "Die Forderung wird erst nach einer Mahnung fällig",
            "Die Forderung ist sofort fällig",
            "Die Forderung wird erst am Schluss des Jahres fällig",
        ],
        "answer": 2,
        "feedback": "Ohne Termin ist die Zahlung nach § 271 BGB sofort fällig. Die 30-Tage-Regel betrifft die Entbehrlichkeit der Mahnung, nicht die Fälligkeit selbst.",
        "source": "Buch Band 2, S. 218 · § 271 BGB (erg.)",
        "points": 1,
    },
    {
        "topic": "Zahlungsverzug · Mahnung",
        "prompt": "In welchem Fall ist eine Mahnung typischerweise entbehrlich?",
        "choices": [
            "Wenn der Schuldner zum ersten Mal zu spät zahlt",
            "Wenn der Zahlungstermin kalendermäßig bestimmt war (z. B. zahlbar am 09.09.)",
            "Wenn der Betrag unter 1.000 € liegt",
            "Wenn der Gläubiger bereits einen Mahnbescheid beantragt hat",
        ],
        "answer": 1,
        "feedback": "Bei einem kalendermäßig bestimmten Termin („zahlbar am 09.09.“) kommt der Schuldner ohne Mahnung in Verzug. Bloße Angaben wie „zahlbar innerhalb von 10 Tagen“ oder „Ende März“ sind oft nicht so bestimmt.",
        "source": "Buch Band 2, S. 218 · § 286 BGB · Übungen Zahlungsverkehr S. 35",
        "points": 1,
    },
    {
        "topic": "Zahlungsverzug · Rechte",
        "prompt": "Welche Rechte hat der Gläubiger, wenn der Käufer im Zahlungsverzug ist?",
        "choices": [
            "Nur Rücktritt, ohne weiter auf Zahlung bestehen zu dürfen",
            "Zahlung plus Verzugszinsen, nach angemessener Nachfrist Rücktritt und Schadenersatz",
            "Sofortiger Rücktritt ohne Nachfrist in jedem Fall",
            "Nur eine Anzeige bei der Schufa, keine vertraglichen Rechte",
        ],
        "answer": 1,
        "feedback": "Der Verkäufer behält den Anspruch auf Zahlung und kann Verzugszinsen verlangen. Rücktritt setzt in der Regel eine angemessene Nachfrist voraus (§ 323 BGB). Schadenersatz folgt aus §§ 280–284 BGB.",
        "source": "Buch Band 2, S. 218–219 · §§ 323, 280–284, 288 BGB",
        "points": 1,
    },
    {
        "topic": "Zahlungsverzug · Verzugszinsen",
        "prompt": "Wie hoch sind die gesetzlichen Verzugszinsen nach § 288 BGB?",
        "choices": [
            "Einheitlich 5 Prozentpunkte über dem Basiszinssatz, unabhängig vom Schuldner",
            "Bei Verbrauchern 5 und bei Unternehmen 9 Prozentpunkte über dem Basiszinssatz",
            "Immer 9 Prozentpunkte über dem Basiszinssatz",
            "Genau in Höhe des Basiszinssatzes, ohne Aufschlag",
        ],
        "answer": 1,
        "feedback": "§ 288 BGB: 5 Prozentpunkte über dem Basiszinssatz im Verbrauchergeschäft, 9 Prozentpunkte unter Unternehmern.",
        "source": "Buch Band 2, S. 219 · § 288 BGB",
        "points": 1,
    },
    {
        "topic": "Zahlungsverzug · Verjährung",
        "prompt": "Wann verjährt der Anspruch auf den Kaufpreis in der Regel und wann beginnt die Frist?",
        "choices": [
            "Nach 2 Jahren, beginnend am Tag des Vertragsschlusses",
            "Nach 3 Jahren, beginnend mit dem Schluss des Jahres, in dem der Anspruch entstanden ist und der Gläubiger davon Kenntnis hatte",
            "Nach 30 Jahren, beginnend mit der Mahnung",
            "Nach 3 Jahren, beginnend genau am Tag der Fälligkeit, unabhängig vom Jahresende",
        ],
        "answer": 1,
        "feedback": "Regelverjährung § 195 BGB: 3 Jahre. Beginn nach § 199 BGB: Schluss des Jahres, in dem der Anspruch entstanden ist und der Gläubiger Kenntnis (oder grob fahrlässige Unkenntnis) hat.",
        "source": "Buch Band 2 · §§ 195, 199 BGB",
        "points": 1,
    },
    {
        "topic": "Gerichtliches Mahnverfahren",
        "prompt": "Wie viel Zeit hat der Schuldner typischerweise, um gegen einen Mahnbescheid Widerspruch einzulegen?",
        "choices": [
            "Eine Woche",
            "Zwei Wochen",
            "Einen Monat",
            "Drei Monate",
        ],
        "answer": 1,
        "feedback": "Nach Zustellung des Mahnbescheids hat der Schuldner in der Regel zwei Wochen Zeit für den Widerspruch. Reagiert er nicht, kann der Gläubiger den Vollstreckungsbescheid beantragen.",
        "source": "HOT 2/2018, S. 17 · Buchübungen S. 35",
        "points": 1,
    },
    {
        "topic": "Gerichtliches Mahnverfahren",
        "prompt": "Was folgt typischerweise, wenn der Schuldner auf den Mahnbescheid nicht reagiert?",
        "choices": [
            "Das Verfahren ist automatisch beendet",
            "Der Gläubiger kann den Erlass eines Vollstreckungsbescheids beantragen",
            "Es wird sofort Zwangsvollstreckung ohne weiteren Titel durchgeführt",
            "Das Amtsgericht setzt von sich aus einen Gerichtstermin an",
        ],
        "answer": 1,
        "feedback": "Ohne Widerspruch kann der Gläubiger den Vollstreckungsbescheid beantragen. Erst dieser (oder ein Urteil) ist ein typischer Vollstreckungstitel. Gegen den Vollstreckungsbescheid ist der Einspruch das Rechtsmittel (ebenfalls in der Regel innerhalb von zwei Wochen).",
        "source": "HOT 2/2018, S. 17",
        "points": 1,
    },
    {
        "topic": "Gerichtliches Mahnverfahren",
        "prompt": "Welches Rechtsmittel legt der Schuldner gegen einen Vollstreckungsbescheid ein?",
        "choices": [
            "Widerspruch",
            "Einspruch",
            "Berufung",
            "Revision",
        ],
        "answer": 1,
        "feedback": "Gegen den Mahnbescheid: Widerspruch. Gegen den Vollstreckungsbescheid: Einspruch. Beide typischerweise innerhalb von zwei Wochen.",
        "source": "HOT 2/2018, S. 17",
        "points": 1,
    },
    {
        "topic": "Zahlungsverzug · Prüfung",
        "prompt": "Welche Aussage ist richtig?",
        "choices": [
            "Das außergerichtliche Mahnverfahren ist in jedem Fall nötig, bevor Rechte aus der Nicht-Rechtzeitig-Zahlung geltend gemacht werden können.",
            "Auf eine Mahnung kann verzichtet werden, wenn der Zahlungstermin kalendermäßig bestimmt war.",
            "Im Fall der Nicht-Rechtzeitig-Zahlung kann der Gläubiger immer sofort vom Vertrag zurücktreten.",
            "Für die Nicht-Rechtzeitig-Zahlung gelten niemals dieselben Bestimmungen des BGB wie für die Nicht-Rechtzeitig-Lieferung.",
        ],
        "answer": 1,
        "feedback": "Eine Mahnung ist entbehrlich, wenn der Termin kalendermäßig bestimmt war. Ein außergerichtliches Mahnverfahren ist nicht in jedem Fall Voraussetzung für die Verzugsrechte. Rücktritt braucht in der Regel eine angemessene Nachfrist.",
        "source": "Übungen Zahlungsverkehr und Finanzierung, S. 35, Aufgabe A",
        "points": 1,
    },
    {
        "topic": "Mangelhafte Lieferung · Fristen",
        "prompt": "Welche Rügefrist gilt typischerweise im B2C-Geschäft (Verbrauchsgüterkauf) bei einem Sachmangel?",
        "choices": [
            "Unverzüglich nach Entdeckung, sonst Verlust der Rechte",
            "Zwei Jahre ab Ablieferung der Sache (Verjährung der Mängelansprüche, ohne unverzügliche Rügepflicht wie im Handelskauf)",
            "Drei Jahre ab Vertragsschluss, unabhängig von der Ablieferung",
            "Vier Wochen nach Erhalt der Rechnung",
        ],
        "answer": 1,
        "feedback": "Im Verbrauchsgüterkauf (B2C) verjähren die Mängelansprüche in der Regel in zwei Jahren ab Ablieferung. Die kaufmännische Rügeobliegenheit „unverzüglich“ gilt im Handelskauf (B2B, § 377 HGB). Bei Arglist gelten längere Fristen (regelmäßig drei Jahre).",
        "source": "LF8 Mangelhafte Lieferung · Buch Band 2",
        "points": 1,
    },
    {
        "topic": "Mangelhafte Lieferung · Rechte",
        "prompt": "In welcher Reihenfolge macht der Käufer seine Rechte bei einem Sachmangel typischerweise geltend?",
        "choices": [
            "Zuerst Rücktritt oder Minderung, danach Nacherfüllung",
            "Zuerst Nacherfüllung (Nachbesserung oder Nachlieferung), danach Stufe-2-Rechte wie Rücktritt, Minderung oder Schadenersatz",
            "Zuerst Schadenersatz, unabhängig von einer Fristsetzung",
            "Nur Umtausch, andere Rechte gibt es nicht",
        ],
        "answer": 1,
        "feedback": "Stufe 1 ist die Nacherfüllung. Scheitert sie oder ist sie unzumutbar, kommen Stufe-2-Rechte (Rücktritt, Minderung, Schadenersatz) in Betracht.",
        "source": "LF8 Mangelhafte Lieferung · Buch Band 2",
        "points": 1,
    },
    {
        "topic": "Lieferungsverzug",
        "prompt": "Wann liegt Lieferungsverzug typischerweise vor?",
        "choices": [
            "Schon mit Vertragsschluss, weil jede Lieferung unsicher ist",
            "Wenn die Lieferpflicht fällig ist und eine Mahnung vorliegt oder die Mahnung entbehrlich ist",
            "Erst wenn die Ware sichtbare Mängel hat",
            "Erst nach Ablauf der zweijährigen Gewährleistungsfrist",
        ],
        "answer": 1,
        "feedback": "Wie beim Zahlungsverzug: Fälligkeit plus Mahnung bzw. Entbehrlichkeit der Mahnung (z. B. kalendermäßig bestimmter Liefertermin).",
        "source": "LF8 Lieferungsverzug · Buch Band 2",
        "points": 1,
    },
    {
        "topic": "Mangelarten",
        "prompt": "Was unterscheidet eine Reklamation von einer Beschwerde?",
        "choices": [
            "Es gibt keinen Unterschied, beide Begriffe meinen dasselbe",
            "Eine Reklamation enthält zusätzlich einen rechtlichen Anspruch, eine Beschwerde äußert Unzufriedenheit",
            "Eine Beschwerde ist immer schriftlich, eine Reklamation immer mündlich",
            "Eine Reklamation betrifft nur Preise, eine Beschwerde nur Lieferzeiten",
        ],
        "answer": 1,
        "feedback": "Beschwerde = Unzufriedenheit. Reklamation = Unzufriedenheit plus rechtlicher Anspruch (z. B. wegen eines Mangels).",
        "source": "LF5/LF8 Abgrenzung, Buch S. 446",
        "points": 1,
    },
]

LF8_TOPICS = [
    {"nr": 1, "title": "Mangelhafte Lieferung", "source": "Band 2", "summary": "Erkennbarkeit (offen, versteckt, arglistig) · Sachmangelarten · Prüfungs- und Rügefristen (B2C 2 Jahre, B2B unverzüglich, Arglist 3 Jahre) · Rechte: zuerst Nacherfüllung, dann Stufe 2."},
    {"nr": 2, "title": "Lieferungsverzug", "source": "Band 2", "summary": "Nicht rechtzeitige Leistung des Verkäufers. Prüfung wie beim Zahlungsverzug: Fälligkeit und Mahnung bzw. Entbehrlichkeit. Rechte nach Nachfrist: Rücktritt und Schadenersatz."},
    {"nr": 3, "title": "Zahlungsverzug", "source": "Band 2, S. 218–219", "summary": "Käufer zahlt nicht rechtzeitig. Prüfschema A–B nach § 286 BGB: Fälligkeit, dann Mahnung oder 30-Tage-/Kalendertermin. Rechte: Zahlung, Verzugszinsen, Rücktritt, Schadenersatz."},
    {"nr": 4, "title": "Gerichtliches Mahnverfahren", "source": "HOT 2/2018, S. 17", "summary": "Antrag auf Mahnbescheid → 2 Wochen Widerspruch → Vollstreckungsbescheid → 2 Wochen Einspruch → sonst Zwangsvollstreckung."},
    {"nr": 5, "title": "Verzugszinsen und Verjährung", "source": "§§ 288, 195, 199 BGB", "summary": "Verzugszinsen: +5 / +9 Prozentpunkte über dem Basiszinssatz. Verjährung regelmäßig 3 Jahre, Beginn am Schluss des Jahres."},
]


def add_ids(prefix, questions):
    for i, q in enumerate(questions, 1):
        q["id"] = f"{prefix}-q{i:03d}"
    return questions


def cards_from_topics(course_id, topics):
    cards = []
    for t in topics:
        cards.append(
            {
                "id": f"{course_id}-c{t['nr']:02d}",
                "front": t["title"],
                "back": t["summary"],
                "topic": t["title"],
            }
        )
    return cards


def cards_from_questions(course_id, questions, start=1, limit=24):
    """A few extra cards from short fact-style questions (numbers, definitions)."""
    cards = []
    n = start
    for q in questions:
        if len(q["prompt"]) > 160:
            continue
        ans = q["choices"][q["answer"]] if 0 <= q["answer"] < len(q["choices"]) else ""
        back = ans
        if q.get("feedback"):
            back = f"{ans}\n\n{q['feedback']}"
        if len(back) > 420:
            continue
        cards.append(
            {
                "id": f"{course_id}-cq{n:02d}",
                "front": q["prompt"],
                "back": back,
                "topic": q.get("topic") or "Wiederholung",
            }
        )
        n += 1
        if len(cards) >= limit:
            break
    return cards


def dedupe_questions(questions):
    seen = set()
    out = []
    for q in questions:
        key = re.sub(r"\s+", " ", q["prompt"].lower())[:180]
        if key in seen:
            continue
        seen.add(key)
        out.append(q)
    return out


def main():
    # Topics
    t_besch = parse_topics(ROOT / "lf5_beschwerde/overview.py")
    t_zahl = parse_topics(ROOT / "lf5_zahlung/overview.py")
    t_markt = parse_topics(ROOT / "lf6_markt/themen.py")
    t_proj = parse_topics(ROOT / "lf9/overview.py")

    names_b = {t["nr"]: t["title"] for t in t_besch}
    names_z = {t["nr"]: t["title"] for t in t_zahl}
    names_m = {t["nr"]: t["title"] for t in t_markt}
    names_p = {t["nr"]: t["title"] for t in t_proj}

    q_besch = []
    q_besch += mc_from_questions_py(ROOT / "questions.py", "Beschwerdemanagement", "Buch Kap. 4.1")
    q_besch += mc_from_questions_py(ROOT / "questions_sachlich.py", "Beschwerdemanagement", "Buch Kap. 4.1.2")
    q_besch += mc_from_questions_py(ROOT / "questions_schwach.py", "Beschwerdemanagement", "Buch Kap. 4.1.5–4.1.6")
    q_besch += mc_from_selbsttest(ROOT / "lf5_beschwerde/selbsttest.py", names_b, "Selbsttest Beschwerde")
    q_besch = dedupe_questions(q_besch)

    q_zahl = dedupe_questions(mc_from_selbsttest(ROOT / "lf5_zahlung/selbsttest.py", names_z, "Selbsttest Zahlungsverkehr"))
    q_markt = dedupe_questions(mc_from_selbsttest(ROOT / "lf6_markt/selbsttest.py", names_m, "Selbsttest Markt"))
    q_proj = dedupe_questions(mc_from_selbsttest(ROOT / "lf9/selbsttest.py", names_p, "Selbsttest Projektmanagement"))
    q_lf8 = [dict(q, id="") for q in LF8_QUESTIONS]

    # Combine LF5 quizzes but keep units
    quizzes = [
        {
            "id": "lf5-beschwerde",
            "courseId": "lf5",
            "title": "Test: Beschwerdemanagement",
            "intro": "Multiple-Choice-Fragen aus den Lernzetteln zu Chance, den 5 Schritten, unfairen Methoden, Fehlern und Gesprächsabschluss.",
            "questions": add_ids("lf5b", q_besch),
        },
        {
            "id": "lf5-zahlung",
            "courseId": "lf5",
            "title": "Test: Zahlungsverkehr",
            "intro": "Fragen zu Bonität, Gläubiger und Schuldner, Bar-/halbarer/bargeldloser Zahlung, SEPA, Kreditkarte und Finanzierung.",
            "questions": add_ids("lf5z", q_zahl),
        },
        {
            "id": "lf6-markt",
            "courseId": "lf6",
            "title": "Test: Markt und Preisbildung",
            "intro": "Fragen zu Marktarten, Angebot und Nachfrage, Gleichgewichtspreis, Kurvenverschiebung und Marktformen.",
            "questions": add_ids("lf6", q_markt),
        },
        {
            "id": "lf8-kvs",
            "courseId": "lf8",
            "title": "Test: Kaufvertragsstörungen",
            "intro": "Fragen zu mangelhafter Lieferung, Lieferungsverzug, Zahlungsverzug und gerichtlichem Mahnverfahren.",
            "questions": add_ids("lf8", q_lf8),
        },
        {
            "id": "lf9-projekt",
            "courseId": "lf9",
            "title": "Test: Projektmanagement",
            "intro": "Fragen zu Projektmerkmalen, Phasen, Beteiligten, SMART, magischem Dreieck und Machbarkeit.",
            "questions": add_ids("lf9", q_proj),
        },
    ]

    lf5_topics = (
        [{"nr": t["nr"], "title": t["title"], "source": t["source"], "summary": t["summary"], "unit": "Beschwerdemanagement"} for t in t_besch]
        + [{"nr": 8 + t["nr"], "title": t["title"], "source": t["source"], "summary": t["summary"], "unit": "Zahlungsverkehr"} for t in t_zahl]
    )

    courses = [
        {
            "id": "lf5",
            "short": "LF5",
            "title": "Lernfeld 5 – Beschwerdemanagement und Zahlungsverkehr",
            "subtitle": "Kundenorientiert kommunizieren · Zahlungsarten und Bonität",
            "color": "#0f6cbf",
            "pattern": "pattern-lf5.svg",
            "overview": "In Lernfeld 5 geht es um zwei große Blöcke: professionelles Beschwerdemanagement (Chance, 5 Handlungsschritte, unfaire Methoden, typische Fehler, Gesprächsabschluss) und Zahlungsverkehr (Bonität, Gläubiger und Schuldner, Bar-/halbare/bargeldlose Zahlung, SEPA, Karten, Online und Finanzierung).",
            "topics": lf5_topics,
            "quizIds": ["lf5-beschwerde", "lf5-zahlung"],
        },
        {
            "id": "lf6",
            "short": "LF6",
            "title": "Lernfeld 6 – Markt und Preisbildung",
            "subtitle": "Bestimmungsfaktoren der Kundennachfrage gestalten",
            "color": "#ca3120",
            "pattern": "pattern-lf6.svg",
            "overview": "Markt ist jeder Ort, an dem Angebot und Nachfrage zusammentreffen. Du lernst Marktarten, die Gesetze von Angebot und Nachfrage, den Gleichgewichtspreis, das Verschieben der Kurven und die Marktformen Monopol, Oligopol und Polypol.",
            "topics": t_markt,
            "quizIds": ["lf6-markt"],
        },
        {
            "id": "lf8",
            "short": "LF8",
            "title": "Lernfeld 8 – Kaufvertragsstörungen",
            "subtitle": "Mangelhafte Lieferung · Lieferungsverzug · Zahlungsverzug",
            "color": "#14813e",
            "pattern": "pattern-lf8.svg",
            "overview": "Wenn der Kaufvertrag nicht wie vereinbart erfüllt wird: Sachmangel und Rechte des Käufers, Lieferungsverzug des Verkäufers sowie Zahlungsverzug des Käufers inklusive Verzugszinsen, Verjährung und gerichtlichem Mahnverfahren.",
            "topics": LF8_TOPICS,
            "quizIds": ["lf8-kvs"],
        },
        {
            "id": "lf9",
            "short": "LF9",
            "title": "Lernfeld 9 – Projektmanagement",
            "subtitle": "Projekte planen, steuern und abschließen",
            "color": "#8e3ccb",
            "pattern": "pattern-lf9.svg",
            "overview": "Was ein Projekt nach DIN 69901 ausmacht, die vier Phasen, Muss- und Kann-Beteiligte, Zielarten, die SMART-Regel laut Buch (A = aktiv beeinflussbar), das magische Dreieck und die Machbarkeitsstudie.",
            "topics": t_proj,
            "quizIds": ["lf9-projekt"],
        },
    ]

    cards = {
        "lf5": cards_from_topics("lf5", t_besch + t_zahl) + cards_from_questions("lf5", q_besch + q_zahl, start=20, limit=18),
        "lf6": cards_from_topics("lf6", t_markt) + cards_from_questions("lf6", q_markt, start=10, limit=12),
        "lf8": cards_from_topics("lf8", LF8_TOPICS) + cards_from_questions("lf8", q_lf8, start=10, limit=12),
        "lf9": cards_from_topics("lf9", t_proj) + cards_from_questions("lf9", q_proj, start=10, limit=12),
    }

    data = {
        "siteName": "Dialogmarketing Lernraum",
        "siteTagline": "Kaufleute für Dialogmarketing · Lernfelder, Tests und Klausurenplaner",
        "courses": courses,
        "quizzes": quizzes,
        "cards": cards,
    }

    # stats
    for qz in quizzes:
        print(f"  {qz['id']}: {len(qz['questions'])} questions")
    for cid, cs in cards.items():
        print(f"  cards {cid}: {len(cs)}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    js = "/* generated – do not edit by hand */\nwindow.LR_CONTENT = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
    OUT.write_text(js, encoding="utf-8")
    print("wrote", OUT, "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
