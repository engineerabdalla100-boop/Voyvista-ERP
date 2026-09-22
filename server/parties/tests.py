from django.test import TestCase
from rest_framework.test import APIClient

from users.models import User

from .models import Party, PartyAlias


class PartyCodeGenerationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="code_user", email="code_user@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "code_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_auto_generates_code_on_create(self):
        res = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "Auto Customer", "phone": "01000000010"})
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data["code"].startswith("VOY-"))

    def test_manual_code_is_respected(self):
        res = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2b", "full_name": "Manual Co", "phone": "01000000011", "code": "CUSTOM-001"})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["code"], "CUSTOM-001")

    def test_codes_are_sequential(self):
        res1 = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "First Auto", "phone": "01000000012"})
        res2 = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "Second Auto", "phone": "01000000013"})
        num1 = int(res1.data["code"].split("VOY-")[1])
        num2 = int(res2.data["code"].split("VOY-")[1])
        self.assertEqual(num2, num1 + 1)

    def test_customer_type_is_independent_field(self):
        res = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2b", "full_name": "Type Test", "phone": "01000000014"})
        self.assertEqual(res.data["client_category"], "b2b")
        self.assertTrue(res.data["code"].startswith("VOY-"))


class PartyResolveCodeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="resolve_user", email="resolve_user@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "resolve_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self.party = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "Resolve Customer", "phone": "01000000015"}).data

    def test_resolve_own_code_found(self):
        res = self.client.get(f"/api/parties/resolve_code/?code={self.party['code']}")
        self.assertTrue(res.data["found"])
        self.assertEqual(res.data["party"]["id"], self.party["id"])

    def test_resolve_unknown_code_not_found(self):
        res = self.client.get("/api/parties/resolve_code/?code=NOTAREALCODE")
        self.assertFalse(res.data["found"])

    def test_resolve_alias_code_found(self):
        self.client.post(f"/api/parties/{self.party['id']}/link_alias/", {"alias_code": "OLD-CODE-1"}, format="json")
        res = self.client.get("/api/parties/resolve_code/?code=OLD-CODE-1")
        self.assertTrue(res.data["found"])
        self.assertEqual(res.data["party"]["id"], self.party["id"])


class PartyLinkAliasTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="link_user", email="link_user@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "link_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self.party = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "Link Customer", "phone": "01000000016"}).data

    def test_link_alias_success(self):
        res = self.client.post(f"/api/parties/{self.party['id']}/link_alias/", {"alias_code": "AHMED1", "note": "Same person, old code"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["alias_code"], "AHMED1")
        self.assertEqual(PartyAlias.objects.filter(party_id=self.party["id"]).count(), 1)

    def test_cannot_link_alias_that_is_a_real_customer_code(self):
        other = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "Other Customer", "phone": "01000000017"}).data
        res = self.client.post(f"/api/parties/{self.party['id']}/link_alias/", {"alias_code": other["code"]}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_cannot_link_same_alias_twice_to_same_party(self):
        self.client.post(f"/api/parties/{self.party['id']}/link_alias/", {"alias_code": "DUPTEST"}, format="json")
        res = self.client.post(f"/api/parties/{self.party['id']}/link_alias/", {"alias_code": "DUPTEST"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_cannot_link_alias_already_linked_to_different_party(self):
        other_party = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "Second Party", "phone": "01000000018"}).data
        self.client.post(f"/api/parties/{self.party['id']}/link_alias/", {"alias_code": "SHARED-CODE"}, format="json")
        res = self.client.post(f"/api/parties/{other_party['id']}/link_alias/", {"alias_code": "SHARED-CODE"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_original_booking_code_never_altered_after_merge(self):
        booking_res = self.client.post("/api/bookings/", {
            "department": "flight", "date": "2026-09-21", "passenger_name": "Old Booking",
            "net_rate": "1000.00", "selling_rate": "1500.00", "supplier": "Test",
            "original_customer_code": "AHMED1",
        })
        self.client.post(f"/api/parties/{self.party['id']}/link_alias/", {"alias_code": "AHMED1"}, format="json")

        booking_after = self.client.get(f"/api/bookings/{booking_res.data['id']}/").data
        self.assertEqual(booking_after["original_customer_code"], "AHMED1")


class PartySearchCodesTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="search_user", email="search_user@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "search_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self.party = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "Search Customer", "phone": "01000000019"}).data

    def test_search_finds_own_code(self):
        res = self.client.get(f"/api/parties/search_codes/?search={self.party['code'][:10]}")
        codes = [m["code"] for m in res.data]
        self.assertIn(self.party["code"], codes)

    def test_search_finds_alias_code(self):
        self.client.post(f"/api/parties/{self.party['id']}/link_alias/", {"alias_code": "SEARCHALIAS"}, format="json")
        res = self.client.get("/api/parties/search_codes/?search=SEARCHALIAS")
        codes = [m["code"] for m in res.data]
        self.assertIn(self.party["code"], codes)