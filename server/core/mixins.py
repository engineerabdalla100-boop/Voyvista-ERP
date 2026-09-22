"""
core/mixins.py â€” Ø§Ù„Ù€Interceptor Mixin.

Ø£ÙŠ ViewSet ÙŠÙˆØ±Ø« Ù…Ù† MakerCheckerMixin Ø¨ÙŠØ§Ø®Ø¯ Ø§Ù„ØªÙˆØ¬ÙŠÙ‡ Ø§Ù„ØªÙ„Ù‚Ø§Ø¦ÙŠ Ø¹Ø¨Ø± Ù…Ø­Ø±Ùƒ
Ø§Ù„Ù€Maker-Checker Ù…Ø¬Ø§Ù†Ù‹Ø§ â€” ØµÙØ± ØªÙƒØ±Ø§Ø± ÙƒÙˆØ¯ Ù„ÙƒÙ„ Ù…ÙˆØ¯ÙŠÙˆÙ„ Ø¬Ø¯ÙŠØ¯. Ø§Ù„Ø·Ø±ÙŠÙ‚Ø©:

1. Ø§Ù„Ù€Serializer Ø¨ÙŠØ¹Ù…Ù„ Ø§Ù„Ù€validation Ø§Ù„Ø¹Ø§Ø¯ÙŠ Ø¨ØªØ§Ø¹Ù‡ØŒ Ø²ÙŠ Ø£ÙŠ DRF View â€”
   Ù…ÙÙŠØ´ ØªØ¯Ø®Ù„ Ù‡Ù†Ø§ Ø®Ø§Ù„Øµ.
2. Ø¨Ø¯Ù„ perform_create/perform_update ÙŠØ¹Ù…Ù„ÙˆØ§ serializer.save() Ù…Ø¨Ø§Ø´Ø±Ø©ØŒ
   Ø§Ù„Ù€Mixin Ø¨ÙŠØ¹ØªØ±Ø¶Ù‡Ù… ÙˆØ¨ÙŠØ¨Ø¹ØªÙˆØ§ Ø§Ù„Ø·Ù„Ø¨ Ù„Ù€MakerCheckerService.submit()
   Ø¨Ø¯Ù„ ÙƒØ¯Ù‡.
3. Ù„Ùˆ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… Ø¹Ù†Ø¯Ù‡ ØµÙ„Ø§Ø­ÙŠØ© ØªÙ†ÙÙŠØ° Ù…Ø¨Ø§Ø´Ø±ØŒ Ø§Ù„Ù€Serializer.save() Ù‡ÙŠØªÙ†ÙØ°
   ÙØ¹Ù„ÙŠÙ‹Ø§ Ø¬ÙˆÙ‡ apply_fnØŒ ÙˆØ±Ø¯ Ø§Ù„Ù€View Ù‡ÙŠÙØ¶Ù„ 201/200 Ø¹Ø§Ø¯ÙŠ.
4. ØºÙŠØ± ÙƒØ¯Ù‡ØŒ Ù‡ÙŠØªØ±Ø¬Ø¹ 202 Accepted + ØªÙØ§ØµÙŠÙ„ Ø§Ù„Ù€ChangeRequestØŒ ÙˆØµÙØ± ØªØ¹Ø¯ÙŠÙ„
   ÙØ¹Ù„ÙŠ Ù‡ÙŠØ­ØµÙ„ Ø¹Ù„Ù‰ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ù‚ÙŠÙ‚ÙŠØ©.
"""

from rest_framework import status
from rest_framework.response import Response

from .base_models import ChangeRequest
from .services import MakerCheckerService, ProtectedFieldError


