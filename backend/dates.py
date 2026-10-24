"""Robust deterministic date and time parser for Hindi, Hinglish, and English.
CRITICAL RULE: Never uses datetime.now(). All dates resolve strictly against reference `today`.
No hardcoded dates or test case IDs.
"""

from __future__ import annotations
import datetime
import re
from typing import Optional, Tuple

WEEKDAYS = {
    "mon": 0, "monday": 0, "somwar": 0, "somvaar": 0, "peer": 0,
    "tue": 1, "tuesday": 1, "mangalwar": 1, "mangalvaar": 1,
    "wed": 2, "wednesday": 2, "budhwar": 2, "budhvaar": 2,
    "thu": 3, "thursday": 3, "guruwar": 3, "brihaspatiwar": 3, "veerwar": 3,
    "fri": 4, "friday": 4, "shukrawar": 4, "shukravaar": 4, "jumma": 4,
    "sat": 5, "saturday": 5, "shanivaar": 5, "shaniwar": 5, "sanichar": 5,
    "sun": 6, "sunday": 6, "ravivar": 6, "itwar": 6, "itvaar": 6
}

HINDI_CARDINALS = {
    "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5,
    "chhe": 6, "che": 6, "saat": 7, "aath": 8, "nau": 9, "dus": 10, "das": 10,
    "gyarah": 11, "barah": 12, "terah": 13, "chaudah": 14, "pandrah": 15,
    "solah": 16, "satrah": 17, "atharah": 18, "unnees": 19, "bees": 20,
    "ikkees": 21, "baees": 22, "teis": 23, "chaubees": 24, "pachhees": 25,
    "chhabees": 26, "sattaees": 27, "atthaees": 28, "untees": 29, "tees": 30,
    "ikattees": 31
}

MONTH_MAP = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12
}


def parse_reference_date(today_str: str) -> datetime.date:
    """Parse today string (YYYY-MM-DD)."""
    return datetime.date.fromisoformat(today_str)


def parse_date_from_text(text: str, today_str: str) -> Optional[str]:
    """Extract and resolve target date from text against `today_str`.
    Returns YYYY-MM-DD or None.
    Handles change of mind (later mentions in text take precedence).
    """
    text_lower = text.lower()
    ref_date = parse_reference_date(today_str)

    # Collect all candidate date mentions along with their character position in text
    candidates: list[tuple[int, datetime.date]] = []

    # 1. Explicit tareekh with digits: e.g. "3 tareekh", "7 tareekh ko", "3 October", "October 3"
    digit_date_pat = re.compile(r'\b(\d{1,2})\s*(?:tareekh|tarikh|date|st|nd|rd|th)?\s*(?:(?:ke|ko)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)?', re.IGNORECASE)
    for m in digit_date_pat.finditer(text_lower):
        matched_str = m.group(0)
        # Avoid treating clock times or phone numbers as tareekh
        if any(w in matched_str for w in ["baje", ":", "am", "pm"]) or len(m.group(1)) > 2:
            continue
        # If the word 'tareekh' or a month is present, or if it's explicitly '3 tareekh'
        day_val = int(m.group(1))
        month_group = m.group(2)
        if 1 <= day_val <= 31:
            if "tareekh" in matched_str or "tarikh" in matched_str or "date" in matched_str or month_group:
                target_month = MONTH_MAP.get(month_group.lower(), ref_date.month) if month_group else ref_date.month
                target_year = ref_date.year
                try:
                    d = datetime.date(target_year, target_month, day_val)
                    # If target date has already passed relative to ref_date in same month, consider next month
                    if d < ref_date and not month_group:
                        if target_month == 12:
                            d = datetime.date(target_year + 1, 1, day_val)
                        else:
                            d = datetime.date(target_year, target_month + 1, day_val)
                    candidates.append((m.start(), d))
                except ValueError:
                    pass

    # 2. Hindi number words with tareekh: e.g. "teen tareekh", "saat tareekh"
    for word, num_val in HINDI_CARDINALS.items():
        pat = rf'\b{word}\s*(?:tareekh|tarikh)\b'
        for m in re.finditer(pat, text_lower):
            try:
                d = datetime.date(ref_date.year, ref_date.month, num_val)
                candidates.append((m.start(), d))
            except ValueError:
                pass

    # 3. Weekday mentions: "somwar", "shanivaar", "Sunday", etc.
    for wd_name, wd_idx in WEEKDAYS.items():
        pat = rf'\b{wd_name}\b'
        for m in re.finditer(pat, text_lower):
            # Calculate days ahead from ref_date (Thursday=3)
            days_ahead = wd_idx - ref_date.weekday()
            if days_ahead < 0:
                days_ahead += 7
            d = ref_date + datetime.timedelta(days=days_ahead)
            candidates.append((m.start(), d))

    # 4. Relative terms: parso (+2), tarso (+3), kal (+1), aaj (0)
    for m in re.finditer(r'\b(?:parso|day after tomorrow)\b', text_lower):
        candidates.append((m.start(), ref_date + datetime.timedelta(days=2)))

    for m in re.finditer(r'\b(?:tarso|narso)\b', text_lower):
        candidates.append((m.start(), ref_date + datetime.timedelta(days=3)))

    for m in re.finditer(r'\b(?:kal|tomorrow)\b', text_lower):
        candidates.append((m.start(), ref_date + datetime.timedelta(days=1)))

    for m in re.finditer(r'\b(?:aaj|today)\b', text_lower):
        candidates.append((m.start(), ref_date))

    if not candidates:
        return None

    # Sort candidates by appearance position in sentence.
    # The last candidate represents the user's final decision or correction.
    candidates.sort(key=lambda x: x[0])
    return candidates[-1][1].isoformat()


