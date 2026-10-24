"""Unit tests for dates.py: Hindi, Hinglish, and English temporal parsing."""

import unittest
from backend.dates import parse_date_from_text, parse_time_from_text


class TestDates(unittest.TestCase):

    def setUp(self):
        self.today = "2026-10-01"  # Thursday

    def test_relative_days(self):
        self.assertEqual(parse_date_from_text("aaj shaam ko appointment chahiye", self.today), "2026-10-01")
        self.assertEqual(parse_date_from_text("kal subah ka slot milega?", self.today), "2026-10-02")
        self.assertEqual(parse_date_from_text("parso Dr. Rao se milna hai", self.today), "2026-10-03")
        self.assertEqual(parse_date_from_text("need an appointment tomorrow morning", self.today), "2026-10-02")

    def test_day_of_week(self):
        self.assertEqual(parse_date_from_text("Shanivaar ko koi slot hai?", self.today), "2026-10-03")
        self.assertEqual(parse_date_from_text("Saturday please", self.today), "2026-10-03")
        self.assertEqual(parse_date_from_text("Somwar ko 5 tareekh", self.today), "2026-10-05")

    def test_day_of_month_and_change_of_mind(self):
        self.assertEqual(parse_date_from_text("3 tareekh ko subah", self.today), "2026-10-03")
        text = "Mangalwar 6 tareekh ko... nahi nahi, budhwar kar dijiye, 7 tareekh."
        self.assertEqual(parse_date_from_text(text, self.today), "2026-10-07")

    def test_time_parsing(self):
        t1, w1 = parse_time_from_text("Subah 10 baje")
        self.assertEqual(t1, "10:00")
        self.assertEqual(w1, "morning")

        t2, w2 = parse_time_from_text("10:15 kar dijiye")
        self.assertEqual(t2, "10:15")

        t3, w3 = parse_time_from_text("shaam ko 5 baje")
        self.assertEqual(t3, "17:00")
        self.assertEqual(w3, "evening")


if __name__ == "__main__":
    unittest.main()
