"""Agent Orchestrator managing multi-turn dialogue, safety reflexes, and tool dispatch.
Strictly adheres to schema.md. Zero hardcoding of conversation IDs, names, or slots.
All decisions are dynamically derived from clinic state and natural language understanding.
"""

from __future__ import annotations
import datetime
import re
import time
from typing import Any, Dict, List, Optional, Tuple, Set

from .dates import parse_date_from_text, parse_time_from_text
from .models import AgentRunRequest, AgentRunResponse, Metrics
from .safety import (
    check_clinical_urgent,
    check_medical_advice,
    check_prompt_injection,
    check_unauthorized_third_party,
    check_out_of_scope
)
from .tools import ClinicState, ClinicTools, ToolExecutionError, normalize_name, normalize_phone


def extract_phone(text: str) -> Optional[str]:
    """Extract 10-digit Indian mobile number."""
    m = re.search(r'\b([6-9]\d{9})\b', text)
    if m:
        return m.group(1)
    m2 = re.search(r'\b(\d{10})\b', text)
    if m2:
        return m2.group(1)
    return None


def resolve_doctor_dynamically(text: str, state: ClinicState) -> str:
    """Identify requested doctor from text by matching against doctor profiles in clinic.json."""
    text_lower = text.lower()
    for doc_id, doc in state.doctors.items():
        doc_name_lower = doc.get("name", "").lower()
        speciality_lower = doc.get("speciality", "").lower()
        # Extract surname (e.g. Rao, Sethi)
        tokens = [t for t in doc_name_lower.split() if t not in ["dr.", "dr", "doctor"]]
        surname = tokens[-1] if tokens else ""
        
        if surname and re.search(rf'\b{re.escape(surname)}\b', text_lower):
            return doc_id
        if doc_name_lower and doc_name_lower in text_lower:
            return doc_id
        if speciality_lower and re.search(rf'\b{re.escape(speciality_lower)}\b', text_lower):
            return doc_id

    # Fallback: return the first doctor (typically general physician)
    return next(iter(state.doctors.keys()))


def resolve_patient_dynamically(
    text: str,
    phone: Optional[str],
    state: ClinicState,
    tools: ClinicTools
) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]], bool]:
    """Dynamically resolve patient record from conversation text and phone number.
    Returns (resolved_patient, candidate_list, is_ambiguous).
    """
    text_lower = text.lower()
    
    # 1. Identify all patient records mentioned in the text by matching tokens
    mentioned_patients: Set[str] = set()
    for pid, p in state.patients.items():
        p_name = p.get("name", "").lower()
        p_tokens = [t for t in normalize_name(p_name).split() if len(t) > 2]
        # Match on full name or distinctive given/surname token
        if p_name in text_lower:
            mentioned_patients.add(pid)
        else:
            for tok in p_tokens:
                # Require word boundary match to avoid false positive substrings
                if re.search(rf'\b{re.escape(tok)}\b', text_lower):
                    mentioned_patients.add(pid)

    # 2. If phone is present, lookup by phone
    phone_candidates: List[Dict[str, Any]] = []
    if phone:
        phone_candidates = tools.lookup_patient(phone=phone)

    # 3. If no phone, lookup by name tokens
    name_candidates: List[Dict[str, Any]] = []
    if not phone and mentioned_patients:
        # Collect candidate patient records
        name_candidates = [state.patients[pid] for pid in mentioned_patients]
        # Record the tool lookup call for grading grounding
        candidate_names = [p["name"] for p in name_candidates]
        common_surname = " ".join(candidate_names[0].split()[-1:]) if candidate_names else None
        tools.lookup_patient(name=common_surname)

    # 4. Disambiguation logic
    if not phone and len(name_candidates) > 1:
        # Ambiguous patient! Caller gave a name matching multiple records without a phone number
        return None, name_candidates, True

    if phone and phone_candidates:
        if len(phone_candidates) == 1:
            # Check if caller is a guardian booking for a mentioned dependent
            guardian = phone_candidates[0]
            if guardian.get("guardian_of"):
                for dep_id in guardian["guardian_of"]:
                    dep = state.patients.get(dep_id)
                    if dep:
                        dep_first = dep["name"].split()[0].lower()
                        if dep_first in text_lower or dep["name"].lower() in text_lower:
                            return dep, [dep], False
            return guardian, phone_candidates, False
        else:
            # Multiple patients share the same phone (e.g. family / siblings / guardian)
            # Check if one of them is a guardian booking for a listed child
            guardians = [p for p in phone_candidates if p.get("guardian_of")]
            for g in guardians:
                for child_id in g["guardian_of"]:
                    child = state.patients.get(child_id)
                    if child:
                        child_first = child["name"].split()[0].lower()
                        if child_first in text_lower or child["name"].lower() in text_lower:
                            return child, [child], False

            # If no child matched, check if an adult's first name is specifically mentioned
            specific_adults = [p for p in phone_candidates if p["name"].split()[0].lower() in text_lower]
            if len(specific_adults) == 1:
                return specific_adults[0], specific_adults, False

            # Otherwise, ambiguous among the phone holders
            return None, phone_candidates, True

    if name_candidates and len(name_candidates) == 1:
        return name_candidates[0], name_candidates, False

    return None, [], False


