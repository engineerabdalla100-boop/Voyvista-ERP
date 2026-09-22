from django.db.models import ProtectedError
from django.shortcuts import render
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.audit import log_event
from core.base_models import AuditLog

from .models import User
from .serializers import EmployeeSerializer, LoginSerializer, MeSerializer, UserSerializer

AVAILABLE_MODULES = [
    {"key": "flights", "label": "Flights"}, {"key": "hotels", "label": "Hotels"}, {"key": "visas", "label": "Visas"},
    {"key": "staff", "label": "Staff"}, {"key": "guides", "label": "Tour Guides"}, {"key": "cars", "label": "Cars"},
    {"key": "events", "label": "Events"}, {"key": "sales", "label": "Sales"}, {"key": "data", "label": "Data"},
    {"key": "accounts", "label": "Accounts"}, {"key": "owner", "label": "Owner Panel"},
    {"key": "it_dashboard", "label": "IT Dashboard"}, {"key": "settings", "label": "Settings"},
]


# Configurable brute-force lockout: 5 failed attempts within 5 minutes
# from the same IP earn a 15-minute block. Both numbers are safe to
# tune here without touching the view logic below.
LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 5 * 60
LOGIN_LOCKOUT_SECONDS = 15 * 60


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        from django.core.cache import cache

        from core.audit import get_client_ip

        ip = get_client_ip(request) or "unknown"
        lockout_key = f"login_lockout:{ip}"
        attempts_key = f"login_attempts:{ip}"

        if cache.get(lockout_key):
            return Response(
                {"detail": "Too many failed login attempts. Please try again in a few minutes."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        serializer = LoginSerializer(data=request.data)
        if not serializer.is_valid():
            attempts = cache.get(attempts_key, 0) + 1
            cache.set(attempts_key, attempts, timeout=LOGIN_WINDOW_SECONDS)
            if attempts >= LOGIN_MAX_ATTEMPTS:
                cache.set(lockout_key, True, timeout=LOGIN_LOCKOUT_SECONDS)
                cache.delete(attempts_key)

            log_event(
                AuditLog.EventType.LOGIN_FAILED, actor=None, request=request,
                description=f"Failed login attempt for username={request.data.get('username', '')!r} (attempt {attempts}/{LOGIN_MAX_ATTEMPTS})",
            )
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        cache.delete(attempts_key)
        user = serializer.validated_data["user"]
        token, _ = Token.objects.get_or_create(user=user)

        # Stamp last_seen now, at login itself -- otherwise a fresh
        # token inherits whatever stale last_seen the user had from
        # before, and the idle-timeout check in LastSeenTokenAuthentication
        # would reject it as expired on its very first use.
        from django.utils import timezone
        type(user).objects.filter(pk=user.pk).update(last_seen=timezone.now())

        log_event(AuditLog.EventType.LOGIN_SUCCESS, actor=user, request=request)
        return Response({"token": token.key, "user": UserSerializer(user).data})


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        request.user.auth_token.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CurrentUserView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(MeSerializer(request.user).data)

    def patch(self, request):
        serializer = MeSerializer(instance=request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class IsAdminRole(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == User.Role.ADMIN)


EMPLOYEE_MANAGEMENT_ROLES = {User.Role.ADMIN, User.Role.OWNER, User.Role.IT}


class IsEmployeeManager(BasePermission):
    message = "Only IT, Owner, and Admin can manage employee accounts."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role in EMPLOYEE_MANAGEMENT_ROLES)


class EmployeeViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = EmployeeSerializer
    permission_classes = [IsEmployeeManager]

    def get_queryset(self):
        qs = super().get_queryset()
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(username__icontains=search) | qs.filter(first_name__icontains=search) | qs.filter(last_name__icontains=search)
        return qs

    def perform_create(self, serializer):
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.id == request.user.id:
            return Response({"detail": "You cannot delete your own account."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            instance.delete()
        except ProtectedError:
            return Response(
                {"detail": "Cannot delete this user -- they have related records (bookings, sales, etc). Consider disabling the account instead."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def toggle_active(self, request, pk=None):
        employee = self.get_object()
        if employee.id == request.user.id:
            return Response({"detail": "You cannot deactivate your own account."}, status=status.HTTP_400_BAD_REQUEST)
        if employee.is_active_employee:
            employee.deactivate_employee()
        else:
            employee.activate_employee()
        return Response(EmployeeSerializer(employee).data)

    @action(detail=False, methods=["get"])
    def available_modules(self, request):
        return Response(AVAILABLE_MODULES)
    @action(detail=False, methods=["get"])
    def online(self, request):
        from .serializers import ONLINE_THRESHOLD_SECONDS
        threshold = timezone.now() - timezone.timedelta(seconds=ONLINE_THRESHOLD_SECONDS)
        qs = User.objects.filter(last_seen__gte=threshold, is_active_employee=True).order_by("-last_seen")
        return Response(EmployeeSerializer(qs, many=True).data)
