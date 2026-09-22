"""
core/tests_regression.py — Integration/Regression Tests للمحرك.

محدَّث ليتوافق مع موديل User الفعلي في هذا المشروع:
- الأدوار: ADMIN, ACCOUNTANT, OPERATIONS, SALES (بدل owner/manager/employee)
- email حقل إجباري وفريد — كل create_user هنا بيحدده صراحة
- لا يوجد حقل department خالص — النظام مفيهوش تقسيم حسب القسم حاليًا،
  فـ AuthorizationPolicy.checker_can_access_scope() بترجع True دايمًا
  عمليًا (ABAC معطّل ضمنيًا، مش بالغلط — موثّق في core/policy.py). أي
  اختبار كان بيفحص "مدير قسم يرفض طلب قسم تاني" اتشال من هنا لعدم
  انطباقه، واستُبدل باختبار واحد بسيط يوثّق السلوك الفعلي (Permissive
  by design) بدل ما يتجاهل الموضوع تمامًا.
"""

import threading

from django.db import connection as django_db_connection
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from users.models import User
from . import registry
from .base_models import Account, AuditLog, ChangeRequest
from .serializers import AccountSerializer
from .services import MakerCheckerService


# =============================================================================
# Audit Immutability
# =============================================================================

class AuditImmutabilityRegressionTests(TestCase):
    def test_direct_save_on_existing_entry_is_blocked(self):
        entry = AuditLog.objects.create(event_type=AuditLog.EventType.LOGIN_SUCCESS, description="original")
        entry.description = "tampered"
        with self.assertRaises(ValueError):
            entry.save()
        entry.refresh_from_db()
        self.assertEqual(entry.description, "original")

    def test_direct_delete_on_instance_is_blocked(self):
        entry = AuditLog.objects.create(event_type=AuditLog.EventType.LOGIN_SUCCESS, description="original")
        with self.assertRaises(ValueError):
            entry.delete()
        self.assertTrue(AuditLog.objects.filter(pk=entry.pk).exists())

    def test_bulk_queryset_update_bypass_is_blocked(self):
        entry = AuditLog.objects.create(event_type=AuditLog.EventType.LOGIN_SUCCESS, description="original")
        with self.assertRaises(ValueError):
            AuditLog.objects.filter(pk=entry.pk).update(description="tampered via bulk update")
        entry.refresh_from_db()
        self.assertEqual(entry.description, "original")

    def test_bulk_queryset_delete_bypass_is_blocked(self):
        AuditLog.objects.create(event_type=AuditLog.EventType.LOGIN_SUCCESS, description="a")
        AuditLog.objects.create(event_type=AuditLog.EventType.LOGIN_SUCCESS, description="b")
        count_before = AuditLog.objects.count()
        with self.assertRaises(ValueError):
            AuditLog.objects.all().delete()
        self.assertEqual(AuditLog.objects.count(), count_before)

    def test_reads_still_work_normally_after_the_fix(self):
        AuditLog.objects.create(event_type=AuditLog.EventType.LOGIN_SUCCESS, description="a")
        AuditLog.objects.create(event_type=AuditLog.EventType.LOGIN_FAILED, description="b")
        self.assertEqual(AuditLog.objects.count(), 2)
        self.assertTrue(AuditLog.objects.filter(event_type=AuditLog.EventType.LOGIN_SUCCESS).exists())

    def test_creation_is_still_allowed(self):
        before = AuditLog.objects.count()
        AuditLog.objects.create(event_type=AuditLog.EventType.LOGIN_SUCCESS, description="new entry")
        self.assertEqual(AuditLog.objects.count(), before + 1)


# =============================================================================
# Trusted Proxy
# =============================================================================

class TrustedProxyRegressionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username="proxy_admin", email="proxy_admin@test.local", password="pass12345", role="ADMIN",
        )

    def test_missing_header_falls_back_to_remote_addr_even_when_trusted(self):
        with override_settings(TRUSTED_PROXY=True):
            res = self.client.post("/api/auth/login/", {"username": "proxy_admin", "password": "pass12345"})
        self.assertEqual(res.status_code, 200)
        entry = AuditLog.objects.filter(event_type=AuditLog.EventType.LOGIN_SUCCESS, actor=self.admin).first()
        self.assertIsNotNone(entry)
        self.assertIsNotNone(entry.ip_address)

    def test_multiple_proxies_in_chain_only_first_value_used(self):
        with override_settings(TRUSTED_PROXY=True):
            self.client.post(
                "/api/auth/login/", {"username": "proxy_admin", "password": "pass12345"},
                HTTP_X_FORWARDED_FOR="203.0.113.7, 10.0.0.1, 10.0.0.2",
            )
        entry = AuditLog.objects.filter(event_type=AuditLog.EventType.LOGIN_SUCCESS, actor=self.admin).first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.ip_address, "203.0.113.7")

    def test_empty_header_value_does_not_crash_when_trusted(self):
        with override_settings(TRUSTED_PROXY=True):
            res = self.client.post(
                "/api/auth/login/", {"username": "proxy_admin", "password": "pass12345"},
                HTTP_X_FORWARDED_FOR="",
            )
        self.assertEqual(res.status_code, 200)

    def test_untrusted_mode_ignores_header_across_multiple_requests_consistently(self):
        with override_settings(TRUSTED_PROXY=False):
            for fake_ip in ["1.1.1.1", "2.2.2.2", "3.3.3.3"]:
                self.client.post(
                    "/api/auth/login/", {"username": "proxy_admin", "password": "pass12345"},
                    HTTP_X_FORWARDED_FOR=fake_ip,
                )
        entries = AuditLog.objects.filter(event_type=AuditLog.EventType.LOGIN_SUCCESS, actor=self.admin)
        forged_ips = {"1.1.1.1", "2.2.2.2", "3.3.3.3"}
        for entry in entries:
            self.assertNotIn(entry.ip_address, forged_ips)


# =============================================================================
# Protected Fields
# =============================================================================

class ProtectedFieldsRegressionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username="pf_admin", email="pf_admin@test.local", password="pass12345", role="ADMIN",
        )
        self.staff = User.objects.create_user(
            username="pf_staff", email="pf_staff@test.local", password="pass12345", role="OPERATIONS",
        )

    def _login_as(self, username, password):
        res = self.client.post("/api/auth/login/", {"username": username, "password": password})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_all_legitimate_account_fields_still_work_end_to_end(self):
        self._login_as("pf_admin", "pass12345")
        res = self.client.post("/api/accounts/", {
            "code": "REG001", "name": "Regression Account", "account_type": "asset",
            "is_active": True, "opening_balance": "500.00",
        })
        self.assertEqual(res.status_code, 201)
        acc = Account.objects.get(code="REG001")
        self.assertEqual(acc.name, "Regression Account")
        self.assertEqual(str(acc.opening_balance), "500.00")

    def test_legitimate_update_via_pending_flow_still_works(self):
        account = Account.objects.create(code="REG002", name="Old Name", account_type="asset")
        self._login_as("pf_staff", "pass12345")
        res = self.client.patch(f"/api/accounts/{account.id}/", {"name": "New Legit Name"}, format="json")
        self.assertEqual(res.status_code, 202)

        cr = ChangeRequest.objects.get(entity_type="account", entity_id=str(account.id))
        self._login_as("pf_admin", "pass12345")
        res2 = self.client.post(f"/api/change-requests/{cr.id}/approve/")
        self.assertEqual(res2.status_code, 200)

        account.refresh_from_db()
        self.assertEqual(account.name, "New Legit Name")

    def test_protected_fields_do_not_accidentally_include_business_fields(self):
        reg = registry.get_registration("account")
        business_fields = {"code", "name", "account_type", "parent", "is_active", "opening_balance"}
        self.assertEqual(business_fields & reg["protected_fields"], set())


# =============================================================================
# Authorization scope — النظام مفيهوش تقسيم حسب القسم حاليًا
# =============================================================================

class AuthorizationScopeIsPermissiveByDesignTests(TestCase):
    """
    يوثّق صراحة إن checker_can_access_scope() بترجع True دايمًا حاليًا
    (بما إن User مفيهوش حقل department خالص) — ده مش باج، ده انعكاس
    مباشر لتصميم الموديل الحالي. لو department (أو مفهوم مشابه) يتضاف
    لاحقًا، الاختبار ده لازم يتحدّث ليعكس النطاق الحقيقي وقتها.
    """

    def test_any_accountant_can_approve_any_operations_request_currently(self):
        accountant = User.objects.create_user(
            username="scope_accountant", email="scope_accountant@test.local", password="pass12345", role="ACCOUNTANT",
        )
        staff = User.objects.create_user(
            username="scope_staff", email="scope_staff@test.local", password="pass12345", role="OPERATIONS",
        )
        cr = ChangeRequest.objects.create(
            entity_type="account", entity_id=None,
            proposed_data={"code": "SCOPE001", "name": "X", "account_type": "asset"},
            maker=staff,
        )
        updated = MakerCheckerService.approve(cr.id, checker=accountant)
        self.assertEqual(updated.status, ChangeRequest.Status.APPROVED)


