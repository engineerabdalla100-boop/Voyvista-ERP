from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from users.models import User
from .models import Booking


class BookingCRUDTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="op_user", email="op_user@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "op_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_create_flight_booking(self):
        res = self.client.post("/api/bookings/", {
            "department": "flight", "date": "2026-09-10", "ticket_no": "TK123",
            "route": "CAI-DXB", "passenger_name": "Ahmed Ali", "rate": "1000",
            "handling": "50", "net_rate": "1050", "supplier": "Emirates",
            "selling_rate": "1300", "currency": "EGP", "file_number": "FAM-001",
        })
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["status"], "pending")
        self.assertEqual(Decimal(res.data["profit"]), Decimal("250.00"))

    def test_new_booking_defaults_to_pending(self):
        res = self.client.post("/api/bookings/", {"department": "hotel", "date": "2026-09-10", "passenger_name": "X"})
        self.assertEqual(res.data["status"], "pending")
        self.assertEqual(res.data["review_status"], "pending")

    def test_created_by_is_request_user(self):
        res = self.client.post("/api/bookings/", {"department": "visa", "date": "2026-09-10", "passenger_name": "X"})
        booking = Booking.objects.get(id=res.data["id"])
        self.assertEqual(booking.created_by, self.user)

    def test_negative_rate_rejected(self):
        res = self.client.post("/api/bookings/", {"department": "flight", "date": "2026-09-10", "passenger_name": "X", "rate": "-10"})
        self.assertEqual(res.status_code, 400)


class BookingConfirmWorkflowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="confirm_op", email="confirm_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "confirm_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        create_res = self.client.post("/api/bookings/", {"department": "flight", "date": "2026-09-10", "passenger_name": "X"})
        self.booking_id = create_res.data["id"]

    def test_confirm_pending_booking(self):
        res = self.client.post(f"/api/bookings/{self.booking_id}/confirm/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "confirmed")

    def test_cannot_confirm_already_confirmed_booking(self):
        self.client.post(f"/api/bookings/{self.booking_id}/confirm/")
        res = self.client.post(f"/api/bookings/{self.booking_id}/confirm/")
        self.assertEqual(res.status_code, 400)

    def test_filter_by_status(self):
        self.client.post("/api/bookings/", {"department": "flight", "date": "2026-09-10", "passenger_name": "Y"})
        self.client.post(f"/api/bookings/{self.booking_id}/confirm/")
        res = self.client.get("/api/bookings/?status=confirmed")
        self.assertEqual(len(res.data["results"]), 1)
        res2 = self.client.get("/api/bookings/?status=pending")
        self.assertEqual(len(res2.data["results"]), 1)


class BookingPaymentStatusTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="pay_op", email="pay_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "pay_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_cash_payment_fills_paid_amount_automatically(self):
        res = self.client.post("/api/bookings/", {
            "department": "flight", "date": "2026-09-10", "passenger_name": "X",
            "selling_rate": "1000", "collection_status": "cash",
        })
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Decimal(res.data["paid_amount"]), Decimal("1000.00"))
        self.assertEqual(Decimal(res.data["remaining_amount"]), Decimal("0.00"))

    def test_partial_payment_requires_paid_amount(self):
        res = self.client.post("/api/bookings/", {
            "department": "flight", "date": "2026-09-10", "passenger_name": "X",
            "selling_rate": "1000", "collection_status": "partial",
        })
        self.assertEqual(res.status_code, 400)

    def test_partial_payment_calculates_remaining(self):
        res = self.client.post("/api/bookings/", {
            "department": "flight", "date": "2026-09-10", "passenger_name": "X",
            "selling_rate": "1000", "collection_status": "partial", "paid_amount": "600",
        })
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Decimal(res.data["remaining_amount"]), Decimal("400.00"))

    def test_partial_paid_amount_cannot_exceed_selling_rate(self):
        res = self.client.post("/api/bookings/", {
            "department": "flight", "date": "2026-09-10", "passenger_name": "X",
            "selling_rate": "1000", "collection_status": "partial", "paid_amount": "1500",
        })
        self.assertEqual(res.status_code, 400)


class BookingCancelPermissionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.ops_user = User.objects.create_user(username="cancel_ops", email="cancel_ops@test.local", password="pass12345", role="OPERATIONS")
        self.admin_user = User.objects.create_user(username="cancel_admin", email="cancel_admin@test.local", password="pass12345", role="ADMIN")

    def _login_as(self, username):
        res = self.client.post("/api/auth/login/", {"username": username, "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_operations_cannot_cancel_booking(self):
        self._login_as("cancel_ops")
        create_res = self.client.post("/api/bookings/", {"department": "flight", "date": "2026-09-10", "passenger_name": "X"})
        res = self.client.delete(f"/api/bookings/{create_res.data['id']}/")
        self.assertEqual(res.status_code, 403)

    def test_admin_can_cancel_booking(self):
        self._login_as("cancel_admin")
        create_res = self.client.post("/api/bookings/", {"department": "flight", "date": "2026-09-10", "passenger_name": "X"})
        res = self.client.delete(f"/api/bookings/{create_res.data['id']}/")
        self.assertEqual(res.status_code, 204)
        booking = Booking.objects.get(id=create_res.data["id"])
        self.assertEqual(booking.record_status, "cancelled")

    def test_cancelled_booking_hidden_from_default_list(self):
        self._login_as("cancel_admin")
        create_res = self.client.post("/api/bookings/", {"department": "flight", "date": "2026-09-10", "passenger_name": "X"})
        self.client.delete(f"/api/bookings/{create_res.data['id']}/")
        res = self.client.get("/api/bookings/")
        self.assertEqual(len(res.data["results"]), 0)


class BookingConcurrencyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="conc_op", email="conc_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "conc_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        create_res = self.client.post("/api/bookings/", {"department": "flight", "date": "2026-09-10", "passenger_name": "X"})
        self.booking_id = create_res.data["id"]

    def test_update_with_correct_version_succeeds(self):
        res = self.client.patch(f"/api/bookings/{self.booking_id}/", {"note": "updated", "expected_version": 0}, format="json")
        self.assertEqual(res.status_code, 200)

    def test_update_with_stale_version_rejected(self):
        self.client.patch(f"/api/bookings/{self.booking_id}/", {"note": "first edit", "expected_version": 0}, format="json")
        res = self.client.patch(f"/api/bookings/{self.booking_id}/", {"note": "stale edit", "expected_version": 0}, format="json")
        self.assertEqual(res.status_code, 409)


class BookingFileNumberSearchTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="fn_op", email="fn_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "fn_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self.client.post("/api/bookings/", {"department": "flight", "date": "2026-09-10", "passenger_name": "Ahmed Khalil", "file_number": "FAM-001"})
        self.client.post("/api/bookings/", {"department": "hotel", "date": "2026-09-10", "passenger_name": "Sara Khalil", "file_number": "FAM-001"})
        self.client.post("/api/bookings/", {"department": "visa", "date": "2026-09-10", "passenger_name": "Mona Adel", "file_number": "FAM-002"})

    def test_search_returns_matching_file_numbers(self):
        res = self.client.get("/api/bookings/file-numbers/?search=FAM-001")
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]["file_number"], "FAM-001")

    def test_search_with_no_query_returns_all(self):
        res = self.client.get("/api/bookings/file-numbers/")
        self.assertEqual(len(res.data), 2)

    def test_search_no_match_returns_empty(self):
        res = self.client.get("/api/bookings/file-numbers/?search=ZZZ")
        self.assertEqual(len(res.data), 0)


class HotelBookingFieldsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="hotel_op", email="hotel_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "hotel_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_create_hotel_booking_with_hotel_specific_fields(self):
        res = self.client.post("/api/bookings/", {
            "department": "hotel", "date": "2026-09-10", "check_out": "2026-09-15",
            "hotel_name": "Tolip El Narges", "location": "Sokhna",
            "passenger_name": "Ahmed Megahed", "rate": "3000", "net_rate": "3000",
            "selling_rate": "3800", "discount_notice": "10% early bird",
        })
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["hotel_name"], "Tolip El Narges")
        self.assertEqual(res.data["location"], "Sokhna")
        self.assertEqual(res.data["check_out"], "2026-09-15")
        self.assertEqual(Decimal(res.data["profit"]), Decimal("800.00"))

    def test_hotel_specific_fields_optional_for_flights(self):
        res = self.client.post("/api/bookings/", {"department": "flight", "date": "2026-09-10", "passenger_name": "X"})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["hotel_name"], "")
        self.assertIsNone(res.data["check_out"])

    def test_filter_hotels_only(self):
        self.client.post("/api/bookings/", {"department": "hotel", "date": "2026-09-10", "passenger_name": "H1"})
        self.client.post("/api/bookings/", {"department": "flight", "date": "2026-09-10", "passenger_name": "F1"})
        res = self.client.get("/api/bookings/?department=hotel")
        self.assertEqual(len(res.data["results"]), 1)
        self.assertEqual(res.data["results"][0]["passenger_name"], "H1")

class SalesReportRoleAccessTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _login_as(self, username, role):
        User.objects.create_user(username=username, email=f"{username}@test.local", password="pass12345", role=role)
        res = self.client.post("/api/auth/login/", {"username": username, "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_admin_can_access_sales_report(self):
        self._login_as("admin_user", "ADMIN")
        res = self.client.get("/api/bookings/sales-report/")
        self.assertEqual(res.status_code, 200)

    def test_owner_can_access_sales_report(self):
        self._login_as("owner_user", "OWNER")
        res = self.client.get("/api/bookings/sales-report/")
        self.assertEqual(res.status_code, 200)

    def test_it_can_access_sales_report(self):
        self._login_as("it_user", "IT")
        res = self.client.get("/api/bookings/sales-report/")
        self.assertEqual(res.status_code, 200)

    def test_accountant_can_access_sales_report(self):
        self._login_as("acc_user", "ACCOUNTANT")
        res = self.client.get("/api/bookings/sales-report/")
        self.assertEqual(res.status_code, 200)

    def test_operations_cannot_access_sales_report(self):
        self._login_as("ops_user", "OPERATIONS")
        res = self.client.get("/api/bookings/sales-report/")
        self.assertEqual(res.status_code, 403)

    def test_sales_role_cannot_access_sales_report(self):
        self._login_as("sales_user", "SALES")
        res = self.client.get("/api/bookings/sales-report/")
        self.assertEqual(res.status_code, 403)

    def test_operations_can_still_create_and_patch_bookings(self):
        self._login_as("ops_user2", "OPERATIONS")
        res = self.client.post("/api/bookings/", {"department": "flight", "date": "2026-09-10", "passenger_name": "X"})
        self.assertEqual(res.status_code, 201)


class SalesReportContentTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="report_admin", email="report_admin@test.local", password="pass12345", role="ADMIN")
        res = self.client.post("/api/auth/login/", {"username": "report_admin", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_only_confirmed_bookings_included(self):
        self.client.post("/api/bookings/", {"department": "flight", "date": "2026-09-10", "passenger_name": "Pending Guy"})
        confirmed_res = self.client.post("/api/bookings/", {"department": "hotel", "date": "2026-09-10", "passenger_name": "Confirmed Guy"})
        self.client.post(f"/api/bookings/{confirmed_res.data['id']}/confirm/")
        res = self.client.get("/api/bookings/sales-report/")
        names = [b["passenger_name"] for b in res.data]
        self.assertIn("Confirmed Guy", names)
        self.assertNotIn("Pending Guy", names)

    def test_includes_all_three_departments(self):
        for dept, name in [("flight", "F"), ("hotel", "H"), ("visa", "V")]:
            create_res = self.client.post("/api/bookings/", {"department": dept, "date": "2026-09-10", "passenger_name": name})
            self.client.post(f"/api/bookings/{create_res.data['id']}/confirm/")
        res = self.client.get("/api/bookings/sales-report/")
        depts = {b["department"] for b in res.data}
        self.assertEqual(depts, {"flight", "hotel", "visa"})

    def test_filter_by_supplier(self):
        c1 = self.client.post("/api/bookings/", {"department": "flight", "date": "2026-09-10", "passenger_name": "X", "supplier": "Emirates"})
        self.client.post(f"/api/bookings/{c1.data['id']}/confirm/")
        c2 = self.client.post("/api/bookings/", {"department": "flight", "date": "2026-09-10", "passenger_name": "Y", "supplier": "Qatar"})
        self.client.post(f"/api/bookings/{c2.data['id']}/confirm/")
        res = self.client.get("/api/bookings/sales-report/?supplier=Emirates")
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]["supplier"], "Emirates")


class BookingAutoCreatesCustomerTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="autocust_user", email="autocust_user@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "autocust_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_booking_without_customer_auto_creates_party(self):
        res = self.client.post("/api/bookings/", {
            "department": "flight", "date": "2026-09-21", "passenger_name": "Auto Customer Test",
            "net_rate": "1000.00", "selling_rate": "1500.00", "supplier": "Test",
        })
        self.assertEqual(res.status_code, 201)
        self.assertIsNotNone(res.data["customer"])

        from parties.models import Party
        party = Party.objects.get(pk=res.data["customer"])
        self.assertEqual(party.full_name, "Auto Customer Test")
        self.assertTrue(party.code.startswith("VOY-"))

    def test_booking_with_explicit_customer_does_not_create_duplicate(self):
        party_res = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "Existing Customer", "phone": "01000000020"})
        party_id = party_res.data["id"]

        res = self.client.post("/api/bookings/", {
            "department": "flight", "date": "2026-09-21", "passenger_name": "Existing Customer",
            "net_rate": "1000.00", "selling_rate": "1500.00", "supplier": "Test", "customer": party_id,
        })
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["customer"], party_id)

        from parties.models import Party
        self.assertEqual(Party.objects.filter(full_name="Existing Customer").count(), 1)


class BookingAutoCustomerCategoryTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="salescat_user", email="salescat_user@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "salescat_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_auto_created_customer_is_sales_report_category(self):
        res = self.client.post("/api/bookings/", {
            "department": "flight", "date": "2026-09-22", "passenger_name": "Sales Report Person",
            "net_rate": "1000.00", "selling_rate": "1500.00", "supplier": "Test",
        })
        self.assertEqual(res.status_code, 201)

        from parties.models import Party
        party = Party.objects.get(pk=res.data["customer"])
        self.assertEqual(party.client_category, "sales_report")

    def test_sales_report_customers_excluded_from_b2b_filter(self):
        self.client.post("/api/bookings/", {
            "department": "flight", "date": "2026-09-22", "passenger_name": "Filter Test Person",
            "net_rate": "1000.00", "selling_rate": "1500.00", "supplier": "Test",
        })
        res = self.client.get("/api/parties/?client_category=b2b")
        names = [p["full_name"] for p in res.data["results"]]
        self.assertNotIn("Filter Test Person", names)


class BookingAnalyticsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="analytics_user", email="analytics_user@test.local", password="pass12345", role="OWNER")
        res = self.client.post("/api/auth/login/", {"username": "analytics_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_analytics_computes_revenue_and_profit(self):
        Booking.objects.create(department="flight", date="2026-01-10", passenger_name="A", selling_rate="1000", net_rate="800", supplier="Egyptair", status="confirmed", created_by=self.user)
        Booking.objects.create(department="hotel", date="2026-01-15", passenger_name="B", selling_rate="2000", net_rate="1500", supplier="Hilton", status="confirmed", created_by=self.user)

        res = self.client.get("/api/bookings/analytics/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(Decimal(res.data["revenue"]), Decimal("3000"))
        self.assertEqual(Decimal(res.data["profit"]), Decimal("700"))

    def test_analytics_outstanding_receivables(self):
        Booking.objects.create(
            department="flight", date="2026-01-10", passenger_name="A", selling_rate="1000", net_rate="800",
            status="confirmed", collection_status="partial", remaining_amount="400", created_by=self.user,
        )
        res = self.client.get("/api/bookings/analytics/")
        self.assertEqual(Decimal(res.data["outstanding_receivables"]), Decimal("400"))

    def test_analytics_by_department(self):
        Booking.objects.create(department="flight", date="2026-01-10", passenger_name="A", selling_rate="1000", net_rate="800", status="confirmed", created_by=self.user)
        Booking.objects.create(department="hotel", date="2026-01-10", passenger_name="B", selling_rate="500", net_rate="400", status="confirmed", created_by=self.user)

        res = self.client.get("/api/bookings/analytics/")
        depts = {row["department"]: row for row in res.data["by_department"]}
        self.assertEqual(Decimal(depts["flight"]["revenue"]), Decimal("1000"))
        self.assertEqual(Decimal(depts["hotel"]["revenue"]), Decimal("500"))

    def test_analytics_top_suppliers(self):
        Booking.objects.create(department="flight", date="2026-01-10", passenger_name="A", selling_rate="1000", net_rate="800", supplier="Egyptair", status="confirmed", created_by=self.user)
        Booking.objects.create(department="flight", date="2026-01-11", passenger_name="B", selling_rate="500", net_rate="400", supplier="Egyptair", status="confirmed", created_by=self.user)

        res = self.client.get("/api/bookings/analytics/")
        supplier_row = next(s for s in res.data["top_suppliers"] if s["supplier"] == "Egyptair")
        self.assertEqual(Decimal(supplier_row["revenue"]), Decimal("1500"))
        self.assertEqual(supplier_row["count"], 2)

    def test_analytics_not_limited_to_50_bookings(self):
        Booking.objects.bulk_create([
            Booking(department="flight", date="2026-01-10", passenger_name=f"P{i}", selling_rate="100", net_rate="80", supplier="Test Supplier", status="confirmed", created_by=self.user)
            for i in range(200)
        ])
        res = self.client.get("/api/bookings/analytics/")
        self.assertEqual(Decimal(res.data["revenue"]), Decimal("20000"))
        self.assertEqual(res.data["active_bookings"], 200)
