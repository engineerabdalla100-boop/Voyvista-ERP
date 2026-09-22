from django.test import TestCase
from rest_framework.test import APIClient

from users.models import User


class HotelDirectoryTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="hotel_user", email="hotel_user@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "hotel_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_create_hotel_with_phones_and_emails(self):
        res = self.client.post("/api/hotels-directory/", {
            "name": "Steigenberger Al Dau", "area": "Sokhna", "address": "Ain Sokhna Road",
            "phones": [{"label": "Reservations", "number": "0111111111"}],
            "emails": [{"label": "Sales", "email": "sales@example.com"}],
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(len(res.data["phones"]), 1)
        self.assertEqual(len(res.data["emails"]), 1)

    def test_search_by_area_finds_hotel(self):
        self.client.post("/api/hotels-directory/", {"name": "Sokhna Beach Resort", "area": "Sokhna"}, format="json")
        self.client.post("/api/hotels-directory/", {"name": "Hurghada Bay", "area": "Hurghada"}, format="json")

        res = self.client.get("/api/hotels-directory/?search=Sokhna")
        names = [h["name"] for h in res.data["results"]]
        self.assertIn("Sokhna Beach Resort", names)
        self.assertNotIn("Hurghada Bay", names)

    def test_update_hotel_replaces_phones(self):
        create_res = self.client.post("/api/hotels-directory/", {
            "name": "Test Hotel", "area": "Sokhna",
            "phones": [{"label": "Old", "number": "0100000000"}],
        }, format="json")
        hid = create_res.data["id"]

        res = self.client.patch(f"/api/hotels-directory/{hid}/", {
            "phones": [{"label": "New", "number": "0122222222"}],
        }, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["phones"]), 1)
        self.assertEqual(res.data["phones"][0]["label"], "New")

    def test_active_only_filter(self):
        self.client.post("/api/hotels-directory/", {"name": "Active Hotel", "area": "Sokhna"}, format="json")
        self.client.post("/api/hotels-directory/", {"name": "Inactive Hotel", "area": "Sokhna", "is_active": False}, format="json")

        res = self.client.get("/api/hotels-directory/?active_only=true")
        names = [h["name"] for h in res.data["results"]]
        self.assertIn("Active Hotel", names)
        self.assertNotIn("Inactive Hotel", names)

    def test_hotel_with_photos_and_star_rating(self):
        res = self.client.post("/api/hotels-directory/", {
            "name": "Photo Hotel", "area": "Sokhna", "star_rating": 5,
            "photos": [{"photo_data": "data:image/jpeg;base64,ABC123"}, {"photo_data": "data:image/jpeg;base64,DEF456"}],
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(len(res.data["photos"]), 2)
        self.assertEqual(res.data["star_rating"], 5)

    def test_hotel_with_no_photos_returns_empty_list(self):
        res = self.client.post("/api/hotels-directory/", {"name": "No Photo Hotel", "area": "Sokhna"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["photos"], [])