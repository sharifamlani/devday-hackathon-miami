#!/usr/bin/env python3
"""Generate the FULLY FICTIONAL messy donor dataset + answer key.

Output: data/sample_inputs/  (xlsx, md, 3 docx, answer_key.json)
Run:    python scripts/make_sample_inputs.py          (deterministic, rerunnable)

Everything here is invented. Emails use example.com / example.org only,
phones are 305-555-01xx, organization names are fictional.
"""
import json
import random
import re
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

from docx import Document
from openpyxl import Workbook, load_workbook

SEED = 20261108
AS_OF = date(2026, 11, 8)
OUT = Path(__file__).resolve().parent.parent / "data" / "sample_inputs"
F_XLSX = "give_miami_day_export_2022-2025.xlsx"
F_MD = "board_retreat_notes.md"
F_CHECK = "check_deposit_log_q3_2026.docx"
F_INTAKE = "donor_intake_forms_2026.docx"
F_STOCK = "stock_and_daf_grants.docx"
F_OCTNOV = "online_gifts_oct_nov_2026.xlsx"

rng = random.Random(SEED)
GMD = {2022: date(2022, 11, 17), 2023: date(2023, 11, 16), 2024: date(2024, 11, 21), 2025: date(2025, 11, 20)}

# --------------------------------------------------------------------------- donors
# key: (display name, type, first, last, org, email, phone suffix, city, fund, aliases)
D = {}
_phone = [100]


def donor(key, name, dtype, first, last, org, email, city, fund, aliases=(), notes=""):
    _phone[0] += 1
    D[key] = dict(
        id=f"D{len(D) + 1:02d}", key=key, name=name, type=dtype, first=first, last=last, org=org,
        email=email, phone=f"305-555-{_phone[0]:04d}", city=city, fund=fund,
        aliases=list(aliases) or [name], notes=notes,
        emails=set(), phones=set(), cities=set(), rows=[],
    )


donor("delgado", "Maria Delgado", "individual", "Maria", "Delgado", None, "maria.delgado@example.com", "Coral Gables",
      "Unrestricted", ["Maria Delgado", "María Delgado-Ruiz", "Maria Delgado-Ruiz"], "Give Miami Day anchor donor.")
donor("nguyen", "Robert Nguyen", "individual", "Robert", "Nguyen", None, "robert.nguyen@example.org", "Miami",
      "Unrestricted", ["Robert Nguyen", "Bob Nguyen"], "Monthly donor, $75 on the 5th.")
donor("okafor", "Priscilla Okafor", "individual", "Priscilla", "Okafor", None, "priscilla.okafor.law@example.org",
      "Miami", "Field of Interest", ["Priscilla Okafor"], "Email changed Jan 2026.")
donor("fontaine", "Elizabeth Fontaine", "individual", "Elizabeth", "Fontaine", None, "liz.fontaine@example.com",
      "Miami Beach", "Unrestricted", ["Elizabeth Fontaine", "Liz Fontaine", "Liz F."])
donor("whitaker", "Harold Whitaker", "individual", "Harold", "Whitaker", None, "harold.whitaker@example.org",
      "Coconut Grove", "Donor Advised", ["Harold Whitaker", "Whitaker Family Charitable Fund"],
      "Gives through a donor-advised fund he advises.")
donor("salinas", "Teodoro Salinas", "individual", "Teodoro", "Salinas", None, "teo.salinas@example.com", "Hialeah",
      "Unrestricted", ["Teodoro Salinas", "Teo Salinas"], "Quarterly donor, $300 on the 15th of Jan/Apr/Jul/Oct.")
donor("pierre", "Gloria Pierre-Louis", "individual", "Gloria", "Pierre-Louis", None, "gloria.pierrelouis@example.org",
      "North Miami", "Scholarship", ["Gloria Pierre-Louis"], "Year-end (December) giver.")
donor("raman", "Priya Raman", "individual", "Priya", "Raman", None, "priya.raman@example.com", "Coral Gables",
      "Unrestricted", ["Priya Raman"], "Gave early for Give Miami Day 2026.")
donor("brandt", "Walter Brandt", "individual", "Walter", "Brandt", None, "walter.brandt@example.com", "Key Biscayne",
      "Designated", ["Walter Brandt"], "Gives each spring.")
donor("achterberg", "Samuel Achterberg", "individual", "Samuel", "Achterberg", None, "sam.achterberg@example.org",
      "Pinecrest", "Unrestricted", ["Samuel Achterberg", "S. Achterberg"])
donor("ferrante", "Lucia Ferrante", "individual", "Lucia", "Ferrante", None, "lucia.ferrante@example.com",
      "Miami", "Unrestricted", ["Lucia Ferrante", "Lucía Ferrante"])
donor("oyelaran", "Marcus Oyelaran", "individual", "Marcus", "Oyelaran", None, "marcus.oyelaran@example.org",
      "Miramar", "Unrestricted")
donor("kowalczyk", "Dana Kowalczyk", "individual", "Dana", "Kowalczyk", None, "dana.kowalczyk@example.com",
      "Homestead", "Unrestricted")
donor("villaverde", "Esperanza Villaverde", "individual", "Esperanza", "Villaverde", None,
      "esperanza.villaverde@example.org", "Hialeah", "Unrestricted")
donor("lindqvist", "Tobias Lindqvist", "individual", "Tobias", "Lindqvist", None, "tobias.lindqvist@example.com",
      "Fort Lauderdale", "Unrestricted")
donor("castellanos", "Naomi Castellanos", "individual", "Naomi", "Castellanos", None,
      "naomi.castellanos@example.org", "Doral", "Unrestricted")
donor("baptiste", "Jerome Baptiste", "individual", "Jerome", "Baptiste", None, "jerome.baptiste@example.com",
      "North Miami", "Unrestricted")
donor("park", "Hye-jin Park", "individual", "Hye-jin", "Park", None, "hyejin.park@example.org", "Aventura",
      "Unrestricted")
donor("quintero", "Rafael Quintero", "individual", "Rafael", "Quintero", None, "rafael.quintero@example.com",
      "Kendall", "Unrestricted")
donor("moreau", "Annelise Moreau", "individual", "Annelise", "Moreau", None, "annelise.moreau@example.org",
      "Coral Gables", "Unrestricted")
donor("achebe", "Desmond Achebe-Wells", "individual", "Desmond", "Achebe-Wells", None,
      "desmond.achebewells@example.com", "Coconut Grove", "Designated")
donor("ibarra", "Carmen Ibarra", "individual", "Carmen", "Ibarra", None, "carmen.ibarra@example.org", "Pinecrest",
      "Field of Interest")
donor("szymanski", "Victor Szymanski", "individual", "Victor", "Szymanski", None, "victor.szymanski@example.com",
      "Miami Beach", "Unrestricted")
donor("rutherford", "Imani Rutherford", "individual", "Imani", "Rutherford", None, "imani.rutherford@example.org",
      "Miami Gardens", "Unrestricted")
donor("tran", "Leopold Tran", "individual", "Leopold", "Tran", None, "leopold.tran@example.com", "Cutler Bay",
      "Scholarship", ["Leopold Tran"], "New donor, intake form only.")
donor("marchetti", "Sofia Marchetti", "individual", "Sofia", "Marchetti", None, "sofia.marchetti@example.org",
      "Miami Shores", "Field of Interest", ["Sofia Marchetti"], "New donor, intake form only.")
# organizations (all invented)
donor("veloria", "Veloria Bay Foundation", "organization", None, None, "Veloria Bay Foundation",
      "grants@example.org", "Miami", "Designated", ["Veloria Bay Foundation", "Veloria Bay Fdn"],
      "Family foundation, annual April grant. Shack Society level.")
donor("bellweather", "Bellweather Pines Family Foundation", "organization", None, None,
      "Bellweather Pines Family Foundation", "office.bellweather@example.com", "Coral Gables", "Organization Endowment",
      ["Bellweather Pines Family Foundation", "Bellweather Pines Family Fdn."], "December grants.")
donor("tamarind", "Tamarind Quay Hardware LLC", "organization", None, None, "Tamarind Quay Hardware LLC",
      "tamarindquay.accounts@example.com", "Homestead", "Unrestricted",
      ["Tamarind Quay Hardware LLC", "Tamarind Quay Hardware, LLC", "Tamarind Quay Hdwe, L.L.C.", "Tamarind Quay"],
      "Local business, Give Miami Day sponsor.")
donor("halcyon", "Halcyon Reef Dental Group", "organization", None, None, "Halcyon Reef Dental Group",
      "frontdesk.halcyonreef@example.org", "Kendall", "Field of Interest", ["Halcyon Reef Dental Group", "Halcyon Reef Dental"])
donor("quillfeather", "Quillfeather Coffee Roasters", "organization", None, None, "Quillfeather Coffee Roasters",
      "hello.quillfeather@example.com", "Miami", "Unrestricted", ["Quillfeather Coffee Roasters", "Quillfeather Coffee"])
donor("marrow", "Marrow Lane Print Co.", "organization", None, None, "Marrow Lane Print Co.",
      "billing.marrowlane@example.org", "Hialeah", "Organization Endowment", ["Marrow Lane Print Co.", "Marrow Lane Print"])
donor("ostrander", "Ostrander-Pell Charitable Trust", "organization", None, None, "Ostrander-Pell Charitable Trust",
      "trustees.ostranderpell@example.com", "Fort Lauderdale", "Scholarship", ["Ostrander-Pell Charitable Trust"])


def fmt_phone(d, style=None):
    p = d["phone"]
    d["phones"].add(p)
    style = style if style is not None else rng.randrange(3)
    a, b, c = p.split("-")
    return [p, f"({a}) {b}-{c}", f"{a}.{b}.{c}"][style]


def fmt_email(d, email=None, upper=False):
    e = email or d["email"]
    d["emails"].add(e.lower())
    return e.title().replace("@", "@") if upper else e


def city_of(d):
    d["cities"].add(d["city"])
    return d["city"]


# --------------------------------------------------------------------------- gifts
GIFTS = []  # every real gift (unique)
EXTRA_ROWS = []  # second recordings of an existing gift


def gift(dk, d_, amt, channel, fund, dest, name=None, email=None, note="", fund_stated=True, **kw):
    g = dict(donor=dk, date=d_, amount=amt, channel=channel, fund=fund, dest=dest, name=name or D[dk]["name"],
             email=email, note=note, fund_stated=fund_stated)
    g.update(kw)
    g["id"] = None
    GIFTS.append(g)
    return g


def dt(y, m, d_):
    return date(y, m, d_)


# --- Give Miami Day gifts (sheet "GMD gifts")
def gmd(dk, years, amts, fund=None, namefn=None):
    for y, a in zip(years, amts):
        n = namefn(y) if namefn else None
        gift(dk, GMD[y], a, "Give Miami Day", fund or D[dk]["fund"], "gmd", name=n, fund_stated=rng.random() < 0.5)


