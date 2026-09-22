from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import HotelViewSet

router = DefaultRouter()
router.register("hotels-directory", HotelViewSet, basename="hotel-directory")

urlpatterns = [
    path("", include(router.urls)),
]