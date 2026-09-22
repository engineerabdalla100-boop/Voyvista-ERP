from rest_framework import permissions, status, viewsets
from rest_framework.response import Response
from core.base_models import ChangeRequest
from .models import Company
from .serializers import CompanySerializer


class CompanyViewSet(viewsets.ModelViewSet):
    queryset = Company.objects.all()
    serializer_class = CompanySerializer
    permission_classes = [permissions.IsAuthenticated]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        ChangeRequest.objects.create(
            maker=request.user,
            target_model="Company",
            action_type=ChangeRequest.ActionType.CREATE,
            payload=serializer.validated_data,
        )

        return Response(
            {"message": "Company creation request submitted for admin approval."},
            status=status.HTTP_202_ACCEPTED,
        )

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(
            instance, data=request.data, partial=kwargs.get("partial", False)
        )
        serializer.is_valid(raise_exception=True)

        ChangeRequest.objects.create(
            maker=request.user,
            target_model="Company",
            target_object_id=str(instance.id),
            action_type=ChangeRequest.ActionType.UPDATE,
            payload=serializer.validated_data,
        )

        return Response(
            {"message": "Company update request submitted for admin approval."},
            status=status.HTTP_202_ACCEPTED,
        )