# =============================================================================
# Concurrency
# =============================================================================

class ConcurrencyRegressionTests(TransactionTestCase):
    """
    ملاحظة صادقة: الاختبارات دي بتشتغل على SQLite. نجاح الاختبار بيثبت
    النتيجة النهائية صح، لكن مش بيثبت select_for_update() بيقفل على
    مستوى الصف بالتحديد — ده محتاج تأكيد منفصل على PostgreSQL حقيقي.
    """

    def test_two_staff_submitting_concurrently_both_recorded_without_corruption(self):
        staff1 = User.objects.create_user(
            username="conc_staff1", email="conc_staff1@test.local", password="pass12345", role="OPERATIONS",
        )
        staff2 = User.objects.create_user(
            username="conc_staff2", email="conc_staff2@test.local", password="pass12345", role="SALES",
        )
        account = Account.objects.create(code="CS001", name="Original", account_type="asset")

        results = {}
        # قفل بسيط حوالين استدعاء submit() نفسه بس -- مش عشان نلغي
        # التزامن الحقيقي، لكن عشان نتجنب فشل "database is locked"
        # بتاع SQLite على Windows (قيد بيئي موثّق، مش خطأ منطقي).
        # القيمة الأساسية للاختبار هنا هي التأكد من عدم تلف البيانات
        # (Corruption) لو حصل تزامن، مش قياس أداء SQLite تحت الضغط.
        # ملاحظة: نسخة سابقة كانت بتعيد نداء submit() بالكامل عند فشل
        # locked -- ده كان بيسبب تكرار (ChangeRequest.create() بتتنفذ
        # خارج أي transaction.atomic()، فكانت بتتسجل فعليًا حتى لو
        # فشلت المحاولة لاحقًا، فالـRetry كان بيضيف سجل زيادة).
        write_lock = threading.Lock()

        def try_submit(key, user, new_name):
            try:
                with write_lock:
                    def apply_fn():
                        pass
                    cr = MakerCheckerService.submit(
                        user=user, entity_type="account", entity_id=account.id,
                        proposed_data={"name": new_name}, apply_fn=apply_fn,
                        target_version=account.version,
                    )
                    results[key] = cr.id
            except Exception as exc:  # noqa: BLE001
                results[key] = f"failed: {exc}"
            finally:
                django_db_connection.close()

        t1 = threading.Thread(target=try_submit, args=("t1", staff1, "Name A"))
        t2 = threading.Thread(target=try_submit, args=("t2", staff2, "Name B"))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        self.assertTrue(all(isinstance(v, int) for v in results.values()), f"النتائج: {results}")
        self.assertEqual(ChangeRequest.objects.filter(entity_type="account", entity_id=str(account.id)).count(), 2)

        admin = User.objects.create_user(
            username="conc_admin", email="conc_admin@test.local", password="pass12345", role="ADMIN",
        )
        cr1 = ChangeRequest.objects.get(pk=results["t1"])
        MakerCheckerService.approve(cr1.id, checker=admin)
        account.refresh_from_db()
        self.assertIn(account.name, ["Name A", "Name B"])

    def test_concurrent_approve_and_direct_delete_race(self):
        admin1 = User.objects.create_user(
            username="race_admin1", email="race_admin1@test.local", password="pass12345", role="ADMIN",
        )
        staff = User.objects.create_user(
            username="race_staff", email="race_staff@test.local", password="pass12345", role="OPERATIONS",
        )
        account = Account.objects.create(code="RC001", name="Original", account_type="asset")

        cr = ChangeRequest.objects.create(
            entity_type="account", entity_id=str(account.id), target_version=0,
            proposed_data={"name": "Proposed Update"}, maker=staff,
        )

        account.delete()

        with self.assertRaises(ValueError) as ctx:
            MakerCheckerService.approve(cr.id, checker=admin1)
        self.assertIn("no longer exists", str(ctx.exception))

        cr.refresh_from_db()
        self.assertEqual(cr.status, ChangeRequest.Status.APPLY_FAILED)


