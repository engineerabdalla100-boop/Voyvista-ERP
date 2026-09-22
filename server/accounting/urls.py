from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .reports import ar_ap_aging_report, audit_log_report, department_performance_report, ledger_report, profit_loss_report, trial_balance_report
from .views import AccountViewSet, BookingAccountingApprovalView, BookingCancellationView, CustodyViewSet, ExpenseVoucherViewSet, FinancialPeriodViewSet, InvoiceViewSet, JournalEntryViewSet, RecurringExpenseTemplateViewSet, VoucherViewSet

router = DefaultRouter()
router.register("accounts-coa", AccountViewSet, basename="account-coa")
router.register("journal-entries", JournalEntryViewSet, basename="journal-entry")
router.register("custody", CustodyViewSet, basename="custody")
router.register("expenses", ExpenseVoucherViewSet, basename="expense")
router.register("vouchers", VoucherViewSet, basename="voucher")
router.register("invoices", InvoiceViewSet, basename="invoice")
router.register("financial-periods", FinancialPeriodViewSet, basename="financial-period")
router.register("recurring-expenses", RecurringExpenseTemplateViewSet, basename="recurring-expense")

urlpatterns = [
    path("", include(router.urls)),
    path("reports/profit-loss/", profit_loss_report, name="report-profit-loss"),
    path("reports/department-performance/", department_performance_report, name="report-department-performance"),
    path("reports/ledger/", ledger_report, name="report-ledger"),
    path("reports/trial-balance/", trial_balance_report, name="report-trial-balance"),
    path("reports/audit-log/", audit_log_report, name="report-audit-log"),
    path("reports/ar-ap-aging/", ar_ap_aging_report, name="report-ar-ap-aging"),
    path("operations/pending/", BookingAccountingApprovalView.as_view(), name="operations-pending"),
    path("operations/<int:pk>/approve/", BookingAccountingApprovalView.as_view(), name="operations-approve"),
    path("operations/<int:pk>/cancel/", BookingCancellationView.as_view(), name="operations-cancel"),
]