gmd("delgado", [2022, 2023, 2024, 2025], [250, 250, 300, 300],
    namefn=lambda y: "Maria Delgado" if y < 2024 else "María Delgado-Ruiz")
gmd("tamarind", [2023, 2024, 2025], [1000, 1000, 1200],
    namefn=lambda y: {2023: "Tamarind Quay Hardware LLC", 2024: "Tamarind Quay Hdwe, L.L.C.", 2025: "Tamarind Quay Hardware, LLC"}[y])
gmd("fontaine", [2022, 2024], [100, 150], namefn=lambda y: "Elizabeth Fontaine" if y == 2022 else "Liz Fontaine")
gmd("achterberg", [2023, 2025], [75, 100])
gmd("ferrante", [2022, 2023], [50, 60])
gmd("kowalczyk", [2024, 2025], [40, 50])
gmd("quillfeather", [2024, 2025], [250, 250])
gmd("baptiste", [2025], [25])
gmd("park", [2023, 2024, 2025], [100, 100, 120])
gmd("villaverde", [2022, 2025], [35, 50])
gmd("raman", [2023, 2024, 2025], [200, 250, 250])
gmd("quintero", [2024], [100])
gmd("moreau", [2022, 2023, 2024], [150, 150, 175])
gmd("lindqvist", [2023], [500])

# --- Online sheet
for i in range(17):  # monthly donor, 5th of each month Jul 2025 .. Nov 2026
    y, m = (2025, 7 + i) if 7 + i <= 12 else ((2026, 7 + i - 12) if i < 17 else None)
    nm = "Bob Nguyen" if i in (4, 9) else ("R. Nguyen" if i == 12 else "Robert Nguyen")
    gift("nguyen", dt(y, m, 5), 75, "online", "Unrestricted", "online", name=nm, fund_stated=False, with_phone=True)
for y, m in [(2025, 1), (2025, 4), (2025, 7), (2025, 10), (2026, 1), (2026, 4)]:  # quarterly, last gift Apr 2026
    gift("salinas", dt(y, m, 15), 300, "online", "Unrestricted", "online",
         name="Teodoro Salinas" if y == 2025 else "Teo Salinas", fund_stated=False)
for y, m, dd, a in [(2022, 12, 27, 200), (2023, 12, 19, 250), (2024, 12, 23, 250), (2025, 12, 22, 300)]:
    gift("pierre", dt(y, m, dd), a, "online", "Scholarship", "online")
gift("okafor", dt(2025, 6, 10), 500, "online", "Field of Interest", "online", email="priscilla.okafor@example.com")
gift("okafor", dt(2026, 2, 14), 500, "online", "Field of Interest", "online", email="priscilla.okafor.law@example.org")
gift("brandt", dt(2024, 3, 12), 400, "online", "Designated", "online")
gift("brandt", dt(2025, 3, 18), 400, "online", "Designated", "online")
gift("baptiste", dt(2026, 5, 2), 60, "online", "Unrestricted", "online")
gift("castellanos", dt(2025, 9, 9), 150, "online", "Unrestricted", "online")
gift("castellanos", dt(2026, 3, 3), 150, "online", "Unrestricted", "online")
gift("oyelaran", dt(2026, 8, 20), 120, "online", "Unrestricted", "online")
gift("szymanski", dt(2024, 12, 3), 75, "online", "Unrestricted", "online")
gift("szymanski", dt(2025, 12, 2), 100, "online", "Unrestricted", "online")
gift("szymanski", dt(2026, 4, 23), 500, "event", "Unrestricted", "online", note="Spring Luncheon table")
gift("rutherford", dt(2025, 12, 2), 50, "online", "Unrestricted", "online", note="GivingTuesday")
gift("rutherford", dt(2026, 4, 23), 250, "event", "Unrestricted", "online", note="Spring Luncheon")
gift("lindqvist", dt(2026, 6, 30), 250, "online", "Unrestricted", "online")

# --- Major sheet
gift("veloria", dt(2022, 4, 12), 200000, "check", "Designated", "major", name="Veloria Bay Fdn")
gift("veloria", dt(2023, 4, 18), 250000, "check", "Designated", "major", name="Veloria Bay Foundation")
gift("veloria", dt(2024, 4, 16), 300000, "check", "Designated", "major", name="Veloria Bay Foundation")
gift("veloria", dt(2025, 4, 15), 350000, "check", "Designated", "major", name="Veloria Bay Foundation Inc")
gift("bellweather", dt(2023, 12, 14), 15000, "check", "Organization Endowment", "major", name="Bellweather Pines Family Fdn.")
gift("bellweather", dt(2024, 12, 12), 15000, "check", "Organization Endowment", "major", name="Bellweather Pines Family Fdn.")
gift("bellweather", dt(2025, 12, 11), 20000, "check", "Organization Endowment", "major", name="Bellweather Pines Family Foundation")
gift("halcyon", dt(2025, 6, 30), 5000, "check", "Field of Interest", "major")
gift("ibarra", dt(2023, 6, 20), 5000, "check", "Field of Interest", "major")
gift("ibarra", dt(2025, 6, 24), 5000, "check", "Field of Interest", "major")
gift("whitaker", dt(2022, 12, 15), 2500, "check", "Donor Advised", "major")

# --- Check log Q3 2026 (docx)
CHECKS = [
    ("achterberg", dt(2026, 7, 14), 500, "annual gift", "Samuel Achterberg"),
    ("ibarra", dt(2026, 7, 2), 5000, "Field of Interest - health access", "Carmen Ibarra"),
    ("kowalczyk", dt(2026, 7, 29), 150, "", "D. Kowalczyk"),
    ("villaverde", dt(2026, 8, 3), 250, "in memory of her mother", "Esperanza Villaverde"),
    ("nguyen", dt(2026, 8, 11), 250, "extra - from Bob", "Bob Nguyen"),
    ("quintero", dt(2026, 8, 18), 100, "", "Rafael Quintero"),
    ("marrow", dt(2026, 8, 26), 1000, "sponsor - spring mailer", "Marrow Lane Print Co."),
    ("fontaine", dt(2026, 8, 5), 350, "dinner tickets", "Liz Fontaine"),
    ("tamarind", dt(2026, 9, 2), 1500, "Q3 sponsorship", "Tamarind Quay Hardware, LLC"),
    ("moreau", dt(2026, 9, 9), 300, "", "Annelise Moreau"),
    ("ostrander", dt(2026, 9, 15), 7500, "Scholarship", "Ostrander-Pell Charitable Trust"),
    ("ferrante", dt(2026, 9, 21), 200, "for the kids program", "Lucia Ferrante"),
]
for dk, d_, a, memo, nm in sorted(CHECKS, key=lambda c: c[1]):
    gift(dk, d_, a, "check", D[dk]["fund"] if dk != "ostrander" else "Scholarship", "check", name=nm, note=memo)

# --- Stock and DAF memo
gift("whitaker", dt(2024, 12, 20), 10000, "DAF grant", "Donor Advised", "stock", name="Whitaker Family Charitable Fund")
gift("whitaker", dt(2025, 12, 18), 12000, "DAF grant", "Donor Advised", "stock", name="Whitaker Family Charitable Fund")
gift("ostrander", dt(2025, 12, 29), 18400, "stock", "Scholarship", "stock", note="150 sh. Pelican Strand Index Fund, value at transfer")
gift("achebe", dt(2026, 6, 11), 3200, "stock", "Designated", "stock", note="40 sh. Pelican Strand Savings Bank stock")

# --- Gifts mentioned only in the board notes
gift("halcyon", dt(2026, 9, 22), 25000, "check", "Field of Interest", "notes", note="corporate gift")
gift("raman", dt(2026, 11, 2), 500, "check", "Unrestricted", "notes", name="Priya Raman", note="early, ahead of GMD")

# the one gift recorded twice: Samuel Achterberg's July check also keyed into the Excel Online sheet
DOUBLE_SRC = next(g for g in GIFTS if g["dest"] == "check" and g["donor"] == "achterberg")
EXTRA_ROWS.append(dict(of=DOUBLE_SRC, dest="online", name="S. Achterberg", date=dt(2026, 7, 15), note="check dep.",
                       amount=500))

PLEDGES = [  # NOT gifts: promised, not yet received
    dict(donor="ferrante", amount=1000, for_="Give Miami Day 2026"),
    dict(donor="moreau", amount=500, for_="Give Miami Day 2026"),
    dict(donor="tamarind", amount=1500, for_="Give Miami Day 2026 match"),
    dict(donor="lindqvist", amount=2000, for_="year-end"),
]

# stable ids: by date then donor
for n, g in enumerate(sorted(GIFTS, key=lambda g: (g["date"], g["donor"], g["amount"])), 1):
    g["id"] = f"G{n:03d}"
for ex in EXTRA_ROWS:
    ex["gift_id"] = ex["of"]["id"]

# --- Gift-alert cases (added after the stable ids above so earlier gift ids never move)
# Hye-jin Park: monthly $40 on the 10th, Jun-Oct 2026; the Nov 10 charge was DECLINED (row exists, not a gift).
# Rafael Quintero: monthly $50 on the 3rd, Mar-Nov 2026, but SKIPPED September; resumed in October (late, then resumed).
_next_id = len(GIFTS)
for _dk, _day, _amt, _months in (("park", 10, 40, range(6, 10)), ("quintero", 3, 50, [3, 4, 5, 6, 7, 8, 10, 11])):
    for _m in _months:
        _g = gift(_dk, dt(2026, _m, _day), _amt, "online", "Unrestricted", "online", fund_stated=False, note="monthly")
        _next_id += 1
        _g["id"] = f"G{_next_id:03d}"
FAILED_GIFTS = [dict(donor="park", date=dt(2026, 10, 10), amount=40, name="Hye-jin Park", note="monthly - card declined", loc=None)]


