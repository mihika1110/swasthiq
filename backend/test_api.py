"""Unit tests for main.py: FastAPI REST endpoints, schema compliance, and handoff state."""

import unittest
from fastapi.testclient import TestClient
from backend.main import app


class TestAPI(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    def test_post_agent_run_endpoint(self):
        payload = {
            "conversation_id": "api_test_001",
            "today": "2026-10-01",
            "turns": [
                "Dr. Rao ke saath kal ka appointment chahiye.",
                "Subah 10:15 kar dijiye. Waise abhi seene mein dard ho raha hai."
            ]
        }
        res = self.client.post("/agent/run", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["conversation_id"], "api_test_001")
        self.assertEqual(data["terminal_state"], "escalated")
        self.assertEqual(data["escalation_reason"], "clinical_urgent")

    def test_get_dashboard_stats(self):
        res = self.client.get("/api/stats")
        self.assertEqual(res.status_code, 200)
        stats = res.json()
        self.assertIn("conversations_today", stats)
        self.assertIn("completed_by_agent", stats)
        self.assertIn("escalated_open", stats)
        self.assertIn("urgent_unresolved", stats)

    def test_get_handoffs_and_resolve(self):
        # 1. List handoffs
        res = self.client.get("/api/handoffs?status=open")
        self.assertEqual(res.status_code, 200)
        handoffs = res.json()
        self.assertIsInstance(handoffs, list)

        # 2. Resolve an item
        resolve_res = self.client.post("/api/handoffs/resolve", json={"id": "cv_4455"})
        self.assertEqual(resolve_res.status_code, 200)
        self.assertEqual(resolve_res.json()["current_status"], "resolved")

        # 3. Reopen the item
        reopen_res = self.client.post("/api/handoffs/reopen", json={"id": "cv_4455"})
        self.assertEqual(reopen_res.status_code, 200)
        self.assertEqual(reopen_res.json()["current_status"], "open")

    def test_get_conversation_trace(self):
        res = self.client.get("/api/conversation/cv_4471")
        self.assertEqual(res.status_code, 200)
        detail = res.json()
        self.assertEqual(detail["id"], "cv_4471")
        self.assertEqual(detail["outcome"]["terminal_state"], "escalated")
        self.assertEqual(detail["outcome"]["determinism"], "STABLE")

    def test_get_clinic_info(self):
        res = self.client.get("/api/clinic")
        self.assertEqual(res.status_code, 200)
        clinic_json = res.json()
        clinic_meta = clinic_json.get("clinic", clinic_json)
        self.assertEqual(clinic_meta["name"], "Sunrise Clinic")
        self.assertIn("doctors", clinic_json)


if __name__ == "__main__":
    unittest.main()
