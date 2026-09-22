from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from users.models import User
from .models import Event, EventCompany, EventTeamMember, ExpenseItem


class EventCRUDTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="event_op", email="event_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "event_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_create_event_with_nested_data(self):
        res = self.client.post("/api/events/", {
            "location": "Sharm El Sheikh", "date": "2026-09-15", "people_count": 50,
            "expense_items": [
                {"description": "Venue rental", "category": "rental", "amount": "5000"},
                {"description": "Equipment purchase", "category": "purchase", "amount": "2000"},
            ],
            "companies": [{"name": "ABC Events Co"}],
            "team": [{"name": "Ahmed", "role": "Coordinator"}],
        }, format="json")
        self.assertEqual(res.status_code, 201)
        event = Event.objects.get(id=res.data["id"])
        self.assertEqual(event.expense_items.count(), 2)
        self.assertEqual(event.companies.count(), 1)
        self.assertEqual(event.team.count(), 1)

    def test_total_spent_is_computed_not_stored(self):
        res = self.client.post("/api/events/", {
            "location": "X", "date": "2026-09-15", "people_count": 10,
            "expense_items": [
                {"description": "A", "category": "purchase", "amount": "1000"},
                {"description": "B", "category": "rental", "amount": "500"},
            ],
        }, format="json")
        self.assertEqual(Decimal(res.data["total_spent"]), Decimal("1500.00"))

    def test_created_by_is_request_user(self):
        res = self.client.post("/api/events/", {"location": "X", "date": "2026-09-15", "people_count": 0}, format="json")
        event = Event.objects.get(id=res.data["id"])
        self.assertEqual(event.created_by, self.user)

    def test_expense_item_zero_amount_rejected(self):
        res = self.client.post("/api/events/", {
            "location": "X", "date": "2026-09-15", "people_count": 0,
            "expense_items": [{"description": "A", "category": "purchase", "amount": "0"}],
        }, format="json")
        self.assertEqual(res.status_code, 400)


class EventUpdateReplacesNestedDataTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="upd_op", email="upd_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "upd_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        res2 = self.client.post("/api/events/", {
            "location": "X", "date": "2026-09-15", "people_count": 10,
            "expense_items": [{"description": "Old Item", "category": "purchase", "amount": "1000"}],
        }, format="json")
        self.event_id = res2.data["id"]

    def test_update_replaces_expense_items(self):
        res = self.client.put(f"/api/events/{self.event_id}/", {
            "location": "X", "date": "2026-09-15", "people_count": 10,
            "expense_items": [{"description": "New Item", "category": "rental", "amount": "500"}],
        }, format="json")
        self.assertEqual(res.status_code, 200)
        event = Event.objects.get(id=self.event_id)
        self.assertEqual(event.expense_items.count(), 1)
        self.assertEqual(event.expense_items.first().description, "New Item")


class EventDeleteTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="del_event_op", email="del_event_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "del_event_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_delete_event_cascades_to_expense_items(self):
        res = self.client.post("/api/events/", {
            "location": "X", "date": "2026-09-15", "people_count": 0,
            "expense_items": [{"description": "A", "category": "purchase", "amount": "100"}],
        }, format="json")
        event_id = res.data["id"]
        res2 = self.client.delete(f"/api/events/{event_id}/")
        self.assertEqual(res2.status_code, 204)
        self.assertFalse(ExpenseItem.objects.filter(event_id=event_id).exists())


class EventSearchTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="search_event_op", email="search_event_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "search_event_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self.client.post("/api/events/", {"location": "Sharm", "date": "2026-09-15", "people_count": 0}, format="json")
        self.client.post("/api/events/", {"location": "Cairo", "date": "2026-09-15", "people_count": 0}, format="json")

    def test_search_by_location(self):
        res = self.client.get("/api/events/?search=Sharm")
        locations = [e["location"] for e in res.data["results"]]
        self.assertEqual(locations, ["Sharm"])