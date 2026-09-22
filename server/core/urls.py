from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AccountViewSet, ChangeRequestViewSet

router = DefaultRouter()
router.register("accounts", AccountViewSet, basename="account")
router.register("change-requests", ChangeRequestViewSet, basename="change-request")

urlpatterns = [
    path("api/", include(router.urls)),
    path("api/", include("users.urls")),
    path("api/", include("bookings.urls")),
    path("api/", include("staff.urls")),
    path("api/", include("parties.urls")),
    path("api/", include("accounting.urls")),
    path("api/", include("hotels_directory.urls")),
    path("api/", include("sales.urls")),
    path("api/", include("cars.urls")),
    path("api/", include("events.urls")),
    path("api/", include("guides.urls")),
    path("api/", include("dashboard.urls")),
]