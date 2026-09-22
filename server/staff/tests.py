from django.test import TestCase
from rest_framework.test import APIClient

from users.models import User
from .models import StaffMember


class StaffCRUDTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="staff_op", email="staff_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "staff_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_create_staff_member(self):
        res = self.client.post("/api/staff/", {
            "name": "Ahmed Ali", "position": "Accountant", "phone": "01012345678",
            "email": "ahmed@test.local", "start_date": "2026-01-01",
        })
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data["is_active"])
        self.assertIsNone(res.data["end_date"])

    def test_created_by_is_request_user(self):
        res = self.client.post("/api/staff/", {"name": "X", "position": "Y", "phone": "01000000000", "start_date": "2026-01-01"})
        member = StaffMember.objects.get(id=res.data["id"])
        self.assertEqual(member.created_by, self.user)

    def test_name_required(self):
        res = self.client.post("/api/staff/", {"position": "Y", "phone": "01000000000", "start_date": "2026-01-01"})
        self.assertEqual(res.status_code, 400)

    def test_phone_required(self):
        res = self.client.post("/api/staff/", {"name": "X", "position": "Y", "start_date": "2026-01-01"})
        self.assertEqual(res.status_code, 400)

    def test_start_date_required(self):
        res = self.client.post("/api/staff/", {"name": "X", "position": "Y", "phone": "01000000000"})
        self.assertEqual(res.status_code, 400)

    def test_end_date_before_start_date_rejected(self):
        res = self.client.post("/api/staff/", {
            "name": "X", "position": "Y", "phone": "01000000000",
            "start_date": "2026-05-01", "end_date": "2026-04-01",
        })
        self.assertEqual(res.status_code, 400)

    def test_update_staff_member(self):
        create_res = self.client.post("/api/staff/", {"name": "X", "position": "Y", "phone": "01000000000", "start_date": "2026-01-01"})
        res = self.client.patch(f"/api/staff/{create_res.data['id']}/", {"position": "Senior Accountant"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["position"], "Senior Accountant")


class StaffContractWorkflowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="contract_op", email="contract_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "contract_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        create_res = self.client.post("/api/staff/", {"name": "Sara", "position": "Sales", "phone": "01000000000", "start_date": "2026-01-01"})
        self.member_id = create_res.data["id"]

    def test_end_contract_sets_end_date_and_is_active_false(self):
        res = self.client.post(f"/api/staff/{self.member_id}/end-contract/", {"end_date": "2026-06-01"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["end_date"], "2026-06-01")
        self.assertFalse(res.data["is_active"])

    def test_end_contract_does_not_delete_record(self):
        self.client.post(f"/api/staff/{self.member_id}/end-contract/", {"end_date": "2026-06-01"}, format="json")
        self.assertTrue(StaffMember.objects.filter(id=self.member_id).exists())

    def test_end_contract_before_start_date_rejected(self):
        res = self.client.post(f"/api/staff/{self.member_id}/end-contract/", {"end_date": "2025-01-01"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_reactivate_clears_end_date(self):
        self.client.post(f"/api/staff/{self.member_id}/end-contract/", {"end_date": "2026-06-01"}, format="json")
        res = self.client.post(f"/api/staff/{self.member_id}/reactivate/")
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data["end_date"])
        self.assertTrue(res.data["is_active"])


class StaffFilterTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="filter_op", email="filter_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "filter_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        active_res = self.client.post("/api/staff/", {"name": "Active Person", "position": "Guide", "phone": "01000000000", "start_date": "2026-01-01"})
        ended_res = self.client.post("/api/staff/", {"name": "Ended Person", "position": "Guide", "phone": "01000000000", "start_date": "2026-01-01"})
        self.client.post(f"/api/staff/{ended_res.data['id']}/end-contract/", {"end_date": "2026-06-01"}, format="json")

    def test_filter_active_only(self):
        res = self.client.get("/api/staff/?status=active")
        self.assertEqual(len(res.data["results"]), 1)
        self.assertEqual(res.data["results"][0]["name"], "Active Person")

    def test_filter_terminated_only(self):
        res = self.client.get("/api/staff/?status=terminated")
        self.assertEqual(len(res.data["results"]), 1)
        self.assertEqual(res.data["results"][0]["name"], "Ended Person")

    def test_search_by_name(self):
        res = self.client.get("/api/staff/?search=Active")
        self.assertEqual(len(res.data["results"]), 1)

    def test_no_filter_returns_all(self):
        res = self.client.get("/api/staff/")
        self.assertEqual(len(res.data["results"]), 2)


class StaffPhotoValidationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="photo_op", email="photo_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "photo_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_oversized_photo_rejected(self):
        huge_photo = "data:image/png;base64," + ("A" * 1_400_000)
        res = self.client.post("/api/staff/", {
            "name": "X", "position": "Y", "phone": "01000000000", "start_date": "2026-01-01",
            "profile_photo": huge_photo,
        })
        self.assertEqual(res.status_code, 400)

    def test_small_photo_accepted(self):
        small_photo = "data:image/png;base64," + ("A" * 1000)
        res = self.client.post("/api/staff/", {
            "name": "X", "position": "Y", "phone": "01000000000", "start_date": "2026-01-01",
            "profile_photo": small_photo,
        })
        self.assertEqual(res.status_code, 201)