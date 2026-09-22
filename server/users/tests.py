from django.test import TestCase
from rest_framework.test import APIClient

from .models import User


class EmployeeCRUDTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="hr_admin", email="hr_admin@test.local", password="pass12345", role="ADMIN")
        res = self.client.post("/api/auth/login/", {"username": "hr_admin", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_admin_can_create_employee(self):
        res = self.client.post("/api/employees/", {
            "username": "new_emp", "email": "new_emp@test.local", "password": "pass12345",
            "role": "OPERATIONS", "department": "Flights",
        })
        self.assertEqual(res.status_code, 201)
        self.assertTrue(User.objects.filter(username="new_emp").exists())

    def test_password_is_hashed_not_plaintext(self):
        self.client.post("/api/employees/", {
            "username": "new_emp2", "email": "new_emp2@test.local", "password": "pass12345", "role": "OPERATIONS",
        })
        employee = User.objects.get(username="new_emp2")
        self.assertNotEqual(employee.password, "pass12345")
        self.assertTrue(employee.check_password("pass12345"))

    def test_created_employee_can_actually_login(self):
        self.client.post("/api/employees/", {
            "username": "real_login_emp", "email": "real_login_emp@test.local", "password": "pass12345", "role": "SALES",
        })
        client2 = APIClient()
        res = client2.post("/api/auth/login/", {"username": "real_login_emp", "password": "pass12345"})
        self.assertEqual(res.status_code, 200)

    def test_password_required_on_create(self):
        res = self.client.post("/api/employees/", {
            "username": "no_pass_emp", "email": "no_pass_emp@test.local", "role": "OPERATIONS",
        })
        self.assertEqual(res.status_code, 400)

    def test_update_without_password_keeps_old_password(self):
        res = self.client.post("/api/employees/", {
            "username": "keep_pass_emp", "email": "keep_pass_emp@test.local", "password": "original123", "role": "OPERATIONS",
        })
        emp_id = res.data["id"]
        self.client.patch(f"/api/employees/{emp_id}/", {"department": "Accounting"}, format="json")
        employee = User.objects.get(id=emp_id)
        self.assertTrue(employee.check_password("original123"))

    def test_update_with_new_password_changes_it(self):
        res = self.client.post("/api/employees/", {
            "username": "change_pass_emp", "email": "change_pass_emp@test.local", "password": "original123", "role": "OPERATIONS",
        })
        emp_id = res.data["id"]
        self.client.patch(f"/api/employees/{emp_id}/", {"password": "newpass456"}, format="json")
        employee = User.objects.get(id=emp_id)
        self.assertTrue(employee.check_password("newpass456"))
        self.assertFalse(employee.check_password("original123"))

    def test_allowed_modules_null_means_unrestricted(self):
        res = self.client.post("/api/employees/", {
            "username": "unrestricted_emp", "email": "unrestricted_emp@test.local", "password": "pass12345", "role": "OPERATIONS",
        })
        self.assertIsNone(res.data["allowed_modules"])

    def test_allowed_modules_restricts_to_specific_list(self):
        res = self.client.post("/api/employees/", {
            "username": "restricted_emp", "email": "restricted_emp@test.local", "password": "pass12345",
            "role": "OPERATIONS", "allowed_modules": ["flights", "hotels"],
        }, format="json")
        self.assertEqual(res.data["allowed_modules"], ["flights", "hotels"])


class EmployeePermissionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.non_admin = User.objects.create_user(username="regular_emp", email="regular_emp@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.post("/api/auth/login/", {"username": "regular_emp", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_non_admin_cannot_list_employees(self):
        res = self.client.get("/api/employees/")
        self.assertEqual(res.status_code, 403)

    def test_non_admin_cannot_create_employee(self):
        res = self.client.post("/api/employees/", {
            "username": "hacker_emp", "email": "hacker_emp@test.local", "password": "pass12345", "role": "ADMIN",
        })
        self.assertEqual(res.status_code, 403)


class EmployeeActivationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="act_admin", email="act_admin@test.local", password="pass12345", role="ADMIN")
        res = self.client.post("/api/auth/login/", {"username": "act_admin", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self.employee = User.objects.create_user(username="toggle_emp", email="toggle_emp@test.local", password="pass12345", role="OPERATIONS")

    def test_toggle_active_disables_employee(self):
        res = self.client.post(f"/api/employees/{self.employee.id}/toggle_active/")
        self.assertEqual(res.status_code, 200)
        self.employee.refresh_from_db()
        self.assertFalse(self.employee.is_active_employee)

    def test_disabled_employee_cannot_login(self):
        self.client.post(f"/api/employees/{self.employee.id}/toggle_active/")
        client2 = APIClient()
        res = client2.post("/api/auth/login/", {"username": "toggle_emp", "password": "pass12345"})
        self.assertEqual(res.status_code, 400)

    def test_toggle_active_twice_reenables(self):
        self.client.post(f"/api/employees/{self.employee.id}/toggle_active/")
        self.client.post(f"/api/employees/{self.employee.id}/toggle_active/")
        self.employee.refresh_from_db()
        self.assertTrue(self.employee.is_active_employee)

    def test_admin_cannot_deactivate_own_account(self):
        res = self.client.post(f"/api/employees/{self.admin.id}/toggle_active/")
        self.assertEqual(res.status_code, 400)


class EmployeeDeletionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="del_admin", email="del_admin@test.local", password="pass12345", role="ADMIN")
        res = self.client.post("/api/auth/login/", {"username": "del_admin", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_delete_employee_without_records_succeeds(self):
        employee = User.objects.create_user(username="clean_emp", email="clean_emp@test.local", password="pass12345", role="OPERATIONS")
        res = self.client.delete(f"/api/employees/{employee.id}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(User.objects.filter(id=employee.id).exists())

    def test_admin_cannot_delete_own_account(self):
        res = self.client.delete(f"/api/employees/{self.admin.id}/")
        self.assertEqual(res.status_code, 400)

    def test_delete_employee_with_records_is_blocked(self):
        from cars.models import Car
        employee = User.objects.create_user(username="busy_emp", email="busy_emp@test.local", password="pass12345", role="OPERATIONS")
        Car.objects.create(type="X", driver_name="Y", created_by=employee)
        res = self.client.delete(f"/api/employees/{employee.id}/")
        self.assertEqual(res.status_code, 409)
        self.assertTrue(User.objects.filter(id=employee.id).exists())


class AvailableModulesTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="mod_admin", email="mod_admin@test.local", password="pass12345", role="ADMIN")
        res = self.client.post("/api/auth/login/", {"username": "mod_admin", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_available_modules_list(self):
        res = self.client.get("/api/employees/available_modules/")
        self.assertEqual(res.status_code, 200)
        keys = [m["key"] for m in res.data]
        self.assertIn("flights", keys)
        self.assertIn("owner", keys)
        self.assertIn("it_dashboard", keys)

class LoginRateLimitTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="rl_user", email="rl_user@test.local", password="CorrectPass123", role="OPERATIONS")
        from django.core.cache import cache
        cache.clear()

    def tearDown(self):
        from django.core.cache import cache
        cache.clear()

    def test_successful_login_not_rate_limited(self):
        res = self.client.post("/api/auth/login/", {"username": "rl_user", "password": "CorrectPass123"})
        self.assertEqual(res.status_code, 200)

    def test_failed_attempts_below_threshold_still_allowed(self):
        for _ in range(4):
            res = self.client.post("/api/auth/login/", {"username": "rl_user", "password": "wrong"})
            self.assertEqual(res.status_code, 400)

    def test_lockout_after_max_attempts(self):
        for _ in range(5):
            self.client.post("/api/auth/login/", {"username": "rl_user", "password": "wrong"})

        res = self.client.post("/api/auth/login/", {"username": "rl_user", "password": "wrong"})
        self.assertEqual(res.status_code, 429)

    def test_lockout_blocks_even_correct_password(self):
        for _ in range(5):
            self.client.post("/api/auth/login/", {"username": "rl_user", "password": "wrong"})

        res = self.client.post("/api/auth/login/", {"username": "rl_user", "password": "CorrectPass123"})
        self.assertEqual(res.status_code, 429)

    def test_successful_login_resets_attempt_counter(self):
        for _ in range(3):
            self.client.post("/api/auth/login/", {"username": "rl_user", "password": "wrong"})

        res = self.client.post("/api/auth/login/", {"username": "rl_user", "password": "CorrectPass123"})
        self.assertEqual(res.status_code, 200)

        for _ in range(3):
            res = self.client.post("/api/auth/login/", {"username": "rl_user", "password": "wrong"})
            self.assertEqual(res.status_code, 400)


class LoginRateLimitTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="rl_user", email="rl_user@test.local", password="CorrectPass123", role="OPERATIONS")
        from django.core.cache import cache
        cache.clear()

    def tearDown(self):
        from django.core.cache import cache
        cache.clear()

    def test_successful_login_not_rate_limited(self):
        res = self.client.post("/api/auth/login/", {"username": "rl_user", "password": "CorrectPass123"})
        self.assertEqual(res.status_code, 200)

    def test_failed_attempts_below_threshold_still_allowed(self):
        for _ in range(4):
            res = self.client.post("/api/auth/login/", {"username": "rl_user", "password": "wrong"})
            self.assertEqual(res.status_code, 400)

    def test_lockout_after_max_attempts(self):
        for _ in range(5):
            self.client.post("/api/auth/login/", {"username": "rl_user", "password": "wrong"})

        res = self.client.post("/api/auth/login/", {"username": "rl_user", "password": "wrong"})
        self.assertEqual(res.status_code, 429)

    def test_lockout_blocks_even_correct_password(self):
        for _ in range(5):
            self.client.post("/api/auth/login/", {"username": "rl_user", "password": "wrong"})

        res = self.client.post("/api/auth/login/", {"username": "rl_user", "password": "CorrectPass123"})
        self.assertEqual(res.status_code, 429)

    def test_successful_login_resets_attempt_counter(self):
        for _ in range(3):
            self.client.post("/api/auth/login/", {"username": "rl_user", "password": "wrong"})

        res = self.client.post("/api/auth/login/", {"username": "rl_user", "password": "CorrectPass123"})
        self.assertEqual(res.status_code, 200)

        for _ in range(3):
            res = self.client.post("/api/auth/login/", {"username": "rl_user", "password": "wrong"})
            self.assertEqual(res.status_code, 400)


class TokenExpirationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="exp_user", email="exp_user@test.local", password="pass12345", role="OPERATIONS")

    def test_active_token_still_works(self):
        res = self.client.post("/api/auth/login/", {"username": "exp_user", "password": "pass12345"})
        token = res.data["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        res = self.client.get("/api/auth/me/")
        self.assertEqual(res.status_code, 200)

    def test_idle_token_is_rejected_and_deleted(self):
        from datetime import timedelta

        from django.utils import timezone

        res = self.client.post("/api/auth/login/", {"username": "exp_user", "password": "pass12345"})
        token = res.data["token"]

        # Simulate 9 hours of inactivity -- past the 8-hour idle timeout.
        self.user.last_seen = timezone.now() - timedelta(hours=9)
        self.user.save(update_fields=["last_seen"])

        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        res = self.client.get("/api/auth/me/")
        self.assertEqual(res.status_code, 401)

        from rest_framework.authtoken.models import Token
        self.assertFalse(Token.objects.filter(key=token).exists())

    def test_recently_active_token_not_expired(self):
        from datetime import timedelta

        from django.utils import timezone

        res = self.client.post("/api/auth/login/", {"username": "exp_user", "password": "pass12345"})
        token = res.data["token"]

        self.user.last_seen = timezone.now() - timedelta(hours=2)
        self.user.save(update_fields=["last_seen"])

        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        res = self.client.get("/api/auth/me/")
        self.assertEqual(res.status_code, 200)
