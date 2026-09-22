import os

from django.conf import settings
from django.http import FileResponse, Http404
from django.urls import include, path, re_path
from rest_framework.routers import DefaultRouter

from .views import AccountViewSet, ChangeRequestViewSet

CLIENT_ROOT = os.path.join(settings.BASE_DIR.parent, "client")


def serve_client_file(request, path=""):
    """
    Serves the static frontend (client/ folder) directly from Django --
    login.html at the root, everything else at its own path. Kept
    intentionally simple (no WhiteNoise/Nginx yet) since the API and
    the frontend live on the same domain.
    """
    if not path:
        path = "login.html"
    full_path = os.path.normpath(os.path.join(CLIENT_ROOT, path))
    if not full_path.startswith(CLIENT_ROOT):
        raise Http404("Invalid path.")
    if not os.path.isfile(full_path):
        raise Http404("File not found.")
    return FileResponse(open(full_path, "rb"))

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

    # Frontend (client/ folder) served directly from the same domain.
    path("", serve_client_file, name="client-root"),
    re_path(r"^(?P<path>(?!api/).*)$", serve_client_file, name="client-files"),
]