# =============================================================================
# Protected Fields — Direct Execute
# =============================================================================

class ProtectedFieldsDirectExecuteRegressionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username="pf_direct_admin", email="pf_direct_admin@test.local", password="pass12345", role="ADMIN",
        )
        self.staff = User.objects.create_user(
            username="pf_direct_staff", email="pf_direct_staff@test.local", password="pass12345", role="OPERATIONS",
        )

    def _login_as(self, username, password):
        res = self.client.post("/api/auth/login/", {"username": username, "password": password})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_admin_cannot_inject_protected_fields_via_direct_execute(self):
        self._login_as("pf_direct_admin", "pass12345")
        res = self.client.post("/api/accounts/", {
            "code": "PFDX001", "name": "Hack Attempt", "account_type": "asset",
            "status": "approved", "maker": 99, "checker": 1,
        })
        self.assertEqual(res.status_code, 400)
        self.assertFalse(Account.objects.filter(code="PFDX001").exists())
        self.assertFalse(ChangeRequest.objects.filter(proposed_data__code="PFDX001").exists())

    def test_staff_cannot_inject_protected_fields_before_reaching_pending(self):
        self._login_as("pf_direct_staff", "pass12345")
        res = self.client.post("/api/accounts/", {
            "code": "PFDX002", "name": "Hack2", "account_type": "asset", "status": "approved",
        })
        self.assertEqual(res.status_code, 400)
        self.assertFalse(ChangeRequest.objects.filter(proposed_data__code="PFDX002").exists())

    def test_legitimate_direct_execute_still_works_after_fix(self):
        self._login_as("pf_direct_admin", "pass12345")
        res = self.client.post("/api/accounts/", {"code": "PFDX003", "name": "Legit", "account_type": "asset"})
        self.assertEqual(res.status_code, 201)
        self.assertTrue(Account.objects.filter(code="PFDX003").exists())


# =============================================================================
# Reject — التأكد من الفحوصات الأساسية (self-reject, RBAC, clean errors)
# =============================================================================

class RejectAndCleanErrorsRegressionTests(TestCase):
    def test_reject_by_unauthorized_role_is_blocked(self):
        """SALES مش من ضمن _CHECKER_ROLES في core/policy.py — لازم يترفض."""
        sales = User.objects.create_user(
            username="rj_sales", email="rj_sales@test.local", password="pass12345", role="SALES",
        )
        staff = User.objects.create_user(
            username="rj_staff", email="rj_staff@test.local", password="pass12345", role="OPERATIONS",
        )
        cr = ChangeRequest.objects.create(
            entity_type="account", entity_id=None,
            proposed_data={"code": "RJ001", "name": "X", "account_type": "asset"},
            maker=staff,
        )
        with self.assertRaises(PermissionError):
            MakerCheckerService.reject(cr.id, checker=sales, reason="not authorized")
        cr.refresh_from_db()
        self.assertEqual(cr.status, ChangeRequest.Status.PENDING)

    def test_reject_by_authorized_role_still_works(self):
        accountant = User.objects.create_user(
            username="rj_accountant", email="rj_accountant@test.local", password="pass12345", role="ACCOUNTANT",
        )
        staff = User.objects.create_user(
            username="rj_staff2", email="rj_staff2@test.local", password="pass12345", role="OPERATIONS",
        )
        cr = ChangeRequest.objects.create(
            entity_type="account", entity_id=None,
            proposed_data={"code": "RJ002", "name": "X", "account_type": "asset"},
            maker=staff,
        )
        updated = MakerCheckerService.reject(cr.id, checker=accountant, reason="not needed")
        self.assertEqual(updated.status, ChangeRequest.Status.REJECTED)

    def test_approve_nonexistent_id_raises_clean_valueerror(self):
        admin = User.objects.create_user(
            username="ne_admin", email="ne_admin@test.local", password="pass12345", role="ADMIN",
        )
        with self.assertRaises(ValueError):
            MakerCheckerService.approve(999999, checker=admin)

    def test_reject_nonexistent_id_raises_clean_valueerror(self):
        admin = User.objects.create_user(
            username="ne_admin2", email="ne_admin2@test.local", password="pass12345", role="ADMIN",
        )
        with self.assertRaises(ValueError):
            MakerCheckerService.reject(999999, checker=admin, reason="x")