# --- Oct-Nov 2026 online + wire export (online_gifts_oct_nov_2026.xlsx): the Q4 money. Added last, with its own
# random stream, so every id, row and byte of the files above stays exactly as it was.
# (donor key, date, amount, channel, fund, name as written, method column, memo)
OCTNOV = [
    ("ibarra", dt(2026, 10, 9), 8000, "online", "Field of Interest", "Carmen Ibarra", "Credit card", "health access, fall appeal"),
    ("fontaine", dt(2026, 10, 9), 2500, "online", "Unrestricted", "Liz F.", "Credit card", ""),
    ("ostrander", dt(2026, 10, 14), 20000, "online", "Scholarship", "Ostrander-Pell Charitable Trust", "Wire", "fall tranche"),
    ("bellweather", dt(2026, 10, 21), 40000, "online", "Organization Endowment", "Bellweather Pines Family Fdn.", "Wire", "early year-end grant"),
    ("whitaker", dt(2026, 10, 28), 15000, "DAF grant", "Donor Advised", "Whitaker Family Charitable Fund", "DAF portal", "advised by H. Whitaker"),
    ("marrow", dt(2026, 10, 30), 2500, "online", "Organization Endowment", "Marrow Lane Print", "ACH", "sponsor - year-end mailer"),
    ("quillfeather", dt(2026, 10, 31), 1000, "online", "Unrestricted", "Quillfeather Coffee", "Credit card", "round-up at the register"),
    ("achterberg", dt(2026, 11, 1), 1500, "online", "Unrestricted", "S. Achterberg", "Credit card", ""),
    ("achebe", dt(2026, 11, 4), 6000, "online", "Designated", "Desmond Achebe-Wells", "ACH", ""),
    ("szymanski", dt(2026, 10, 12), 250, "online", "Unrestricted", "Victor Szymanski", "Credit card", ""),
    ("castellanos", dt(2026, 10, 19), 150, "online", "Unrestricted", "Naomi Castellanos", "Credit card", ""),
    ("rutherford", dt(2026, 10, 20), 100, "online", "Unrestricted", "Imani Rutherford", "Credit card", ""),
    ("kowalczyk", dt(2026, 10, 22), 75, "online", "Unrestricted", "Dana Kowalczyk", "Credit card", ""),
    ("villaverde", dt(2026, 10, 24), 100, "online", "Unrestricted", "Esperanza Villaverde", "Credit card", ""),
    ("okafor", dt(2026, 11, 3), 500, "online", "Field of Interest", "Priscilla Okafor", "Credit card", "new email"),
    ("oyelaran", dt(2026, 11, 5), 100, "online", "Unrestricted", "Marcus Oyelaran", "Credit card", ""),
    ("baptiste", dt(2026, 11, 6), 40, "online", "Unrestricted", "Jerome Baptiste", "Credit card", ""),
    ("lindqvist", dt(2026, 11, 7), 250, "online", "Unrestricted", "Tobias Lindqvist", "Credit card", ""),
]
for _dk, _d, _amt, _ch, _fund, _nm, _method, _memo in OCTNOV:
    _g = gift(_dk, _d, _amt, _ch, _fund, "oct_nov", name=_nm, note=_memo, method=_method,
              email="priscilla.okafor.law@example.org" if _dk == "okafor" else None)
    _g["id"] = None
for _n, _g in enumerate(sorted((g for g in GIFTS if g["dest"] == "oct_nov"), key=lambda g: (g["date"], g["donor"])), 1):
    _g["id"] = f"G{_next_id + _n:03d}"


SRC = defaultdict(list)  # donor key -> source row dicts


def src(dk, file, loc, written, kind):
    SRC[dk].append(dict(file=file, location=loc, name_as_written=written, kind=kind))


# --------------------------------------------------------------------------- Excel
def fmt_date(d_):
    s = rng.randrange(4)
    if s == 0:
        return d_.strftime("%m/%d/%Y")
    if s == 1:
        return d_.isoformat()
    if s == 2:
        return d_.strftime("%b %d %Y").replace(" 0", " ")
    return datetime(d_.year, d_.month, d_.day)  # real Excel date


def fmt_amt(a):
    s = rng.randrange(5)
    if s < 3:
        return a
    if s == 3:
        return f"${a:,.2f}"
    return f"{a:,}"


def write_xlsx():
    wb = Workbook()
    # sheet 1: GMD gifts -- title rows, header row 4, blank spacer between years
    ws = wb.active
    ws.title = "GMD gifts"
    ws.append(["Give Miami Day - donor export (run 12/02/2025)", None, None, None, None])
    ws.append(["pulled by J.H. - DO NOT SORT, formulas broken", None, None, None, None])
    ws.append([])
    ws.append(["Donor Name", "Email", "Amt", "Gift Date", "Fund"])
    rows = [g for g in GIFTS if g["dest"] == "gmd"]
    tot = 0
    last_year = None
    for g in sorted(rows, key=lambda g: (g["date"], rng.random())):
        if last_year and g["date"].year != last_year:
            ws.append([])
        last_year = g["date"].year
        d = D[g["donor"]]
        email = None
        if rng.random() < 0.75:
            email = fmt_email(d, upper=(g["name"] == "María Delgado-Ruiz")) if g["donor"] != "delgado" else \
                fmt_email(d, "Maria.Delgado@Example.com" if g["date"].year >= 2024 else None)
        ws.append([g["name"], email, fmt_amt(g["amount"]), fmt_date(g["date"]),
                   g["fund"] if g["fund_stated"] else None])
        g["loc"] = f"sheet 'GMD gifts' row {ws.max_row}"
        src(g["donor"], F_XLSX, g["loc"], g["name"], "gift_row")
        tot += g["amount"]
    ws.append([])
    ws.append(["TOTAL", None, tot, None, None])

    # sheet 2: Online -- header row 1, different headings, more columns
    ws = wb.create_sheet("Online")
    ws.append(["Name", "E-mail", "Amount ($)", "Date", "Phone", "City", "Fund designation", "Notes"])
    rows = [g for g in GIFTS if g["dest"] == "online"]
    allrows = [(g["date"], g, None) for g in rows] + [(ex["date"], ex["of"], ex) for ex in EXTRA_ROWS]
    tot = 0
    for _, g, ex in sorted(allrows, key=lambda t: (t[0], rng.random())):
        d = D[g["donor"]]
        nm = ex["name"] if ex else g["name"]
        amt = ex["amount"] if ex else g["amount"]
        when = ex["date"] if ex else g["date"]
        email = g["email"] or d["email"]
        email = fmt_email(d, email) if rng.random() < 0.8 or g["email"] else None
        phone = fmt_phone(d, 1) if (g.get("with_phone") and not ex and rng.random() < 0.7) else None
        city = city_of(d) if rng.random() < 0.5 else None
        note = (ex["note"] if ex else g["note"]) or None
        if g["channel"] == "event" and not ex and not note:
            note = "event"
        ws.append([nm, email, fmt_amt(amt), fmt_date(when), phone, city,
                   g["fund"] if (g["fund_stated"] and not ex) else None, note])
        loc = f"sheet 'Online' row {ws.max_row}"
        if ex:
            ex["loc"] = loc
            src(g["donor"], F_XLSX, loc, nm, "gift_row_duplicate_recording")
        else:
            g["loc"] = loc
            src(g["donor"], F_XLSX, loc, nm, "gift_row")
        tot += amt
    for fg in FAILED_GIFTS:  # declined charge: listed in the sheet, never counted in the total
        d = D[fg["donor"]]
        ws.append([fg["name"], fmt_email(d), fmt_amt(fg["amount"]), fmt_date(fg["date"]), None, None, None, fg["note"]])
        fg["loc"] = f"sheet 'Online' row {ws.max_row}"
        src(fg["donor"], F_XLSX, fg["loc"], fg["name"], "failed_gift_row")
    ws.append([])
    ws.append(["Grand total", None, tot])

    # sheet 3: Major gifts -- note row, header on row 2, different headings
    ws = wb.create_sheet("Major gifts 22-25")
    ws.append(["Gifts of $2,500+ (some entered by hand - check against bank)"])
    ws.append(["Donor / Organization", "Contact email", "Gift Amount", "Received", "Type", "Comments"])
    rows = [g for g in GIFTS if g["dest"] == "major"]
    tot = 0
    for g in sorted(rows, key=lambda g: g["date"]):
        d = D[g["donor"]]
        ws.append([g["name"], fmt_email(d) if rng.random() < 0.8 else None, fmt_amt(g["amount"]), fmt_date(g["date"]),
                   "check" if g["channel"] == "check" else g["channel"], g["note"] or None])
        g["loc"] = f"sheet 'Major gifts 22-25' row {ws.max_row}"
        src(g["donor"], F_XLSX, g["loc"], g["name"], "gift_row")
        tot += g["amount"]
    ws.append(["TOTAL", None, tot])
    for w in wb.worksheets:
        for col in "ABCDEFGH":
            w.column_dimensions[col].width = 26
    wb.save(OUT / F_XLSX)


def write_octnov():
    """Q4 2026 online + wire gifts. Messy on purpose: a title block, a different header per sheet, mixed date and
    amount formats, an inconsistent Phone column, and sub-total rows that are not gifts."""
    r = random.Random(SEED + 1)   # its own stream: the other files must not move

    def date_cell(d_):
        return [d_.strftime("%m/%d/%Y"), d_.isoformat(), d_.strftime("%b %d, %Y").replace(" 0", " "),
                datetime(d_.year, d_.month, d_.day)][r.randrange(4)]

    def amt_cell(a):
        k = r.randrange(5)
        return a if k < 2 else (f"${a:,.2f}" if k == 2 else (f"{a:,}" if k == 3 else f"${a:,}"))

    wb = Workbook()
    specs = [
        ("October", date(2026, 10, 1), date(2026, 10, 31), ["Supporter", "Email address", "Gift ($)", "Date received", "Method", "Designation", "Phone"]),
        ("Nov 1-7", date(2026, 11, 1), date(2026, 11, 8), ["Donor", "E-mail", "Amt", "Date", "Type", "Fund", "Tel", "Notes"]),
    ]
    for n, (title, lo, hi, header) in enumerate(specs):
        ws = wb.active if n == 0 else wb.create_sheet()
        ws.title = title
        if n == 0:
            ws.append(["Online + wire gifts - Q4 2026 (giving portal export, pulled 11/08)"])
            ws.append(["incl. DAF portal + wires keyed by hand. Subtotal rows are NOT gifts"])
            ws.append([])
        else:
            ws.append(["Early November (through Sat 11/7)"])
        ws.append(header)
        tot = 0
        for g in [g for g in GIFTS if g["dest"] == "oct_nov" and lo <= g["date"] <= hi]:
            d = D[g["donor"]]
            # a variant spelling always carries the email, so the person links; a plain full name sometimes omits it
            email = fmt_email(d, g["email"]) if (g["email"] or g["name"] != d["name"] or r.random() < 0.8) else None
            phone = fmt_phone(d, 1) if r.random() < 0.35 else None
            row = [g["name"], email, amt_cell(g["amount"]), date_cell(g["date"]), g["method"],
                   g["fund"] if r.random() < 0.7 else None, phone]
            if n == 1:
                row.append(g["note"] or None)
            else:
                row[5] = g["fund"] if r.random() < 0.7 else (g["note"] or None)
            ws.append(row)
            g["loc"] = f"sheet '{title}' row {ws.max_row}"
            src(g["donor"], F_OCTNOV, g["loc"], g["name"], "gift_row")
            tot += g["amount"]
        ws.append([])
        ws.append(["Subtotal - " + ("October" if n == 0 else "Nov 1-7"), None, tot])
        for col in "ABCDEFGH":
            ws.column_dimensions[col].width = 26
    wb.save(OUT / F_OCTNOV)