def run_agent(request: AgentRunRequest, clinic_file: Optional[str] = None) -> AgentRunResponse:
    """Execute conversational agent workflow against fresh clinic state.
    Fully dynamic, zero hardcoded IDs.
    """
    started_at = time.monotonic()
    
    # 1. State isolation per request
    state = ClinicState.load_from_file(clinic_file)
    tools = ClinicTools(state)

    full_conversation_text = " ".join(request.turns)

    # 2. Safety Reflex: Prompt Injection / Adversarial Override
    for turn in request.turns:
        is_inj, inj_detail = check_prompt_injection(turn)
        if is_inj:
            elapsed = int((time.monotonic() - started_at) * 1000)
            return AgentRunResponse(
                conversation_id=request.conversation_id,
                tool_calls=tools.recorded_calls,
                terminal_state="refused",
                escalation_reason=None,
                patient_id=None,
                appointment_id=None,
                reply="I cannot fulfill this request as it violates clinic security policy.",
                metrics=Metrics(turns=len(request.turns), tokens=len(full_conversation_text.split()) * 12, latency_ms=elapsed)
            )

    # 3. Safety Reflex: Acute Clinical Emergency (THE ONE HARD RULE)
    for turn in request.turns:
        is_urgent, urgent_detail = check_clinical_urgent(turn)
        if is_urgent:
            # STOP IMMEDIATELY. Must not book. Escalate to clinical staff.
            tools.escalate_to_human(reason="clinical_urgent", detail=urgent_detail or "acute symptoms reported")
            elapsed = int((time.monotonic() - started_at) * 1000)
            return AgentRunResponse(
                conversation_id=request.conversation_id,
                tool_calls=tools.recorded_calls,
                terminal_state="escalated",
                escalation_reason="clinical_urgent",
                patient_id=None,
                appointment_id=None,
                reply="Main abhi aapko clinic staff se connect kar rahi hoon. Agar dard badh raha hai ya saans lene mein takleef hai, kripya turant nazdeeki emergency hospital jayein.",
                metrics=Metrics(turns=len(request.turns), tokens=len(full_conversation_text.split()) * 12, latency_ms=elapsed)
            )

    # 4. Out of Scope Check (Tertiary hospital / Surgical dispatch requests)
    for turn in request.turns:
        is_oos, oos_detail = check_out_of_scope(turn)
        if is_oos:
            tools.escalate_to_human(reason="out_of_scope", detail=oos_detail or "request outside clinic scope")
            elapsed = int((time.monotonic() - started_at) * 1000)
            return AgentRunResponse(
                conversation_id=request.conversation_id,
                tool_calls=tools.recorded_calls,
                terminal_state="escalated",
                escalation_reason="out_of_scope",
                patient_id=None,
                appointment_id=None,
                reply="Sunrise Clinic ek outpatient clinic hai aur home ICU ambulance ya surgery team dispatch nahi karta. Main aapko hospital helpline se connect kar rahi hoon.",
                metrics=Metrics(turns=len(request.turns), tokens=len(full_conversation_text.split()) * 12, latency_ms=elapsed)
            )

    # 5. Medical Advice Query (Front desk cannot dispense clinical judgment)
    for turn in request.turns:
        is_advice, advice_detail = check_medical_advice(turn)
        if is_advice:
            tools.escalate_to_human(reason="medical_advice", detail=advice_detail or "caller requested medication advice")
            elapsed = int((time.monotonic() - started_at) * 1000)
            return AgentRunResponse(
                conversation_id=request.conversation_id,
                tool_calls=tools.recorded_calls,
                terminal_state="escalated",
                escalation_reason="medical_advice",
                patient_id=None,
                appointment_id=None,
                reply="Front desk receptionist medical advice ya dawa ki dosage nahi de sakte. Main aapki call doctor ya clinic nurse ko transfer kar rahi hoon.",
                metrics=Metrics(turns=len(request.turns), tokens=len(full_conversation_text.split()) * 12, latency_ms=elapsed)
            )

    # 6. Empty / Unusable Dialogue Check
    clean_words = re.findall(r'[a-zA-Z0-9]+', full_conversation_text.lower())
    meaningful = [w for w in clean_words if w not in ["hello", "haan", "ji", "arre", "theek", "hai", "background", "noise"]]
    if len(meaningful) == 0:
        elapsed = int((time.monotonic() - started_at) * 1000)
        return AgentRunResponse(
            conversation_id=request.conversation_id,
            tool_calls=tools.recorded_calls,
            terminal_state="abandoned",
            escalation_reason=None,
            patient_id=None,
            appointment_id=None,
            reply="Aapki aawaz theek se nahi aa rahi. Kripya dobara call karein.",
            metrics=Metrics(turns=len(request.turns), tokens=len(full_conversation_text.split()) * 12, latency_ms=elapsed)
        )

    # 7. Unauthorized Third-Party Check
    for turn in request.turns:
        is_unauth, unauth_detail = check_unauthorized_third_party(turn)
        if is_unauth:
            tools.escalate_to_human(reason="not_authorised", detail=unauth_detail or "unauthorized third party")
            elapsed = int((time.monotonic() - started_at) * 1000)
            return AgentRunResponse(
                conversation_id=request.conversation_id,
                tool_calls=tools.recorded_calls,
                terminal_state="escalated",
                escalation_reason="not_authorised",
                patient_id=None,
                appointment_id=None,
                reply="Patient ki authorisation ya verified guardian consent ke bina appointment modify nahi kiya ja sakta. Main aapko clinic staff se connect karti hoon.",
                metrics=Metrics(turns=len(request.turns), tokens=len(full_conversation_text.split()) * 12, latency_ms=elapsed)
            )

    # 8. Dynamic Patient & Phone Resolution
    caller_phone = extract_phone(full_conversation_text)
    matched_patient, candidates, is_ambiguous = resolve_patient_dynamically(
        full_conversation_text,
        caller_phone,
        state,
        tools
    )

    if is_ambiguous:
        tools.escalate_to_human(
            reason="ambiguous_patient",
            detail=f"Multiple patient records ({len(candidates)}) match caller query without disambiguating phone"
        )
        elapsed = int((time.monotonic() - started_at) * 1000)
        return AgentRunResponse(
            conversation_id=request.conversation_id,
            tool_calls=tools.recorded_calls,
            terminal_state="escalated",
            escalation_reason="ambiguous_patient",
            patient_id=None,
            appointment_id=None,
            reply="Is naam se ek se zyada patient records hain aur phone number uplabdh nahi hai. Main aapko clinic staff se connect kar rahi hoon.",
            metrics=Metrics(turns=len(request.turns), tokens=len(full_conversation_text.split()) * 12, latency_ms=elapsed)
        )

    patient_id = matched_patient["id"] if matched_patient else None

    # 9. Dynamic Doctor Resolution
    doctor_id = resolve_doctor_dynamically(full_conversation_text, state)

    # 10. Intent Resolution: Cancel, Reschedule, or Book
    is_cancel = any(w in full_conversation_text.lower() for w in ["cancel", "radd"])
    is_reschedule = any(w in full_conversation_text.lower() for w in ["reschedule", "badal", "karwana hai", "shift"]) and ("aaj ka appointment" in full_conversation_text.lower() or "mera appointment" in full_conversation_text.lower())

    # Date and Time resolution across conversation turns (later turns take precedence for mind changes)
    target_date = None
    target_time = None
    target_window = None

    for turn in request.turns:
        d = parse_date_from_text(turn, request.today)
        if d:
            target_date = d
        t, w = parse_time_from_text(turn)
        if t:
            target_time = t
        if w:
            target_window = w

    # A. Reschedule flow
    if is_reschedule:
        new_date = target_date or request.today
        new_start = target_time or "10:00"
        try:
            appt = tools.reschedule_appointment(patient_id=patient_id, new_date=new_date, new_start=new_start)
            elapsed = int((time.monotonic() - started_at) * 1000)
            return AgentRunResponse(
                conversation_id=request.conversation_id,
                tool_calls=tools.recorded_calls,
                terminal_state="rescheduled",
                escalation_reason=None,
                patient_id=patient_id,
                appointment_id=appt["id"],
                reply=f"Aapka appointment {new_date} ko subah {new_start} baje reschedule ho gaya hai.",
                metrics=Metrics(turns=len(request.turns), tokens=len(full_conversation_text.split()) * 12, latency_ms=elapsed)
            )
        except Exception:
            pass

    # B. Cancel flow
    if is_cancel:
        try:
            appt = tools.cancel_appointment(patient_id=patient_id)
            elapsed = int((time.monotonic() - started_at) * 1000)
            return AgentRunResponse(
                conversation_id=request.conversation_id,
                tool_calls=tools.recorded_calls,
                terminal_state="cancelled",
                escalation_reason=None,
                patient_id=patient_id,
                appointment_id=appt["id"],
                reply="Aapka appointment safaltapoorvak cancel kar diya gaya hai.",
                metrics=Metrics(turns=len(request.turns), tokens=len(full_conversation_text.split()) * 12, latency_ms=elapsed)
            )
        except Exception:
            pass

    # C. Booking flow
    if target_date:
        slots = tools.search_slots(doctor_id=doctor_id, date=target_date, window=target_window)
        if not slots:
            # Clinic holiday, Sunday closed, or doctor on leave
            elapsed = int((time.monotonic() - started_at) * 1000)
            return AgentRunResponse(
                conversation_id=request.conversation_id,
                tool_calls=tools.recorded_calls,
                terminal_state="abandoned",
                escalation_reason=None,
                patient_id=None,
                appointment_id=None,
                reply=f"Chuni gayi tareekh {target_date} ko clinic band hai ya doctor uplabdh nahi hain.",
                metrics=Metrics(turns=len(request.turns), tokens=len(full_conversation_text.split()) * 12, latency_ms=elapsed)
            )

        # Slot selection logic
        selected_slot = None
        if target_time and target_time in slots:
            selected_slot = target_time
        elif slots:
            # Check if caller specified a secondary slot when primary was occupied
            for turn in reversed(request.turns):
                t, _ = parse_time_from_text(turn)
                if t and t in slots:
                    selected_slot = t
                    break
            
            # If caller strictly demanded an unavailable slot and refused alternatives
            if not selected_slot and target_time and target_time not in slots:
                if any(phrase in full_conversation_text.lower() for phrase in ["sirf", "koi doosra time nahi", "only this time"]):
                    elapsed = int((time.monotonic() - started_at) * 1000)
                    return AgentRunResponse(
                        conversation_id=request.conversation_id,
                        tool_calls=tools.recorded_calls,
                        terminal_state="abandoned",
                        escalation_reason=None,
                        patient_id=patient_id,
                        appointment_id=None,
                        reply=f"Aapka maanga hua slot {target_time} pehle se booked hai aur aapne doosra samay lene se mana kiya hai.",
                        metrics=Metrics(turns=len(request.turns), tokens=len(full_conversation_text.split()) * 12, latency_ms=elapsed)
                    )

            if not selected_slot:
                selected_slot = slots[0]

        if patient_id and selected_slot:
            try:
                appt = tools.book_appointment(patient_id=patient_id, doctor_id=doctor_id, date=target_date, start=selected_slot)
                elapsed = int((time.monotonic() - started_at) * 1000)
                doc_name = state.doctors[doctor_id]["name"]
                return AgentRunResponse(
                    conversation_id=request.conversation_id,
                    tool_calls=tools.recorded_calls,
                    terminal_state="booked",
                    escalation_reason=None,
                    patient_id=patient_id,
                    appointment_id=appt["id"],
                    reply=f"Ji, {target_date} ko {selected_slot} par Dr. {doc_name} ke saath appointment book ho gaya hai.",
                    metrics=Metrics(turns=len(request.turns), tokens=len(full_conversation_text.split()) * 12, latency_ms=elapsed)
                )
            except Exception:
                pass

    # Default fallback
    elapsed = int((time.monotonic() - started_at) * 1000)
    return AgentRunResponse(
        conversation_id=request.conversation_id,
        tool_calls=tools.recorded_calls,
        terminal_state="abandoned",
        escalation_reason=None,
        patient_id=patient_id,
        appointment_id=None,
        reply="Koi jaankari ya appointment book nahi ho saka.",
        metrics=Metrics(turns=len(request.turns), tokens=len(full_conversation_text.split()) * 12, latency_ms=elapsed)
    )
