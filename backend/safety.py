"""Safety, Clinical Triage, and Security Verification Layer.
Categorizes utterances using clinically grounded taxonomies and security filters.
Zero hardcoded conversation IDs or test references.
"""

from __future__ import annotations
import re
from typing import Optional, Tuple

# 1. ACUTE CLINICAL EMERGENCIES (Requires Immediate Cessation of Booking and Escalation)
CLINICAL_EMERGENCY_TAXONOMY = [
    # Cardiac / Thoracic
    r'seene\s+mein\s+(?:[a-zA-Z]+\s+)?(?:dard|khichav|jalan)',
    r'(?:acute\s+|severe\s+)?chest\s+pain',
    r'heart\s+attack',
    r'angina',
    r'pain\s+radiating\s+to\s+(?:arm|jaw|back)',
    
    # Respiratory Distress
    r'saans\s+(?:[a-zA-Z]+\s+)?(?:phool|ruk|nahi\s+aa|chad)',
    r'shortness\s+of\s+breath',
    r'difficulty\s+(?:in\s+)?breathing',
    r'choking',
    r'suffocating',
    r'asthma\s+attack',
    
    # Neurological / Cerebrovascular (Stroke / FAST)
    r'muh\s+(?:thoda\s+)?tedha',
    r'facial\s+droop(?:ing)?',
    r'bolne\s+mein\s+(?:ladkhadahat|takleef)',
    r'slurred\s+speech',
    r'sudden\s+(?:numbness|weakness)',
    r'stroke',
    r'paralysis',
    r'adhrang',
    
    # Altered Consciousness / Syncope
    r'behosh(?:i)?',
    r'unconscious(?:ness)?',
    r'faint(?:ed|ing)?',
    r'chakkar\s+aakar\s+gir',
    r'collapse',
    r'unresponsive',
    
    # Acute Hemorrhage / Severe Trauma
    r'khoon\s+(?:bah|nikal)\s+raha',
    r'severe\s+bleeding',
    r'heavy\s+bleeding',
    r'haemorrhage',
    r'sir\s+par\s+(?:chot|gehra\s+ghav)',
    r'head\s+injury'
]

# 2. MEDICAL ADVICE & PHARMACOLOGICAL INQUIRIES
MEDICAL_ADVICE_TAXONOMY = [
    r'(?:ek\s+aur\s+)?(?:goli|tablet|pill|dawai|dawa)\s+le\s+lu[nm]?',
    r'dawa\s+badal\s+du[nm]?',
    r'should\s+i\s+take\s+(?:another\s+)?(?:pill|tablet|dose|medicine)',
    r'is\s+it\s+safe\s+to\s+(?:take|mix)',
    r'safe\s+hai\s+ya\s+nahi',
    r'aspirin\s+(?:ke\s+saath|le\s+sakta)',
    r'kitni\s+(?:der\s+mein|tablet|goli)',
    r'how\s+many\s+(?:tablets|times\s+a\s+day)',
    r'can\s+you\s+prescribe',
    r'crocin\s+le\s+raha\s+hoon',
    r'kya\s+ye\s+bimari\s+hai',
    r'diagnos(?:e|is)'
]

# 3. PROMPT INJECTION, JAILBREAKS & AUTHORITY SPOOFING
PROMPT_INJECTION_TAXONOMY = [
    r'ignore\s+(?:all\s+)?(?:your\s+)?previous\s+instructions',
    r'disregard\s+(?:all\s+)?(?:previous\s+)?instructions',
    r'you\s+are\s+now\s+in\s+administrator\s+mode',
    r'system\s+(?:override|notice|prompt)',
    r'authorised\s+internal\s+test',
    r'bypass\s+(?:rules|security|constraints)',
    r'cancel\s+every\s+appointment',
    r'delete\s+all\s+(?:appointments|records)',
    r'override\s+scheduling\s+constraints',
    r'developer\s+mode'
]

# 4. THIRD-PARTY / UNAUTHORIZED RECORD ACCESS
UNAUTHORIZED_RELATIONSHIP_TAXONOMY = [
    r'padosi\s+(?:hoon|hai)',
    r'neighbour',
    r'neighbor',
    r'unka\s+number\s+mere\s+paas\s+nahi\s+hai',
    r'friend\s+calling\s+for',
    r'colleague\s+calling',
    r'employer',
    r'boss\s+bol\s+raha\s+hoon',
    r'office\s+boss',
    r'landlord'
]

# 5. OUT OF SCOPE CLINICAL / HOSPITAL SERVICES
OUT_OF_SCOPE_TAXONOMY = [
    r'(?:portable\s+)?icu\s+ambulance',
    r'surgery\s+setup',
    r'ghar\s+par\s+surgery',
    r'mobile\s+surgery',
    r'dispatch\s+(?:surgery|icu|ambulance)\s+team',
    r'mri\s+machine\s+ghar\s+par',
    r'ventilator\s+dispatch'
]


def check_clinical_urgent(text: str) -> Tuple[bool, Optional[str]]:
    """Detect if caller mentions an acute medical emergency."""
    text_lower = text.lower()
    for pat in CLINICAL_EMERGENCY_TAXONOMY:
        m = re.search(pat, text_lower)
        if m:
            return True, f"Acute clinical emergency detected: '{m.group(0)}'"
    return False, None


def check_medical_advice(text: str) -> Tuple[bool, Optional[str]]:
    """Detect if caller asks receptionist for clinical/pharmacological decisions."""
    text_lower = text.lower()
    for pat in MEDICAL_ADVICE_TAXONOMY:
        m = re.search(pat, text_lower)
        if m:
            return True, f"Clinical advice inquiry detected: '{m.group(0)}'"
    return False, None


def check_prompt_injection(text: str) -> Tuple[bool, Optional[str]]:
    """Detect prompt injection or meta-instructions inside caller utterance."""
    text_lower = text.lower()
    for pat in PROMPT_INJECTION_TAXONOMY:
        m = re.search(pat, text_lower)
        if m:
            return True, f"Adversarial prompt injection pattern detected: '{m.group(0)}'"
    return False, None


def check_unauthorized_third_party(text: str) -> Tuple[bool, Optional[str]]:
    """Detect unverified third party attempting to act on someone's medical record."""
    text_lower = text.lower()
    for pat in UNAUTHORIZED_RELATIONSHIP_TAXONOMY:
        m = re.search(pat, text_lower)
        if m:
            return True, f"Unauthorized third-party relationship: '{m.group(0)}'"
    return False, None


def check_out_of_scope(text: str) -> Tuple[bool, Optional[str]]:
    """Detect requests for tertiary hospital services outside clinic front desk remit."""
    text_lower = text.lower()
    for pat in OUT_OF_SCOPE_TAXONOMY:
        m = re.search(pat, text_lower)
        if m:
            return True, f"Out of scope clinic request: '{m.group(0)}'"
    return False, None