# --------------------------------------------------------------------------- docx
def money(a):
    return f"${a:,.2f}"


def write_check_log():
    doc = Document()
    doc.add_heading("Check Deposit Log - Q3 2026", 1)
    doc.add_paragraph("Development office. Checks received July-September 2026. Entered by hand, "
                      "bank deposit slips attached in the blue binder.")
    t = doc.add_table(rows=1, cols=5)
    t.style = "Table Grid"
    for c, h in zip(t.rows[0].cells, ["Donor", "Check #", "Amount", "Date", "Memo"]):
        c.text = h
    n = 4450
    rows = sorted([g for g in GIFTS if g["dest"] == "check"], key=lambda g: g["date"])
    for g in rows:
        n += rng.randrange(1, 6)
        g["check_no"] = n
        r = t.add_row().cells
        s = rng.randrange(2)
        r[0].text, r[1].text, r[2].text = g["name"], str(n), money(g["amount"])
        r[3].text = g["date"].strftime("%m/%d/%Y") if s else g["date"].strftime("%B %d, %Y")
        r[4].text = g["note"] or ""
        g["loc"] = f"table 1 row {len(t.rows) - 1}"
        src(g["donor"], F_CHECK, g["loc"], g["name"], "gift_row")
    p1 = doc.add_paragraph()
    p1.add_run("Handwritten notes (scanned from the margin)").bold = True
    texts = [
        "Fri 9/4 - Dwayne from the hardware place came by with check #%d. Smudged deposit slip, memo says Q3 sponsorship. "
        "Same people who sponsor Give Miami Day every year. Spelled the name three different ways again!" %
        next(g for g in GIFTS if g["donor"] == "tamarind" and g["dest"] == "check")["check_no"],
        "Liz F. wants her receipt emailed to liz.fontaine@example.com - not the old address. Also she asked if \"Elizabeth\" "
        "and \"Liz\" would end up as two people in the system. (Please no.)",
        "Bob N. dropped his check at the front desk himself, said it is on top of the monthly gift, not instead of it.",
        "Chk %d - Samuel A. - already keyed this one into the online sheet by mistake, see Excel 7/15. Do not count twice." %
        next(g for g in GIFTS if g["donor"] == "achterberg" and g["dest"] == "check")["check_no"],
    ]
    for tx in texts:
        doc.add_paragraph(tx)
    fmt_email(D["fontaine"])  # the notes paragraph above states this address
    doc.save(OUT / F_CHECK)
    # record mentions in paragraphs
    for i, tx in enumerate(texts, 1):
        for dk, nm in [("tamarind", "hardware place"), ("fontaine", "Liz F."), ("nguyen", "Bob N."), ("achterberg", "Samuel A.")]:
            if nm in tx:
                src(dk, F_CHECK, f"handwritten notes paragraph {i}", nm, "mention")


def write_stock():
    doc = Document()
    doc.add_heading("MEMO - Stock gifts and donor-advised fund grants", 1)
    doc.add_paragraph("To: Development team    From: Gift processing    Re: non-cash and DAF items received")
    doc.add_paragraph("Whitaker Family Charitable Fund is advised by Harold Whitaker (harold.whitaker@example.org). "
                      "Grants are recorded to the fund's advisor.")
    fmt_email(D["whitaker"])
    t = doc.add_table(rows=1, cols=5)
    t.style = "Table Grid"
    for c, h in zip(t.rows[0].cells, ["Source", "Type", "Value at receipt", "Date", "Details"]):
        c.text = h
    for g in sorted([g for g in GIFTS if g["dest"] == "stock"], key=lambda g: g["date"]):
        r = t.add_row().cells
        r[0].text, r[1].text = g["name"] if g["channel"] == "DAF grant" else D[g["donor"]]["name"], \
            "DAF grant" if g["channel"] == "DAF grant" else "Stock"
        r[2].text, r[3].text = money(g["amount"]), g["date"].strftime("%Y-%m-%d")
        r[4].text = g["note"] or ("Grant check via fund sponsor" if g["channel"] == "DAF grant" else "")
        g["loc"] = f"table 1 row {len(t.rows) - 1}"
        src(g["donor"], F_STOCK, g["loc"], r[0].text, "gift_row")
    doc.add_paragraph("Stock values are the closing price on the date of transfer. Brokerage statements are in the shared drive.")
    doc.save(OUT / F_STOCK)


FORMS = [
    ("delgado", "María Delgado-Ruiz", None, "Maria.Delgado@Example.com", "Unrestricted",
     "Moved to Coral Gables. Prefers a call over email. Please note my name changed (hyphenated)."),
    ("tran", "Leopold Tran", None, "leopold.tran@example.com", "Scholarship",
     "Retired teacher. Wants to endow a small scholarship in his late wife's name."),
    ("marchetti", "Sofia Marchetti", None, "sofia.marchetti@example.org", "Field of Interest",
     "Interested in coastal resilience and youth sailing. Met the team at the spring luncheon."),
    ("marrow", "Bernard Okoye", "Marrow Lane Print Co.", "billing.marrowlane@example.org", "Organization Endowment",
     "Owner of a Hialeah print shop. Wants the company named in the annual report."),
]


def write_intake():
    doc = Document()
    doc.add_heading("Donor Intake Forms - 2026", 1)
    for i, (dk, nm, org, email, fund, notes) in enumerate(FORMS, 1):
        d = D[dk]
        doc.add_heading(f"Intake Form {i}", 2)
        t = doc.add_table(rows=0, cols=2)
        t.style = "Table Grid"
        fields = [("Name", nm), ("Organization", org or ""), ("Email", fmt_email(d, email)), ("Phone", fmt_phone(d, i % 3)),
                  ("City", city_of(d) + ", FL"), ("Fund type preference", fund), ("Notes", notes)]
        for k, v in fields:
            r = t.add_row().cells
            r[0].text, r[1].text = k, v
        src(dk, F_INTAKE, f"section 'Intake Form {i}'", nm, "intake_form")
    doc.save(OUT / F_INTAKE)


# --------------------------------------------------------------------------- notes (markdown)
def notes_text():
    ph = fmt_phone(D["nguyen"], 2).replace(".", "-")  # "305-555-01xx"
    return f"""# Development Team Retreat Notes - Oct 29, 2026

*Attendees: Dana (ED), Jules, Marisol, Tomas. Notes by Tomas. Rough, typed on my phone.*

## Give Miami Day (Nov 19) prep

- Early giving opens Sat Nov 14. Last year the day itself was Nov 20 and we should assume the same shape.
- Maria Delgado is our anchor: she has given on every single Give Miami Day since 2022. Jules will call her this
  week. She is now María Delgado-Ruiz on her new intake form - same person, same email, just hyphenated.
- Pledges for the day (promised, NOT received yet, so do not enter as gifts): Lucia Ferrante says $1,000,
  Annelise Moreau $500, and the hardware store (Tamarind Quay Hardware) $1,500 as a match challenge.
- Tobias Lindqvist pledged $2,000 for year-end, nothing booked yet.

## Who is who (clean-up items)

- Bob Nguyen = Robert Nguyen, the monthly donor. Same man, same cell, {ph}. Everyone calls him Bob.
- Priscilla Okafor changed her email in January: the old priscilla.okafor@example.com bounces, use
  priscilla.okafor.law@example.org. She did give $500 in February from the new address.
- Walter Brandt has not given yet this year. He is usually March. Marisol to check in, gently.
- Harold Whitaker gives through the Whitaker Family Charitable Fund, his donor-advised fund. Treat the fund grants as his.
- Veloria Bay Foundation: over $1 million since 2022, our Shack Society-level fundholder. Their grant usually lands in
  April and nothing has arrived this year. Dana will phone the trustees before Give Miami Day.

## Gifts since the last meeting

- Halcyon Reef Dental Group wired a $25,000 corporate gift on Sept 22, for the youth health field-of-interest fund. Thank-you letter still owed.
- Priya Raman dropped off a $500 check on Nov 2 - early, ahead of Give Miami Day. Thank her in person.

## Pantry and community notes

- Dolores Quinones (Spanish speaker, picks up pantry boxes every other Friday) put $25 in the donation jar at the
  Oct 18 open house. Not sure whether she goes in as a donor or stays a client. Marisol to ask what she prefers.
- Marcus Bell, one of our pantry regulars (he filled out an intake form in September), told Jules he wants to give
  $10 a month once his new job starts in December. Nothing received yet.
- Tomas met Gabriela Rincon at the chamber mixer. She says she wants to "get involved and probably give" and mentioned
  her mother gets senior meals from us. No form, no gift yet.

## Action items

1. Jules - call Maria, then Veloria Bay trustees.
2. Marisol - Walter Brandt and Teo Salinas (he usually gives quarterly and has gone quiet since the spring).
3. Tomas - merge duplicate records before the Nov 14 early-giving email goes out.
"""


def write_notes():
    txt = notes_text()
    (OUT / F_MD).write_text(txt, encoding="utf-8")
    lines = txt.splitlines()
    # gift locations
    for g in GIFTS:
        if g["dest"] == "notes":
            ln = next(i for i, l in enumerate(lines, 1)
                      if f"${g['amount']:,}" in l and any(a in l for a in D[g["donor"]]["aliases"]))
            g["loc"] = f"line {ln}"
            src(g["donor"], F_MD, g["loc"], g["name"], "gift_row")
    # donor mentions
    for dk, d in D.items():
        for i, l in enumerate(lines, 1):
            hit = next((a for a in d["aliases"] if a in l), None)
            if hit and not any(s["file"] == F_MD and s["location"] == f"line {i}" for s in SRC[dk]):
                src(dk, F_MD, f"line {i}", hit, "mention")
    D["nguyen"]["phones"].add(D["nguyen"]["phone"])  # stated in the notes
    for e in ("priscilla.okafor@example.com", "priscilla.okafor.law@example.org"):
        D["okafor"]["emails"].add(e)


# --------------------------------------------------------------------------- community + neighbors (tabs 2 and 3)
F_COMMUNITY = "community_intake_forms_2026.docx"
F_SIGNIN = "event_signin_sheet_nov1.xlsx"
SIGNIN_SHEET = "Nov 1 Open House"
rng2 = random.Random(SEED + 1)  # separate stream: never disturbs the donor content

