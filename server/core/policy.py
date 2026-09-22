class Action:
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    SUBMIT = "submit"
    APPROVE = "approve"
    REJECT = "reject"
    DIRECT_EXECUTE = "direct_execute"


_DIRECT_EXECUTE_ROLES = frozenset({"ADMIN", "ACCOUNTANT"})
_CHECKER_ROLES = frozenset({"ADMIN", "ACCOUNTANT"})
_ORG_WIDE_ROLES = frozenset({"ADMIN"})


class AuthorizationPolicy:
    @staticmethod
    def can_execute_directly(user) -> bool:
        return getattr(user, "role", None) in _DIRECT_EXECUTE_ROLES

    @staticmethod
    def can_be_checker(user) -> bool:
        return bool(user and user.is_authenticated and getattr(user, "role", None) in _CHECKER_ROLES)

    @staticmethod
    def is_org_wide(user) -> bool:
        return getattr(user, "role", None) in _ORG_WIDE_ROLES

    @staticmethod
    def can_submit(user) -> bool:
        return bool(user and user.is_authenticated)

    @staticmethod
    def get_entity_scope(instance):
        if instance is None:
            return None
        for attr in ("department", "branch", "owner_id"):
            value = getattr(instance, attr, None)
            if value not in (None, "", "-"):
                return value
        return None

    @classmethod
    def checker_can_access_scope(cls, checker, *, target_instance=None, maker=None) -> bool:
        if cls.is_org_wide(checker):
            return True
        target_scope = cls.get_entity_scope(target_instance)
        if target_scope is not None:
            checker_scope = getattr(checker, "department", None)
            if not checker_scope or checker_scope in ("-", ""):
                return True
            return target_scope == checker_scope
        maker_scope = getattr(maker, "department", None) if maker else None
        checker_scope = getattr(checker, "department", None)
        if not maker_scope or maker_scope in ("-", ""):
            return True
        if not checker_scope or checker_scope in ("-", ""):
            return True
        return maker_scope == checker_scope