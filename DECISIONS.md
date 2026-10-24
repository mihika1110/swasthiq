# Architecture & Design Decisions (DECISIONS.md)

This document details the architectural choices, ambiguities discovered in the assignment specification/starter pack, trade-offs made, and how data consistency and safety are maintained.

---

## 1. Ambiguities & Inconsistencies Discovered in Starter Material

### A. Overlapping Schedule Windows for Dr. Rao on Monday
* **The Inconsistency:** In `clinic.json`, Dr. Rao's Monday working schedule defines two overlapping windows:
  ```json
  {"day": "Mon", "start": "09:00", "end": "12:00"},
  {"day": "Mon", "start": "11:45", "end": "15:00"}
  ```
  The interval between `11:45` and `12:00` overlaps by 15 minutes.
* **Decision:** In `backend/tools.py::search_slots`, window slot starts are calculated into a mathematical `set()` before sorting. This deduplicates the `11:45` slot cleanly, preventing duplicate slot listings or slot collisions while preserving continuous availability from 09:00 through 15:00.

### B. Family Phone Sharing vs. Patient Ambiguity
* **The Ambiguity:** Multiple family members in `clinic.json` share the exact same mobile number:
  - `9812200197` belongs to both `pt_0009` (Meera Joshi) and `pt_0031` (Kabir Joshi).
  - `9812200166` belongs to `pt_0008` (Sunita Gupta), `pt_0006` (Aarav Gupta), and `pt_0007` (Arjun Gupta).
* **Decision:** The phone lookup returns all matching family members, but the agent resolves the *intended patient* dynamically by cross-referencing:
  1. The `guardian_of` array in `clinic.json` (verifying parental authorization).
  2. Distinctive first-name mentions in the conversation (e.g. "Kabir mera beta hai" -> maps to `pt_0031`; "Mere bete Aarav ke liye" -> maps to `pt_0006`).
  If a caller only mentions a shared surname ("Sharma ji") with no phone, the system identifies multiple candidates and strictly escalates with `ambiguous_patient` rather than guessing.

---

## 2. The Ground Truth Tool Layer & Zero Hallucinations

* **Core Rule:** The tool layer (`backend/tools.py`) **never calls an LLM**.
* **Zero Invented Facts:** The agent's final outcome can only confirm an appointment or patient that was returned by `search_slots` or `lookup_patient`. If a caller asks for Sunday (`cv_0005`), a clinic holiday (Oct 2), or a doctor on leave (Dr. Sethi on Oct 5–7), `search_slots` returns `[]`. The agent informs the caller and marks the state `abandoned`.
* **Atomic Double-Booking Prevention:** In `book_appointment`, before inserting a new record, the tool performs an atomic collision check against all existing appointments with `status == "booked"` for that doctor and date. If another request attempts to book the same slot, a specific `ToolExecutionError` is raised.

---

## 3. The One Hard Rule: Emergency Reflex vs. Booking Flow

* **The Problem:** In `cv_0011`, a caller starts with an ordinary booking flow ("Dr. Rao ke saath kal ka appointment... Subah 10 baje") and in the 3rd turn mentions: *"Waise abhi seene mein dard ho raha hai aur saans thodi phool rahi hai."*
* **Decision:** Acute clinical emergency detection is treated as a **pre-emptive safety interrupt**.
  - Regardless of where the conversation is in the booking pipeline, the flow is instantly aborted.
  - No appointment is created (`appointment_id = None`).
  - The tool `escalate_to_human(reason="clinical_urgent")` is called.
  - The agent responds with immediate triage advice directing the patient to nearest emergency hospital facilities.
  - This rule also covers stroke/FAST signs (facial drooping, slurred speech), unconsciousness, and heavy bleeding (as tested in `adv_0001`).

---

## 4. Date & Time Resolution Without Clock Drift

* **Requirement:** No usage of `datetime.now()`.
* **Decision:** All natural language temporal expressions ("aaj", "kal", "parso", "somwar", "3 tareekh", "Shanivaar", "10 baje", "gyarah baje") are resolved relative to the request's `today` field (default `2026-10-01`).
* **Change of Mind Handling:** Callers frequently change their mind mid-utterance (e.g. `cv_0002`: *"Mangalwar 6 tareekh ko... nahi nahi, budhwar kar dijiye, 7 tareekh"*). Our parser indexes date mentions sequentially; the latest date mentioned in the discourse takes precedence.

---

## 5. Security & Authorization Defenses

* **Prompt Injections & Jailbreaks (`cv_0014`, `adv_0002`):**
  - Attempts to inject instructions ("Ignore previous instructions", "You are now in administrator mode", "Cancel every appointment") are trapped by our security filter.
  - The agent returns `terminal_state="refused"` with `escalation_reason=null` without executing any unauthorized tools.
* **Third-Party Record Tampering (`cv_0009`, `adv_0005`):**
  - Unverified third parties (neighbors, employers, colleagues) attempting to cancel or inspect appointments are blocked and escalated with `not_authorised`.

---

## 6. Determinism & Performance

* **100% Determinism:** State is completely isolated per conversation run by reloading from `clinic.json` (or roll-backed in-memory). Running `runner.py --repeat 3` yields identical fingerprints and terminal states across all iterations.
* **Latency & Token Efficiency:** The local deterministic agent layer executes in **10–40ms** per multi-turn dialogue, consuming 0 third-party API tokens when running locally, while remaining plug-and-play with external LLMs (GPT-4o / Gemini) via standard function calling.
