from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CurrentUserView, EmployeeViewSet, LoginView, LogoutView

router = DefaultRouter()
router.register("employees", EmployeeViewSet, basename="employee")

urlpatterns = [
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("auth/me/", CurrentUserView.as_view(), name="current-user"),
    path("", include(router.urls)),
]