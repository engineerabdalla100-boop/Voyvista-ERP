from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core"

    def ready(self):
        from . import registry
        from .serializers import AccountSerializer

        registry.register("account", model_path="core.Account", serializer_class=AccountSerializer)