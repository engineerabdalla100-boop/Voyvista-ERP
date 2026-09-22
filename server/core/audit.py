from .base_models import AuditLog


def get_client_ip(request):
    if request is None:
        return None

    from django.conf import settings

    if getattr(settings, "TRUSTED_PROXY", False):
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
        if forwarded:
            return forwarded.split(",")[0].strip()

    return request.META.get("REMOTE_ADDR")


def log_event(
    event_type, *, actor=None, request=None, entity_type="", entity_id=None,
    old_value=None, new_value=None, description="",
):
    return AuditLog.objects.create(
        event_type=event_type,
        actor=actor,
        ip_address=get_client_ip(request) if request else None,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        old_value=old_value,
        new_value=new_value,
        description=description,
    )