import csv
import json
from collections import defaultdict
from datetime import datetime

from django.core.serializers.json import DjangoJSONEncoder
from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import Booking
from core.base_models import AuditLog
from users.models import User

from .models import Broadcast, CompanySettings, OwnerFile
from .serializers import BroadcastSerializer, CompanySettingsSerializer, OwnerFileSerializer


class IsAdminRole(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == User.Role.ADMIN)


class IsOwnerOrAdminRole(BasePermission):
    message = "Only Owner and Admin can access this."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role in {User.Role.OWNER, User.Role.ADMIN})


class IsBackupRole(BasePermission):
    message = "Only IT, Owner, and Admin can export a full database backup."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role in {User.Role.ADMIN, User.Role.OWNER, User.Role.IT})


class BroadcastView(APIView):
    def get_permissions(self):
        if self.request.method == "GET":
            return [IsAuthenticated()]
        return [IsAdminRole()]

    def get(self, request):
        broadcast = Broadcast.objects.filter(pk=1).first()
        if not broadcast:
            return Response(None)
        return Response(BroadcastSerializer(broadcast).data)

    def post(self, request):
        existing = Broadcast.objects.filter(pk=1).first()
        serializer = BroadcastSerializer(instance=existing, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(posted_by=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def delete(self, request):
        Broadcast.objects.filter(pk=1).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CompanySettingsView(APIView):
    def get_permissions(self):
        if self.request.method == "GET":
            return [IsAuthenticated()]
        return [IsAdminRole()]

    def get(self, request):
        return Response(CompanySettingsSerializer(CompanySettings.load()).data)

    def patch(self, request):
        settings_obj = CompanySettings.load()
        serializer = CompanySettingsSerializer(instance=settings_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response(serializer.data)


class OwnerFileViewSet(viewsets.ModelViewSet):
    serializer_class = OwnerFileSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return OwnerFile.objects.filter(uploaded_by=self.request.user)

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)


class DashboardOverviewView(APIView):
    permission_classes = [IsOwnerOrAdminRole]

    def get(self, request):
        active_bookings = Booking.objects.filter(record_status=Booking.RecordStatus.ACTIVE)

        totals_by_currency = defaultdict(lambda: {"revenue": 0, "profit": 0})
        by_department = {}

        for dept_key, _ in Booking.Department.choices:
            dept_qs = active_bookings.filter(department=dept_key)
            dept_totals = defaultdict(lambda: {"revenue": 0, "profit": 0})
            for booking in dept_qs:
                dept_totals[booking.currency]["revenue"] += booking.selling_rate
                dept_totals[booking.currency]["profit"] += booking.profit
                totals_by_currency[booking.currency]["revenue"] += booking.selling_rate
                totals_by_currency[booking.currency]["profit"] += booking.profit
            by_department[dept_key] = {
                "count": dept_qs.count(),
                "totals_by_currency": {k: {"revenue": str(v["revenue"]), "profit": str(v["profit"])} for k, v in dept_totals.items()},
            }

        recent = active_bookings.order_by("-created_at")[:10]
        recent_data = [
            {
                "id": b.id, "department": b.department, "customer_name": b.customer_name,
                "date": b.date, "selling_rate": str(b.selling_rate), "currency": b.currency,
            }
            for b in recent
        ]

        return Response({
            "total_bookings": active_bookings.count(),
            "totals_by_currency": {k: {"revenue": str(v["revenue"]), "profit": str(v["profit"])} for k, v in totals_by_currency.items()},
            "by_department": by_department,
            "recent_bookings": recent_data,
        })


class AuditLogExportView(APIView):
    permission_classes = [IsAdminRole]

    def get(self, request):
        qs = AuditLog.objects.select_related("actor").all()

        event_type = request.query_params.get("event_type")
        if event_type:
            qs = qs.filter(event_type=event_type)

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="Voyvista-Audit-Log.csv"'
        response.write("\ufeff")

        writer = csv.writer(response)
        writer.writerow(["Date", "Actor", "Event Type", "Entity", "Entity ID", "Description", "IP Address"])
        for entry in qs.iterator():
            writer.writerow([
                entry.created_at.isoformat(), entry.actor.username if entry.actor else "-",
                entry.get_event_type_display(), entry.entity_type or "-", entry.entity_id or "-",
                entry.description, entry.ip_address or "-",
            ])
        return response

class FullBackupView(APIView):
    permission_classes = [IsBackupRole]

    def get(self, request):
        from django.core import serializers as django_serializers

        from bookings.models import Booking
        from cars.models import Car, CarMovement
        from events.models import Event, EventCompany, EventTeamMember, ExpenseItem
        from guides.models import Guide
        from parties.models import Party, PartyContactNumber, PartySocialLink
        from staff.models import StaffMember
        from users.models import User

        models_to_export = [
            ("users", User.objects.all()),
            ("bookings", Booking.objects.all()),
            ("staff", StaffMember.objects.all()),
            ("events", Event.objects.all()),
            ("event_expense_items", ExpenseItem.objects.all()),
            ("event_companies", EventCompany.objects.all()),
            ("event_team_members", EventTeamMember.objects.all()),
            ("parties", Party.objects.all()),
            ("party_contact_numbers", PartyContactNumber.objects.all()),
            ("party_social_links", PartySocialLink.objects.all()),
            ("cars", Car.objects.all()),
            ("car_movements", CarMovement.objects.all()),
            ("guides", Guide.objects.all()),
        ]

        backup = {
            "generated_at": datetime.now().isoformat(),
            "generated_by": request.user.username,
        }
        for label, queryset in models_to_export:
            backup[label] = json.loads(django_serializers.serialize("json", queryset))

        payload = json.dumps(backup, indent=2, cls=DjangoJSONEncoder, ensure_ascii=False)
        filename = f"Voyvista-Backup-{datetime.now().strftime('%Y-%m-%d_%H%M')}.json"
        response = HttpResponse(payload, content_type="application/json")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response