# id, name, contact pref, email, phone, household, age (range or birth year, "" if not given), gender, zip,
# neighborhood, language, programs, dog (True/False/None), pet note, notes
COMMUNITY = [
    ("C01", "Rosa Elena Martinez", "Phone call", "", "305-555-0150", "5", "born 1984", "Female", "33135", "Little Havana", "Spanish",
     ["Food pantry", "After-school"], True, "Dog: Chispa", "Needs Spanish-language forms."),
    ("C02", "Jean-Robert Toussaint", "Phone call", "", "305-555-0151", "1", "70-79", "Male", "33147", "Liberty City", "Haitian Creole",
     ["Senior meals"], None, "", "Mobility limited; meals delivered."),
    ("C03", "Keisha Williams", "Email", "keisha.williams@example.com", "", "4", "30-39", "Female", "33142", "Allapattah", "English",
     ["After-school"], True, "Dog: Duke", ""),
    ("C04", "Dmitri Volkov", "Phone call", "", "305-555-0153", "2", "born 1948", "Male", "33180", "Aventura", "Russian",
     ["Senior meals"], False, "", "Wife also eats at the senior lunch."),
    ("C05", "Altagracia Pena", "Text message", "", "305-555-0154", "6", "prefer not to say", "Female", "33012", "Hialeah", "Spanish",
     ["Food pantry"], False, "Has a cat, no dog", ""),
    ("C06", "Marcus Bell", "Email", "marcus.bell@example.org", "", "1", "18-24", "prefer not to say", "33127", "Wynwood", "English",
     ["Food pantry"], True, "Dog: Pixel", "Between jobs."),
    ("C07", "Nguyen Thi Lan", "Phone call", "", "305-555-0156", "2", "born 1951", "Female", "33176", "Kendall", "Vietnamese / English",
     ["Senior meals"], False, "", ""),
    ("C08", "Yolanda Cruz-Beltran", "Email", "yolanda.cruzbeltran@example.com", "305-555-0157", "4", "40-49", "Female", "33125",
     "Little Havana", "Spanish", ["After-school", "Food pantry"], True, "Dog: Coco (small, needs shots)", ""),
    ("C09", "Andre Lafleur", "Message via church", "", "", "3", "25-34", "Male", "33150", "Little Haiti", "Haitian Creole / French",
     ["Food pantry"], None, "", "No phone or email; reach through his church office."),
    ("C10", "Mildred Hayes", "Phone call", "", "305-555-0159", "1", "born 1944", "Female", "33133", "Coconut Grove", "English",
     ["Senior meals"], True, "Dog: Biscuit", "Lives alone; Biscuit is her main company."),
    ("C11", "Santiago Ortega", "Email", "santiago.ortega@example.org", "", "5", "35-44", "Male", "33174", "Sweetwater", "Spanish",
     ["After-school"], False, "", ""),
    ("C12", "Fatima Al-Sayed", "Phone call", "", "305-555-0161", "7", "30-39", "Female", "33186", "Kendall West", "Arabic / English",
     ["Food pantry"], None, "", "Large household."),
    ("C13", "Luis Fernando Paz", "Email", "luis.paz@example.com", "", "2", "55-64", "Male", "33142", "Allapattah", "Spanish",
     ["Food pantry"], True, "Dog: Rocco", ""),
    ("C14", "Tamika Brooks", "Email", "tamika.brooks@example.com", "305-555-0164", "3", "30-39", "Female", "33169", "Miami Gardens", "English",
     ["After-school"], False, "", ""),
]
COMM = {c[0]: dict(id=c[0], name=c[1], pref=c[2], email=c[3] or None, phone=c[4] or None, household=c[5], age=c[6],
                   gender=c[7], zip=c[8], hood=c[9], lang=c[10], programs=c[11], dog=c[12], pet_note=c[13], notes=c[14],
                   rows=[], tab="community", ambiguous=False, candidate_tabs=None, reason=None) for c in COMMUNITY}

# Neighbors: id, name, email, phone, zip, interests, brought a dog (True/None), dog name
NEIGH = [
    ("N01", "Camila Restrepo", "camila.restrepo@example.com", None, "33145", ["volunteering", "newsletter"], True, "Luna"),
    ("N02", "Jamal Pierce", None, "305-555-0171", "33127", ["giving"], None, ""),
    ("N03", "Ingrid Solheim", "ingrid.solheim@example.org", None, "33133", ["newsletter", "pet_adoption"], None, ""),
    ("N04", "Tyrone Gaines", None, None, "33142", ["volunteering"], True, "Bruno"),
    ("N05", "Beatriz Almeida", "beatriz.almeida@example.com", None, "33156", ["pet_adoption"], None, ""),
    ("N06", "Owen Castellan", "owen.castellan@example.org", None, "33129", ["volunteering", "giving"], True, "Pepper"),
    ("N07", "Nadia Haddad", None, "305-555-0177", "33131", ["newsletter"], None, ""),
    ("N08", "Felix Okonkwo", "felix.okonkwo@example.com", None, "33137", ["giving", "newsletter"], True, "Rex"),
    ("N09", "Svetlana Petrova", "svetlana.petrova@example.org", None, "33160", ["volunteering"], None, ""),
    ("N10", "Darnell Washington", None, "305-555-0180", "33150", ["pet_adoption"], None, ""),
    ("N11", "Lourdes Quesada", "lourdes.quesada@example.com", None, "33135", ["volunteering", "pet_adoption"], True, "Canela"),
    ("N12", "Mateo Bianchi", "mateo.bianchi@example.org", None, "33138", ["newsletter"], None, ""),
    ("N13", "Jocelyn Fairweather", "jocelyn.fairweather@example.com", None, "33146", ["giving"], True, "Waffles"),
    ("N14", "Anil Deshmukh", "anil.deshmukh@example.org", None, "33143", ["volunteering", "newsletter"], None, ""),
    ("N15", "Renata Silva-Cho", None, "305-555-0185", "33173", ["newsletter"], True, "Tofu"),
    ("N16", "Elliot Brandvold", "elliot.brandvold@example.com", None, "33155", ["giving", "volunteering"], None, ""),
    ("N17", "Yasmin Farouk", "yasmin.farouk@example.org", None, "33134", ["pet_adoption"], True, "Olive"),
    ("N18", "Gus Lindemann", None, None, "33181", ["volunteering"], None, ""),
    ("N19", "Pilar Echeverria", "pilar.echeverria@example.com", None, "33165", ["newsletter", "giving"], True, "Rocky"),
]
NB = {n[0]: dict(id=n[0], name=n[1], email=n[2], phone=n[3], zip=n[4], interests=n[5], dog=n[6], dog_name=n[7],
                 rows=[], tab="neighbor", ambiguous=False, candidate_tabs=None, reason=None) for n in NEIGH}

# Ambiguous people planted in the retreat notes (flag for review)
NB["N20"] = dict(id="N20", name="Gabriela Rincon", email=None, phone=None, zip=None, interests=["giving"], dog=None, dog_name="",
                 rows=[], tab="neighbor", ambiguous=True, candidate_tabs=["neighbor", "giver"],
                 reason="Met at a chamber mixer; says she wants to 'get involved and probably give' but nothing is given yet, and her mother is a senior-meals client. Not a donor until a gift lands; flag for review.")
COMM["C15"] = dict(id="C15", name="Dolores Quinones", pref=None, email=None, phone=None, household=None, age=None, gender=None,
                   zip=None, hood=None, lang="Spanish", programs=["Food pantry"], dog=None, pet_note="", notes="Notes only; no intake form.",
                   rows=[], tab="community", ambiguous=True, candidate_tabs=["community", "giver"],
                   reason="Receives pantry boxes (community) but also put $25 in the donation jar at the Oct 18 open house. A client who gave once: community or giver? Flag for review. The $25 is NOT in the donor gift totals.")
COMM["C06"].update(ambiguous=True, candidate_tabs=["community", "giver"],
                   reason="Pantry client (intake form) who told staff he wants to give $10 a month once his new job starts. A stated intention, no gift yet; stays community, flag for review.")

# Existing people who show up again on the sign-in sheet (cross-file duplicates)
SIGN_DONORS = [
    # donor key, name as written, contact, zip, interests, brought a dog, dog name
    ("delgado", "Maria D.", "MARIA.DELGADO@EXAMPLE.COM", "33134", ["giving", "newsletter"], None, ""),
    ("raman", "priya raman", "priya.raman@example.com", "33146", ["giving", "pet_adoption"], True, "Mango"),
    ("ferrante", "Lucia F", "lucia.ferrante@example.com", "33130", ["volunteering"], None, ""),
]
SIGN_COMM = [
    ("C01", "Rosa E. Martinez", "(305) 555-0150", "33135", ["volunteering"], None, ""),
    ("C03", "Keisha W.", "keisha.williams@example.com", "33142", ["newsletter", "pet_adoption"], True, "Duke"),
    ("C10", "Millie Hayes", "305.555.0159", "33133", ["pet_adoption"], True, "Biscuit"),
]
# neighbors who signed twice (second name spelling, second contact spelling)
SIGN_TWICE = {"N01": ("camila r.", "Camila.Restrepo@example.com"), "N08": ("F. Okonkwo", "felix.okonkwo@example.com")}

INTEREST_RAW = {
    "volunteering": ["volunteering", "Volunteer!", "volunteer", "vol."],
    "giving": ["giving", "donate?", "maybe donate", "giving"],
    "pet_adoption": ["pet adoption", "adopt a pup", "pet adoption", "dogs!"],
    "newsletter": ["newsletter", "email list", "newsletter", "updates"],
}
DOG_RAW_YES = ["Y", "yes", "Yes!", "✓", "Y"]
SIGN_ROWS = []


def fmt_style(ph):
    a, b, c = ph.split("-")
    return rng2.choice([ph, f"({a}) {b}-{c}", f"{a}.{b}.{c}"])


def _signin_contact(p):
    if p["email"]:
        return p["email"]
    if p["phone"]:
        return fmt_style(p["phone"])
    return ""


def write_community():
    doc = Document()
    doc.add_heading("Community Program Intake Forms - 2026", 1)
    doc.add_paragraph("Self-reported by participants. Fields left blank were not answered.")
    for i, c in enumerate((COMM[c[0]] for c in COMMUNITY), 1):
        doc.add_heading(f"Intake Form {i}", 2)
        t = doc.add_table(rows=0, cols=2)
        t.style = "Table Grid"
        dog_txt = {True: "Yes", False: "No", None: ""}[c["dog"]]
        if c["pet_note"]:
            dog_txt = (dog_txt + " - " + c["pet_note"]).strip(" -")
        fields = [("Name", c["name"]), ("Preferred way to reach you", c["pref"]), ("Email", c["email"] or ""),
                  ("Phone", c["phone"] or ""), ("People in household", c["household"]),
                  ("Age range or birth year", c["age"]), ("Gender (optional)", c["gender"]),
                  ("ZIP code", c["zip"]), ("Neighborhood", c["hood"]), ("Language at home", c["lang"]),
                  ("Programs", ", ".join(c["programs"])), ("Do you have a dog / pet?", dog_txt),
                  ("Notes", c["notes"])]
        for k, v in fields:
            r = t.add_row().cells
            r[0].text, r[1].text = k, v or ""
        c["rows"].append(dict(file=F_COMMUNITY, location=f"section 'Intake Form {i}'", name_as_written=c["name"], kind="intake_form"))
    doc.save(OUT / F_COMMUNITY)


