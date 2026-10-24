"""Ground-truth tool layer operating deterministically on clinic.json.
CRITICAL RULE: Never calls an LLM. No invented slots, patients, or appointments.
"""

from __future__ import annotations
import copy
import datetime
import json
import os
import pathlib
import re
from typing import Any, Dict, List, Optional, Tuple

VALID_ESCALATION_REASONS = {
    "clinical_urgent", "medical_advice", "not_authorised",
    "ambiguous_patient", "out_of_scope"
}


class ClinicState:
    """In-memory isolated state for a single conversation run."""

    def __init__(self, data: dict):
        self.clinic = data["clinic"]
        self.doctors = {d["id"]: d for d in data["doctors"]}
        self.holidays = set(data.get("holidays", []))
        self.patients = {p["id"]: p for p in data["patients"]}
        self.appointments = list(data.get("appointments", []))

    @classmethod
    def load_from_file(cls, path: str | pathlib.Path | None = None) -> ClinicState:
        if path is None:
            # Look in backend dir or parent dirs
            candidate_paths = [
                pathlib.Path(__file__).parent / "clinic.json",
                pathlib.Path(__file__).parent.parent / "swasthiq-front-desk-agent-starter-pack" / "clinic.json",
                pathlib.Path("clinic.json"),
                pathlib.Path("swasthiq-front-desk-agent-starter-pack/clinic.json")
            ]
            for p in candidate_paths:
                if p.is_file():
                    path = p
                    break
        if path is None or not pathlib.Path(path).is_file():
            raise FileNotFoundError("clinic.json could not be found.")

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls(data)


class ToolExecutionError(ValueError):
    """Specific, actionable error for tool execution failures."""
    pass


def normalize_phone(phone: str) -> str:
    """Extract digits only from phone string."""
    return re.sub(r'\D', '', phone)


def normalize_name(name: str) -> str:
    """Normalize patient name by lowercasing and stripping honorifics."""
    n = name.lower()
    # Strip honorifics: ji, mr, mrs, ms, dr, shree, shri
    n = re.sub(r'\b(ji|mr|mrs|ms|dr|shree|shri)\b', '', n)
    return ' '.join(n.split())