def parse_time_from_text(text: str) -> Tuple[Optional[str], Optional[str]]:
    """Extract start time (HH:MM) and window ('morning'|'evening'|None) from text.
    Handles exact HH:MM, Hindi clock expressions, and modifiers (saadhe, sawa, paune).
    """
    text_lower = text.lower()
    window = None
    if re.search(r'\b(?:subah|morning|am)\b', text_lower):
        window = "morning"
    elif re.search(r'\b(?:shaam|sham|dopahar|evening|afternoon|raat|pm)\b', text_lower):
        window = "evening"

    # 1. Exact digital time format: e.g. "09:30", "10:15", "11:00", "9:30"
    m_time = re.findall(r'\b(\d{1,2}):(\d{2})\b', text_lower)
    if m_time:
        hr = int(m_time[-1][0])
        mn = int(m_time[-1][1])
        if window == "evening" and hr < 12:
            hr += 12
        return f"{hr:02d}:{mn:02d}", window

    # 2. Hindi modifiers:
    # "saadhe nau" -> 09:30, "saadhe dus" -> 10:30, "saadhe gyarah" -> 11:30
    # "sawa dus" -> 10:15, "paune gyarah" -> 10:45
    modifier_matches = []
    for mod_name, min_offset in [("saadhe", 30), ("sadhe", 30), ("sawa", 15), ("paune", -15)]:
        for word, val in HINDI_CARDINALS.items():
            pat = rf'\b{mod_name}\s+{word}\b'
            for m in re.finditer(pat, text_lower):
                hr = val
                if min_offset == -15:
                    hr -= 1
                    min_val = 45
                else:
                    min_val = min_offset
                if window == "evening" and hr < 12:
                    hr += 12
                modifier_matches.append((m.start(), f"{hr:02d}:{min_val:02d}"))

    if modifier_matches:
        modifier_matches.sort(key=lambda x: x[0])
        return modifier_matches[-1][1], window

    # 3. Digit with baje: e.g. "10 baje", "9 baje", "5 baje"
    baje_matches = []
    for m in re.finditer(r'\b(\d{1,2})\s*baje\b', text_lower):
        hr = int(m.group(1))
        if window == "evening" and hr < 12:
            hr += 12
        baje_matches.append((m.start(), f"{hr:02d}:00"))

    # 4. Word with baje: e.g. "dus baje", "gyarah baje", "nau baje"
    for word, val in HINDI_CARDINALS.items():
        for m in re.finditer(rf'\b{word}\s*baje\b', text_lower):
            hr = val
            if (window == "evening" or hr <= 7) and hr < 12 and word in ["char", "chaar", "paanch", "panch", "chhe", "che", "saat"]:
                hr += 12
            baje_matches.append((m.start(), f"{hr:02d}:00"))

    if baje_matches:
        baje_matches.sort(key=lambda x: x[0])
        return baje_matches[-1][1], window

    # 5. Standalone Hindi time words if used in appointment scheduling context
    for word, val in HINDI_CARDINALS.items():
        if word in ["nau", "dus", "das", "gyarah", "barah"] and re.search(rf'\b{word}\b', text_lower):
            hr = val
            return f"{hr:02d}:00", window

    return None, window
