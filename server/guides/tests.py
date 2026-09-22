from django.test import TestCase
from rest_framework.test import APIClient

from users.models import User
from .models import Guide


class GuideCRUDTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="guide_op", email="guide_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "guide_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_create_guide(self):
        res = self.client.post("/api/guides/", {"name": "Ahmed", "language": "English", "phone": "01000000000"})
        self.assertEqual(res.status_code, 201)
        self.assertTrue(Guide.objects.filter(name="Ahmed").exists())

    def test_created_by_is_request_user(self):
        res = self.client.post("/api/guides/", {"name": "X", "language": "Y", "phone": "Z"})
        guide = Guide.objects.get(id=res.data["id"])
        self.assertEqual(guide.created_by, self.user)

    def test_update_guide(self):
        res = self.client.post("/api/guides/", {"name": "X", "language": "Y", "phone": "Z"})
        guide_id = res.data["id"]
        res2 = self.client.patch(f"/api/guides/{guide_id}/", {"phone": "New Phone"}, format="json")
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.data["phone"], "New Phone")

    def test_delete_guide_is_real_deletion(self):
        res = self.client.post("/api/guides/", {"name": "X", "language": "Y", "phone": "Z"})
        guide_id = res.data["id"]
        res2 = self.client.delete(f"/api/guides/{guide_id}/")
        self.assertEqual(res2.status_code, 204)
        self.assertFalse(Guide.objects.filter(id=guide_id).exists())


class GuideSearchTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="search_op", email="search_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "search_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        Guide.objects.create(name="Ahmed", language="English", phone="1", created_by=self.user)
        Guide.objects.create(name="Sara", language="French", phone="2", created_by=self.user)

    def test_search_by_name(self):
        res = self.client.get("/api/guides/?search=Ahmed")
        names = [g["name"] for g in res.data["results"]]
        self.assertEqual(names, ["Ahmed"])

    def test_search_by_language(self):
        res = self.client.get("/api/guides/?search=French")
        names = [g["name"] for g in res.data["results"]]
        self.assertEqual(names, ["Sara"])