class ClinicTools:
    """The 6 mandatory tools matching schema.md."""

    def __init__(self, state: ClinicState):
        self.state = state
        self.recorded_calls: List[dict[str, Any]] = []

    def record_call(self, name: str, arguments: dict[str, Any], result: Any = None):
        """Record executed tool call for response output."""
        self.recorded_calls.append({
            "name": name,
            "arguments": arguments,
            "_result": result
        })

    def lookup_patient(self, name: Optional[str] = None, phone: Optional[str] = None) -> List[Dict[str, Any]]:
        """Resolve a caller to a patient record. Returns candidates, never a guess."""
        arguments = {}
        if name is not None:
            arguments["name"] = name
        if phone is not None:
            arguments["phone"] = phone

        if not name and not phone:
            raise ToolExecutionError("Either name or phone must be provided to lookup_patient.")

        norm_phone = normalize_phone(phone) if phone else None
        norm_name = normalize_name(name) if name else None

        candidates = []

        for p_id, patient in self.state.patients.items():
            p_phone = normalize_phone(patient.get("phone", ""))
            p_name_norm = normalize_name(patient.get("name", ""))

            # Phone match
            phone_matched = bool(norm_phone and norm_phone in p_phone)
            
            # Name match (substring or token overlap)
            name_matched = False
            if norm_name:
                p_tokens = set(p_name_norm.split())
                q_tokens = set(norm_name.split())
                if norm_name in p_name_norm or p_name_norm in norm_name:
                    name_matched = True
                elif q_tokens and q_tokens.issubset(p_tokens):
                    name_matched = True
                elif any(q in p_tokens for q in q_tokens if len(q) > 2):
                    name_matched = True

            if norm_phone and norm_name:
                # If both provided, both must align, or phone matches guardian record
                if phone_matched and name_matched:
                    candidates.append(patient)
                elif phone_matched and not name_matched:
                    # Check if caller phone is guardian of this patient
                    pass
            elif norm_phone:
                if phone_matched:
                    candidates.append(patient)
            elif norm_name:
                if name_matched:
                    candidates.append(patient)

        # Also check guardian relationships if a guardian's phone/name was provided for a child
        if not candidates and norm_phone and norm_name:
            # Search if phone belongs to a guardian who is guardian_of a patient matching norm_name
            for guardian in self.state.patients.values():
                if norm_phone in normalize_phone(guardian.get("phone", "")):
                    for child_id in guardian.get("guardian_of", []):
                        child = self.state.patients.get(child_id)
                        if child:
                            child_name = normalize_name(child.get("name", ""))
                            if norm_name in child_name or any(q in child_name.split() for q in norm_name.split()):
                                candidates.append(child)

        self.record_call("lookup_patient", arguments, result=candidates)
        return candidates

    def search_slots(self, doctor_id: str, date: str, window: Optional[str] = None) -> List[str]:
        """Free slots for a doctor on a date.
        Never double-books. Respects holidays and doctor leaves.
        """
        arguments = {"doctor_id": doctor_id, "date": date}
        if window:
            arguments["window"] = window

        if doctor_id not in self.state.doctors:
            raise ToolExecutionError(f"Doctor '{doctor_id}' does not exist in clinic schedule.")

        try:
            target_date = datetime.date.fromisoformat(date)
        except ValueError:
            raise ToolExecutionError(f"Invalid date format '{date}'. Expected YYYY-MM-DD.")

        # Check clinic holiday
        if date in self.state.holidays:
            self.record_call("search_slots", arguments, result=[])
            return []

        doctor = self.state.doctors[doctor_id]

        # Check doctor leave
        if date in doctor.get("leave_dates", []):
            self.record_call("search_slots", arguments, result=[])
            return []

        # Day of week (Mon, Tue, Wed, Thu, Fri, Sat, Sun)
        day_abbr = target_date.strftime("%a")  # e.g. "Mon"
        matching_windows = [w for w in doctor.get("windows", []) if w["day"] == day_abbr]

        if not matching_windows:
            self.record_call("search_slots", arguments, result=[])
            return []

        slot_mins = self.state.clinic.get("slot_minutes", 15)
        all_possible_slots = set()

        for win in matching_windows:
            try:
                start_h, start_m = map(int, win["start"].split(":"))
                end_h, end_m = map(int, win["end"].split(":"))
            except ValueError:
                continue

            cur = datetime.datetime(2000, 1, 1, start_h, start_m)
            end_dt = datetime.datetime(2000, 1, 1, end_h, end_m)

            while cur + datetime.timedelta(minutes=slot_mins) <= end_dt:
                time_str = cur.strftime("%H:%M")
                # Window filter
                if window == "morning" and cur.hour >= 13:
                    cur += datetime.timedelta(minutes=slot_mins)
                    continue
                if window == "evening" and cur.hour < 16:
                    cur += datetime.timedelta(minutes=slot_mins)
                    continue
                all_possible_slots.add(time_str)
                cur += datetime.timedelta(minutes=slot_mins)

        # Check existing booked appointments on that date for this doctor
        booked_times = set()
        for appt in self.state.appointments:
            if appt.get("doctor_id") == doctor_id and appt.get("date") == date and appt.get("status") == "booked":
                booked_times.add(appt.get("start"))

        free_slots = sorted(list(all_possible_slots - booked_times))
        self.record_call("search_slots", arguments, result=free_slots)
        return free_slots

    def book_appointment(self, patient_id: str, doctor_id: str, date: str, start: str) -> Dict[str, Any]:
        """Create an appointment in a free slot. Double-booking is strictly prohibited."""
        arguments = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "date": date,
            "start": start
        }

        if patient_id not in self.state.patients:
            raise ToolExecutionError(f"Patient '{patient_id}' not found.")
        if doctor_id not in self.state.doctors:
            raise ToolExecutionError(f"Doctor '{doctor_id}' not found.")

        # Check double-booking
        for appt in self.state.appointments:
            if appt.get("doctor_id") == doctor_id and appt.get("date") == date and appt.get("start") == start and appt.get("status") == "booked":
                self.record_call("book_appointment", arguments, result=None)
                raise ToolExecutionError(f"Slot {start} on {date} for doctor {doctor_id} is already booked.")

        # Check if slot is within doctor's schedule
        free = self.search_slots(doctor_id=doctor_id, date=date)
        if start not in free:
            self.record_call("book_appointment", arguments, result=None)
            raise ToolExecutionError(f"Slot {start} on {date} is not available in doctor {doctor_id}'s schedule.")

        # Compute end time
        h, m = map(int, start.split(":"))
        slot_mins = self.state.clinic.get("slot_minutes", 15)
        end_dt = datetime.datetime(2000, 1, 1, h, m) + datetime.timedelta(minutes=slot_mins)
        end_str = end_dt.strftime("%H:%M")

        # Generate appointment ID
        max_num = 0
        for appt in self.state.appointments:
            aid = appt.get("id", "")
            if aid.startswith("ap_"):
                try:
                    num = int(aid.split("_")[1])
                    if num > max_num:
                        max_num = num
                except ValueError:
                    pass
        new_id = f"ap_{max_num + 1:04d}"

        new_appt = {
            "id": new_id,
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "date": date,
            "start": start,
            "end": end_str,
            "status": "booked"
        }
        self.state.appointments.append(new_appt)
        self.record_call("book_appointment", arguments, result=new_appt)
        return new_appt

    def reschedule_appointment(self, appointment_id: Optional[str] = None, patient_id: Optional[str] = None, new_date: str = "", new_start: str = "") -> Dict[str, Any]:
        """Move an existing appointment."""
        arguments = {
            "appointment_id": appointment_id,
            "patient_id": patient_id,
            "new_date": new_date,
            "new_start": new_start
        }

        target_appt = None
        for appt in self.state.appointments:
            if appointment_id and appt.get("id") == appointment_id:
                target_appt = appt
                break
            if patient_id and appt.get("patient_id") == patient_id and appt.get("status") == "booked":
                target_appt = appt
                break

        if not target_appt:
            self.record_call("reschedule_appointment", arguments, result=None)
            raise ToolExecutionError("No active appointment found to reschedule.")

        doctor_id = target_appt["doctor_id"]
        # Free slot check on new_date
        free = self.search_slots(doctor_id=doctor_id, date=new_date)
        if new_start not in free:
            self.record_call("reschedule_appointment", arguments, result=None)
            raise ToolExecutionError(f"Target slot {new_start} on {new_date} is not available for doctor {doctor_id}.")

        h, m = map(int, new_start.split(":"))
        slot_mins = self.state.clinic.get("slot_minutes", 15)
        end_dt = datetime.datetime(2000, 1, 1, h, m) + datetime.timedelta(minutes=slot_mins)

        target_appt["date"] = new_date
        target_appt["start"] = new_start
        target_appt["end"] = end_dt.strftime("%H:%M")
        target_appt["status"] = "booked"

        self.record_call("reschedule_appointment", arguments, result=target_appt)
        return target_appt

    def cancel_appointment(self, appointment_id: Optional[str] = None, patient_id: Optional[str] = None) -> Dict[str, Any]:
        """Cancel an existing appointment."""
        arguments = {"appointment_id": appointment_id, "patient_id": patient_id}

        target_appt = None
        for appt in self.state.appointments:
            if appointment_id and appt.get("id") == appointment_id:
                target_appt = appt
                break
            if patient_id and appt.get("patient_id") == patient_id and appt.get("status") == "booked":
                target_appt = appt
                break

        if not target_appt:
            self.record_call("cancel_appointment", arguments, result=None)
            raise ToolExecutionError("No active appointment found to cancel.")

        target_appt["status"] = "cancelled"
        self.record_call("cancel_appointment", arguments, result=target_appt)
        return target_appt

    def escalate_to_human(self, reason: str, detail: str = "") -> Dict[str, Any]:
        """Hand the conversation off to a human staff member."""
        arguments = {"reason": reason, "detail": detail}
        if reason not in VALID_ESCALATION_REASONS:
            raise ToolExecutionError(f"Invalid escalation reason '{reason}'. Must be one of {VALID_ESCALATION_REASONS}.")

        record = {"escalated": True, "reason": reason, "detail": detail}
        self.record_call("escalate_to_human", arguments, result=record)
        return record
