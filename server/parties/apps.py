from django.apps import AppConfig


class PartiesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "parties"

    def ready(self):
        from core import registry

        from .serializers import PartySerializer

        registry.register(
            "party",
            model_path="parties.Party",
            serializer_class=PartySerializer,
            extra_apply_kwargs_fn=lambda change_request: {"created_by": change_request.maker},
        )