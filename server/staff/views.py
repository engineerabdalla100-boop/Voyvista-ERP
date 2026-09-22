from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import StaffMember
from .serializers import StaffMemberSerializer


class StaffMemberViewSet(viewsets.ModelViewSet):
    queryset = StaffMember.objects.select_related("created_by")
    serializer_class = StaffMemberSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(name__icontains=search) | qs.filter(position__icontains=search)
        status_param = self.request.query_params.get("status")
        if status_param == "active":
            qs = qs.filter(end_date__isnull=True)
        elif status_param == "terminated":
            qs = qs.filter(end_date__isnull=False)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=["post"], url_path="end-contract")
    def end_contract(self, request, pk=None):
        member = self.get_object()
        end_date = request.data.get("end_date")
        if not end_date:
            return Response({"detail": "end_date is required."}, status=400)
        if end_date < member.start_date.isoformat():
            return Response({"detail": "End date cannot be before start date."}, status=400)
        member.end_date = end_date
        member.save(update_fields=["end_date"])
        return Response(StaffMemberSerializer(member).data)

    @action(detail=True, methods=["post"])
    def reactivate(self, request, pk=None):
        member = self.get_object()
        member.end_date = None
        member.save(update_fields=["end_date"])
        return Response(StaffMemberSerializer(member).data)