def write_signin():
    entries = []  # (kind, id, name, contact, zip, interests, dog_flag, dog_name)
    for n in NB.values():
        if n["id"] == "N20":
            continue
        entries.append(("neighbor", n["id"], n["name"], _signin_contact(n), n["zip"], n["interests"], n["dog"], n["dog_name"]))
    for nid, (nm, ct) in SIGN_TWICE.items():
        n = NB[nid]
        entries.append(("neighbor", nid, nm, ct, n["zip"], n["interests"][:1], n["dog"], n["dog_name"]))
    for dk, nm, ct, z, ints, dg, dn in SIGN_DONORS:
        entries.append(("giver", D[dk]["id"], nm, ct, z, ints, dg, dn))
    for cid, nm, ct, z, ints, dg, dn in SIGN_COMM:
        entries.append(("community", cid, nm, ct, z, ints, dg, dn))
    rng2.shuffle(entries)
    wb = Workbook()
    ws = wb.active
    ws.title = SIGNIN_SHEET
    ws.append(["COMMUNITY OPEN HOUSE - Sat Nov 1 - sign in please!!"])
    ws.append([])
    ws.append(["#", "Name", "Email or phone", "ZIP", "Interested in", "Brought a dog?", "Dog's name / notes", "Time in"])
    for i, (kind, pid, nm, ct, z, ints, dg, dn) in enumerate(entries):
        mins = 10 * 60 + i * 7
        hh, mm = divmod(mins, 60)
        tm = f"{hh}:{mm:02d} AM" if hh < 12 else f"{hh - 12 or 12}:{mm:02d} PM"
        raw_int = ", ".join(rng2.choice(INTEREST_RAW[x]) for x in ints)
        dog = rng2.choice(DOG_RAW_YES) if dg else rng2.choice(["", "", "no", "N"])
        note = dn if (dg and dn) else ("first time here" if kind == "neighbor" and i % 5 == 0 else "")
        ws.append([i + 1, nm, ct, z if i % 6 else int(z), raw_int, dog, note, tm])
        rec = dict(file=F_SIGNIN, location=f"sheet '{SIGNIN_SHEET}' row {ws.max_row}", name_as_written=nm, kind="signin_row")
        SIGN_ROWS.append(dict(person_kind=kind, pid=pid, **rec))
        if kind == "neighbor":
            NB[pid]["rows"].append(rec)
        elif kind == "community":
            COMM[pid]["rows"].append(rec)
        else:
            src(next(k for k, v in D.items() if v["id"] == pid), F_SIGNIN, rec["location"], nm, "signin_row")
    ws.append([])
    ws.append(["Thanks for coming! - front desk"])
    wb.save(OUT / F_SIGNIN)
    D["raman"]["dog"] = True  # Priya brought a dog (Mango) to the sign-in


def attach_notes_people():
    """Record where the planted ambiguous people appear in the retreat notes."""
    lines = (OUT / F_MD).read_text(encoding="utf-8").splitlines()
    for pid, tag in (("C15", "Dolores Quinones"), ("C06", "Marcus Bell"), ("N20", "Gabriela Rincon")):
        ln = next(i for i, l in enumerate(lines, 1) if tag in l)
        end = ln
        while end < len(lines) and lines[end].startswith("  "):  # wrapped continuation lines of the bullet
            end += 1
        rec = dict(file=F_MD, location=f"line {ln}" if end == ln else f"lines {ln}-{end}", name_as_written=tag, kind="mention")
        (COMM if pid.startswith("C") else NB)[pid]["rows"].append(rec)


def contact_of(p):
    return bool(p.get("email") or p.get("phone"))


def people_index():
    out = []
    for d in D.values():
        e = dict(person_id=d["id"], full_name=d["name"], tab="giver", ambiguous=False)
        if d.get("dog") is not None:
            e["has_dog"] = d["dog"]
        e["has_contact"] = True
        e["source_rows"] = SRC[d["key"]]
        out.append(e)
    for p in list(COMM.values()) + list(NB.values()):
        e = dict(person_id=p["id"], full_name=p["name"], tab=p["tab"], ambiguous=p["ambiguous"])
        if p["ambiguous"]:
            e["candidate_tabs"] = p["candidate_tabs"]
            e["reason"] = p["reason"]
        if p["dog"] is not None:
            e["has_dog"] = bool(p["dog"])
        e["has_contact"] = contact_of(p)
        e["source_rows"] = p["rows"]
        out.append(e)
    return out


def community_key():
    comm = [dict(person_id=c["id"], full_name=c["name"], tab="community", ambiguous=c["ambiguous"],
                 candidate_tabs=c["candidate_tabs"], reason=c["reason"],
                 contact_preference=c["pref"], email=c["email"], phone=c["phone"], household_size=c["household"],
                 age_as_reported=c["age"], gender_as_reported=c["gender"], zip=c["zip"], neighborhood=c["hood"],
                 language=c["lang"], programs=c["programs"], has_dog=c["dog"], pet_note=c["pet_note"] or None,
                 source_rows=c["rows"]) for c in COMM.values()]
    nb = [dict(person_id=n["id"], full_name=n["name"], tab="neighbor", ambiguous=n["ambiguous"],
               candidate_tabs=n["candidate_tabs"], reason=n["reason"], email=n["email"], phone=n["phone"], zip=n["zip"],
               interests=n["interests"], has_dog=True if n["dog"] else None, dog_name=n["dog_name"] or None,
               source_rows=n["rows"]) for n in NB.values()]
    return comm, nb


def cross_file_dupes():
    out = []
    for dk, nm, *_ in SIGN_DONORS:
        d = D[dk]
        out.append(dict(person_id=d["id"], tab="giver", canonical=d["name"], appears_as=nm,
                        files=["(existing donor files)", F_SIGNIN]))
    for cid, nm, *_ in SIGN_COMM:
        out.append(dict(person_id=cid, tab="community", canonical=COMM[cid]["name"], appears_as=nm,
                        files=[F_COMMUNITY, F_SIGNIN]))
    for nid, (nm, _) in SIGN_TWICE.items():
        out.append(dict(person_id=nid, tab="neighbor", canonical=NB[nid]["name"], appears_as=nm,
                        files=[F_SIGNIN], note="signed in twice on the same sheet"))
    return out


def puppy_outreach():
    people = people_index()
    dog = [p for p in people if p.get("has_dog") is True]
    target = [p for p in dog if p["has_contact"]]
    no_contact = [p for p in dog if not p["has_contact"]]
    pet_interest = [n["id"] for n in NB.values() if "pet_adoption" in n["interests"]] + \
                   [r[0] for r in SIGN_COMM if "pet_adoption" in r[4]] + \
                   [D[r[0]]["id"] for r in SIGN_DONORS if "pet_adoption" in r[4]]
    return dict(
        rule="Target everyone whose has_dog is stated True in any file AND who has an email or phone. A blank or No in 'Brought a dog?' is NOT evidence of no dog. People with a dog but no contact info cannot be reached and are listed separately.",
        target_ids=[p["person_id"] for p in target], target_count=len(target),
        target_by_tab={t: sum(1 for p in target if p["tab"] == t) for t in ("giver", "neighbor", "community")},
        has_dog_but_no_contact=[p["person_id"] for p in no_contact],
        interested_in_pet_adoption_not_necessarily_dog_owners=sorted(set(pet_interest)),
        stated_no_dog=[p["person_id"] for p in people if p.get("has_dog") is False],
    )


