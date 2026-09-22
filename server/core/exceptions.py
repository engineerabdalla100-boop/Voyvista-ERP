from rest_framework.exceptions import NotAuthenticated, PermissionDenied
from rest_framework.views import exception_handler as drf_default_exception_handler

from .audit import log_event
from .base_models import AuditLog

def audit_logging_exception_handler(exc, context):
    response = drf_default_exception_handler(exc, context)

    if isinstance(exc, (PermissionDenied, NotAuthenticated)) and response is not None:
        request = context.get("request")
        actor = getattr(request, "user", None)
        if actor is not None and not actor.is_authenticated:
            actor = None
        log_event(
            AuditLog.EventType.ACCESS_DENIED,
            actor=actor,
            request=request,
            description=f"{request.method if request else '?'} {request.path if request else '?'}",
        )

    return response