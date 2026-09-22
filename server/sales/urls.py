from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CommunicationLogEntryViewSet,
    CustomerNoteViewSet,
    QuoteViewSet,
    SalesSettingsView,
    SaleViewSet,
)

router = DefaultRouter()
router.register("sales", SaleViewSet, basename="sale")
router.register("sales-quotes", QuoteViewSet, basename="sales-quote")
router.register("sales-customer-notes", CustomerNoteViewSet, basename="sales-customer-note")
router.register("sales-communication-log", CommunicationLogEntryViewSet, basename="sales-communication-log")

urlpatterns = [
    path("", include(router.urls)),
    path("sales-settings/", SalesSettingsView.as_view(), name="sales-settings"),
]