# --------------------------------------------------------------------------- answer key
def build_key():
    gifts_out = []
    for g in sorted(GIFTS, key=lambda g: g["id"]):
        item = dict(gift_id=g["id"], donor_id=D[g["donor"]]["id"], donor=D[g["donor"]]["name"], amount=g["amount"],
                    gift_date=g["date"].isoformat(), channel=g["channel"], fund_type=g["fund"],
                    fund_type_stated_in_source=bool(g["fund_stated"]) if g["dest"] in ("gmd", "online", "oct_nov") else True,
                    name_as_written=g["name"], source=dict(file=FILES[g["dest"]], location=g["loc"]))
        if g["channel"] == "event":
            item["channel_note"] = "event gift"
        if g.get("check_no"):
            item["check_number"] = g["check_no"]
        if g is DOUBLE_SRC:
            ex = EXTRA_ROWS[0]
            item["also_recorded_at"] = [dict(file=F_XLSX, location=ex["loc"], name_as_written=ex["name"],
                                              date_as_entered=ex["date"].isoformat())]
        gifts_out.append(item)
    donors_out = []
    for dk, d in D.items():
        emails = sorted(d["emails"]) or [d["email"]]
        donors_out.append(dict(
            donor_id=d["id"], full_name=d["name"], first_name=d["first"], last_name=d["last"], org_name=d["org"],
            donor_type=d["type"], email=d["email"], emails_all=sorted(set(emails) | {d["email"]}),
            phone=d["phone"] if d["phones"] else None, city=d["city"] if d["cities"] else None,
            state="FL" if d["cities"] else None, fund_type=d["fund"], notes=d["notes"],
            names_as_written=sorted({s["name_as_written"] for s in SRC[dk]}),
            source_rows=SRC[dk]))
    total = sum(g["amount"] for g in GIFTS)
    by_quarter = defaultdict(lambda: dict(gifts=0, total=0))
    for g in GIFTS:
        q = by_quarter[f"{g['date'].year}-Q{(g['date'].month - 1) // 3 + 1}"]
        q["gifts"] += 1
        q["total"] += g["amount"]
    veloria = sum(g["amount"] for g in GIFTS if g["donor"] == "veloria")
    dup_groups = [
        dict(group="DG1", donor_id=D["delgado"]["id"], canonical="Maria Delgado",
             members=["Maria Delgado", "María Delgado-Ruiz"],
             reason="Same email in different case (maria.delgado@example.com vs Maria.Delgado@Example.com); accent and married-name hyphenation; notes confirm it is the same person."),
        dict(group="DG2", donor_id=D["nguyen"]["id"], canonical="Robert Nguyen",
             members=["Robert Nguyen", "Bob Nguyen", "R. Nguyen"],
             reason=f"Nickname Bob for Robert; same phone {D['nguyen']['phone']} in the Online sheet and the retreat notes; notes say 'Bob Nguyen = Robert Nguyen'."),
        dict(group="DG3", donor_id=D["tamarind"]["id"], canonical="Tamarind Quay Hardware LLC",
             members=["Tamarind Quay Hardware LLC", "Tamarind Quay Hdwe, L.L.C.", "Tamarind Quay Hardware, LLC"],
             reason="One organization written three ways (abbreviation, punctuation of the legal suffix); same contact email on the Excel rows."),
        dict(group="DG4", donor_id=D["okafor"]["id"], canonical="Priscilla Okafor",
             members=["Priscilla Okafor (priscilla.okafor@example.com)", "Priscilla Okafor (priscilla.okafor.law@example.org)"],
             reason="Same name, two different emails; the retreat notes say she changed her email in January 2026 (old one bounces)."),
        dict(group="DG5", donor_id=D["fontaine"]["id"], canonical="Elizabeth Fontaine",
             members=["Elizabeth Fontaine", "Liz Fontaine"],
             reason="Nickname Liz for Elizabeth; same email liz.fontaine@example.com in the Excel rows and the check-log notes."),
        dict(group="DG6", donor_id=D["whitaker"]["id"], canonical="Harold Whitaker",
             members=["Harold Whitaker", "Whitaker Family Charitable Fund"],
             reason="DAF grants are recorded under the fund name; the memo and notes say the fund is advised by Harold Whitaker, same email harold.whitaker@example.org."),
    ]
    for dg in dup_groups:
        dg["source_rows"] = [s for s in SRC[next(k for k, v in D.items() if v["id"] == dg["donor_id"])]]
    dbl = EXTRA_ROWS[0]
    comm, nb = community_key()
    people = people_index()
    tab_counts = {t: sum(1 for p in people if p["tab"] == t) for t in ("giver", "neighbor", "community")}
    for dn in donors_out:
        dn["tab"] = "giver"
        dn["ambiguous"] = False
        dk = next(k for k, v in D.items() if v["id"] == dn["donor_id"])
        if D[dk].get("dog") is not None:
            dn["has_dog"] = D[dk]["dog"]
    return dict(
        _note="FULLY FICTIONAL test data. Answer key for data/sample_inputs/. Generated by scripts/make_sample_inputs.py",
        as_of=AS_OF.isoformat(), seed=SEED,
        files=[F_XLSX, F_MD, F_CHECK, F_INTAKE, F_STOCK, F_COMMUNITY, F_SIGNIN, F_OCTNOV],
        totals=dict(canonical_donors=len(D), individuals=sum(d["type"] == "individual" for d in D.values()),
                    organizations=sum(d["type"] == "organization" for d in D.values()),
                    unique_gifts=len(GIFTS), total_amount=total,
                    gift_source_rows=len(GIFTS) + len(EXTRA_ROWS),
                    gift_source_rows_amount=total + dbl["amount"],
                    duplicate_groups=len(dup_groups),
                    q4_2026_gifts=by_quarter["2026-Q4"]["gifts"], q4_2026_total=by_quarter["2026-Q4"]["total"]),
        gifts_by_quarter=dict(sorted(by_quarter.items())),   # calendar quarters; the Q4 gauge reads 2026-Q4 against the $150k sample goal
        canonical_donors=donors_out, duplicate_groups=dup_groups, gifts=gifts_out,
        double_recorded_gift=dict(gift_id=DOUBLE_SRC["id"], donor_id=D["achterberg"]["id"], amount=DOUBLE_SRC["amount"],
                                  counted_once_from=dict(file=F_CHECK, location=DOUBLE_SRC["loc"], check_number=DOUBLE_SRC.get("check_no")),
                                  duplicate_recording=dict(file=F_XLSX, location=dbl["loc"]),
                                  rule="Same gift (same check, dated 7/14 vs 7/15). Count once: the check log row is canonical."),
        non_gift_rows=["Totals rows at the bottom of each Excel sheet ('TOTAL', 'Grand total')",
                       "Title/note rows at the top of sheets", "Pledges listed in the retreat notes"],
        pledges_not_gifts=[dict(donor_id=D[p["donor"]]["id"], donor=D[p["donor"]]["name"], amount=p["amount"], for_=p["for_"]) for p in PLEDGES],
        planted_cases=dict(
            a_loyal_gmd_donor=dict(donor_id=D["delgado"]["id"], donor="Maria Delgado", detail="Gave on every Give Miami Day 2022-2025 (11/17/22, 11/16/23, 11/21/24, 11/20/25); nothing in 2026. Expect rank #1."),
            b_quarterly_overdue=dict(donor_id=D["salinas"]["id"], donor="Teodoro Salinas", detail="$300 on the 15th of Jan/Apr/Jul/Oct from 2025-01; last gift 2026-04-15, missed 2026-07-15 and 2026-10-15."),
            c_monthly_on_track=dict(donor_id=D["nguyen"]["id"], donor="Robert Nguyen (Bob)", detail="$75 on the 5th of every month 2025-07 .. 2026-11; last gift 2026-11-05."),
            d_december_year_end=dict(donor_id=D["pierre"]["id"], donor="Gloria Pierre-Louis", detail="Gives in late December every year (2022-2025); next window is Dec 2026, about one month out. Not lapsing yet."),
            e_shack_society=dict(donor_id=D["veloria"]["id"], donor="Veloria Bay Foundation", detail=f"Lifetime ${veloria:,} (> $1M) -> star / Shack Society level. Annual April grant; last 2025-04-15; none in 2026."),
            f_gave_nov_2026=dict(donor_id=D["raman"]["id"], donor="Priya Raman", detail="Check for $500 on 2026-11-02 (in the retreat notes). Gave GMD 2023-2025 too. On track."),
            walter_brandt_not_yet_this_year=dict(donor_id=D["brandt"]["id"], donor="Walter Brandt", detail="Gives each March (2024, 2025); the notes say he has not given yet this year."),
        ),
        expected_top3_lapsing_as_of_2026_11_08=[
            dict(rank=1, donor_id=D["delgado"]["id"], donor="Maria Delgado",
                 reason="Gave on 4 of 4 Give Miami Days; the next one (2026-11-19) is 11 days away and she has not given in 2026. Highest loyalty at stake."),
            dict(rank=2, donor_id=D["veloria"]["id"], donor="Veloria Bay Foundation",
                 reason=f"Star donor: ${veloria:,} lifetime, annual April grant of $350,000 not received in 2026 (about 7 months past usual cadence)."),
            dict(rank=3, donor_id=D["salinas"]["id"], donor="Teodoro Salinas",
                 reason="Quarterly donor, last gift 2026-04-15; two expected gifts (Jul, Oct) missed, about 207 days since last gift vs a 91-day cadence."),
        ],
        gift_alerts_expected=[
            dict(donor_id=D["park"]["id"], donor="Hye-jin Park", kind="failed",
                 reason=f"Monthly $40 donor (10th of each month): good gifts 2026-06 .. 2026-09. The 2026-10-10 charge is in the Online sheet ({FAILED_GIFTS[0]['loc']}) marked card declined, status declined, and no later good gift exists. The declined $40 is NOT a gift and is not in any total."),
            dict(donor_id=D["salinas"]["id"], donor="Teodoro Salinas", kind="late",
                 reason="Quarterly $300 donor (15th of Jan/Apr/Jul/Oct); last gift 2026-04-15, missed 2026-07-15 and 2026-10-15."),
            dict(donor_id=D["brandt"]["id"], donor="Walter Brandt", kind="late",
                 reason="Yearly donor (March: 2024-03-12, 2025-03-18); the 2026 gift was due about 2026-03-18 and has not arrived."),
            dict(donor_id=D["veloria"]["id"], donor="Veloria Bay Foundation", kind="late",
                 reason="Yearly grantor (April: last 2025-04-15); the 2026 grant was due about 2026-04-15 and has not arrived."),
            dict(donor_id=D["quintero"]["id"], donor="Rafael Quintero", kind="failed",
                 reason="Missed Sep 2026 monthly gift. Monthly $50 donor (3rd of each month, 2026-03 .. 2026-11) with no September gift; resumed in October."),
        ],
        failed_gifts_not_counted=[dict(donor_id=D[f["donor"]]["id"], donor=f["name"], amount=f["amount"], date=f["date"].isoformat(),
                                       source=dict(file=F_XLSX, location=f["loc"]), note=f["note"],
                                       status="declined", rule="A declined charge is not a gift: excluded from gifts, totals, gift_source_rows and lifetime giving.")
                                  for f in FAILED_GIFTS],
        tab_counts=tab_counts, ambiguous_count=sum(1 for p in people if p["ambiguous"]),
        ambiguous_people=[p for p in people if p["ambiguous"]],
        people=people, community_members=comm, neighbors=nb, cross_file_duplicates=cross_file_dupes(),
        puppy_outreach=puppy_outreach(),
        tab_notes=dict(
            tab_rule="giver = has given (or is an org donor); community = receives the nonprofit's services; neighbor = met at an event, neither yet. Each canonical person counted once, under the tab in `tab`. Ambiguous people are counted under their default tab and flagged.",
            mentioned_gifts_not_counted=[dict(person_id="C15", amount=25, note="$25 in the donation jar, Oct 18 open house; not entered as a donor gift")],
            sign_in_rows=len(SIGN_ROWS), sign_in_unique_new_neighbors=sum(1 for n in nb if n["person_id"] != "N20")),
        not_lapsing_examples=["Robert Nguyen (monthly, on track)", "Priya Raman (gave Nov 2026)", "Gloria Pierre-Louis (December window next month)"],
    )


FILES = {"gmd": F_XLSX, "online": F_XLSX, "major": F_XLSX, "check": F_CHECK, "stock": F_STOCK, "notes": F_MD,
         "oct_nov": F_OCTNOV}


FIXED_TS = datetime(2026, 11, 1, 9, 0, 0)


def pin_timestamps():
    """docx/xlsx embed 'created' times; pin them so reruns are byte-stable."""
    for f in (F_CHECK, F_INTAKE, F_STOCK, F_COMMUNITY):
        d = Document(OUT / f)
        d.core_properties.created = d.core_properties.modified = FIXED_TS
        d.core_properties.author = "Sample Data Generator (fictional)"
        d.save(OUT / f)
    wb = load_workbook(OUT / F_XLSX)
    wb.properties.created = wb.properties.modified = FIXED_TS
    wb.properties.creator = "Sample Data Generator (fictional)"
    wb.save(OUT / F_XLSX)
    wb = load_workbook(OUT / F_OCTNOV)
    wb.properties.created = wb.properties.modified = FIXED_TS
    wb.properties.creator = "Sample Data Generator (fictional)"
    wb.save(OUT / F_OCTNOV)
    wb = load_workbook(OUT / F_SIGNIN)
    wb.properties.created = wb.properties.modified = FIXED_TS
    wb.properties.creator = "Sample Data Generator (fictional)"
    wb.save(OUT / F_SIGNIN)


