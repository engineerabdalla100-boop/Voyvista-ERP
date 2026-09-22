from django.db.models import ProtectedError
from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Car, CarMovement
from .serializers import CarMovementSerializer, CarSerializer


class CarViewSet(viewsets.ModelViewSet):
    queryset = Car.objects.select_related("created_by").prefetch_related("movements")
    serializer_class = CarSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(type__icontains=search) | qs.filter(driver_name__icontains=search)
        category = self.request.query_params.get("category")
        if category:
            qs = qs.filter(category=category)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        try:
            instance.delete()
        except ProtectedError:
            return Response(
                {"detail": "Cannot delete this car -- it has recorded movements. Movement history is part of the financial record and must be preserved."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class CarMovementViewSet(viewsets.ModelViewSet):
    queryset = CarMovement.objects.select_related("car", "created_by")
    serializer_class = CarMovementSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        car_id = self.request.query_params.get("car")
        if car_id:
            qs = qs.filter(car_id=car_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)