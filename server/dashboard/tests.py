from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from bookings.models import Booking
from users.models import User
from .models import Broadcast, OwnerFile


class BroadcastTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="bc_admin", email="bc_admin@test.local", password="pass12345", role="ADMIN")
        self.staff = User.objects.create_user(username="bc_staff", email="bc_staff@test.local", password="pass12345", role="OPERATIONS")

    def _login_as(self, username):
        res = self.client.post("/api/auth/login/", {"username": username, "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_get_broadcast_when_none_exists_returns_null(self):
        self._login_as("bc_staff")
        res = self.client.get("/api/broadcast/")
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data)

    def test_admin_can_post_broadcast(self):
        self._login_as("bc_admin")
        res = self.client.post("/api/broadcast/", {"level": "warning", "message": "Scheduled maintenance tonight"})
        self.assertEqual(res.status_code, 201)
        self.assertTrue(Broadcast.objects.filter(pk=1).exists())

    def test_non_admin_cannot_post_broadcast(self):
        self._login_as("bc_staff")
        res = self.client.post("/api/broadcast/", {"level": "info", "message": "X"})
        self.assertEqual(res.status_code, 403)

    def test_posting_twice_replaces_not_duplicates(self):
        self._login_as("bc_admin")
        self.client.post("/api/broadcast/", {"level": "info", "message": "First"})
        self.client.post("/api/broadcast/", {"level": "critical", "message": "Second"})
        self.assertEqual(Broadcast.objects.count(), 1)
        self.assertEqual(Broadcast.objects.get(pk=1).message, "Second")

    def test_any_authenticated_user_can_read_broadcast(self):
        self._login_as("bc_admin")
        self.client.post("/api/broadcast/", {"level": "info", "message": "Visible to all"})
        self._login_as("bc_staff")
        res = self.client.get("/api/broadcast/")
        self.assertEqual(res.data["message"], "Visible to all")

    def test_admin_can_clear_broadcast(self):
        self._login_as("bc_admin")
        self.client.post("/api/broadcast/", {"level": "info", "message": "X"})
        res = self.client.delete("/api/broadcast/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(Broadcast.objects.filter(pk=1).exists())

    def test_non_admin_cannot_clear_broadcast(self):
        self._login_as("bc_admin")
        self.client.post("/api/broadcast/", {"level": "info", "message": "X"})
        self._login_as("bc_staff")
        res = self.client.delete("/api/broadcast/")
        self.assertEqual(res.status_code, 403)


class OwnerFileTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user1 = User.objects.create_user(username="file_u1", email="file_u1@test.local", password="pass12345", role="ADMIN")
        self.user2 = User.objects.create_user(username="file_u2", email="file_u2@test.local", password="pass12345", role="ADMIN")

    def _login_as(self, username):
        res = self.client.post("/api/auth/login/", {"username": username, "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_upload_file(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        self._login_as("file_u1")
        fake_file = SimpleUploadedFile("report.pdf", b"fake pdf content", content_type="application/pdf")
        res = self.client.post("/api/owner-files/", {"name": "Q3 Report", "file": fake_file}, format="multipart")
        self.assertEqual(res.status_code, 201)

    def test_uploaded_by_is_request_user(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        self._login_as("file_u1")
        fake_file = SimpleUploadedFile("x.pdf", b"content", content_type="application/pdf")
        res = self.client.post("/api/owner-files/", {"name": "X", "file": fake_file}, format="multipart")
        file_obj = OwnerFile.objects.get(id=res.data["id"])
        self.assertEqual(file_obj.uploaded_by, self.user1)

    def test_user_cannot_see_other_users_files(self):
        OwnerFile.objects.create(name="User1 File", file="fake/path.pdf", uploaded_by=self.user1)
        OwnerFile.objects.create(name="User2 File", file="fake/path2.pdf", uploaded_by=self.user2)
        self._login_as("file_u1")
        res = self.client.get("/api/owner-files/")
        names = [f["name"] for f in res.data["results"]]
        self.assertEqual(names, ["User1 File"])
        self.assertNotIn("User2 File", names)

    def test_user_can_delete_own_file(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        self._login_as("file_u1")
        fake_file = SimpleUploadedFile("x.pdf", b"content", content_type="application/pdf")
        res = self.client.post("/api/owner-files/", {"name": "X", "file": fake_file}, format="multipart")
        res2 = self.client.delete(f"/api/owner-files/{res.data['id']}/")
        self.assertEqual(res2.status_code, 204)


class DashboardOverviewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="dash_admin", email="dash_admin@test.local", password="pass12345", role="ADMIN")
        self.staff = User.objects.create_user(username="dash_staff", email="dash_staff@test.local", password="pass12345", role="OPERATIONS")

        Booking.objects.create(department="flight", date="2026-09-01", customer_name="A", net_rate=1000, selling_rate=1200, currency="EGP", created_by=self.admin)
        Booking.objects.create(department="flight", date="2026-09-01", customer_name="B", net_rate=2000, selling_rate=2500, currency="EGP", created_by=self.admin)
        Booking.objects.create(department="hotel", date="2026-09-01", customer_name="C", net_rate=500, selling_rate=800, currency="USD", created_by=self.admin)
        Booking.objects.create(department="visa", date="2026-09-01", customer_name="D", net_rate=100, selling_rate=200, currency="EGP", record_status="cancelled", created_by=self.admin)

    def _login_as(self, username):
        res = self.client.post("/api/auth/login/", {"username": username, "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_admin_can_access_overview(self):
        self._login_as("dash_admin")
        res = self.client.get("/api/dashboard-overview/")
        self.assertEqual(res.status_code, 200)

    def test_non_admin_cannot_access_overview(self):
        self._login_as("dash_staff")
        res = self.client.get("/api/dashboard-overview/")
        self.assertEqual(res.status_code, 403)

    def test_total_bookings_excludes_cancelled(self):
        self._login_as("dash_admin")
        res = self.client.get("/api/dashboard-overview/")
        self.assertEqual(res.data["total_bookings"], 3)

    def test_totals_per_currency_not_combined(self):
        self._login_as("dash_admin")
        res = self.client.get("/api/dashboard-overview/")
        totals = res.data["totals_by_currency"]
        self.assertEqual(Decimal(totals["EGP"]["revenue"]), Decimal("3700"))
        self.assertEqual(Decimal(totals["USD"]["revenue"]), Decimal("800"))
        self.assertNotIn("combined", totals)

    def test_by_department_breakdown(self):
        self._login_as("dash_admin")
        res = self.client.get("/api/dashboard-overview/")
        self.assertEqual(res.data["by_department"]["flight"]["count"], 2)
        self.assertEqual(res.data["by_department"]["hotel"]["count"], 1)
        self.assertEqual(res.data["by_department"]["visa"]["count"], 0)


class AuditLogExportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="export_admin", email="export_admin@test.local", password="pass12345", role="ADMIN")
        self.staff = User.objects.create_user(username="export_staff", email="export_staff@test.local", password="pass12345", role="OPERATIONS")

    def _login_as(self, username):
        res = self.client.post("/api/auth/login/", {"username": username, "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_admin_can_export_csv(self):
        self._login_as("export_admin")
        res = self.client.get("/api/audit-log/export/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "text/csv")

    def test_non_admin_cannot_export(self):
        self._login_as("export_staff")
        res = self.client.get("/api/audit-log/export/")
        self.assertEqual(res.status_code, 403)

    def test_csv_contains_utf8_bom(self):
        self._login_as("export_admin")
        res = self.client.get("/api/audit-log/export/")
        content = b"".join(res.streaming_content) if res.streaming else res.content
        self.assertTrue(content.startswith(b"\xef\xbb\xbf"))