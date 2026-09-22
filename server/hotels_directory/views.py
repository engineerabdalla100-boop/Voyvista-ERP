from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from .models import Hotel
from .serializers import HotelSerializer


class HotelViewSet(viewsets.ModelViewSet):
    """
    Any authenticated staff member can search/browse the hotel
    directory (it's a shared reference list, not sensitive data), but
    creating/editing/deleting stays open to anyone logged in too --
    this is an internal lookup tool, not a financial record.
    """

    queryset = Hotel.objects.prefetch_related("phones", "emails", "photos").select_related("created_by").all()
    serializer_class = HotelSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        active_only = self.request.query_params.get("active_only")
        if active_only == "true":
            qs = qs.filter(is_active=True)

        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(name__icontains=search) | qs.filter(area__icontains=search)

        area = self.request.query_params.get("area")
        if area:
            qs = qs.filter(area__icontains=area)

        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)