from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from .models import Guide
from .serializers import GuideSerializer


class GuideViewSet(viewsets.ModelViewSet):
    queryset = Guide.objects.select_related("created_by")
    serializer_class = GuideSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(name__icontains=search) | qs.filter(language__icontains=search)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)