from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from users.models import User
from .models import CommunicationLogEntry, CustomerNote, Quote, Sale, SalesSettings


class SaleCRUDTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.sales_user = User.objects.create_user(username="sale_agent", email="sale_agent@test.local", password="pass12345", role="SALES")

    def _login_as(self, username, password):
        res = self.client.post("/api/auth/login/", {"username": username, "password": password})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_create_sale(self):
        self._login_as("sale_agent", "pass12345")
        res = self.client.post("/api/sales/", {
            "department": "flights", "client_name": "Ahmed Test", "service": "CAI-JED",
            "cost": "3000", "selling": "3500", "currency": "EGP",
            "payment_status": "paid_full", "date": "2026-08-31",
        })
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data["code"].startswith("BK-"))

    def test_code_auto_increments_sequentially(self):
        self._login_as("sale_agent", "pass12345")
        codes = set()
        for i in range(3):
            res = self.client.post("/api/sales/", {
                "department": "flights", "client_name": f"C{i}", "cost": "100", "selling": "150",
                "date": "2026-08-31",
            })
            codes.add(res.data["code"])
        self.assertEqual(len(codes), 3)

    def test_profit_is_computed_not_stored(self):
        self._login_as("sale_agent", "pass12345")
        res = self.client.post("/api/sales/", {
            "department": "hotels", "client_name": "X", "cost": "2000", "selling": "2800",
            "date": "2026-08-31",
        })
        self.assertEqual(Decimal(res.data["profit"]), Decimal("800.00"))

    def test_created_by_is_request_user_not_payload(self):
        self._login_as("sale_agent", "pass12345")
        other = User.objects.create_user(username="other_u", email="other_u@test.local", password="pass12345", role="ADMIN")
        res = self.client.post("/api/sales/", {
            "department": "flights", "client_name": "X", "cost": "100", "selling": "150",
            "date": "2026-08-31", "created_by": other.id,
        })
        sale = Sale.objects.get(id=res.data["id"])
        self.assertEqual(sale.created_by, self.sales_user)

    def test_negative_cost_is_rejected(self):
        self._login_as("sale_agent", "pass12345")
        res = self.client.post("/api/sales/", {
            "department": "flights", "client_name": "X", "cost": "-100", "selling": "150",
            "date": "2026-08-31",
        })
        self.assertEqual(res.status_code, 400)


class SaleFilteringTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="filt_sale", email="filt_sale@test.local", password="pass12345", role="SALES")
        self._login()
        self.client.post("/api/sales/", {"department": "flights", "client_name": "Ahmed", "cost": "100", "selling": "150", "date": "2026-08-01", "payment_status": "paid_full"})
        self.client.post("/api/sales/", {"department": "hotels", "client_name": "Sara", "cost": "200", "selling": "300", "date": "2026-08-15", "payment_status": "deposit"})

    def _login(self):
        res = self.client.post("/api/auth/login/", {"username": "filt_sale", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_filter_by_department(self):
        res = self.client.get("/api/sales/?department=hotels")
        names = [item["client_name"] for item in res.data["results"]]
        self.assertEqual(names, ["Sara"])

    def test_filter_by_payment_status(self):
        res = self.client.get("/api/sales/?payment_status=paid_full")
        names = [item["client_name"] for item in res.data["results"]]
        self.assertEqual(names, ["Ahmed"])

    def test_filter_by_date_range(self):
        res = self.client.get("/api/sales/?date_from=2026-08-10&date_to=2026-08-20")
        names = [item["client_name"] for item in res.data["results"]]
        self.assertEqual(names, ["Sara"])

    def test_search_by_client_name(self):
        res = self.client.get("/api/sales/?search=Ahmed")
        names = [item["client_name"] for item in res.data["results"]]
        self.assertEqual(names, ["Ahmed"])


class SaleCancelTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="cancel_admin", email="cancel_admin@test.local", password="pass12345", role="ADMIN")
        self.sales_user = User.objects.create_user(username="cancel_sale", email="cancel_sale@test.local", password="pass12345", role="SALES")
        self.sale = Sale.objects.create(department="flights", client_name="X", cost=100, selling=150, date="2026-08-31", created_by=self.admin)

    def _login_as(self, username, password):
        res = self.client.post("/api/auth/login/", {"username": username, "password": password})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_sales_role_cannot_cancel(self):
        self._login_as("cancel_sale", "pass12345")
        res = self.client.delete(f"/api/sales/{self.sale.id}/")
        self.assertEqual(res.status_code, 403)

    def test_admin_cancel_is_soft_delete(self):
        self._login_as("cancel_admin", "pass12345")
        res = self.client.delete(f"/api/sales/{self.sale.id}/")
        self.assertEqual(res.status_code, 204)
        self.sale.refresh_from_db()
        self.assertEqual(self.sale.record_status, Sale.RecordStatus.CANCELLED)
        self.assertTrue(Sale.objects.filter(id=self.sale.id).exists())


class QuoteTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User.objects.create_user(username="quote_u", email="quote_u@test.local", password="pass12345", role="SALES")
        res = self.client.post("/api/auth/login/", {"username": "quote_u", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_create_quote(self):
        res = self.client.post("/api/sales-quotes/", {
            "client": "Ahmed", "service": "CAI-JED Flight", "price": "3500", "currency": "EGP", "valid_until": "2026-09-15",
        })
        self.assertEqual(res.status_code, 201)
        self.assertTrue(Quote.objects.filter(client="Ahmed").exists())


class CustomerNoteTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User.objects.create_user(username="note_u", email="note_u@test.local", password="pass12345", role="SALES")
        res = self.client.post("/api/auth/login/", {"username": "note_u", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_create_note(self):
        res = self.client.post("/api/sales-customer-notes/", {"client": "Ahmed", "note": "Prefers morning flights"})
        self.assertEqual(res.status_code, 201)

    def test_note_has_no_update_endpoint(self):
        res = self.client.post("/api/sales-customer-notes/", {"client": "Ahmed", "note": "X"})
        note_id = res.data["id"]
        res2 = self.client.patch(f"/api/sales-customer-notes/{note_id}/", {"note": "Tampered"}, format="json")
        self.assertEqual(res2.status_code, 405)

    def test_note_has_no_delete_endpoint(self):
        res = self.client.post("/api/sales-customer-notes/", {"client": "Ahmed", "note": "X"})
        note_id = res.data["id"]
        res2 = self.client.delete(f"/api/sales-customer-notes/{note_id}/")
        self.assertEqual(res2.status_code, 405)


class CommunicationLogTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User.objects.create_user(username="comm_u", email="comm_u@test.local", password="pass12345", role="SALES")
        res = self.client.post("/api/auth/login/", {"username": "comm_u", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_create_communication_entry(self):
        res = self.client.post("/api/sales-communication-log/", {
            "client": "Ahmed", "channel": "whatsapp", "summary": "Asked about a flight deal",
        })
        self.assertEqual(res.status_code, 201)
        self.assertTrue(CommunicationLogEntry.objects.filter(client="Ahmed").exists())


class SalesSettingsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User.objects.create_user(username="settings_u", email="settings_u@test.local", password="pass12345", role="SALES")
        res = self.client.post("/api/auth/login/", {"username": "settings_u", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_get_default_settings(self):
        res = self.client.get("/api/sales-settings/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(str(res.data["default_commission"]), "15.00")
        self.assertEqual(res.data["currency"], "EGP")

    def test_update_settings(self):
        res = self.client.put("/api/sales-settings/", {"default_commission": "20", "currency": "USD"})
        self.assertEqual(res.status_code, 200)

        res2 = self.client.get("/api/sales-settings/")
        self.assertEqual(str(res2.data["default_commission"]), "20.00")
        self.assertEqual(res2.data["currency"], "USD")

    def test_settings_stays_singleton(self):
        self.client.put("/api/sales-settings/", {"default_commission": "10", "currency": "USD"})
        self.client.put("/api/sales-settings/", {"default_commission": "25", "currency": "EUR"})
        self.assertEqual(SalesSettings.objects.count(), 1)