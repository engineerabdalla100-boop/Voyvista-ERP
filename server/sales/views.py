from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import CommunicationLogEntry, CustomerNote, Quote, Sale, SalesSettings
from .serializers import (
    CommunicationLogEntrySerializer,
    CustomerNoteSerializer,
    QuoteSerializer,
    SaleSerializer,
    SalesSettingsSerializer,
)

CANCEL_ALLOWED_ROLES = {"ADMIN", "ACCOUNTANT"}


class CanCancelSale(BasePermission):
    def has_permission(self, request, view):
        if view.action != "destroy":
            return True
        return bool(request.user and request.user.is_authenticated and request.user.role in CANCEL_ALLOWED_ROLES)


class SaleViewSet(viewsets.ModelViewSet):
    queryset = Sale.objects.exclude(record_status=Sale.RecordStatus.CANCELLED).select_related("created_by")
    serializer_class = SaleSerializer
    permission_classes = [IsAuthenticated, CanCancelSale]

    def get_queryset(self):
        qs = super().get_queryset()
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(client_name__icontains=search) | qs.filter(code__icontains=search)
        department = self.request.query_params.get("department")
        if department:
            qs = qs.filter(department=department)
        payment_status = self.request.query_params.get("payment_status")
        if payment_status:
            qs = qs.filter(payment_status=payment_status)
        date_from = self.request.query_params.get("date_from")
        if date_from:
            qs = qs.filter(date__gte=date_from)
        date_to = self.request.query_params.get("date_to")
        if date_to:
            qs = qs.filter(date__lte=date_to)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.record_status = Sale.RecordStatus.CANCELLED
        instance.cancelled_by = request.user
        instance.cancelled_at = timezone.now()
        instance.save(update_fields=["record_status", "cancelled_by", "cancelled_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class QuoteViewSet(viewsets.ModelViewSet):
    queryset = Quote.objects.select_related("created_by")
    serializer_class = QuoteSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class CustomerNoteViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "head", "options"]
    queryset = CustomerNote.objects.select_related("created_by")
    serializer_class = CustomerNoteSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class CommunicationLogEntryViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "head", "options"]
    queryset = CommunicationLogEntry.objects.select_related("created_by")
    serializer_class = CommunicationLogEntrySerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class SalesSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(SalesSettingsSerializer(SalesSettings.load()).data)

    def put(self, request):
        settings_obj = SalesSettings.load()
        serializer = SalesSettingsSerializer(instance=settings_obj, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)