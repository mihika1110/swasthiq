"""Data contracts matching schema.md exactly."""

from typing import Any, List, Optional
from pydantic import BaseModel, Field


class AgentRunRequest(BaseModel):
    conversation_id: str
    today: str = "2026-10-01"
    turns: List[str]


class ToolCallRecord(BaseModel):
    name: str
    arguments: dict[str, Any]
    result: Optional[Any] = None


class Metrics(BaseModel):
    turns: int = 0
    tokens: int = 0
    latency_ms: int = 0


class AgentRunResponse(BaseModel):
    conversation_id: str
    tool_calls: List[dict[str, Any]]
    terminal_state: str  # booked, rescheduled, cancelled, escalated, refused, abandoned
    escalation_reason: Optional[str] = None  # clinical_urgent, medical_advice, not_authorised, ambiguous_patient, out_of_scope
    patient_id: Optional[str] = None
    appointment_id: Optional[str] = None
    reply: str
    metrics: Metrics = Field(default_factory=Metrics)
