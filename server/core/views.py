from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .mixins import MakerCheckerMixin
from .base_models import Account, ChangeRequest
from .permissions import CanReviewChangeRequests
from .serializers import AccountSerializer, ChangeRequestSerializer, RejectChangeRequestSerializer
from .services import MakerCheckerService


class AccountViewSet(MakerCheckerMixin, viewsets.ModelViewSet):
    queryset = Account.objects.all()
    serializer_class = AccountSerializer
    permission_classes = [IsAuthenticated]
    entity_type = "account"


class ChangeRequestViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ChangeRequest.objects.select_related("maker", "checker").all()
    serializer_class = ChangeRequestSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        return qs

    def get_permissions(self):
        if self.action in ("approve", "reject"):
            return [IsAuthenticated(), CanReviewChangeRequests()]
        return super().get_permissions()

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        change_request = self.get_object()
        self.check_object_permissions(request, change_request)

        try:
            updated = MakerCheckerService.approve(change_request.id, checker=request.user, request=request)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            from .services import StaleChangeRequestError
            code = status.HTTP_409_CONFLICT if isinstance(exc, StaleChangeRequestError) else status.HTTP_400_BAD_REQUEST
            return Response({"detail": str(exc)}, status=code)

        return Response(ChangeRequestSerializer(updated).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        change_request = self.get_object()
        self.check_object_permissions(request, change_request)

        serializer = RejectChangeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            updated = MakerCheckerService.reject(
                change_request.id, checker=request.user, reason=serializer.validated_data["reason"], request=request,
            )
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(ChangeRequestSerializer(updated).data)