def _num(v):
    if isinstance(v, (int, float)):
        return float(v)
    m = re.fullmatch(r"\$?\s*([\d,]+(?:\.\d+)?)", str(v).strip())
    return float(m.group(1).replace(",", "")) if m else None


def verify_tabs(key, check, md, wb_sign):
    """Recount the 3-tab content from the files themselves and compare with the key."""
    ppl = key["people"]
    recount = {t: sum(1 for p in ppl if p["tab"] == t) for t in ("giver", "neighbor", "community")}
    check("tab_counts match a recount of `people`", recount == key["tab_counts"], f"({recount})")
    check("giver tab == canonical donors", recount["giver"] == key["totals"]["canonical_donors"])
    check("unique person_ids", len({p["person_id"] for p in ppl}) == len(ppl))
    d = Document(OUT / F_COMMUNITY)
    forms = len(d.tables)
    cm = [c for c in key["community_members"] if any(r["kind"] == "intake_form" for r in c["source_rows"])]
    check("12-15 community intake forms, one per key member", 12 <= forms <= 15 and forms == len(cm), f"({forms} forms)")
    ws = wb_sign[SIGNIN_SHEET]
    rows = [r for r in ws.iter_rows(min_row=4, values_only=True) if isinstance(r[0], int)]
    check("sign-in sheet has 25-30 rows", 25 <= len(rows) <= 30, f"({len(rows)} rows)")
    in_key = sum(
        1 for grp in (key["community_members"], key["neighbors"]) for m in grp for r in m["source_rows"] if r["file"] == F_SIGNIN)
    in_key += sum(1 for dn in key["canonical_donors"] for r in dn["source_rows"] if r["file"] == F_SIGNIN)
    check("every sign-in row is in the key", in_key == len(rows), f"({in_key} vs {len(rows)})")
    names = {str(r[1]) for r in rows}
    sheet_names = {r["name_as_written"] for grp in (key["community_members"], key["neighbors"]) for m in grp
                   for r in m["source_rows"] if r["file"] == F_SIGNIN}
    check("sign-in names in key == names on sheet", sheet_names <= names)
    amb = [p for p in ppl if p["ambiguous"]]
    check("3 ambiguous people, each named in the retreat notes", len(amb) == 3 and all(p["full_name"] in md for p in amb))
    check("every ambiguous person has notes source_rows (index + detail lists)", all(
        p["source_rows"] and p["source_rows"][-1]["file"] == F_MD for p in amb if p["person_id"] != "C06") and all(
        p["source_rows"] for p in amb))
    al = key["gift_alerts_expected"]
    check("gift alerts: 2 failed + 3 late", sorted((a["donor"], a["kind"]) for a in al) ==
          [("Hye-jin Park", "failed"), ("Rafael Quintero", "failed"), ("Teodoro Salinas", "late"),
           ("Veloria Bay Foundation", "late"), ("Walter Brandt", "late")])
    check("declined charge is on/before as_of", all(f["date"] <= AS_OF.isoformat() for f in key["failed_gifts_not_counted"])
          and all(f["status"] == "declined" for f in key["failed_gifts_not_counted"]))
    fg = key["failed_gifts_not_counted"][0]
    sheet = load_workbook(OUT / F_XLSX)["Online"]
    row = int(fg["source"]["location"].rsplit(" ", 1)[1])
    check("declined row exists on the sheet and is not a key gift", "declined" in str(sheet.cell(row, 8).value).lower()
          and not any(g["donor"] == fg["donor"] and g["gift_date"] == fg["date"] for g in key["gifts"]))
    puppy = key["puppy_outreach"]
    dogs = [p for p in ppl if p.get("has_dog") is True and p["has_contact"]]
    check("puppy target_count == recount", puppy["target_count"] == len(dogs) == len(puppy["target_ids"]), f"({len(dogs)})")
    check("every neighbor with a 'Y' dog on the sheet is has_dog", all(
        n.get("has_dog") for n in key["neighbors"] if any(r["file"] == F_SIGNIN for r in n["source_rows"]) and n["person_id"] in
        {"N01", "N04", "N06", "N08", "N11", "N13", "N15", "N17", "N19"}))
    ph = [p for p in re.findall(r"305-555-\d{4}", json.dumps(key))]
    check("key phones are all 305-555-01xx", all(p[8:10] == "01" for p in ph), f"({len(ph)})")


def verify():
    """Re-open every file and prove the key matches what is actually in them."""
    key = json.loads((OUT / "answer_key.json").read_text(encoding="utf-8"))
    ok = True

    def check(label, cond, detail=""):
        nonlocal ok
        ok &= bool(cond)
        print(f"  [{'PASS' if cond else 'FAIL'}] {label} {detail}")

    wb = load_workbook(OUT / F_XLSX)
    amt_col = {"GMD gifts": 2, "Online": 2, "Major gifts 22-25": 2}
    xl_rows, xl_sum = 0, 0.0
    for ws in wb.worksheets:
        for r in ws.iter_rows(min_row=1, values_only=True):
            first = str(r[0] or "")
            if not first or first.upper().startswith(("TOTAL", "GRAND")) or first in ("Donor Name", "Name", "Donor / Organization"):
                continue
            if ws.title == "Online" and "declined" in str(r[7] or "").lower():
                continue  # failed charge: not a gift
            n = _num(r[amt_col[ws.title]])
            if n is not None:
                xl_rows += 1
                xl_sum += n
    for ws in load_workbook(OUT / F_OCTNOV).worksheets:       # Q4 online + wire export: col C is the amount
        for r in ws.iter_rows(min_row=1, values_only=True):
            if str(r[0] or "").lower().startswith("subtotal"):
                continue
            n = _num(r[2])
            if n is not None:
                xl_rows += 1
                xl_sum += n
    docs = {}
    for f in (F_CHECK, F_STOCK):
        d = Document(OUT / f)
        s, c = 0.0, 0
        for row in d.tables[0].rows[1:]:
            col = 2
            s += _num(row.cells[col].text); c += 1
        docs[f] = (c, s)
    md = (OUT / F_MD).read_text(encoding="utf-8")
    note_gifts = [g for g in key["gifts"] if g["source"]["file"] == F_MD]
    note_sum = sum(g["amount"] for g in note_gifts)
    for g in note_gifts:
        check(f"notes mention gift ${g['amount']:,}", f"${g['amount']:,}" in md)
    rows = xl_rows + sum(c for c, _ in docs.values()) + len(note_gifts)
    tot = xl_sum + sum(s for _, s in docs.values()) + note_sum
    t = key["totals"]
    dbl = key["double_recorded_gift"]["amount"]
    check("source rows - 1 double == unique gifts", rows - 1 == t["unique_gifts"], f"({rows} - 1 vs {t['unique_gifts']})")
    check("sum of source rows - double == key total", round(tot - dbl) == t["total_amount"], f"({tot:,.0f} - {dbl} vs {t['total_amount']:,})")
    q4 = sum(g["amount"] for g in key["gifts"] if g["gift_date"] >= "2026-10-01")
    check("2026 Q4 gifts are $90k-$110k more than the old $750", 90_000 <= q4 - 750 <= 110_000, f"(Q4 total ${q4:,}; gauge {q4 / 150_000:.0%} of the $150k sample goal)")
    q4 = sum(g["amount"] for g in key["gifts"] if g["gift_date"] >= "2026-10-01")
    check("new file adds $90k-$110k of Oct-Nov 2026 gifts", 90_000 <= q4 - 750 <= 110_000, f"(Q4 total ${q4:,}; gauge {q4 / 150_000:.0%} of the $150k sample goal)")
    check("key gifts sum == key total", sum(g["amount"] for g in key["gifts"]) == t["total_amount"])
    check("6 duplicate groups", len(key["duplicate_groups"]) == 6)
    check("33 donors 25-35, orgs 5-7", 25 <= t["canonical_donors"] <= 35 and 5 <= t["organizations"] <= 7)
    check("exactly one double-recorded gift", sum(1 for g in key["gifts"] if "also_recorded_at" in g) == 1)
    check("every gift has a donor + location", all(g["donor_id"] and g["source"]["location"] for g in key["gifts"]))
    # text sweep for emails / phones
    text = md + "\n".join(c.text for f in (F_CHECK, F_INTAKE, F_STOCK, F_COMMUNITY) for tb in Document(OUT / f).tables
                          for row in tb.rows for c in row.cells)
    text += "\n".join(c.text for f in (F_CHECK, F_INTAKE, F_STOCK, F_COMMUNITY) for c in Document(OUT / f).paragraphs)
    wb_sign = load_workbook(OUT / F_SIGNIN)
    for w in list(wb.worksheets) + list(wb_sign.worksheets):
        for r in w.iter_rows(values_only=True):
            text += "\n" + " ".join(str(v) for v in r if v is not None)
    emails = set(re.findall(r"[\w.+-]+@[\w.-]+\w", text))
    bad = [e for e in emails if not re.search(r"@example\.(com|org)$", e, re.I)]
    check("all emails end in @example.com/.org", not bad, f"({len(emails)} distinct, bad={bad})")
    allp = re.findall(r"[0-9]{3}[-. )]+[0-9]{3}[-. ][0-9]{4}", text)
    check("all phones are 305-555-01xx", len(allp) > 0 and all(re.search(r"305[^0-9]+555[^0-9]+01[0-9][0-9]", p) for p in allp), f"({len(allp)} found)")
    verify_tabs(key, check, md, wb_sign)
    top = key["expected_top3_lapsing_as_of_2026_11_08"]
    check("top-3 lapsing present", [x["rank"] for x in top] == [1, 2, 3], "-> " + ", ".join(x["donor"] for x in top))
    vel = sum(g["amount"] for g in key["gifts"] if g["donor"] == "Veloria Bay Foundation")
    check("Veloria Bay lifetime >= $1M", vel >= 1_000_000, f"(${vel:,})")
    print("VERIFY:", "ALL PASS" if ok else "FAILURES")
    return 0 if ok else 1


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    write_check_log()   # first: assigns check numbers
    write_xlsx()
    write_octnov()
    write_stock()
    write_intake()
    write_notes()
    write_community()
    write_signin()
    attach_notes_people()
    key = build_key()
    (OUT / "answer_key.json").write_text(json.dumps(key, indent=2, ensure_ascii=False), encoding="utf-8")
    t = key["totals"]
    print(f"wrote {len(key['files']) + 1} files to {OUT}")
    print(f"donors={t['canonical_donors']} (individuals={t['individuals']}, orgs={t['organizations']}) "
          f"gifts={t['unique_gifts']} total=${t['total_amount']:,} dup_groups={t['duplicate_groups']}")
    print(f"tabs={key['tab_counts']} ambiguous={key['ambiguous_count']} "
          f"puppy_targets={key['puppy_outreach']['target_count']}")
    pin_timestamps()
    return verify()


if __name__ == "__main__":
    sys.exit(main())
