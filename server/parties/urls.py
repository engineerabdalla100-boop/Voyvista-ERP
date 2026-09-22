from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import PartyViewSet

router = DefaultRouter()
router.register("parties", PartyViewSet, basename="party")

urlpatterns = [
    path("", include(router.urls)),
]