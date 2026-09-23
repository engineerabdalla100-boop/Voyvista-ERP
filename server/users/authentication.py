from django.utils import timezone
from rest_framework.authentication import TokenAuthentication

UPDATE_INTERVAL_SECONDS = 60


# Idle timeout: if a token has gone unused for longer than this, it is
# treated as expired and deleted, forcing a fresh login. Tunable here
# without touching the authenticate() logic below.
IDLE_TIMEOUT_SECONDS = 8 * 60 * 60  # 8 hours


class LastSeenTokenAuthentication(TokenAuthentication):
    def authenticate(self, request):
        result = super().authenticate(request)
        if result is not None:
            user, token = result
            now = timezone.now()

            # Live re-check on every request: a disabled account's token
            # is revoked immediately, even if it was already issued
            # before the account was disabled. Without this, "Disable
            # User" only blocks future logins -- an already-signed-in
            # session would otherwise keep working until it naturally
            # expired or was manually revoked.
            if not user.is_active_employee or not user.is_active:
                token.delete()
                from rest_framework.exceptions import AuthenticationFailed
                raise AuthenticationFailed("This account has been disabled.")

            if user.last_seen is not None and (now - user.last_seen).total_seconds() >= IDLE_TIMEOUT_SECONDS:
                token.delete()
                from rest_framework.exceptions import AuthenticationFailed
                raise AuthenticationFailed("Session expired due to inactivity. Please log in again.")

            if user.last_seen is None or (now - user.last_seen).total_seconds() >= UPDATE_INTERVAL_SECONDS:
                type(user).objects.filter(pk=user.pk).update(last_seen=now)
        return result