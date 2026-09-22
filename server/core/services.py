from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from . import registry
from .audit import log_event
from .base_models import AuditLog, ChangeRequest
from .policy import AuthorizationPolicy


class StaleChangeRequestError(ValueError):
    """The target changed after the request was submitted and before someone approved it."""


class ProtectedFieldError(ValueError):
    """proposed_data is trying to change a protected field."""


class ApplyExecutionError(ValueError):
    """
    An error that happened while executing the change itself.

    Its purpose is to separate:
    Authorization / Validation / Concurrency failures
    from a failure that happened during the actual Apply operation.

    Inherits from ValueError (not Exception directly) on purpose --
    any existing code (like core/views.py's approve() action) that
    catches except ValueError to return a clean HTTP response (400)
    must still catch it correctly, instead of letting it bubble up as
    an unhandled 500. This gap was discovered through actual testing.
    """


class MakerCheckerService:
    @staticmethod
    def user_can_execute_directly(user) -> bool:
        return AuthorizationPolicy.can_execute_directly(user)

    @classmethod
    def submit(
        cls,
        *,
        user,
        entity_type: str,
        entity_id,
        proposed_data: dict,
        apply_fn,
        request=None,
        target_version=None,
    ):
        # Protected Fields check -- was completely missing from here
        # before; it only existed inside apply_change_request_generic()
        # which only runs during approve(). Result: a user with direct
        # execution privilege could send status/maker/checker inside
        # proposed_data and have them accepted immediately, and a
        # regular user could submit a ChangeRequest tainted with the
        # same fields and have it stay PENDING without rejection. The
        # check now happens here, before any record is created, so it
        # covers both cases (Direct Execute and PENDING) with the same
        # rule.
        if registry.is_registered(entity_type):
            protected_fields = registry.get_registration(entity_type)["protected_fields"]
            touched_protected = set((proposed_data or {}).keys()) & protected_fields
            if touched_protected:
                raise ProtectedFieldError(
                    f"Cannot modify protected fields through this path: {sorted(touched_protected)}"
                )

        can_execute = cls.user_can_execute_directly(user)

        change_request = ChangeRequest.objects.create(
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            proposed_data=proposed_data,
            maker=user,
            status=(
                ChangeRequest.Status.APPROVED
                if can_execute
                else ChangeRequest.Status.PENDING
            ),
            checker=user if can_execute else None,
            reviewed_at=timezone.now() if can_execute else None,
            target_version=target_version,
        )

        if not can_execute:
            log_event(
                AuditLog.EventType.CHANGE_SUBMITTED,
                actor=user,
                request=request,
                entity_type=entity_type,
                entity_id=entity_id,
                new_value=proposed_data,
                description=f"change_request_id={change_request.id}",
            )
            return change_request

        try:
            with transaction.atomic():
                apply_fn()
        except (serializers.ValidationError, ValueError) as exc:
            cls._mark_apply_failed(
                change_request=change_request,
                actor=user,
                request=request,
                reason=str(exc),
            )
            raise
        except Exception as exc:
            cls._mark_apply_failed(
                change_request=change_request,
                actor=user,
                request=request,
                reason=str(exc),
            )
            raise ApplyExecutionError(
                "An error occurred while executing the direct change."
            ) from exc

        log_event(
            AuditLog.EventType.CHANGE_APPLIED_DIRECT,
            actor=user,
            request=request,
            entity_type=entity_type,
            entity_id=entity_id,
            new_value=proposed_data,
        )

        return change_request

    @classmethod
    def approve(cls, change_request_id, *, checker, request=None):
        """
        Approve flow:

        1. Lock ChangeRequest.
        2. Validate request state.
        3. Validate maker/checker separation.
        4. Validate checker role.
        5. Validate target/scope/version.
        6. Apply transaction.
        7. Mark approved.

        Authorization failures (self-approval, RBAC role, ABAC scope)
        do NOT turn into APPLY_FAILED -- the request stays PENDING so
        another qualified reviewer can approve it later.

        But StaleChangeRequestError and Target-Missing (ValueError from
        apply_change_request_generic) now turn into a real
        APPLY_FAILED, not PENDING -- because the reason will not change
        if retried (the record was permanently deleted/changed), so
        leaving it PENDING meant a request "pending forever" with no
        clear final state.
        """

        try:
            with transaction.atomic():
                change_request = (
                    ChangeRequest.objects
                    .select_for_update()
                    .select_related("maker", "checker")
                    .get(pk=change_request_id)
                )

                cls._validate_approval_authorization(
                    change_request,
                    checker,
                )

                # ABAC + Apply -- both now inside the same try/except so
                # we classify the failure correctly: PermissionError
                # (scope) stays PENDING, anything else (Stale/Missing
                # Target/Protected Field/Serializer Validation) becomes
                # APPLY_FAILED.
                try:
                    cls._validate_target_for_apply(
                        change_request,
                        checker=checker,
                    )
                    cls.apply_change_request_generic(
                        change_request,
                        checker=checker,
                        authorization_already_checked=True,
                    )
                except PermissionError:
                    # Pure Authorization Failure -- request stays PENDING.
                    raise
                except (
                    StaleChangeRequestError,
                    ProtectedFieldError,
                    ValueError,
                    serializers.ValidationError,
                ) as exc:
                    # Real Apply Failure -- a data state that will not
                    # change if retried (record deleted/changed, or the
                    # Payload is invalid) -- needs a clear final state.
                    raise ApplyExecutionError(str(exc)) from exc
                except Exception as exc:
                    raise ApplyExecutionError(
                        "An error occurred while executing the ChangeRequest."
                    ) from exc

                change_request.status = ChangeRequest.Status.APPROVED
                change_request.checker = checker
                change_request.reviewed_at = timezone.now()

                change_request.save(
                    update_fields=[
                        "status",
                        "checker",
                        "reviewed_at",
                    ]
                )

        except ChangeRequest.DoesNotExist:
            raise ValueError("Change request not found.")

        except ApplyExecutionError as exc:
            cls._mark_apply_failed_by_id(
                change_request_id=change_request_id,
                checker=checker,
                request=request,
                reason=str(exc),
            )
            raise

        log_event(
            AuditLog.EventType.CHANGE_APPROVED,
            actor=checker,
            request=request,
            entity_type=change_request.entity_type,
            entity_id=change_request.entity_id,
            new_value=change_request.proposed_data,
            description=(
                f"change_request_id={change_request.id}, "
                f"maker={change_request.maker_id}"
            ),
        )

        return change_request

    @staticmethod
    def reject(
        change_request_id,
        *,
        checker,
        reason: str = "",
        request=None,
    ):
        with transaction.atomic():
            try:
                change_request = (
                    ChangeRequest.objects
                    .select_for_update()
                    .select_related("maker", "checker")
                    .get(pk=change_request_id)
                )
            except ChangeRequest.DoesNotExist:
                raise ValueError("Change request not found.")

            if change_request.status != ChangeRequest.Status.PENDING:
                raise ValueError(
                    "This request is not in a pending approval state."
                )

            if change_request.maker_id == checker.id:
                raise PermissionError(
                    "You cannot reject a request you submitted yourself."
                )

            if not AuthorizationPolicy.can_be_checker(checker):
                raise PermissionError(
                    "This user does not have permission to reject requests."
                )

            if not AuthorizationPolicy.checker_can_access_scope(
                checker,
                target_instance=MakerCheckerService._get_target_instance(
                    change_request
                ),
                maker=change_request.maker,
            ):
                raise PermissionError(
                    "This user is outside the authorization scope for this specific request."
                )

            change_request.status = ChangeRequest.Status.REJECTED
            change_request.checker = checker
            change_request.rejection_reason = reason
            change_request.reviewed_at = timezone.now()

            change_request.save(
                update_fields=[
                    "status",
                    "checker",
                    "rejection_reason",
                    "reviewed_at",
                ]
            )

        log_event(
            AuditLog.EventType.CHANGE_REJECTED,
            actor=checker,
            request=request,
            entity_type=change_request.entity_type,
            entity_id=change_request.entity_id,
            description=(
                f"change_request_id={change_request.id}, "
                f"reason={reason}"
            ),
        )

        return change_request

    @classmethod
    def apply_change_request_generic(
        cls,
        change_request: ChangeRequest,
        *,
        checker=None,
        authorization_already_checked=False,
    ):
        """
        Executes the ChangeRequest after authorization checks are done.

        authorization_already_checked=True is used by approve() after
        it already ran all authorization/scope/version checks.
        """

        reg = registry.get_registration(
            change_request.entity_type
        )

        model_class = registry.get_model_class(
            change_request.entity_type
        )

        serializer_class = reg["serializer_class"]
        protected_fields = reg["protected_fields"]

        data = change_request.proposed_data or {}

        touched_protected = (
            set(data.keys()) & protected_fields
        )

        if touched_protected:
            raise ProtectedFieldError(
                "Cannot modify protected fields through this path: "
                f"{sorted(touched_protected)}"
            )

        is_delete = data.get("_action") == "delete"

        if change_request.entity_id:
            try:
                instance = (
                    model_class.objects
                    .select_for_update()
                    .get(pk=change_request.entity_id)
                )
            except model_class.DoesNotExist:
                raise ValueError(
                    f"The target record "
                    f"(#{change_request.entity_id}) no longer exists "
                    "-- it was deleted after this request was submitted."
                )

            current_version = getattr(
                instance,
                "version",
                None,
            )

            if (
                change_request.target_version is not None
                and current_version != change_request.target_version
            ):
                raise StaleChangeRequestError(
                    "The record was modified by another user after this "
                    "request was submitted "
                    f"(version at submission: "
                    f"{change_request.target_version}, "
                    f"current version: {current_version}) -- "
                    "the request is rejected; review the current state "
                    "and resubmit if needed."
                )

        else:
            instance = None

        if (
            checker is not None
            and not authorization_already_checked
            and not AuthorizationPolicy.checker_can_access_scope(
                checker,
                target_instance=instance,
                maker=change_request.maker,
            )
        ):
            raise PermissionError(
                "This user is outside the authorization scope for this specific request."
            )

        if instance is not None:
            if is_delete:
                instance.delete()
                return None

            serializer = serializer_class(
                instance=instance,
                data=data,
                partial=True,
            )

            serializer.is_valid(
                raise_exception=True
            )

            # extra_apply_kwargs_fn was registered in core/registry.py
            # (e.g. parties/apps.py's lambda cr: {"created_by": cr.maker})
            # but was never actually used here -- the result was a
            # NOT NULL constraint failed for any Entity that needs a
            # required field like created_by to be set from the
            # original maker at approve() time.
            extra_kwargs = reg["extra_apply_kwargs_fn"](change_request) if reg.get("extra_apply_kwargs_fn") else {}
            return serializer.save(**extra_kwargs)

        if is_delete:
            raise ValueError(
                "Delete request without an entity_id."
            )

        serializer = serializer_class(data=data)

        serializer.is_valid(
            raise_exception=True
        )

        extra_kwargs = reg["extra_apply_kwargs_fn"](change_request) if reg.get("extra_apply_kwargs_fn") else {}
        return serializer.save(**extra_kwargs)

    # ------------------------------------------------------------------
    # Internal validation helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_approval_authorization(
        change_request,
        checker,
    ):
        if change_request.status != ChangeRequest.Status.PENDING:
            raise ValueError(
                "This request is not in a pending approval state."
            )

        if change_request.maker_id == checker.id:
            raise PermissionError(
                "You cannot approve a request you submitted yourself."
            )

        if not AuthorizationPolicy.can_be_checker(checker):
            raise PermissionError(
                "This user does not have permission to approve requests."
            )

    @classmethod
    def _validate_target_for_apply(
        cls,
        change_request,
        *,
        checker,
    ):
        """
        Only the ABAC check happens here -- the check for the target's
        existence was removed from here (it used to raise ValueError
        before we even reached apply_change_request_generic, which let
        the failure escape correct classification).
        apply_change_request_generic itself already confirms the
        target exists (via select_for_update().get()) and raises a
        clear ValueError if it doesn't -- no need to duplicate the
        check here, and duplicating it here outside the correct try
        block would let the failure escape classification again.
        """
        instance = cls._get_target_instance(
            change_request,
            lock=True,
        )

        if (
            not AuthorizationPolicy.checker_can_access_scope(
                checker,
                target_instance=instance,
                maker=change_request.maker,
            )
        ):
            raise PermissionError(
                "This user is outside the authorization scope for this specific request."
            )

    @staticmethod
    def _get_target_instance(
        change_request,
        *,
        lock=False,
    ):
        if not change_request.entity_id:
            return None

        model_class = registry.get_model_class(
            change_request.entity_type
        )

        queryset = model_class.objects

        if lock:
            queryset = queryset.select_for_update()

        try:
            return queryset.get(
                pk=change_request.entity_id
            )
        except model_class.DoesNotExist:
            return None

    @classmethod
    def _mark_apply_failed(
        cls,
        *,
        change_request,
        actor,
        request,
        reason,
    ):
        change_request.status = ChangeRequest.Status.APPLY_FAILED
        change_request.apply_failure_reason = reason
        change_request.checker = actor
        change_request.reviewed_at = timezone.now()

        change_request.save(
            update_fields=[
                "status",
                "apply_failure_reason",
                "checker",
                "reviewed_at",
            ]
        )

        log_event(
            AuditLog.EventType.CHANGE_APPLY_FAILED,
            actor=actor,
            request=request,
            entity_type=change_request.entity_type,
            entity_id=change_request.entity_id,
            new_value=change_request.proposed_data,
            description=reason,
        )

    @classmethod
    def _mark_apply_failed_by_id(
        cls,
        *,
        change_request_id,
        checker,
        request,
        reason,
    ):
        change_request = (
            ChangeRequest.objects
            .select_related("maker", "checker")
            .get(pk=change_request_id)
        )

        cls._mark_apply_failed(
            change_request=change_request,
            actor=checker,
            request=request,
            reason=reason,
        )