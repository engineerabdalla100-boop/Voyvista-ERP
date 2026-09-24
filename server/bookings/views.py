from decimal import Decimal

from django.db.models import F
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from users.models import User

from .models import Booking
from .serializers import BookingSerializer

CANCEL_ALLOWED_ROLES = {User.Role.ADMIN, User.Role.ACCOUNTANT}
DATA_ACC_ALLOWED_ROLES = {User.Role.ADMIN, User.Role.OWNER, User.Role.IT, User.Role.ACCOUNTANT}


class IsDataAccRole(BasePermission):
    message = "Only IT, Owner, ACC, and Admin can access the sales report."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role in DATA_ACC_ALLOWED_ROLES)


class BookingViewSet(viewsets.ModelViewSet):
    queryset = Booking.objects.select_related("created_by")
    serializer_class = BookingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        department = self.request.query_params.get("department")
        if department:
            qs = qs.filter(department=department)
        date_filter = self.request.query_params.get("date")
        if date_filter:
            qs = qs.filter(date=date_filter)
        booking_status = self.request.query_params.get("status")
        if booking_status:
            qs = qs.filter(status=booking_status)
        record_status = self.request.query_params.get("record_status")
        if record_status:
            qs = qs.filter(record_status=record_status)
        else:
            qs = qs.filter(record_status=Booking.RecordStatus.ACTIVE)
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(passenger_name__icontains=search) | qs.filter(file_number__icontains=search)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        expected_version = request.data.get("expected_version")
        if expected_version is not None and int(expected_version) != instance.version:
            return Response(
                {"detail": "This record was changed by someone else. Please reload and try again."},
                status=status.HTTP_409_CONFLICT,
            )
        response = super().update(request, *args, **kwargs)
        Booking.objects.filter(pk=instance.pk).update(version=F("version") + 1, updated_by=request.user)
        instance.refresh_from_db()
        response.data = BookingSerializer(instance).data
        return response

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if request.user.role not in CANCEL_ALLOWED_ROLES:
            raise PermissionDenied("Only ADMIN or ACCOUNTANT can cancel bookings.")
        instance.record_status = Booking.RecordStatus.CANCELLED
        instance.save(update_fields=["record_status"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["get"], url_path="file-numbers")
    def file_numbers(self, request):
        search = request.query_params.get("search", "").strip()
        qs = Booking.objects.exclude(file_number="").values_list("file_number", "passenger_name").distinct()
        if search:
            qs = qs.filter(file_number__icontains=search)
        results = {}
        for file_number, passenger_name in qs.order_by("file_number")[:20]:
            results.setdefault(file_number, []).append(passenger_name)
        return Response([{"file_number": fn, "names": names} for fn, names in results.items()])

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        booking = self.get_object()
        if booking.status != Booking.BookingStatus.PENDING:
            return Response({"detail": "This booking is not pending."}, status=status.HTTP_400_BAD_REQUEST)
        booking.status = Booking.BookingStatus.CONFIRMED
        booking.save(update_fields=["status"])
        return Response(BookingSerializer(booking).data)

    @action(detail=True, methods=["post"])
    def mark_reviewed(self, request, pk=None):
        booking = self.get_object()
        booking.review_status = Booking.ReviewStatus.REVIEWED
        booking.save(update_fields=["review_status"])
        return Response(BookingSerializer(booking).data)

    @action(detail=False, methods=["get"], url_path="sales-report", permission_classes=[IsAuthenticated, IsDataAccRole])
    def sales_report(self, request):
        qs = (
            Booking.objects.filter(status=Booking.BookingStatus.CONFIRMED, record_status=Booking.RecordStatus.ACTIVE)
            .select_related("created_by")
            .order_by("-date")
        )
        department_filter = request.query_params.get("department")
        if department_filter:
            qs = qs.filter(department=department_filter)
        supplier_filter = request.query_params.get("supplier")
        if supplier_filter:
            qs = qs.filter(supplier__icontains=supplier_filter)
        review_status_filter = request.query_params.get("review_status")
        if review_status_filter:
            qs = qs.filter(review_status=review_status_filter)
        return Response(BookingSerializer(qs, many=True).data)

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated, IsDataAccRole])
    def analytics(self, request):
        """
        Everything the Data Analysis dashboard needs, computed live from
        confirmed bookings -- revenue, profit, margin, outstanding
        receivables, a 12-month revenue/profit trend, revenue split by
        department, and top suppliers by volume. All aggregation runs
        on the database side (Sum/Count), so this never loads the full
        booking list into memory and is unaffected by row count.
        """
        from datetime import date
        from django.db.models import Sum, Count
        from django.db.models.functions import TruncMonth

        confirmed = Booking.objects.filter(status=Booking.BookingStatus.CONFIRMED, record_status=Booking.RecordStatus.ACTIVE)

        totals = confirmed.aggregate(revenue=Sum("selling_rate"), net=Sum("net_rate"))
        revenue = totals["revenue"] or Decimal("0")
        net = totals["net"] or Decimal("0")
        profit = revenue - net
        margin = float(profit / revenue * 100) if revenue else 0

        active_count = confirmed.count()
        pending_count = Booking.objects.filter(status=Booking.BookingStatus.PENDING, record_status=Booking.RecordStatus.ACTIVE).count()

        receivables = confirmed.filter(collection_status=Booking.CollectionStatus.PARTIAL).aggregate(total=Sum("remaining_amount"))["total"] or Decimal("0")

        # 12-month trend, oldest to newest. Computed with plain date
        # arithmetic (no extra dependency) -- 365 days back covers a
        # full year regardless of which day of the month "today" is.
        one_year_ago = date.today() - __import__("datetime").timedelta(days=365)
        trend_rows = (
            confirmed.filter(date__gte=one_year_ago)
            .annotate(month=TruncMonth("date"))
            .values("month")
            .annotate(revenue=Sum("selling_rate"), net=Sum("net_rate"))
            .order_by("month")
        )
        trend = [
            {"month": row["month"].strftime("%Y-%m"), "revenue": str(row["revenue"] or 0), "profit": str((row["revenue"] or 0) - (row["net"] or 0))}
            for row in trend_rows
        ]

        by_department = list(
            confirmed.values("department").annotate(revenue=Sum("selling_rate"), count=Count("id")).order_by("-revenue")
        )
        for row in by_department:
            row["revenue"] = str(row["revenue"] or 0)

        top_suppliers = list(
            confirmed.exclude(supplier="").values("supplier").annotate(revenue=Sum("selling_rate"), net=Sum("net_rate"), count=Count("id")).order_by("-revenue")[:10]
        )
        for row in top_suppliers:
            revenue_val = row["revenue"] or Decimal("0")
            net_val = row["net"] or Decimal("0")
            row["revenue"] = str(revenue_val)
            row["profit"] = str(revenue_val - net_val)
            del row["net"]

        return Response({
            "revenue": str(revenue),
            "profit": str(profit),
            "margin_percent": round(margin, 1),
            "active_bookings": active_count,
            "pending_bookings": pending_count,
            "outstanding_receivables": str(receivables),
            "monthly_trend": trend,
            "by_department": by_department,
            "top_suppliers": top_suppliers,
        })

    @action(detail=False, methods=["get"], url_path="recent-activity", permission_classes=[IsAuthenticated, IsDataAccRole])
    def recent_activity(self, request):
        qs = (
            Booking.objects.filter(record_status=Booking.RecordStatus.ACTIVE)
            .select_related("created_by", "updated_by")
            .order_by("-updated_at")
        )
        department_filter = request.query_params.get("department")
        if department_filter:
            qs = qs.filter(department=department_filter)
        date_filter = request.query_params.get("date")
        if date_filter:
            qs = qs.filter(date=date_filter)
        limit = int(request.query_params.get("limit", 20))
        return Response(BookingSerializer(qs[:limit], many=True).data)


    @action(detail=True, methods=["get"])
    def payment_summary(self, request, pk=None):
        """
        For the "+ Collect Payment" button inside Booking Details:
        returns what the customer still owes, and every Voucher already
        linked to this booking (via the FK, not the free-text reference)
        so the accountant sees a live running total without re-entering
        anything.
        """
        booking = self.get_object()

        vouchers = booking.vouchers.filter(status="posted").select_related("party").order_by("-date")
        total_collected = sum((v.amount for v in vouchers if v.type == "receipt"), Decimal("0"))
        remaining = booking.selling_rate - total_collected

        return Response({
            "booking_id": booking.id, "selling_rate": str(booking.selling_rate),
            "total_collected": str(total_collected), "remaining": str(remaining),
            "collection_status": "paid" if remaining <= 0 else ("partial" if total_collected > 0 else "unpaid"),
            "vouchers": [{
                "id": v.id, "number": v.number, "date": v.date, "amount": str(v.amount),
                "type": v.type, "payment_method": v.payment_method,
            } for v in vouchers],
        })
