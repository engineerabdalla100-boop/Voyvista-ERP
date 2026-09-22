from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CarMovementViewSet, CarViewSet

router = DefaultRouter()
router.register("cars", CarViewSet, basename="car")
router.register("car-movements", CarMovementViewSet, basename="car-movement")

urlpatterns = [
    path("", include(router.urls)),
]