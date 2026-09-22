from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AuditLogExportView, BroadcastView, CompanySettingsView, DashboardOverviewView, FullBackupView, OwnerFileViewSet

router = DefaultRouter()
router.register("owner-files", OwnerFileViewSet, basename="owner-file")

urlpatterns = [
    path("", include(router.urls)),
    path("broadcast/", BroadcastView.as_view(), name="broadcast"),
    path("company-settings/", CompanySettingsView.as_view(), name="company-settings"),
    path("dashboard-overview/", DashboardOverviewView.as_view(), name="dashboard-overview"),
    path("audit-log/export/", AuditLogExportView.as_view(), name="audit-log-export"),
    path("backup/full/", FullBackupView.as_view(), name="full-backup"),
]