from django.test import TestCase
from rest_framework.test import APIClient

from users.models import User
from .models import Account


class AccountAccessTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _login_as(self, username, role):
        User.objects.create_user(username=username, email=f"{username}@test.local", password="pass12345", role=role)
        res = self.client.post("/api/auth/login/", {"username": username, "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_admin_can_access(self):
        self._login_as("coa_admin", "ADMIN")
        res = self.client.get("/api/accounts-coa/")
        self.assertEqual(res.status_code, 200)

    def test_accountant_can_access(self):
        self._login_as("coa_acc", "ACCOUNTANT")
        res = self.client.get("/api/accounts-coa/")
        self.assertEqual(res.status_code, 200)

    def test_owner_can_access(self):
        self._login_as("coa_owner", "OWNER")
        res = self.client.get("/api/accounts-coa/")
        self.assertEqual(res.status_code, 200)

    def test_operations_cannot_access(self):
        self._login_as("coa_ops", "OPERATIONS")
        res = self.client.get("/api/accounts-coa/")
        self.assertEqual(res.status_code, 403)

    def test_sales_cannot_access(self):
        self._login_as("coa_sales", "SALES")
        res = self.client.get("/api/accounts-coa/")
        self.assertEqual(res.status_code, 403)


class AccountCRUDTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="crud_admin", email="crud_admin@test.local", password="pass12345", role="ADMIN")
        res = self.client.post("/api/auth/login/", {"username": "crud_admin", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_create_root_account(self):
        res = self.client.post("/api/accounts-coa/", {
            "code": "1000", "name": "Assets", "type": "asset", "nature": "debit", "currency": "EGP", "opening_balance": 0,
        })
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["balance"], "0.00")

    def test_opening_balance_becomes_balance_on_create(self):
        res = self.client.post("/api/accounts-coa/", {
            "code": "1010", "name": "Cash", "type": "asset", "nature": "debit", "currency": "EGP", "opening_balance": 5000,
        })
        self.assertEqual(res.data["balance"], "5000.00")

    def test_duplicate_code_rejected(self):
        self.client.post("/api/accounts-coa/", {"code": "2000", "name": "A", "type": "liability", "nature": "credit"})
        res = self.client.post("/api/accounts-coa/", {"code": "2000", "name": "B", "type": "liability", "nature": "credit"})
        self.assertEqual(res.status_code, 400)

    def test_create_child_account(self):
        root = self.client.post("/api/accounts-coa/", {"code": "1000", "name": "Assets", "type": "asset", "nature": "debit"})
        res = self.client.post("/api/accounts-coa/", {"code": "1010", "name": "Cash", "type": "asset", "nature": "debit", "parent": root.data["id"]})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["parent"], root.data["id"])

    def test_created_by_set_automatically(self):
        res = self.client.post("/api/accounts-coa/", {"code": "1000", "name": "Assets", "type": "asset", "nature": "debit"})
        account = Account.objects.get(id=res.data["id"])
        self.assertEqual(account.created_by, self.admin)


class AccountCircularHierarchyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="circ_admin", email="circ_admin@test.local", password="pass12345", role="ADMIN")
        res = self.client.post("/api/auth/login/", {"username": "circ_admin", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_account_cannot_be_its_own_parent(self):
        a = self.client.post("/api/accounts-coa/", {"code": "1000", "name": "A", "type": "asset", "nature": "debit"})
        res = self.client.patch(f"/api/accounts-coa/{a.data['id']}/", {"parent": a.data["id"]}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_indirect_circular_hierarchy_rejected(self):
        a = self.client.post("/api/accounts-coa/", {"code": "1000", "name": "A", "type": "asset", "nature": "debit"})
        b = self.client.post("/api/accounts-coa/", {"code": "1010", "name": "B", "type": "asset", "nature": "debit", "parent": a.data["id"]})
        c = self.client.post("/api/accounts-coa/", {"code": "1020", "name": "C", "type": "asset", "nature": "debit", "parent": b.data["id"]})
        # Try to make A a child of C -- A -> B -> C -> A would be circular
        res = self.client.patch(f"/api/accounts-coa/{a.data['id']}/", {"parent": c.data["id"]}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_inactive_parent_rejected(self):
        a = self.client.post("/api/accounts-coa/", {"code": "1000", "name": "A", "type": "asset", "nature": "debit", "status": "inactive"})
        res = self.client.post("/api/accounts-coa/", {"code": "1010", "name": "B", "type": "asset", "nature": "debit", "parent": a.data["id"]})
        self.assertEqual(res.status_code, 400)


class AccountDeletionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="del_admin", email="del_admin@test.local", password="pass12345", role="ADMIN")
        res = self.client.post("/api/auth/login/", {"username": "del_admin", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_account_with_children_cannot_be_deleted(self):
        a = self.client.post("/api/accounts-coa/", {"code": "1000", "name": "A", "type": "asset", "nature": "debit"})
        self.client.post("/api/accounts-coa/", {"code": "1010", "name": "B", "type": "asset", "nature": "debit", "parent": a.data["id"]})
        res = self.client.delete(f"/api/accounts-coa/{a.data['id']}/")
        self.assertEqual(res.status_code, 400)

    def test_account_without_children_or_movements_can_be_deleted(self):
        a = self.client.post("/api/accounts-coa/", {"code": "1000", "name": "A", "type": "asset", "nature": "debit"})
        res = self.client.delete(f"/api/accounts-coa/{a.data['id']}/")
        self.assertEqual(res.status_code, 204)

    def test_system_account_cannot_be_deleted(self):
        account = Account.objects.create(code="9999", name="Suspense", type="asset", nature="debit", is_system_account=True, created_by=self.admin)
        res = self.client.delete(f"/api/accounts-coa/{account.id}/")
        self.assertEqual(res.status_code, 403)

class JournalEntryAccessTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _login_as(self, username, role):
        User.objects.create_user(username=username, email=f"{username}@test.local", password="pass12345", role=role)
        res = self.client.post("/api/auth/login/", {"username": username, "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_operations_cannot_access_journal(self):
        self._login_as("je_ops", "OPERATIONS")
        res = self.client.get("/api/journal-entries/")
        self.assertEqual(res.status_code, 403)

    def test_accountant_can_access_journal(self):
        self._login_as("je_acc", "ACCOUNTANT")
        res = self.client.get("/api/journal-entries/")
        self.assertEqual(res.status_code, 200)


class JournalEntryCRUDTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="je_user", email="je_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "je_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self.cash = self.client.post("/api/accounts-coa/", {"code": "1010", "name": "Cash", "type": "asset", "nature": "debit"}).data
        self.revenue = self.client.post("/api/accounts-coa/", {"code": "4010", "name": "Sales Revenue", "type": "revenue", "nature": "credit"}).data

    def _balanced_lines(self, amount="1000.00"):
        return [
            {"account": self.cash["id"], "debit": amount, "credit": "0.00"},
            {"account": self.revenue["id"], "debit": "0.00", "credit": amount},
        ]

    def test_create_balanced_entry(self):
        res = self.client.post("/api/journal-entries/", {
            "date": "2026-09-16", "description": "Test sale", "lines": self._balanced_lines(),
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["status"], "draft")
        self.assertTrue(res.data["number"].startswith("JE-"))

    def test_unbalanced_entry_rejected(self):
        lines = [
            {"account": self.cash["id"], "debit": "1000.00", "credit": "0.00"},
            {"account": self.revenue["id"], "debit": "0.00", "credit": "500.00"},
        ]
        res = self.client.post("/api/journal-entries/", {"date": "2026-09-16", "description": "Unbalanced", "lines": lines}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_single_line_rejected(self):
        lines = [{"account": self.cash["id"], "debit": "1000.00", "credit": "0.00"}]
        res = self.client.post("/api/journal-entries/", {"date": "2026-09-16", "description": "Only one line", "lines": lines}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_line_with_both_debit_and_credit_rejected(self):
        lines = [
            {"account": self.cash["id"], "debit": "1000.00", "credit": "500.00"},
            {"account": self.revenue["id"], "debit": "0.00", "credit": "500.00"},
        ]
        res = self.client.post("/api/journal-entries/", {"date": "2026-09-16", "description": "Bad line", "lines": lines}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_zero_amount_entry_rejected(self):
        lines = [
            {"account": self.cash["id"], "debit": "0.00", "credit": "0.00"},
            {"account": self.revenue["id"], "debit": "0.00", "credit": "0.00"},
        ]
        res = self.client.post("/api/journal-entries/", {"date": "2026-09-16", "description": "Empty", "lines": lines}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_edit_draft_entry(self):
        create_res = self.client.post("/api/journal-entries/", {"date": "2026-09-16", "description": "Original", "lines": self._balanced_lines()}, format="json")
        res = self.client.patch(f"/api/journal-entries/{create_res.data['id']}/", {"description": "Updated"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["description"], "Updated")

    def test_delete_draft_entry(self):
        create_res = self.client.post("/api/journal-entries/", {"date": "2026-09-16", "description": "To delete", "lines": self._balanced_lines()}, format="json")
        res = self.client.delete(f"/api/journal-entries/{create_res.data['id']}/")
        self.assertEqual(res.status_code, 204)


class JournalEntryWorkflowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="je_wf", email="je_wf@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "je_wf", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self.cash = self.client.post("/api/accounts-coa/", {"code": "1010", "name": "Cash", "type": "asset", "nature": "debit"}).data
        self.revenue = self.client.post("/api/accounts-coa/", {"code": "4010", "name": "Sales Revenue", "type": "revenue", "nature": "credit"}).data
        lines = [
            {"account": self.cash["id"], "debit": "1000.00", "credit": "0.00"},
            {"account": self.revenue["id"], "debit": "0.00", "credit": "1000.00"},
        ]
        self.entry = self.client.post("/api/journal-entries/", {"date": "2026-09-16", "description": "Test", "lines": lines}, format="json").data

    def test_cannot_post_a_draft_entry(self):
        res = self.client.post(f"/api/journal-entries/{self.entry['id']}/post_entry/")
        self.assertEqual(res.status_code, 400)

    def test_full_workflow_to_posted_updates_balances(self):
        self.client.post(f"/api/journal-entries/{self.entry['id']}/submit/")
        self.client.post(f"/api/journal-entries/{self.entry['id']}/approve/")
        res = self.client.post(f"/api/journal-entries/{self.entry['id']}/post_entry/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "posted")

        cash_after = self.client.get(f"/api/accounts-coa/{self.cash['id']}/").data
        revenue_after = self.client.get(f"/api/accounts-coa/{self.revenue['id']}/").data
        self.assertEqual(cash_after["balance"], "1000.00")   # debit nature: +1000
        self.assertEqual(revenue_after["balance"], "1000.00")  # credit nature: +1000

    def test_account_with_movements_becomes_locked(self):
        self.client.post(f"/api/journal-entries/{self.entry['id']}/submit/")
        self.client.post(f"/api/journal-entries/{self.entry['id']}/approve/")
        self.client.post(f"/api/journal-entries/{self.entry['id']}/post_entry/")

        res = self.client.patch(f"/api/accounts-coa/{self.cash['id']}/", {"code": "9999"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_posted_account_with_movements_cannot_be_deleted(self):
        self.client.post(f"/api/journal-entries/{self.entry['id']}/submit/")
        self.client.post(f"/api/journal-entries/{self.entry['id']}/approve/")
        self.client.post(f"/api/journal-entries/{self.entry['id']}/post_entry/")
        res = self.client.delete(f"/api/accounts-coa/{self.cash['id']}/")
        self.assertEqual(res.status_code, 400)

    def test_posted_entry_cannot_be_edited(self):
        self.client.post(f"/api/journal-entries/{self.entry['id']}/submit/")
        self.client.post(f"/api/journal-entries/{self.entry['id']}/approve/")
        self.client.post(f"/api/journal-entries/{self.entry['id']}/post_entry/")
        res = self.client.patch(f"/api/journal-entries/{self.entry['id']}/", {"description": "Hacked"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_posted_entry_cannot_be_deleted(self):
        self.client.post(f"/api/journal-entries/{self.entry['id']}/submit/")
        self.client.post(f"/api/journal-entries/{self.entry['id']}/approve/")
        self.client.post(f"/api/journal-entries/{self.entry['id']}/post_entry/")
        res = self.client.delete(f"/api/journal-entries/{self.entry['id']}/")
        self.assertEqual(res.status_code, 400)


class JournalEntryReversalTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="je_rev", email="je_rev@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "je_rev", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self.cash = self.client.post("/api/accounts-coa/", {"code": "1010", "name": "Cash", "type": "asset", "nature": "debit"}).data
        self.revenue = self.client.post("/api/accounts-coa/", {"code": "4010", "name": "Sales Revenue", "type": "revenue", "nature": "credit"}).data
        lines = [
            {"account": self.cash["id"], "debit": "1000.00", "credit": "0.00"},
            {"account": self.revenue["id"], "debit": "0.00", "credit": "1000.00"},
        ]
        entry_res = self.client.post("/api/journal-entries/", {"date": "2026-09-16", "description": "Test", "lines": lines}, format="json")
        self.entry_id = entry_res.data["id"]
        self.client.post(f"/api/journal-entries/{self.entry_id}/submit/")
        self.client.post(f"/api/journal-entries/{self.entry_id}/approve/")
        self.client.post(f"/api/journal-entries/{self.entry_id}/post_entry/")

    def test_cannot_reverse_unposted_entry(self):
        lines = [
            {"account": self.cash["id"], "debit": "500.00", "credit": "0.00"},
            {"account": self.revenue["id"], "debit": "0.00", "credit": "500.00"},
        ]
        draft = self.client.post("/api/journal-entries/", {"date": "2026-09-16", "description": "Draft", "lines": lines}, format="json")
        res = self.client.post(f"/api/journal-entries/{draft.data['id']}/reverse/")
        self.assertEqual(res.status_code, 400)

    def test_reverse_creates_new_posted_entry_with_swapped_lines(self):
        res = self.client.post(f"/api/journal-entries/{self.entry_id}/reverse/", {"reason": "Wrong amount"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["status"], "posted")
        self.assertEqual(res.data["reverses"], self.entry_id)

    def test_reversal_restores_original_balances(self):
        self.client.post(f"/api/journal-entries/{self.entry_id}/reverse/", {"reason": "test"}, format="json")
        cash_after = self.client.get(f"/api/accounts-coa/{self.cash['id']}/").data
        revenue_after = self.client.get(f"/api/accounts-coa/{self.revenue['id']}/").data
        self.assertEqual(cash_after["balance"], "0.00")
        self.assertEqual(revenue_after["balance"], "0.00")

    def test_cannot_reverse_same_entry_twice(self):
        self.client.post(f"/api/journal-entries/{self.entry_id}/reverse/", {"reason": "first"}, format="json")
        res = self.client.post(f"/api/journal-entries/{self.entry_id}/reverse/", {"reason": "second"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_original_entry_shows_is_reversed_true(self):
        self.client.post(f"/api/journal-entries/{self.entry_id}/reverse/", {"reason": "test"}, format="json")
        entry = self.client.get(f"/api/journal-entries/{self.entry_id}/").data
        self.assertTrue(entry["is_reversed"])


class ExpenseAndCustodySetupMixin:
    def _setup_accounts(self):
        self.cash = self.client.post("/api/accounts-coa/", {"code": "1010", "name": "Cash", "type": "asset", "nature": "debit"}).data
        self.custody_acc = self.client.post("/api/accounts-coa/", {"code": "1020", "name": "Employee Custody", "type": "asset", "nature": "debit"}).data
        self.expense_acc = self.client.post("/api/accounts-coa/", {"code": "5010", "name": "Travel Expenses", "type": "expense", "nature": "debit"}).data


class CustodyLifecycleTests(ExpenseAndCustodySetupMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="cus_user", email="cus_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "cus_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self._setup_accounts()
        self.employee = User.objects.create_user(username="ahmed_emp", email="ahmed@test.local", password="pass12345", role="OPERATIONS")

    def _create_custody(self, amount="5000.00"):
        return self.client.post("/api/custody/", {
            "date": "2026-09-16", "employee": self.employee.id, "amount": amount,
            "treasury_account": self.cash["id"], "custody_account": self.custody_acc["id"], "description": "Flight tickets",
        }, format="json")

    def test_create_custody_draft(self):
        res = self._create_custody()
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["status"], "draft")
        self.assertTrue(res.data["number"].startswith("CUS-"))

    def test_negative_amount_rejected(self):
        res = self._create_custody(amount="-100.00")
        self.assertEqual(res.status_code, 400)

    def test_full_issue_workflow_moves_money(self):
        create_res = self._create_custody()
        cid = create_res.data["id"]
        self.client.post(f"/api/custody/{cid}/submit/")
        self.client.post(f"/api/custody/{cid}/approve/")
        res = self.client.post(f"/api/custody/{cid}/issue/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "posted")

        cash_after = self.client.get(f"/api/accounts-coa/{self.cash['id']}/").data
        custody_after = self.client.get(f"/api/accounts-coa/{self.custody_acc['id']}/").data
        self.assertEqual(cash_after["balance"], "-5000.00")
        self.assertEqual(custody_after["balance"], "5000.00")

    def test_settlement_returns_remaining_to_treasury(self):
        create_res = self._create_custody(amount="5000.00")
        cid = create_res.data["id"]
        self.client.post(f"/api/custody/{cid}/submit/")
        self.client.post(f"/api/custody/{cid}/approve/")
        self.client.post(f"/api/custody/{cid}/issue/")

        # Spend 4500 via an expense charged to this custody
        expense_res = self.client.post("/api/expenses/", {
            "date": "2026-09-17", "category": "Travel", "amount": "4500.00", "payment_method": "custody",
            "custody": cid, "expense_account": self.expense_acc["id"], "description": "Flight tickets bought",
        }, format="json")
        eid = expense_res.data["id"]
        self.client.post(f"/api/expenses/{eid}/submit/")
        self.client.post(f"/api/expenses/{eid}/approve/")
        self.client.post(f"/api/expenses/{eid}/post_expense/")

        res = self.client.post(f"/api/custody/{cid}/settle/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "settled")

        cash_after = self.client.get(f"/api/accounts-coa/{self.cash['id']}/").data
        custody_after = self.client.get(f"/api/accounts-coa/{self.custody_acc['id']}/").data
        self.assertEqual(cash_after["balance"], "-4500.00")   # -5000 issued + 500 returned
        self.assertEqual(custody_after["balance"], "0.00")  # settlement zeroes the custody account out

    def test_cannot_settle_with_unposted_expense(self):
        create_res = self._create_custody()
        cid = create_res.data["id"]
        self.client.post(f"/api/custody/{cid}/submit/")
        self.client.post(f"/api/custody/{cid}/approve/")
        self.client.post(f"/api/custody/{cid}/issue/")

        self.client.post("/api/expenses/", {
            "date": "2026-09-17", "category": "Travel", "amount": "1000.00", "payment_method": "custody",
            "custody": cid, "expense_account": self.expense_acc["id"], "description": "Not posted yet",
        }, format="json")

        res = self.client.post(f"/api/custody/{cid}/settle/")
        self.assertEqual(res.status_code, 400)


class ExpenseVoucherTests(ExpenseAndCustodySetupMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="exp_user", email="exp_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "exp_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self._setup_accounts()

    def test_cash_expense_requires_treasury_account(self):
        res = self.client.post("/api/expenses/", {
            "date": "2026-09-16", "category": "Rent", "amount": "1000.00", "payment_method": "cash",
            "expense_account": self.expense_acc["id"], "description": "Office rent",
        }, format="json")
        self.assertEqual(res.status_code, 400)

    def test_full_cash_expense_workflow(self):
        create_res = self.client.post("/api/expenses/", {
            "date": "2026-09-16", "category": "Rent", "amount": "1000.00", "payment_method": "cash",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"], "description": "Office rent",
        }, format="json")
        eid = create_res.data["id"]
        self.client.post(f"/api/expenses/{eid}/submit/")
        self.client.post(f"/api/expenses/{eid}/approve/")
        res = self.client.post(f"/api/expenses/{eid}/post_expense/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "posted")

        cash_after = self.client.get(f"/api/accounts-coa/{self.cash['id']}/").data
        expense_after = self.client.get(f"/api/accounts-coa/{self.expense_acc['id']}/").data
        self.assertEqual(cash_after["balance"], "-1000.00")
        self.assertEqual(expense_after["balance"], "1000.00")

    def test_reverse_expense_restores_balances(self):
        create_res = self.client.post("/api/expenses/", {
            "date": "2026-09-16", "category": "Rent", "amount": "1000.00", "payment_method": "cash",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"], "description": "Office rent",
        }, format="json")
        eid = create_res.data["id"]
        self.client.post(f"/api/expenses/{eid}/submit/")
        self.client.post(f"/api/expenses/{eid}/approve/")
        self.client.post(f"/api/expenses/{eid}/post_expense/")

        res = self.client.post(f"/api/expenses/{eid}/reverse/")
        self.assertEqual(res.status_code, 201)

        cash_after = self.client.get(f"/api/accounts-coa/{self.cash['id']}/").data
        expense_after = self.client.get(f"/api/accounts-coa/{self.expense_acc['id']}/").data
        self.assertEqual(cash_after["balance"], "0.00")
        self.assertEqual(expense_after["balance"], "0.00")

    def test_cannot_reverse_twice(self):
        create_res = self.client.post("/api/expenses/", {
            "date": "2026-09-16", "category": "Rent", "amount": "1000.00", "payment_method": "cash",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"], "description": "Office rent",
        }, format="json")
        eid = create_res.data["id"]
        self.client.post(f"/api/expenses/{eid}/submit/")
        self.client.post(f"/api/expenses/{eid}/approve/")
        self.client.post(f"/api/expenses/{eid}/post_expense/")
        self.client.post(f"/api/expenses/{eid}/reverse/")
        res = self.client.post(f"/api/expenses/{eid}/reverse/")
        self.assertEqual(res.status_code, 400)

    def test_operations_role_cannot_access_expenses(self):
        client2 = APIClient()
        User.objects.create_user(username="exp_ops", email="exp_ops@test.local", password="pass12345", role="OPERATIONS")
        res = client2.post("/api/auth/login/", {"username": "exp_ops", "password": "pass12345"})
        client2.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        res = client2.get("/api/expenses/")
        self.assertEqual(res.status_code, 403)


class VoucherTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="v_user", email="v_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "v_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

        self.cash = self.client.post("/api/accounts-coa/", {"code": "1010", "name": "Cash", "type": "asset", "nature": "debit"}).data
        self.ar_account = self.client.post("/api/accounts-coa/", {"code": "1030", "name": "Accounts Receivable", "type": "asset", "nature": "debit"}).data
        self.ap_account = self.client.post("/api/accounts-coa/", {"code": "2010", "name": "Accounts Payable", "type": "liability", "nature": "credit"}).data

        party_res = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "Test Customer", "phone": "01000000000"})
        self.party = party_res.data

    def test_create_receipt_voucher_draft(self):
        res = self.client.post("/api/vouchers/", {
            "type": "receipt", "date": "2026-09-16", "party": self.party["id"], "amount": "2000.00",
            "treasury_account": self.cash["id"], "party_control_account": self.ar_account["id"], "description": "Payment from customer",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["status"], "draft")
        self.assertTrue(res.data["number"].startswith("REC-"))

    def test_receipt_voucher_full_workflow_updates_balances(self):
        create_res = self.client.post("/api/vouchers/", {
            "type": "receipt", "date": "2026-09-16", "party": self.party["id"], "amount": "2000.00",
            "treasury_account": self.cash["id"], "party_control_account": self.ar_account["id"], "description": "Payment from customer",
        }, format="json")
        vid = create_res.data["id"]
        self.client.post(f"/api/vouchers/{vid}/submit/")
        self.client.post(f"/api/vouchers/{vid}/approve/")
        res = self.client.post(f"/api/vouchers/{vid}/post_voucher/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "posted")

        cash_after = self.client.get(f"/api/accounts-coa/{self.cash['id']}/").data
        ar_after = self.client.get(f"/api/accounts-coa/{self.ar_account['id']}/").data
        party_after = self.client.get(f"/api/parties/{self.party['id']}/").data
        self.assertEqual(cash_after["balance"], "2000.00")
        self.assertEqual(ar_after["balance"], "-2000.00")
        self.assertEqual(party_after["balance"], "-2000.00")

    def test_payment_voucher_full_workflow_updates_balances(self):
        create_res = self.client.post("/api/vouchers/", {
            "type": "payment", "date": "2026-09-16", "party": self.party["id"], "amount": "1500.00",
            "treasury_account": self.cash["id"], "party_control_account": self.ap_account["id"], "description": "Payment to supplier",
        }, format="json")
        vid = create_res.data["id"]
        self.client.post(f"/api/vouchers/{vid}/submit/")
        self.client.post(f"/api/vouchers/{vid}/approve/")
        res = self.client.post(f"/api/vouchers/{vid}/post_voucher/")
        self.assertEqual(res.status_code, 200)

        cash_after = self.client.get(f"/api/accounts-coa/{self.cash['id']}/").data
        party_after = self.client.get(f"/api/parties/{self.party['id']}/").data
        self.assertEqual(cash_after["balance"], "-1500.00")
        self.assertEqual(party_after["balance"], "1500.00")

    def test_reverse_receipt_voucher_restores_balances(self):
        create_res = self.client.post("/api/vouchers/", {
            "type": "receipt", "date": "2026-09-16", "party": self.party["id"], "amount": "2000.00",
            "treasury_account": self.cash["id"], "party_control_account": self.ar_account["id"], "description": "Payment",
        }, format="json")
        vid = create_res.data["id"]
        self.client.post(f"/api/vouchers/{vid}/submit/")
        self.client.post(f"/api/vouchers/{vid}/approve/")
        self.client.post(f"/api/vouchers/{vid}/post_voucher/")

        res = self.client.post(f"/api/vouchers/{vid}/reverse/", {"reason": "wrong amount"}, format="json")
        self.assertEqual(res.status_code, 201)

        cash_after = self.client.get(f"/api/accounts-coa/{self.cash['id']}/").data
        party_after = self.client.get(f"/api/parties/{self.party['id']}/").data
        self.assertEqual(cash_after["balance"], "0.00")
        self.assertEqual(party_after["balance"], "0.00")

    def test_negative_amount_rejected(self):
        res = self.client.post("/api/vouchers/", {
            "type": "receipt", "date": "2026-09-16", "party": self.party["id"], "amount": "-100.00",
            "treasury_account": self.cash["id"], "party_control_account": self.ar_account["id"], "description": "Bad",
        }, format="json")
        self.assertEqual(res.status_code, 400)

    def test_operations_role_cannot_access_vouchers(self):
        client2 = APIClient()
        User.objects.create_user(username="v_ops", email="v_ops@test.local", password="pass12345", role="OPERATIONS")
        res = client2.post("/api/auth/login/", {"username": "v_ops", "password": "pass12345"})
        client2.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        res = client2.get("/api/vouchers/")
        self.assertEqual(res.status_code, 403)

    def test_cannot_reverse_twice(self):
        create_res = self.client.post("/api/vouchers/", {
            "type": "receipt", "date": "2026-09-16", "party": self.party["id"], "amount": "500.00",
            "treasury_account": self.cash["id"], "party_control_account": self.ar_account["id"], "description": "test",
        }, format="json")
        vid = create_res.data["id"]
        self.client.post(f"/api/vouchers/{vid}/submit/")
        self.client.post(f"/api/vouchers/{vid}/approve/")
        self.client.post(f"/api/vouchers/{vid}/post_voucher/")
        self.client.post(f"/api/vouchers/{vid}/reverse/")
        res = self.client.post(f"/api/vouchers/{vid}/reverse/")
        self.assertEqual(res.status_code, 400)


class InvoiceTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="inv_user", email="inv_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "inv_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        party_res = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "Invoice Customer", "phone": "01000000001"})
        self.party = party_res.data
        self.ar = self.client.post("/api/accounts-coa/", {"code": "1030", "name": "AR", "type": "asset", "nature": "debit"}).data
        self.revenue = self.client.post("/api/accounts-coa/", {"code": "4010", "name": "Sales Revenue", "type": "revenue", "nature": "credit"}).data

    def test_create_draft_invoice(self):
        res = self.client.post("/api/invoices/", {
            "date": "2026-09-16", "party": self.party["id"], "total_amount": "15000.00", "description": "Flight ticket",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["status"], "draft")
        self.assertFalse(res.data["is_issued"])
        self.assertTrue(res.data["number"].startswith("INV-"))

    def test_issue_locks_invoice(self):
        create_res = self.client.post("/api/invoices/", {
            "date": "2026-09-16", "party": self.party["id"], "total_amount": "15000.00", "description": "Flight ticket",
        }, format="json")
        iid = create_res.data["id"]
        res = self.client.post(f"/api/invoices/{iid}/issue/", {"ar_account": self.ar["id"], "revenue_account": self.revenue["id"], "signature_data": "base64sig", "qr_code_data": "qrpayload"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["is_issued"])
        self.assertEqual(res.data["status"], "issued")

    def test_cannot_edit_issued_invoice(self):
        create_res = self.client.post("/api/invoices/", {
            "date": "2026-09-16", "party": self.party["id"], "total_amount": "15000.00", "description": "Flight ticket",
        }, format="json")
        iid = create_res.data["id"]
        self.client.post(f"/api/invoices/{iid}/issue/", {"ar_account": self.ar["id"], "revenue_account": self.revenue["id"]}, format="json")
        res = self.client.patch(f"/api/invoices/{iid}/", {"total_amount": "12000.00"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_cannot_delete_issued_invoice(self):
        create_res = self.client.post("/api/invoices/", {
            "date": "2026-09-16", "party": self.party["id"], "total_amount": "15000.00", "description": "Flight ticket",
        }, format="json")
        iid = create_res.data["id"]
        self.client.post(f"/api/invoices/{iid}/issue/", {"ar_account": self.ar["id"], "revenue_account": self.revenue["id"]}, format="json")
        res = self.client.delete(f"/api/invoices/{iid}/")
        self.assertEqual(res.status_code, 400)

    def test_credit_and_reissue_creates_two_invoices(self):
        create_res = self.client.post("/api/invoices/", {
            "date": "2026-09-16", "party": self.party["id"], "total_amount": "50000.00", "description": "Original",
        }, format="json")
        iid = create_res.data["id"]
        self.client.post(f"/api/invoices/{iid}/issue/", {"ar_account": self.ar["id"], "revenue_account": self.revenue["id"]}, format="json")

        res = self.client.post(f"/api/invoices/{iid}/credit_and_reissue/", {"new_amount": "42000.00"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["credit_note"]["total_amount"], "-50000.00")
        self.assertEqual(res.data["replacement"]["total_amount"], "42000.00")
        self.assertTrue(res.data["credit_note"]["is_issued"])
        self.assertFalse(res.data["replacement"]["is_issued"])

        original_after = self.client.get(f"/api/invoices/{iid}/").data
        self.assertEqual(original_after["status"], "credited")
        self.assertEqual(original_after["total_amount"], "50000.00")  # original number NEVER changes

    def test_cannot_credit_unissued_invoice(self):
        create_res = self.client.post("/api/invoices/", {
            "date": "2026-09-16", "party": self.party["id"], "total_amount": "15000.00", "description": "Draft",
        }, format="json")
        iid = create_res.data["id"]
        res = self.client.post(f"/api/invoices/{iid}/credit_and_reissue/", {"new_amount": "10000.00"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_cannot_credit_same_invoice_twice(self):
        create_res = self.client.post("/api/invoices/", {
            "date": "2026-09-16", "party": self.party["id"], "total_amount": "50000.00", "description": "Original",
        }, format="json")
        iid = create_res.data["id"]
        self.client.post(f"/api/invoices/{iid}/issue/", {"ar_account": self.ar["id"], "revenue_account": self.revenue["id"]}, format="json")
        self.client.post(f"/api/invoices/{iid}/credit_and_reissue/", {"new_amount": "42000.00"}, format="json")
        res = self.client.post(f"/api/invoices/{iid}/credit_and_reissue/", {"new_amount": "40000.00"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_operations_role_cannot_access_invoices(self):
        client2 = APIClient()
        User.objects.create_user(username="inv_ops", email="inv_ops@test.local", password="pass12345", role="OPERATIONS")
        res = client2.post("/api/auth/login/", {"username": "inv_ops", "password": "pass12345"})
        client2.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        res = client2.get("/api/invoices/")
        self.assertEqual(res.status_code, 403)


class FinancialPeriodTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="fp_user", email="fp_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "fp_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_open_period_creates_row(self):
        res = self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 9}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertFalse(res.data["is_locked"])

    def test_open_period_is_idempotent(self):
        self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 9}, format="json")
        res = self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 9}, format="json")
        self.assertEqual(res.status_code, 200)

    def test_readiness_check_with_no_pending_bookings(self):
        create_res = self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 9}, format="json")
        pid = create_res.data["id"]
        res = self.client.get(f"/api/financial-periods/{pid}/readiness_check/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["ready_to_close"])

    def test_close_period_locks_it(self):
        create_res = self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 9}, format="json")
        pid = create_res.data["id"]
        res = self.client.post(f"/api/financial-periods/{pid}/close/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["is_locked"])
        self.assertIsNotNone(res.data["closed_at"])
        self.assertEqual(res.data["closed_by_name"], "fp_user")

    def test_cannot_close_already_locked_period(self):
        create_res = self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 9}, format="json")
        pid = create_res.data["id"]
        self.client.post(f"/api/financial-periods/{pid}/close/")
        res = self.client.post(f"/api/financial-periods/{pid}/close/")
        self.assertEqual(res.status_code, 400)

    def test_closed_period_still_readable_as_archive(self):
        create_res = self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 9}, format="json")
        pid = create_res.data["id"]
        self.client.post(f"/api/financial-periods/{pid}/close/")
        res = self.client.get(f"/api/financial-periods/{pid}/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["is_locked"])

    def test_period_list_shows_history(self):
        self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 8}, format="json")
        self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 9}, format="json")
        res = self.client.get("/api/financial-periods/")
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(len(res.data.get("results", res.data)), 2)

    def test_cannot_delete_or_patch_period(self):
        create_res = self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 9}, format="json")
        pid = create_res.data["id"]
        delete_res = self.client.delete(f"/api/financial-periods/{pid}/")
        self.assertEqual(delete_res.status_code, 405)
        patch_res = self.client.patch(f"/api/financial-periods/{pid}/", {"is_locked": True}, format="json")
        self.assertEqual(patch_res.status_code, 405)

    def test_operations_role_cannot_access_periods(self):
        client2 = APIClient()
        User.objects.create_user(username="fp_ops", email="fp_ops@test.local", password="pass12345", role="OPERATIONS")
        res = client2.post("/api/auth/login/", {"username": "fp_ops", "password": "pass12345"})
        client2.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        res = client2.get("/api/financial-periods/")
        self.assertEqual(res.status_code, 403)


class ReportsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="rpt_user", email="rpt_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "rpt_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

        self.cash = self.client.post("/api/accounts-coa/", {"code": "1010", "name": "Cash", "type": "asset", "nature": "debit"}).data
        self.revenue = self.client.post("/api/accounts-coa/", {"code": "4010", "name": "Sales Revenue", "type": "revenue", "nature": "credit"}).data

        lines = [
            {"account": self.cash["id"], "debit": "1000.00", "credit": "0.00"},
            {"account": self.revenue["id"], "debit": "0.00", "credit": "1000.00"},
        ]
        entry_res = self.client.post("/api/journal-entries/", {"date": "2026-09-16", "description": "Test sale", "lines": lines}, format="json")
        self.entry_id = entry_res.data["id"]
        self.client.post(f"/api/journal-entries/{self.entry_id}/submit/")
        self.client.post(f"/api/journal-entries/{self.entry_id}/approve/")
        self.client.post(f"/api/journal-entries/{self.entry_id}/post_entry/")

    def test_ledger_report_shows_running_balance(self):
        res = self.client.get(f"/api/reports/ledger/?account_id={self.cash['id']}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["lines"]), 1)
        self.assertEqual(res.data["lines"][0]["running_balance"], "1000.00")

    def test_ledger_report_requires_account_id(self):
        res = self.client.get("/api/reports/ledger/")
        self.assertEqual(res.status_code, 400)

    def test_trial_balance_is_balanced(self):
        res = self.client.get("/api/reports/trial-balance/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["is_balanced"])
        self.assertEqual(res.data["total_debit"], res.data["total_credit"])

    def test_profit_loss_live_month(self):
        res = self.client.get("/api/reports/profit-loss/?year=2026&month=9")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["source"], "live")

    def test_profit_loss_archived_month(self):
        self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 9}, format="json")
        period_list = self.client.get("/api/financial-periods/?year=2026").data
        period_id = next(p["id"] for p in period_list.get("results", period_list) if p["year"] == 2026 and p["month"] == 9)
        self.client.post(f"/api/financial-periods/{period_id}/close/")

        res = self.client.get("/api/reports/profit-loss/?year=2026&month=9")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["source"], "archived")

    def test_department_performance_report(self):
        res = self.client.get("/api/reports/department-performance/?year=2026&month=9")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["departments"]), 3)

    def test_audit_log_shows_posted_entry(self):
        res = self.client.get("/api/reports/audit-log/?event_type=accounting_posted")
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(len(res.data["results"]), 1)

    def test_audit_log_shows_closed_period(self):
        self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 10}, format="json")
        period_list = self.client.get("/api/financial-periods/?year=2026").data
        period_id = next(p["id"] for p in period_list.get("results", period_list) if p["year"] == 2026 and p["month"] == 10)
        self.client.post(f"/api/financial-periods/{period_id}/close/")

        res = self.client.get("/api/reports/audit-log/?event_type=period_closed")
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(len(res.data["results"]), 1)

    def test_operations_role_cannot_access_reports(self):
        client2 = APIClient()
        User.objects.create_user(username="rpt_ops", email="rpt_ops@test.local", password="pass12345", role="OPERATIONS")
        res = client2.post("/api/auth/login/", {"username": "rpt_ops", "password": "pass12345"})
        client2.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        res = client2.get("/api/reports/trial-balance/")
        self.assertEqual(res.status_code, 403)


class BookingAccountingApprovalTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="ops_acc_user", email="ops_acc_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "ops_acc_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

        self.ar = self.client.post("/api/accounts-coa/", {"code": "1030", "name": "AR", "type": "asset", "nature": "debit"}).data
        self.revenue = self.client.post("/api/accounts-coa/", {"code": "4010", "name": "Sales Revenue", "type": "revenue", "nature": "credit"}).data
        self.cogs = self.client.post("/api/accounts-coa/", {"code": "5020", "name": "COGS", "type": "expense", "nature": "debit"}).data
        self.ap = self.client.post("/api/accounts-coa/", {"code": "2010", "name": "AP", "type": "liability", "nature": "credit"}).data

        booking_res = self.client.post("/api/bookings/", {
            "department": "flight", "date": "2026-09-17", "passenger_name": "Test Customer",
            "net_rate": "10000.00", "selling_rate": "15000.00", "supplier": "Amadeus",
        })
        self.booking_id = booking_res.data["id"]
        self.client.post(f"/api/bookings/{self.booking_id}/confirm/")

    def _approve_payload(self):
        return {
            "ar_account": self.ar["id"], "revenue_account": self.revenue["id"],
            "cogs_account": self.cogs["id"], "ap_account": self.ap["id"],
        }

    def test_pending_list_shows_confirmed_booking(self):
        res = self.client.get("/api/operations/pending/")
        self.assertEqual(res.status_code, 200)
        ids = [r["id"] for r in res.data["results"]]
        self.assertIn(self.booking_id, ids)

    def test_approve_generates_balanced_entry_and_locks_booking(self):
        res = self.client.post(f"/api/operations/{self.booking_id}/approve/", self._approve_payload(), format="json")
        self.assertEqual(res.status_code, 200)
        self.assertIn("journal_entry_number", res.data)

        ar_after = self.client.get(f"/api/accounts-coa/{self.ar['id']}/").data
        revenue_after = self.client.get(f"/api/accounts-coa/{self.revenue['id']}/").data
        cogs_after = self.client.get(f"/api/accounts-coa/{self.cogs['id']}/").data
        ap_after = self.client.get(f"/api/accounts-coa/{self.ap['id']}/").data

        self.assertEqual(ar_after["balance"], "15000.00")
        self.assertEqual(revenue_after["balance"], "15000.00")
        self.assertEqual(cogs_after["balance"], "10000.00")
        self.assertEqual(ap_after["balance"], "10000.00")

    def test_approved_booking_no_longer_in_pending_list(self):
        self.client.post(f"/api/operations/{self.booking_id}/approve/", self._approve_payload(), format="json")
        res = self.client.get("/api/operations/pending/")
        ids = [r["id"] for r in res.data["results"]]
        self.assertNotIn(self.booking_id, ids)

    def test_cannot_approve_twice(self):
        self.client.post(f"/api/operations/{self.booking_id}/approve/", self._approve_payload(), format="json")
        res = self.client.post(f"/api/operations/{self.booking_id}/approve/", self._approve_payload(), format="json")
        self.assertEqual(res.status_code, 400)

    def test_missing_accounts_rejected(self):
        res = self.client.post(f"/api/operations/{self.booking_id}/approve/", {"ar_account": self.ar["id"]}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_operations_role_cannot_access(self):
        client2 = APIClient()
        User.objects.create_user(username="ops_acc_ops", email="ops_acc_ops@test.local", password="pass12345", role="OPERATIONS")
        res = client2.post("/api/auth/login/", {"username": "ops_acc_ops", "password": "pass12345"})
        client2.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        res = client2.get("/api/operations/pending/")
        self.assertEqual(res.status_code, 403)


class ExpenseVoucherEnhancementsTests(ExpenseAndCustodySetupMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="ex_enh_user", email="ex_enh_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "ex_enh_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self._setup_accounts()
        self.vat_account = self.client.post("/api/accounts-coa/", {"code": "1040", "name": "VAT Recoverable", "type": "asset", "nature": "debit"}).data

    def test_expense_with_currency_and_exchange_rate(self):
        res = self.client.post("/api/expenses/", {
            "date": "2026-09-17", "category": "Travel", "amount": "100.00", "payment_method": "cash",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"], "description": "USD expense",
            "currency": "USD", "exchange_rate": "48.50",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["currency"], "USD")
        self.assertEqual(res.data["exchange_rate"], "48.5000")

    def test_expense_with_booking_reference(self):
        res = self.client.post("/api/expenses/", {
            "date": "2026-09-17", "category": "Travel", "amount": "500.00", "payment_method": "cash",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"], "description": "Linked expense",
            "booking_reference": "FL-1234",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["booking_reference"], "FL-1234")

    def test_expense_with_attachment(self):
        res = self.client.post("/api/expenses/", {
            "date": "2026-09-17", "category": "Travel", "amount": "200.00", "payment_method": "cash",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"], "description": "With receipt",
            "attachment_name": "receipt.jpg", "attachment_data": "data:image/jpeg;base64,ABC123",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["attachment_name"], "receipt.jpg")

    def test_expense_vat_posts_to_separate_account(self):
        create_res = self.client.post("/api/expenses/", {
            "date": "2026-09-17", "category": "Travel", "amount": "1000.00", "payment_method": "cash",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"], "description": "With VAT",
            "vat_amount": "140.00", "vat_account": self.vat_account["id"],
        }, format="json")
        eid = create_res.data["id"]
        self.client.post(f"/api/expenses/{eid}/submit/")
        self.client.post(f"/api/expenses/{eid}/approve/")
        res = self.client.post(f"/api/expenses/{eid}/post_expense/")
        self.assertEqual(res.status_code, 200)

        cash_after = self.client.get(f"/api/accounts-coa/{self.cash['id']}/").data
        vat_after = self.client.get(f"/api/accounts-coa/{self.vat_account['id']}/").data
        expense_after = self.client.get(f"/api/accounts-coa/{self.expense_acc['id']}/").data
        self.assertEqual(cash_after["balance"], "-1140.00")
        self.assertEqual(vat_after["balance"], "140.00")
        self.assertEqual(expense_after["balance"], "1000.00")

    def test_vat_amount_without_vat_account_rejected_at_posting(self):
        create_res = self.client.post("/api/expenses/", {
            "date": "2026-09-17", "category": "Travel", "amount": "1000.00", "payment_method": "cash",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"], "description": "Bad VAT",
            "vat_amount": "140.00",
        }, format="json")
        eid = create_res.data["id"]
        self.client.post(f"/api/expenses/{eid}/submit/")
        self.client.post(f"/api/expenses/{eid}/approve/")
        res = self.client.post(f"/api/expenses/{eid}/post_expense/")
        self.assertEqual(res.status_code, 400)

    def test_confirm_and_post_skips_manual_steps(self):
        create_res = self.client.post("/api/expenses/", {
            "date": "2026-09-17", "category": "Rent", "amount": "500.00", "payment_method": "cash",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"], "description": "Quick expense",
        }, format="json")
        eid = create_res.data["id"]
        res = self.client.post(f"/api/expenses/{eid}/confirm_and_post/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "posted")

        cash_after = self.client.get(f"/api/accounts-coa/{self.cash['id']}/").data
        self.assertEqual(cash_after["balance"], "-500.00")

    def test_confirm_and_post_rejects_non_draft(self):
        create_res = self.client.post("/api/expenses/", {
            "date": "2026-09-17", "category": "Rent", "amount": "500.00", "payment_method": "cash",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"], "description": "Quick expense",
        }, format="json")
        eid = create_res.data["id"]
        self.client.post(f"/api/expenses/{eid}/submit/")
        res = self.client.post(f"/api/expenses/{eid}/confirm_and_post/")
        self.assertEqual(res.status_code, 400)


class CustodyEnhancementsTests(ExpenseAndCustodySetupMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="cus_enh_user", email="cus_enh_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "cus_enh_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self._setup_accounts()
        self.employee = User.objects.create_user(username="cus_enh_emp", email="cus_enh_emp@test.local", password="pass12345", role="OPERATIONS")

    def test_custody_with_currency_and_due_date(self):
        res = self.client.post("/api/custody/", {
            "date": "2026-09-17", "employee": self.employee.id, "amount": "5000.00",
            "treasury_account": self.cash["id"], "custody_account": self.custody_acc["id"], "description": "Umrah trip",
            "currency": "SAR", "due_date": "2026-10-01",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["currency"], "SAR")
        self.assertEqual(res.data["due_date"], "2026-10-01")


class RecurringExpenseTemplateTests(ExpenseAndCustodySetupMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="rec_exp_user", email="rec_exp_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "rec_exp_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self._setup_accounts()

    def test_create_template(self):
        res = self.client.post("/api/recurring-expenses/", {
            "name": "Office Rent", "category": "Rent", "default_amount": "15000.00",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"],
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data["is_active"])

    def test_post_month_generates_posted_vouchers(self):
        rent = self.client.post("/api/recurring-expenses/", {
            "name": "Office Rent", "category": "Rent", "default_amount": "15000.00",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"],
        }, format="json").data
        internet = self.client.post("/api/recurring-expenses/", {
            "name": "Internet", "category": "Utilities", "default_amount": "500.00",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"],
        }, format="json").data

        res = self.client.post("/api/recurring-expenses/post_month/", {
            "lines": [
                {"template_id": rent["id"], "amount": "15000.00", "date": "2026-09-17"},
                {"template_id": internet["id"], "amount": "620.00", "date": "2026-09-17"},
            ],
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["posted_count"], 2)

        cash_after = self.client.get(f"/api/accounts-coa/{self.cash['id']}/").data
        self.assertEqual(cash_after["balance"], "-15620.00")

        expenses = self.client.get("/api/expenses/").data["results"]
        rent_expense = next(e for e in expenses if e["description"] == "Recurring: Office Rent")
        self.assertEqual(rent_expense["status"], "posted")
        self.assertEqual(rent_expense["amount"], "15000.00")

    def test_post_month_with_inactive_template_rejected(self):
        template = self.client.post("/api/recurring-expenses/", {
            "name": "Old Subscription", "category": "Software", "default_amount": "200.00",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"], "is_active": False,
        }, format="json").data

        res = self.client.post("/api/recurring-expenses/post_month/", {
            "lines": [{"template_id": template["id"], "amount": "200.00"}],
        }, format="json")
        self.assertEqual(res.status_code, 400)

    def test_post_month_with_zero_amount_rejected(self):
        template = self.client.post("/api/recurring-expenses/", {
            "name": "Rent", "category": "Rent", "default_amount": "15000.00",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"],
        }, format="json").data

        res = self.client.post("/api/recurring-expenses/post_month/", {
            "lines": [{"template_id": template["id"], "amount": "0"}],
        }, format="json")
        self.assertEqual(res.status_code, 400)

    def test_active_only_filter(self):
        self.client.post("/api/recurring-expenses/", {
            "name": "Active One", "category": "Rent", "default_amount": "1000.00",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"],
        }, format="json")
        self.client.post("/api/recurring-expenses/", {
            "name": "Inactive One", "category": "Rent", "default_amount": "500.00",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"], "is_active": False,
        }, format="json")

        res = self.client.get("/api/recurring-expenses/?active_only=true")
        names = [t["name"] for t in res.data["results"]]
        self.assertIn("Active One", names)
        self.assertNotIn("Inactive One", names)

    def test_operations_role_cannot_access(self):
        client2 = APIClient()
        User.objects.create_user(username="rec_exp_ops", email="rec_exp_ops@test.local", password="pass12345", role="OPERATIONS")
        res = client2.post("/api/auth/login/", {"username": "rec_exp_ops", "password": "pass12345"})
        client2.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        res = client2.get("/api/recurring-expenses/")
        self.assertEqual(res.status_code, 403)


class PayrollBatchTests(ExpenseAndCustodySetupMixin, TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="payroll_user", email="payroll_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "payroll_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self._setup_accounts()

    def test_payroll_batch_posts_single_net_total(self):
        res = self.client.post("/api/recurring-expenses/post_payroll_batch/", {
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"],
            "lines": [
                {"employee_name": "Ahmed", "salary": "5000.00", "deduction": "200.00"},
                {"employee_name": "Sara", "salary": "4000.00", "deduction": "0.00"},
            ],
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["total_net"], "8800.00")

        cash_after = self.client.get(f"/api/accounts-coa/{self.cash['id']}/").data
        self.assertEqual(cash_after["balance"], "-8800.00")

    def test_payroll_batch_deduction_exceeding_salary_rejected(self):
        res = self.client.post("/api/recurring-expenses/post_payroll_batch/", {
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"],
            "lines": [{"employee_name": "Ahmed", "salary": "1000.00", "deduction": "2000.00"}],
        }, format="json")
        self.assertEqual(res.status_code, 400)

    def test_payroll_batch_requires_accounts(self):
        res = self.client.post("/api/recurring-expenses/post_payroll_batch/", {
            "lines": [{"employee_name": "Ahmed", "salary": "1000.00", "deduction": "0"}],
        }, format="json")
        self.assertEqual(res.status_code, 400)


class VoucherEnhancementsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="v_enh_user", email="v_enh_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "v_enh_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        self.cash = self.client.post("/api/accounts-coa/", {"code": "1010", "name": "Cash", "type": "asset", "nature": "debit"}).data
        self.ar_account = self.client.post("/api/accounts-coa/", {"code": "1030", "name": "AR", "type": "asset", "nature": "debit"}).data
        party_res = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "V Enh Customer", "phone": "01000000002"})
        self.party = party_res.data

    def test_voucher_with_all_new_fields(self):
        res = self.client.post("/api/vouchers/", {
            "type": "receipt", "date": "2026-09-18", "party": self.party["id"], "amount": "1000.00",
            "treasury_account": self.cash["id"], "party_control_account": self.ar_account["id"], "description": "Test",
            "payment_method": "instapay", "currency": "USD", "exchange_rate": "48.50",
            "booking_reference": "FL-5678", "transaction_reference": "TXN-99887",
            "attachment_name": "receipt.jpg", "attachment_data": "data:image/jpeg;base64,ABC",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["payment_method"], "instapay")
        self.assertEqual(res.data["currency"], "USD")
        self.assertEqual(res.data["booking_reference"], "FL-5678")
        self.assertEqual(res.data["attachment_name"], "receipt.jpg")


class VoucherBookingLinkTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="vbl_user", email="vbl_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "vbl_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

        self.cash = self.client.post("/api/accounts-coa/", {"code": "1010", "name": "Cash", "type": "asset", "nature": "debit"}).data
        self.ar_account = self.client.post("/api/accounts-coa/", {"code": "1030", "name": "AR", "type": "asset", "nature": "debit"}).data
        party_res = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "VBL Customer", "phone": "01000000003"})
        self.party = party_res.data

        booking_res = self.client.post("/api/bookings/", {
            "department": "flight", "date": "2026-09-18", "passenger_name": "VBL Customer",
            "net_rate": "8000.00", "selling_rate": "12000.00", "supplier": "Amadeus",
        })
        self.booking_id = booking_res.data["id"]

    def test_voucher_links_to_booking_via_fk(self):
        res = self.client.post("/api/vouchers/", {
            "type": "receipt", "date": "2026-09-18", "party": self.party["id"], "amount": "5000.00",
            "treasury_account": self.cash["id"], "party_control_account": self.ar_account["id"],
            "description": "Deposit", "booking": self.booking_id,
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["booking"], self.booking_id)

    def test_payment_summary_reflects_posted_vouchers(self):
        voucher_res = self.client.post("/api/vouchers/", {
            "type": "receipt", "date": "2026-09-18", "party": self.party["id"], "amount": "5000.00",
            "treasury_account": self.cash["id"], "party_control_account": self.ar_account["id"],
            "description": "Deposit", "booking": self.booking_id,
        }, format="json")
        vid = voucher_res.data["id"]
        self.client.post(f"/api/vouchers/{vid}/submit/")
        self.client.post(f"/api/vouchers/{vid}/approve/")
        self.client.post(f"/api/vouchers/{vid}/post_voucher/")

        res = self.client.get(f"/api/bookings/{self.booking_id}/payment_summary/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["total_collected"], "5000.00")
        self.assertEqual(res.data["remaining"], "7000.00")
        self.assertEqual(res.data["collection_status"], "partial")
        self.assertEqual(len(res.data["vouchers"]), 1)

    def test_payment_summary_shows_paid_when_fully_collected(self):
        voucher_res = self.client.post("/api/vouchers/", {
            "type": "receipt", "date": "2026-09-18", "party": self.party["id"], "amount": "12000.00",
            "treasury_account": self.cash["id"], "party_control_account": self.ar_account["id"],
            "description": "Full payment", "booking": self.booking_id,
        }, format="json")
        vid = voucher_res.data["id"]
        self.client.post(f"/api/vouchers/{vid}/submit/")
        self.client.post(f"/api/vouchers/{vid}/approve/")
        self.client.post(f"/api/vouchers/{vid}/post_voucher/")

        res = self.client.get(f"/api/bookings/{self.booking_id}/payment_summary/")
        self.assertEqual(res.data["collection_status"], "paid")
        self.assertEqual(res.data["remaining"], "0.00")

    def test_payment_summary_with_no_vouchers_is_unpaid(self):
        res = self.client.get(f"/api/bookings/{self.booking_id}/payment_summary/")
        self.assertEqual(res.data["collection_status"], "unpaid")
        self.assertEqual(res.data["total_collected"], "0")


class BookingCancellationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="cancel_user", email="cancel_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "cancel_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

        self.ar = self.client.post("/api/accounts-coa/", {"code": "1030", "name": "AR", "type": "asset", "nature": "debit"}).data
        self.revenue = self.client.post("/api/accounts-coa/", {"code": "4010", "name": "Sales Revenue", "type": "revenue", "nature": "credit"}).data
        self.cogs = self.client.post("/api/accounts-coa/", {"code": "5020", "name": "COGS", "type": "expense", "nature": "debit"}).data
        self.ap = self.client.post("/api/accounts-coa/", {"code": "2010", "name": "AP", "type": "liability", "nature": "credit"}).data

        booking_res = self.client.post("/api/bookings/", {
            "department": "flight", "date": "2026-09-18", "passenger_name": "Cancel Test",
            "net_rate": "10000.00", "selling_rate": "15000.00", "supplier": "Amadeus",
        })
        self.booking_id = booking_res.data["id"]
        self.client.post(f"/api/bookings/{self.booking_id}/confirm/")
        self.client.post(f"/api/operations/{self.booking_id}/approve/", {
            "ar_account": self.ar["id"], "revenue_account": self.revenue["id"],
            "cogs_account": self.cogs["id"], "ap_account": self.ap["id"],
        }, format="json")

    def test_cancel_reverses_all_balances_to_zero(self):
        res = self.client.post(f"/api/operations/{self.booking_id}/cancel/", {"reason": "Client cancelled"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["accounting_status"], "pending")

        ar_after = self.client.get(f"/api/accounts-coa/{self.ar['id']}/").data
        revenue_after = self.client.get(f"/api/accounts-coa/{self.revenue['id']}/").data
        cogs_after = self.client.get(f"/api/accounts-coa/{self.cogs['id']}/").data
        ap_after = self.client.get(f"/api/accounts-coa/{self.ap['id']}/").data
        self.assertEqual(ar_after["balance"], "0.00")
        self.assertEqual(revenue_after["balance"], "0.00")
        self.assertEqual(cogs_after["balance"], "0.00")
        self.assertEqual(ap_after["balance"], "0.00")

    def test_cancel_sets_booking_status_cancelled(self):
        self.client.post(f"/api/operations/{self.booking_id}/cancel/", {"reason": "test"}, format="json")
        from bookings.models import Booking
        booking = Booking.objects.get(pk=self.booking_id)
        self.assertEqual(booking.record_status, "cancelled")

    def test_cannot_cancel_twice(self):
        self.client.post(f"/api/operations/{self.booking_id}/cancel/", {"reason": "first"}, format="json")
        res = self.client.post(f"/api/operations/{self.booking_id}/cancel/", {"reason": "second"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_cannot_cancel_unapproved_booking(self):
        booking_res = self.client.post("/api/bookings/", {
            "department": "hotel", "date": "2026-09-18", "passenger_name": "Not Approved",
            "net_rate": "1000.00", "selling_rate": "1500.00", "supplier": "Test",
        })
        res = self.client.post(f"/api/operations/{booking_res.data['id']}/cancel/", {"reason": "test"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_cancellation_logged_in_audit(self):
        self.client.post(f"/api/operations/{self.booking_id}/cancel/", {"reason": "Audit test"}, format="json")
        res = self.client.get("/api/reports/audit-log/?event_type=accounting_reversed")
        self.assertGreaterEqual(len(res.data["results"]), 1)

    def test_booking_reapprovable_after_cancellation_reversal(self):
        """
        After a clean reversal, accounting_status returns to pending,
        which is intentional: if the booking is later un-cancelled or
        re-confirmed, it can go through approval again -- this base
        reversal never leaves the booking in a locked, un-actionable state.
        """
        self.client.post(f"/api/operations/{self.booking_id}/cancel/", {"reason": "test"}, format="json")
        from bookings.models import Booking
        booking = Booking.objects.get(pk=self.booking_id)
        self.assertEqual(booking.accounting_status, "pending")


class BookingCancellationPenaltiesTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="penalty_user", email="penalty_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "penalty_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

        self.ar = self.client.post("/api/accounts-coa/", {"code": "1030", "name": "AR", "type": "asset", "nature": "debit"}).data
        self.revenue = self.client.post("/api/accounts-coa/", {"code": "4010", "name": "Sales Revenue", "type": "revenue", "nature": "credit"}).data
        self.cogs = self.client.post("/api/accounts-coa/", {"code": "5020", "name": "COGS", "type": "expense", "nature": "debit"}).data
        self.ap = self.client.post("/api/accounts-coa/", {"code": "2010", "name": "AP", "type": "liability", "nature": "credit"}).data
        self.penalty_expense = self.client.post("/api/accounts-coa/", {"code": "5900", "name": "Cancellation Penalty Expense", "type": "expense", "nature": "debit"}).data
        self.penalty_revenue = self.client.post("/api/accounts-coa/", {"code": "4020", "name": "Cancellation Fee Income", "type": "revenue", "nature": "credit"}).data

        booking_res = self.client.post("/api/bookings/", {
            "department": "flight", "date": "2026-09-18", "passenger_name": "Penalty Test",
            "net_rate": "10000.00", "selling_rate": "15000.00", "supplier": "Amadeus",
        })
        self.booking_id = booking_res.data["id"]
        self.client.post(f"/api/bookings/{self.booking_id}/confirm/")
        self.client.post(f"/api/operations/{self.booking_id}/approve/", {
            "ar_account": self.ar["id"], "revenue_account": self.revenue["id"],
            "cogs_account": self.cogs["id"], "ap_account": self.ap["id"],
        }, format="json")

    def test_cancel_with_supplier_penalty_only(self):
        res = self.client.post(f"/api/operations/{self.booking_id}/cancel/", {
            "reason": "Supplier fee", "supplier_penalty": "500.00", "supplier_penalty_account": self.penalty_expense["id"],
        }, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["net_company_gain_loss"], "-500.00")

        ap_after = self.client.get(f"/api/accounts-coa/{self.ap['id']}/").data
        expense_after = self.client.get(f"/api/accounts-coa/{self.penalty_expense['id']}/").data
        self.assertEqual(ap_after["balance"], "500.00")
        self.assertEqual(expense_after["balance"], "500.00")

    def test_cancel_with_client_penalty_only(self):
        res = self.client.post(f"/api/operations/{self.booking_id}/cancel/", {
            "reason": "Client fee", "client_penalty": "1000.00", "client_penalty_account": self.penalty_revenue["id"],
        }, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["net_company_gain_loss"], "1000.00")

        ar_after = self.client.get(f"/api/accounts-coa/{self.ar['id']}/").data
        revenue_after = self.client.get(f"/api/accounts-coa/{self.penalty_revenue['id']}/").data
        self.assertEqual(ar_after["balance"], "1000.00")
        self.assertEqual(revenue_after["balance"], "1000.00")

    def test_cancel_with_both_penalties(self):
        res = self.client.post(f"/api/operations/{self.booking_id}/cancel/", {
            "reason": "Both fees", "supplier_penalty": "500.00", "supplier_penalty_account": self.penalty_expense["id"],
            "client_penalty": "1000.00", "client_penalty_account": self.penalty_revenue["id"],
        }, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["net_company_gain_loss"], "500.00")

    def test_supplier_penalty_without_account_rejected(self):
        res = self.client.post(f"/api/operations/{self.booking_id}/cancel/", {
            "reason": "Missing account", "supplier_penalty": "500.00",
        }, format="json")
        self.assertEqual(res.status_code, 400)

    def test_net_refundable_reflects_collected_minus_client_penalty(self):
        voucher_res = self.client.post("/api/vouchers/", {
            "type": "receipt", "date": "2026-09-18", "party": self.client.post("/api/parties/", {
                "type": "customer", "client_category": "b2c", "full_name": "Penalty Customer", "phone": "01000000004",
            }).data["id"],
            "amount": "4000.00", "treasury_account": self.ar["id"], "party_control_account": self.ar["id"],
            "description": "Deposit", "booking": self.booking_id,
        }, format="json")
        vid = voucher_res.data["id"]
        self.client.post(f"/api/vouchers/{vid}/submit/")
        self.client.post(f"/api/vouchers/{vid}/approve/")
        self.client.post(f"/api/vouchers/{vid}/post_voucher/")

        res = self.client.post(f"/api/operations/{self.booking_id}/cancel/", {
            "reason": "test", "client_penalty": "1000.00", "client_penalty_account": self.penalty_revenue["id"],
        }, format="json")
        self.assertEqual(res.data["total_collected"], "4000.00")
        self.assertEqual(res.data["net_refundable"], "3000.00")


class BookingCancellationRefundVoucherTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="refund_user", email="refund_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "refund_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

        self.ar = self.client.post("/api/accounts-coa/", {"code": "1030", "name": "AR", "type": "asset", "nature": "debit"}).data
        self.revenue = self.client.post("/api/accounts-coa/", {"code": "4010", "name": "Sales Revenue", "type": "revenue", "nature": "credit"}).data
        self.cogs = self.client.post("/api/accounts-coa/", {"code": "5020", "name": "COGS", "type": "expense", "nature": "debit"}).data
        self.ap = self.client.post("/api/accounts-coa/", {"code": "2010", "name": "AP", "type": "liability", "nature": "credit"}).data
        self.cash = self.client.post("/api/accounts-coa/", {"code": "1010", "name": "Cash", "type": "asset", "nature": "debit"}).data
        self.penalty_revenue = self.client.post("/api/accounts-coa/", {"code": "4020", "name": "Cancellation Fee Income", "type": "revenue", "nature": "credit"}).data

        self.party = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "Refund Customer", "phone": "01000000005"}).data

        booking_res = self.client.post("/api/bookings/", {
            "department": "flight", "date": "2026-09-18", "passenger_name": "Refund Customer",
            "net_rate": "10000.00", "selling_rate": "15000.00", "supplier": "Amadeus",
        })
        self.booking_id = booking_res.data["id"]
        self.client.post(f"/api/bookings/{self.booking_id}/confirm/")
        self.client.post(f"/api/operations/{self.booking_id}/approve/", {
            "ar_account": self.ar["id"], "revenue_account": self.revenue["id"],
            "cogs_account": self.cogs["id"], "ap_account": self.ap["id"],
        }, format="json")

        voucher_res = self.client.post("/api/vouchers/", {
            "type": "receipt", "date": "2026-09-18", "party": self.party["id"], "amount": "5000.00",
            "treasury_account": self.cash["id"], "party_control_account": self.ar["id"],
            "description": "Deposit", "booking": self.booking_id,
        }, format="json")
        vid = voucher_res.data["id"]
        self.client.post(f"/api/vouchers/{vid}/submit/")
        self.client.post(f"/api/vouchers/{vid}/approve/")
        self.client.post(f"/api/vouchers/{vid}/post_voucher/")

    def test_cancel_generates_draft_refund_voucher(self):
        res = self.client.post(f"/api/operations/{self.booking_id}/cancel/", {"reason": "test"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertIsNotNone(res.data["refund_voucher_id"])
        self.assertEqual(res.data["net_refundable"], "5000.00")

        refund_voucher = self.client.get(f"/api/vouchers/{res.data['refund_voucher_id']}/").data
        self.assertEqual(refund_voucher["status"], "draft")
        self.assertEqual(refund_voucher["type"], "payment")
        self.assertEqual(refund_voucher["amount"], "5000.00")
        self.assertEqual(refund_voucher["booking"], self.booking_id)

    def test_refund_voucher_amount_reduced_by_client_penalty(self):
        res = self.client.post(f"/api/operations/{self.booking_id}/cancel/", {
            "reason": "test", "client_penalty": "1000.00", "client_penalty_account": self.penalty_revenue["id"],
        }, format="json")
        self.assertEqual(res.data["net_refundable"], "4000.00")
        refund_voucher = self.client.get(f"/api/vouchers/{res.data['refund_voucher_id']}/").data
        self.assertEqual(refund_voucher["amount"], "4000.00")

    def test_no_refund_voucher_when_nothing_was_collected(self):
        booking_res = self.client.post("/api/bookings/", {
            "department": "hotel", "date": "2026-09-18", "passenger_name": "No Payment",
            "net_rate": "1000.00", "selling_rate": "1500.00", "supplier": "Test",
        })
        bid = booking_res.data["id"]
        self.client.post(f"/api/bookings/{bid}/confirm/")
        self.client.post(f"/api/operations/{bid}/approve/", {
            "ar_account": self.ar["id"], "revenue_account": self.revenue["id"],
            "cogs_account": self.cogs["id"], "ap_account": self.ap["id"],
        }, format="json")

        res = self.client.post(f"/api/operations/{bid}/cancel/", {"reason": "test"}, format="json")
        self.assertIsNone(res.data["refund_voucher_id"])

    def test_refund_voucher_stays_draft_not_auto_posted(self):
        res = self.client.post(f"/api/operations/{self.booking_id}/cancel/", {"reason": "test"}, format="json")
        cash_after = self.client.get(f"/api/accounts-coa/{self.cash['id']}/").data
        # Cash was only credited once (the original deposit) -- the
        # refund voucher must not have posted itself and moved money
        # again on its own.
        self.assertEqual(cash_after["balance"], "5000.00")


class InvoiceAccountingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="inv_acc_user", email="inv_acc_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "inv_acc_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

        self.ar = self.client.post("/api/accounts-coa/", {"code": "1030", "name": "AR", "type": "asset", "nature": "debit"}).data
        self.revenue = self.client.post("/api/accounts-coa/", {"code": "4010", "name": "Sales Revenue", "type": "revenue", "nature": "credit"}).data
        self.party = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "Invoice Acc Customer", "phone": "01000000006"}).data

    def test_issue_requires_ar_and_revenue_accounts(self):
        create_res = self.client.post("/api/invoices/", {
            "date": "2026-09-18", "party": self.party["id"], "total_amount": "15000.00", "description": "Test",
        }, format="json")
        iid = create_res.data["id"]
        res = self.client.post(f"/api/invoices/{iid}/issue/")
        self.assertEqual(res.status_code, 400)

    def test_issue_generates_balanced_journal_entry(self):
        create_res = self.client.post("/api/invoices/", {
            "date": "2026-09-18", "party": self.party["id"], "total_amount": "15000.00", "description": "Test",
        }, format="json")
        iid = create_res.data["id"]
        res = self.client.post(f"/api/invoices/{iid}/issue/", {"ar_account": self.ar["id"], "revenue_account": self.revenue["id"]}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertIsNotNone(res.data["journal_entry"])

        ar_after = self.client.get(f"/api/accounts-coa/{self.ar['id']}/").data
        revenue_after = self.client.get(f"/api/accounts-coa/{self.revenue['id']}/").data
        self.assertEqual(ar_after["balance"], "15000.00")
        self.assertEqual(revenue_after["balance"], "15000.00")

    def test_credit_and_reissue_generates_reversing_entry(self):
        create_res = self.client.post("/api/invoices/", {
            "date": "2026-09-18", "party": self.party["id"], "total_amount": "20000.00", "description": "Original",
        }, format="json")
        iid = create_res.data["id"]
        self.client.post(f"/api/invoices/{iid}/issue/", {"ar_account": self.ar["id"], "revenue_account": self.revenue["id"]}, format="json")

        res = self.client.post(f"/api/invoices/{iid}/credit_and_reissue/", {"new_amount": "18000.00"}, format="json")
        self.assertEqual(res.status_code, 201)

        ar_after = self.client.get(f"/api/accounts-coa/{self.ar['id']}/").data
        revenue_after = self.client.get(f"/api/accounts-coa/{self.revenue['id']}/").data
        self.assertEqual(ar_after["balance"], "0.00")
        self.assertEqual(revenue_after["balance"], "0.00")


class MonthlyClosingChecklistTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="mc_check_user", email="mc_check_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "mc_check_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

        self.cash = self.client.post("/api/accounts-coa/", {"code": "1010", "name": "Cash", "type": "asset", "nature": "debit"}).data
        self.ar = self.client.post("/api/accounts-coa/", {"code": "1030", "name": "AR", "type": "asset", "nature": "debit"}).data
        self.revenue = self.client.post("/api/accounts-coa/", {"code": "4010", "name": "Sales Revenue", "type": "revenue", "nature": "credit"}).data
        self.expense_acc = self.client.post("/api/accounts-coa/", {"code": "5010", "name": "Expense", "type": "expense", "nature": "debit"}).data
        self.party = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "MC Check Customer", "phone": "01000000007"}).data

    def test_readiness_flags_draft_voucher(self):
        self.client.post("/api/vouchers/", {
            "type": "receipt", "date": "2026-09-18", "party": self.party["id"], "amount": "500.00",
            "treasury_account": self.cash["id"], "party_control_account": self.ar["id"], "description": "Draft voucher",
        }, format="json")

        period = self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 9}, format="json").data
        res = self.client.get(f"/api/financial-periods/{period['id']}/readiness_check/")
        self.assertEqual(res.data["draft_vouchers_count"], 1)
        self.assertFalse(res.data["ready_to_close"])

    def test_readiness_flags_draft_expense(self):
        self.client.post("/api/expenses/", {
            "date": "2026-09-18", "category": "Test", "amount": "300.00", "payment_method": "cash",
            "treasury_account": self.cash["id"], "expense_account": self.expense_acc["id"], "description": "Draft expense",
        }, format="json")

        period = self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 9}, format="json").data
        res = self.client.get(f"/api/financial-periods/{period['id']}/readiness_check/")
        self.assertEqual(res.data["draft_expenses_count"], 1)
        self.assertFalse(res.data["ready_to_close"])

    def test_readiness_flags_unpaid_invoice(self):
        invoice_res = self.client.post("/api/invoices/", {
            "date": "2026-09-18", "party": self.party["id"], "total_amount": "5000.00", "description": "Test",
        }, format="json")
        self.client.post(f"/api/invoices/{invoice_res.data['id']}/issue/", {"ar_account": self.ar["id"], "revenue_account": self.revenue["id"]}, format="json")

        period = self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 9}, format="json").data
        res = self.client.get(f"/api/financial-periods/{period['id']}/readiness_check/")
        self.assertEqual(res.data["unpaid_invoices_count"], 1)
        self.assertFalse(res.data["ready_to_close"])

    def test_readiness_clean_when_nothing_pending(self):
        period = self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 9}, format="json").data
        res = self.client.get(f"/api/financial-periods/{period['id']}/readiness_check/")
        self.assertTrue(res.data["ready_to_close"])

    def test_cannot_close_with_draft_voucher(self):
        self.client.post("/api/vouchers/", {
            "type": "receipt", "date": "2026-09-18", "party": self.party["id"], "amount": "500.00",
            "treasury_account": self.cash["id"], "party_control_account": self.ar["id"], "description": "Draft voucher",
        }, format="json")

        period = self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 9}, format="json").data
        res = self.client.post(f"/api/financial-periods/{period['id']}/close/")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["draft_vouchers_count"], 1)


class ARAPAgingReportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="aging_user", email="aging_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "aging_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

        self.cash = self.client.post("/api/accounts-coa/", {"code": "1010", "name": "Cash", "type": "asset", "nature": "debit"}).data
        self.ar = self.client.post("/api/accounts-coa/", {"code": "1030", "name": "AR", "type": "asset", "nature": "debit"}).data
        self.party = self.client.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "Aging Customer", "phone": "01000000008"}).data

    def test_aging_report_shows_outstanding_customer(self):
        voucher_res = self.client.post("/api/vouchers/", {
            "type": "payment", "date": "2026-09-18", "party": self.party["id"], "amount": "3000.00",
            "treasury_account": self.cash["id"], "party_control_account": self.ar["id"], "description": "test",
        }, format="json")
        vid = voucher_res.data["id"]
        self.client.post(f"/api/vouchers/{vid}/submit/")
        self.client.post(f"/api/vouchers/{vid}/approve/")
        self.client.post(f"/api/vouchers/{vid}/post_voucher/")

        res = self.client.get("/api/reports/ar-ap-aging/?type=customer")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["rows"]), 1)
        self.assertEqual(res.data["rows"][0]["bucket"], "0-30")

    def test_aging_report_excludes_zero_balance_parties(self):
        res = self.client.get("/api/reports/ar-ap-aging/?type=customer")
        party_ids = [r["party_id"] for r in res.data["rows"]]
        self.assertNotIn(self.party["id"], party_ids)

    def test_aging_report_operations_role_forbidden(self):
        client2 = APIClient()
        User.objects.create_user(username="aging_ops", email="aging_ops@test.local", password="pass12345", role="OPERATIONS")
        res = client2.post("/api/auth/login/", {"username": "aging_ops", "password": "pass12345"})
        client2.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
        res = client2.get("/api/reports/ar-ap-aging/")
        self.assertEqual(res.status_code, 403)


class ProfitLossComparisonTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="pl_cmp_user", email="pl_cmp_user@test.local", password="pass12345", role="ACCOUNTANT")
        res = self.client.post("/api/auth/login/", {"username": "pl_cmp_user", "password": "pass12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")

    def test_compare_with_previous_returns_none_when_previous_not_closed(self):
        res = self.client.get("/api/reports/profit-loss/?year=2026&month=9&compare_with_previous=true")
        self.assertIsNone(res.data["comparison"])

    def test_compare_with_previous_returns_closed_month_data(self):
        period = self.client.post("/api/financial-periods/open_period/", {"year": 2026, "month": 8}, format="json").data
        self.client.post(f"/api/financial-periods/{period['id']}/close/")

        res = self.client.get("/api/reports/profit-loss/?year=2026&month=9&compare_with_previous=true")
        self.assertIsNotNone(res.data["comparison"])
        self.assertEqual(res.data["comparison"]["year"], 2026)
        self.assertEqual(res.data["comparison"]["month"], 8)

    def test_no_comparison_key_populated_when_not_requested(self):
        res = self.client.get("/api/reports/profit-loss/?year=2026&month=9")
        self.assertIsNone(res.data["comparison"])
