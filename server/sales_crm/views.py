from decimal import Decimal

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Activity, Deal
from .serializers import ActivitySerializer, DealSerializer


class DealViewSet(viewsets.ModelViewSet):
    queryset = Deal.objects.select_related("party", "booking", "created_by").all()
    serializer_class = DealSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        stage = self.request.query_params.get("stage")
        if stage:
            qs = qs.filter(stage=stage)
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(company_name__icontains=search)
        return qs

    def perform_create(self, serializer):
        # Auto-create the Party the moment a deal is logged, exactly
        # like Booking does for a new customer -- it gets its own
        # unified VOY-0000001 code for free, and the deal is never
        # "just a name" the way the old prototype's contacts list was.
        from parties.models import Party

        deal = serializer.save(created_by=self.request.user)
        if not deal.party_id and deal.company_name:
            party = Party.objects.create(
                type=Party.Type.CUSTOMER,
                client_category=Party.ClientCategory.B2B,
                full_name=deal.company_name,
                phone=deal.contact_phone,
                email=deal.contact_email,
                created_by=self.request.user,
            )
            deal.party = party
            deal.save(update_fields=["party"])

    @action(detail=True, methods=["post"])
    def move_stage(self, request, pk=None):
        """
        Moves a deal to a new pipeline stage. Moving to WON is the one
        stage with a side effect: it creates a real Booking (department
        set from the deal's service_type where recognisable, otherwise
        left for the operations team to route), linked back to this
        deal and to the same Party -- so it flows into the exact same
        accounting approval process as any other booking, with no
        separate "sales accounting" path. This only fires once: moving
        a deal to WON a second time (or moving it away and back) never
        creates a duplicate Booking.
        """
        deal = self.get_object()
        new_stage = request.data.get("stage")
        if new_stage not in Deal.Stage.values:
            return Response({"detail": "Invalid stage."}, status=status.HTTP_400_BAD_REQUEST)

        deal.stage = new_stage

        if new_stage == Deal.Stage.STAGE4 and not deal.booking_id:
            from bookings.models import Booking

            department = _guess_department(deal.service_type)
            booking = Booking.objects.create(
                department=department,
                date=deal.created_at.date(),
                passenger_name=deal.company_name,
                customer_name=deal.company_name,
                customer=deal.party,
                selling_rate=deal.estimated_value,
                net_rate=Decimal("0"),
                note=f"Auto-created from CRM deal #{deal.id} ({deal.service_type})",
                created_by=request.user,
            )
            deal.booking = booking

        deal.save()
        return Response(DealSerializer(deal).data)


def _guess_department(service_type):
    from bookings.models import Booking

    text = (service_type or "").lower()
    if "hotel" in text or "\u0641\u0646\u0627\u062F\u0642" in text:
        return Booking.Department.HOTEL
    if "visa" in text or "\u062A\u0623\u0634\u064A\u0631" in text:
        return Booking.Department.VISA
    if "car" in text or "\u0639\u0631\u0628" in text:
        return Booking.Department.CAR
    return Booking.Department.FLIGHT


class ActivityViewSet(viewsets.ModelViewSet):
    queryset = Activity.objects.select_related("deal", "created_by").all()
    serializer_class = ActivitySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        deal_id = self.request.query_params.get("deal")
        if deal_id:
            qs = qs.filter(deal_id=deal_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)