from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from users.models import User
from .models import Car, CarMovement


class CarCRUDTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="car_op", email="car_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "car_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_create_car_with_all_fields(self):
        res = self.client.post("/api/cars/", {
            "category": "luxury", "type": "Mercedes Viano", "driver_name": "Ahmed",
            "driver_phone": "01000000000", "price": "5000", "issue_date": "2026-09-01",
            "return_date": "2026-09-10", "net": "4000", "sale": "5500",
        })
        self.assertEqual(res.status_code, 201)
        car = Car.objects.get(type="Mercedes Viano")
        self.assertEqual(car.category, "luxury")
        self.assertEqual(car.driver_phone, "01000000000")

    def test_profit_is_computed_from_net_and_sale(self):
        res = self.client.post("/api/cars/", {
            "category": "economy", "type": "X", "driver_name": "Y",
            "net": "4000", "sale": "5500",
        })
        self.assertEqual(Decimal(res.data["profit"]), Decimal("1500.00"))

    def test_created_by_is_request_user(self):
        res = self.client.post("/api/cars/", {"category": "van", "type": "X", "driver_name": "Y"})
        car = Car.objects.get(id=res.data["id"])
        self.assertEqual(car.created_by, self.user)

    def test_negative_price_rejected(self):
        res = self.client.post("/api/cars/", {"category": "bus", "type": "X", "driver_name": "Y", "price": "-100"})
        self.assertEqual(res.status_code, 400)

    def test_all_four_categories_accepted(self):
        for cat in ["economy", "luxury", "bus", "van"]:
            res = self.client.post("/api/cars/", {"category": cat, "type": f"Car-{cat}", "driver_name": "X"})
            self.assertEqual(res.status_code, 201, f"failed for category {cat}")

    def test_optional_dates_can_be_omitted(self):
        res = self.client.post("/api/cars/", {"category": "economy", "type": "X", "driver_name": "Y"})
        self.assertEqual(res.status_code, 201)
        self.assertIsNone(res.data["issue_date"])
        self.assertIsNone(res.data["return_date"])

    def test_update_car(self):
        res = self.client.post("/api/cars/", {"category": "economy", "type": "X", "driver_name": "Y"})
        car_id = res.data["id"]
        res2 = self.client.patch(f"/api/cars/{car_id}/", {"driver_name": "New Driver"}, format="json")
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.data["driver_name"], "New Driver")


class CarFilteringTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="filt_op", email="filt_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "filt_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self.client.post("/api/cars/", {"category": "luxury", "type": "Mercedes", "driver_name": "Ahmed"})
        self.client.post("/api/cars/", {"category": "economy", "type": "Hyundai", "driver_name": "Sara"})

    def test_filter_by_category(self):
        res = self.client.get("/api/cars/?category=luxury")
        types = [c["type"] for c in res.data["results"]]
        self.assertEqual(types, ["Mercedes"])

    def test_search_by_driver_name(self):
        res = self.client.get("/api/cars/?search=Sara")
        types = [c["type"] for c in res.data["results"]]
        self.assertEqual(types, ["Hyundai"])


class CarDeleteProtectionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="del_op", email="del_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "del_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self.car = Car.objects.create(category="van", type="X", driver_name="Y", created_by=self.user)

    def test_car_without_movements_can_be_deleted(self):
        res = self.client.delete(f"/api/cars/{self.car.id}/")
        self.assertEqual(res.status_code, 204)

    def test_car_with_movements_cannot_be_deleted(self):
        CarMovement.objects.create(car=self.car, from_location="A", to_location="B", date="2026-09-01", net=100, selling=150, created_by=self.user)
        res = self.client.delete(f"/api/cars/{self.car.id}/")
        self.assertEqual(res.status_code, 409)


class CarMovementTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="mv_op", email="mv_op@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "mv_op", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self.car = Car.objects.create(category="economy", type="X", driver_name="Y", created_by=self.user)

    def test_create_movement(self):
        res = self.client.post("/api/car-movements/", {
            "car": self.car.id, "from_location": "Cairo", "to_location": "Alex",
            "date": "2026-09-01", "net": "100", "selling": "150",
        })
        self.assertEqual(res.status_code, 201)

    def test_car_shows_movements_count_and_total_profit(self):
        CarMovement.objects.create(car=self.car, from_location="A", to_location="B", date="2026-09-01", net=100, selling=150, created_by=self.user)
        CarMovement.objects.create(car=self.car, from_location="C", to_location="D", date="2026-09-01", net=200, selling=300, created_by=self.user)
        res = self.client.get(f"/api/cars/{self.car.id}/")
        self.assertEqual(res.data["movements_count"], 2)
        self.assertEqual(Decimal(str(res.data["total_movements_profit"])), Decimal("150"))