class MakerCheckerMixin:
    """
    Ø§Ù„Ø§Ø³ØªØ®Ø¯Ø§Ù…:
        class CompanyViewSet(MakerCheckerMixin, viewsets.ModelViewSet):
            entity_type = "company"   # Ù„Ø§Ø²Ù… ÙŠØ·Ø§Ø¨Ù‚ ØªØ³Ø¬ÙŠÙ„ ÙÙŠ core/registry.py
            queryset = Company.objects.all()
            serializer_class = CompanySerializer
    """

    entity_type = None

    def _require_entity_type(self):
        if not self.entity_type:
            raise NotImplementedError(f"{self.__class__.__name__} Ù„Ø§Ø²Ù… ÙŠØ­Ø¯Ø¯ entity_type Ù„Ø§Ø³ØªØ®Ø¯Ø§Ù… MakerCheckerMixin.")

    def get_create_extra_kwargs(self):
        """
        Hook Ù‚Ø§Ø¨Ù„ Ù„Ù„Ù€Override â€” Ø£ÙŠ Ø­Ù‚Ù„ Ù„Ø§Ø²Ù… ÙŠØªØ­Ø¯Ø¯ Ù…Ù† request.user (Ø²ÙŠ
        created_by) Ø¨Ø¯Ù„ Ù…Ø§ ÙŠÙˆØµÙ„ Ù…Ù† proposed_data (Ø§Ù„Ù„ÙŠ Ù…Ù…ÙƒÙ† Ø§Ù„Ø¹Ù…ÙŠÙ„
        ÙŠØ­Ø§ÙˆÙ„ ÙŠØ²ÙˆÙ‘Ø±Ù‡Ø§). Ø§Ù„Ù€Default ÙØ§Ø¶ÙŠØŒ Ù…Ø´ ÙƒÙ„ Ù…ÙˆØ¯ÙŠÙˆÙ„ Ù…Ø­ØªØ§Ø¬Ù‡Ø§.
        """
        return {}

    def perform_create(self, serializer):
        self._require_entity_type()
        extra_kwargs = self.get_create_extra_kwargs()

        def apply_fn():
            serializer.save(**extra_kwargs)

        self._change_request = MakerCheckerService.submit(
            user=self.request.user,
            entity_type=self.entity_type,
            entity_id=None,
            proposed_data=self.request.data,
            apply_fn=apply_fn,
            request=self.request,
        )

    def perform_update(self, serializer):
        self._require_entity_type()
        instance = serializer.instance

        def apply_fn():
            serializer.save()

        self._change_request = MakerCheckerService.submit(
            user=self.request.user,
            entity_type=self.entity_type,
            entity_id=instance.pk,
            proposed_data=self.request.data,
            apply_fn=apply_fn,
            request=self.request,
            # Ù†Ø³Ø®Ø© Ø§Ù„Ù€Target Ø§Ù„Ø­Ø§Ù„ÙŠØ© ÙˆÙ‚Øª Ø§Ù„ØªÙ‚Ø¯ÙŠÙ… â€” core/services.py Ù‡ÙŠÙ‚Ø§Ø±Ù†
            # Ø¨ÙŠÙ‡Ø§ ÙˆÙ‚Øª Ø§Ù„Ù€approve Ù„Ø§ÙƒØªØ´Ø§Ù Ù„Ùˆ Ø­Ø¯ Ø¹Ø¯Ù‘Ù„ Ø§Ù„Ø³Ø¬Ù„ ÙÙŠ Ø§Ù„ÙØªØ±Ø©
            # Ø¨ÙŠÙ† Ø§Ù„ØªÙ‚Ø¯ÙŠÙ… ÙˆØ§Ù„Ù…ÙˆØ§ÙÙ‚Ø© (Stale Request Protection). Ù„Ùˆ
            # Ø§Ù„Ù…ÙˆØ¯ÙŠÙ„ Ù…Ø§Ù„ÙˆØ´ Ø­Ù‚Ù„ version Ø®Ø§Ù„ØµØŒ Ø¨ÙŠØ±Ø¬Ø¹ None ÙˆØ¯Ù‡ ÙŠØ¹Ø·Ù‘Ù„
            # Ø§Ù„ÙØ­Øµ Ø¯Ù‡ ØªÙ„Ù‚Ø§Ø¦ÙŠÙ‹Ø§ (Graceful Degradation)ØŒ Ù…Ø´ ÙŠÙ…Ù†Ø¹Ù‡.
            target_version=getattr(instance, "version", None),
        )

    def perform_destroy(self, instance):
        self._require_entity_type()
        entity_id = instance.pk

        def apply_fn():
            instance.delete()

        self._change_request = MakerCheckerService.submit(
            user=self.request.user,
            entity_type=self.entity_type,
            entity_id=entity_id,
            proposed_data={"_action": "delete"},
            apply_fn=apply_fn,
            request=self.request,
            target_version=getattr(instance, "version", None),
        )

    def _maybe_pending_response(self, response):
        """
        Ø¨ØªØªÙ†Ø§Ø¯Ù‰ Ù…Ù† create()/update()/destroy() Ø¨Ø¹Ø¯ Ø§Ù„Ù€super() â€”
        Ù„Ùˆ Ø§Ù„Ø·Ù„Ø¨ ÙØ¶Ù„ PENDING (Ø§ØªØ³Ø¬Ù‘Ù„ Ø¨Ø³ØŒ Ù…Ø§ØªÙ†ÙÙ‘Ø°Ø´)ØŒ Ø¨Ù†Ø¨Ø¯Ù‘Ù„ Ø§Ù„Ø±Ø¯ Ù„Ù€
        202 Accepted Ø¨Ø¯Ù„ 201/200/204 Ø§Ù„Ø§ÙØªØ±Ø§Ø¶ÙŠØ©ØŒ ÙˆÙ†Ø±Ø¬Ù‘Ø¹ ØªÙØ§ØµÙŠÙ„
        Ø§Ù„Ù€ChangeRequest Ø¨Ø¯Ù„ Ø¨ÙŠØ§Ù†Ø§Øª ÙƒØ§Ø¦Ù† Ù…Ø´ Ù…ÙˆØ¬ÙˆØ¯ ÙØ¹Ù„ÙŠÙ‹Ø§ Ù„Ø³Ù‡.
        """
        change_request = getattr(self, "_change_request", None)
        if change_request and change_request.status == ChangeRequest.Status.PENDING:
            return Response(
                {
                    "detail": "ØªÙ… Ø¥Ø±Ø³Ø§Ù„ Ø§Ù„Ø·Ù„Ø¨ â€” Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø§Ø¹ØªÙ…Ø§Ø¯ ØµØ§Ø­Ø¨ ØµÙ„Ø§Ø­ÙŠØ©.",
                    "change_request_id": change_request.id,
                    "status": change_request.status,
                },
                status=status.HTTP_202_ACCEPTED,
            )
        return response

    def _run_maker_checker_action(self, super_call, *args, **kwargs):
        """
        Ø¨ØªÙ„Ù super().create()/update()/destroy() â€” Ù„Ùˆ submit() Ø±Ù…Øª
        ProtectedFieldError (Payload Ø¨ØªØ­Ø§ÙˆÙ„ ØªÙ„Ù…Ø³ Ø­Ù‚ÙˆÙ„ Ù…Ø­Ù…ÙŠØ©) Ø£Ùˆ
        ValueError Ø¹Ø§Ù…Ø©ØŒ Ø¨ØªØ±Ø¬Ø¹ 400 Ù†Ø¸ÙŠÙ Ø¨Ø¯Ù„ Ù…Ø§ ØªØ³ÙŠØ¨ Ø§Ù„Ù€Exception
        ØªÙ†ÙØ¬Ø± Ù„Ø­Ø¯ Ø§Ù„Ù€Server Ù†ÙØ³Ù‡ (500). Ø§ØªÙƒØ´ÙØª Ø§Ù„Ø­Ø§Ø¬Ø© Ù„Ù„ÙØ­Øµ Ø¯Ù‡ Ø¨Ø§Ù„ÙØ¹Ù„
        Ø¨Ø§Ù„Ø§Ø®ØªØ¨Ø§Ø± â€” Ù‚Ø¨Ù„ Ø§Ù„Ø¥ØµÙ„Ø§Ø­ØŒ Ø­Ù‚Ù† status/maker/checker ÙÙŠ Ø§Ù„Ù€Payload
        ÙƒØ§Ù† Ø¨ÙŠØªØ³Ø¨Ø¨ ÙÙŠ 500 Internal Server Error Ù…Ø´ Ø±Ø¯ HTTP ÙˆØ§Ø¶Ø­.
        """
        try:
            return super_call(*args, **kwargs)
        except ProtectedFieldError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    def create(self, request, *args, **kwargs):
        response = self._run_maker_checker_action(super().create, request, *args, **kwargs)
        return self._maybe_pending_response(response)

    def update(self, request, *args, **kwargs):
        response = self._run_maker_checker_action(super().update, request, *args, **kwargs)
        return self._maybe_pending_response(response)

    def destroy(self, request, *args, **kwargs):
        response = self._run_maker_checker_action(super().destroy, request, *args, **kwargs)
        return self._maybe_pending_response(response)
