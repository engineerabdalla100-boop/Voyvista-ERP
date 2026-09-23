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
    login.html at the root, everything else at its own path. Every page
    references its assets as "/client/assets/...", so a leading
    "client/" segment is stripped before resolving against CLIENT_ROOT
    (which already points at the client/ folder itself).
    """
    if not path:
        path = "login.html"
    if path.startswith("client/"):
        path = path[len("client/"):]
    full_path = os.path.normpath(os.path.join(CLIENT_ROOT, path))
    if not full_path.startswith(CLIENT_ROOT):
        raise Http404("Invalid path.")
    if not os.path.isfile(full_path):
        raise Http404("File not found.")

    content_type = "text/plain"
    if full_path.endswith(".html"):
        content_type = "text/html"
    elif full_path.endswith(".js"):
        content_type = "application/javascript"
    elif full_path.endswith(".css"):
        content_type = "text/css"
    elif full_path.endswith(".json"):
        content_type = "application/json"

    return FileResponse(open(full_path, "rb"), content_type=content_type)

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
    path("api/", include("sales_crm.urls")),
    path("api/", include("sales.urls")),
    path("api/", include("cars.urls")),
    path("api/", include("events.urls")),
    path("api/", include("guides.urls")),
    path("api/", include("dashboard.urls")),

    # Frontend (client/ folder) served directly from the same domain.
    path("", serve_client_file, name="client-root"),
    re_path(r"^(?P<path>(?!api/).*)$", serve_client_file, name="client-files"),
]