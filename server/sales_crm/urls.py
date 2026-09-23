from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ActivityViewSet, DealViewSet

router = DefaultRouter()
router.register("deals", DealViewSet, basename="deal")
router.register("activities", ActivityViewSet, basename="activity")

urlpatterns = [
    path("", include(router.urls)),
]