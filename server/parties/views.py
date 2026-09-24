from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Party, PartyAlias
from .serializers import PartyAliasSerializer, PartySerializer


class PartyViewSet(viewsets.ModelViewSet):
    queryset = Party.objects.exclude(record_status=Party.RecordStatus.ARCHIVED).select_related("parent_party", "created_by")
    serializer_class = PartySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        code = self.request.query_params.get("code")
        if code:
            qs = qs.filter(code=code)
        client_category = self.request.query_params.get("client_category")
        if client_category:
            qs = qs.filter(client_category=client_category)
        party_type = self.request.query_params.get("type")
        if party_type:
            qs = qs.filter(type=party_type)
        roots_only = self.request.query_params.get("roots_only")
        if roots_only in ("1", "true", "True"):
            qs = qs.filter(parent_party__isnull=True)
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(full_name__icontains=search) | qs.filter(code__icontains=search)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def perform_destroy(self, instance):
        instance.record_status = Party.RecordStatus.ARCHIVED
        instance.save(update_fields=["record_status"])

    @action(detail=False, methods=["get"])
    def resolve_code(self, request):
        """
        Given a typed customer code, looks it up as either a Party's
        own code or a linked PartyAlias, and returns whichever Party it
        resolves to. If nothing matches, tells the caller so the UI can
        offer "create new customer" or "use as a free-text code" instead.
        """
        code = request.query_params.get("code", "").strip()
        if not code:
            return Response({"detail": "code is required."}, status=status.HTTP_400_BAD_REQUEST)

        party = Party.objects.filter(code=code).exclude(record_status=Party.RecordStatus.ARCHIVED).first()
        if not party:
            alias = PartyAlias.objects.filter(alias_code=code).select_related("party").first()
            party = alias.party if alias else None

        if party:
            return Response({"found": True, "party": PartySerializer(party).data})
        return Response({"found": False, "party": None})

    @action(detail=False, methods=["get"])
    def peek_next_code(self, request):
        """
        Read-only preview of the code the next new customer would get --
        does NOT create anything. Lets the booking form show "VOY-0000042"
        on load without a Party existing yet; the real Party (and its
        real code) is only created once the booking is actually saved.
        """
        last = Party.objects.exclude(code="").order_by("-id").first()
        next_number = 1
        if last and last.code.startswith("VOY-"):
            try:
                next_number = int(last.code.split("VOY-")[1]) + 1
            except (ValueError, IndexError):
                next_number = Party.objects.count() + 1
        else:
            next_number = Party.objects.count() + 1
        return Response({"next_code": f"VOY-{next_number:07d}"})

    @action(detail=False, methods=["get"])
    def search_codes(self, request):
        """
        Autocomplete source for the customer-code field: matches both a
        Party's own code/name and any alias codes linked to it, so
        typing an old free-text code still surfaces the right customer.
        """
        query = request.query_params.get("search", "").strip()
        if not query:
            return Response([])

        matches = []
        seen_party_ids = set()

        for party in Party.objects.filter(code__icontains=query).exclude(record_status=Party.RecordStatus.ARCHIVED)[:10]:
            matches.append({"code": party.code, "party_id": party.id, "label": f"{party.code} -- {party.full_name}", "matched_alias": None})
            seen_party_ids.add(party.id)

        for alias in PartyAlias.objects.filter(alias_code__icontains=query).select_related("party")[:10]:
            if alias.party_id not in seen_party_ids:
                matches.append({"code": alias.party.code, "party_id": alias.party_id, "label": f"{alias.party.code} -- {alias.party.full_name} (alias: {alias.alias_code})", "matched_alias": alias.alias_code})

        return Response(matches[:10])

    @action(detail=True, methods=["post"])
    def link_alias(self, request, pk=None):
        """
        Merge step: links an old free-text customer code to this Party
        as a PartyAlias. Never touches any existing Booking rows -- their
        original_customer_code stays exactly as first typed; only future
        lookups of that code now resolve to this Party.
        """
        party = self.get_object()
        alias_code = request.data.get("alias_code", "").strip()
        if not alias_code:
            return Response({"detail": "alias_code is required."}, status=status.HTTP_400_BAD_REQUEST)

        if Party.objects.filter(code=alias_code).exclude(pk=party.pk).exists():
            return Response({"detail": f"'{alias_code}' is already a registered customer's own code -- cannot alias it."}, status=status.HTTP_400_BAD_REQUEST)

        existing_alias = PartyAlias.objects.filter(alias_code=alias_code).select_related("party").first()
        if existing_alias:
            if existing_alias.party_id == party.pk:
                return Response({"detail": f"'{alias_code}' is already linked to this customer."}, status=status.HTTP_400_BAD_REQUEST)
            return Response({"detail": f"'{alias_code}' is already linked to a different customer ({existing_alias.party.code})."}, status=status.HTTP_400_BAD_REQUEST)

        alias = PartyAlias.objects.create(party=party, alias_code=alias_code, note=request.data.get("note", ""), linked_by=request.user)
        return Response(PartyAliasSerializer(alias).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        """
        Full cross-department transaction history for one customer --
        every confirmed booking across Flights, Hotels, Visas and Cars
        that is linked to this Party, newest first. No pagination cap:
        a long-standing customer's entire history is returned in one
        call, exactly like every other list in this system.
        """
        from bookings.models import Booking
        from bookings.serializers import BookingSerializer

        party = self.get_object()
        bookings = (
            Booking.objects.filter(customer_id=party.pk, record_status=Booking.RecordStatus.ACTIVE)
            .select_related("created_by")
            .order_by("-date")
        )
        return Response({
            "party": PartySerializer(party).data,
            "total_bookings": bookings.count(),
            "bookings": BookingSerializer(bookings, many=True).data,
        })
