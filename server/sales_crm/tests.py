from django.test import TestCase
from rest_framework.test import APIClient

from users.models import User

from .models import Activity, Deal


class DealCreationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="crm_user", email="crm_user@test.local", password="pass12345", role="SALES")
        res = self.client.post("/api/auth/login/", {"username": "crm_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_create_deal_auto_creates_party(self):
        res = self.client.post("/api/deals/", {
            "company_name": "Al Nour Software", "contact_name": "Osama", "contact_phone": "01000000001",
            "contact_email": "osama@alnour.com", "service_type": "\u0631\u062D\u0644\u0629 \u062C\u0645\u0627\u0639\u064A\u0629 Corporate",
            "estimated_value": "50000.00",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertIsNotNone(res.data["party"])
        self.assertTrue(res.data["party_code"].startswith("VOY-"))

    def test_deal_defaults_to_stage1(self):
        res = self.client.post("/api/deals/", {"company_name": "Test Co", "estimated_value": "1000.00"}, format="json")
        self.assertEqual(res.data["stage"], "stage1")

    def test_deals_list_is_not_paginated_away(self):
        for i in range(60):
            self.client.post("/api/deals/", {"company_name": f"Company {i}", "estimated_value": "1000.00"}, format="json")
        res = self.client.get("/api/deals/")
        self.assertEqual(res.data["count"], 60)


class DealStageMovementTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="stage_user", email="stage_user@test.local", password="pass12345", role="SALES")
        res = self.client.post("/api/auth/login/", {"username": "stage_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self.deal = self.client.post("/api/deals/", {
            "company_name": "Won Test Co", "service_type": "\u062D\u062C\u0632 \u0641\u0646\u0627\u062F\u0642 \u0648\u062A\u0623\u0634\u064A\u0631\u0627\u062A",
            "estimated_value": "75000.00",
        }, format="json").data

    def test_move_to_stage2_no_side_effects(self):
        res = self.client.post(f"/api/deals/{self.deal['id']}/move_stage/", {"stage": "stage2"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["stage"], "stage2")
        self.assertIsNone(res.data["booking"])

    def test_move_to_won_creates_booking(self):
        res = self.client.post(f"/api/deals/{self.deal['id']}/move_stage/", {"stage": "stage4"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertIsNotNone(res.data["booking"])

        from bookings.models import Booking
        booking = Booking.objects.get(pk=res.data["booking"])
        self.assertEqual(booking.department, "hotel")
        self.assertEqual(str(booking.selling_rate), self.deal["estimated_value"])
        self.assertEqual(booking.customer_id, int(self.deal["party"]))

    def test_moving_to_won_twice_does_not_duplicate_booking(self):
        self.client.post(f"/api/deals/{self.deal['id']}/move_stage/", {"stage": "stage4"}, format="json")
        first_booking_id = Deal.objects.get(pk=self.deal["id"]).booking_id

        self.client.post(f"/api/deals/{self.deal['id']}/move_stage/", {"stage": "stage3"}, format="json")
        self.client.post(f"/api/deals/{self.deal['id']}/move_stage/", {"stage": "stage4"}, format="json")
        second_booking_id = Deal.objects.get(pk=self.deal["id"]).booking_id

        self.assertEqual(first_booking_id, second_booking_id)

    def test_invalid_stage_rejected(self):
        res = self.client.post(f"/api/deals/{self.deal['id']}/move_stage/", {"stage": "not_a_real_stage"}, format="json")
        self.assertEqual(res.status_code, 400)


class ActivityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="activity_user", email="activity_user@test.local", password="pass12345", role="SALES")
        res = self.client.post("/api/auth/login/", {"username": "activity_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self.deal = self.client.post("/api/deals/", {"company_name": "Activity Test Co", "estimated_value": "5000.00"}, format="json").data

    def test_log_activity(self):
        res = self.client.post("/api/activities/", {
            "deal": self.deal["id"], "activity_type": "whatsapp", "note": "Sent pricing proposal",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Activity.objects.filter(deal_id=self.deal["id"]).count(), 1)

    def test_activity_with_reminder(self):
        res = self.client.post("/api/activities/", {
            "deal": self.deal["id"], "activity_type": "call", "note": "Follow up next week",
            "reminder_at": "2026-10-01T10:00:00Z",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertIsNotNone(res.data["reminder_at"])

    def test_activities_filtered_by_deal(self):
        other_deal = self.client.post("/api/deals/", {"company_name": "Other Co", "estimated_value": "1000.00"}, format="json").data
        self.client.post("/api/activities/", {"deal": self.deal["id"], "activity_type": "call", "note": "A"}, format="json")
        self.client.post("/api/activities/", {"deal": other_deal["id"], "activity_type": "call", "note": "B"}, format="json")

        res = self.client.get(f"/api/activities/?deal={self.deal['id']}")
        self.assertEqual(len(res.data["results"]), 1)