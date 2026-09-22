from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import StaffMemberViewSet

router = DefaultRouter()
router.register("staff", StaffMemberViewSet, basename="staff")

urlpatterns = [
    path("", include(router.urls)),
]