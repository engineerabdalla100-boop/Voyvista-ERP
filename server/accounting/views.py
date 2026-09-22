from decimal import Decimal

from django.db import transaction
from django.db.models import Sum as models_sum
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from parties.models import Party
from users.models import User

from .models import Account, Custody, ExpenseVoucher, JournalEntry, JournalLine, Voucher
from .serializers import AccountSerializer, CustodySerializer, ExpenseVoucherSerializer, JournalEntrySerializer, VoucherSerializer

from core.audit import log_event
from core.base_models import AuditLog

ACCOUNTING_ROLES = {User.Role.ADMIN, User.Role.OWNER, User.Role.ACCOUNTANT, User.Role.IT}


class IsAccountingRole(BasePermission):
    message = "Only Admin, Owner, Accountant, and IT can access Accounting."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role in ACCOUNTING_ROLES)


class AccountViewSet(viewsets.ModelViewSet):
    queryset = Account.objects.select_related("parent", "created_by").all()
    serializer_class = AccountSerializer
    permission_classes = [IsAuthenticated, IsAccountingRole]

    def get_queryset(self):
        qs = super().get_queryset()
        account_type = self.request.query_params.get("type")
        if account_type:
            qs = qs.filter(type=account_type)
        parent_id = self.request.query_params.get("parent")
        if parent_id == "root":
            qs = qs.filter(parent__isnull=True)
        elif parent_id:
            qs = qs.filter(parent_id=parent_id)
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(name__icontains=search) | qs.filter(code__icontains=search)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.is_system_account:
            raise PermissionDenied("System accounts cannot be deleted.")
        if instance.has_movements():
            raise ValidationError({"detail": "This account has real journal movements and cannot be deleted."})
        if instance.children.exists():
            raise ValidationError({"detail": "This account has sub-accounts and cannot be deleted -- delete or reassign them first."})
        return super().destroy(request, *args, **kwargs)


def next_entry_number():
    last = JournalEntry.objects.order_by("-id").first()
    next_n = (last.id + 1) if last else 1
    return f"JE-{next_n:04d}"


def apply_posting_effect(entry, sign=1):
    for line in entry.lines.select_related("account").all():
        account = Account.objects.select_for_update().get(pk=line.account_id)
        if account.nature == Account.Nature.DEBIT:
            net_effect = line.debit - line.credit
        else:
            net_effect = line.credit - line.debit
        account.balance = account.balance + (net_effect * sign)
        account.save(update_fields=["balance"])


def create_and_post_entry(date, description, reference, lines_data, user):
    entry = JournalEntry.objects.create(
        number=next_entry_number(), date=date, description=description,
        reference=reference, status=JournalEntry.Status.POSTED, created_by=user,
    )
    for account, debit, credit in lines_data:
        JournalLine.objects.create(entry=entry, account=account, debit=debit, credit=credit)
    apply_posting_effect(entry, sign=1)
    return entry


class JournalEntryViewSet(viewsets.ModelViewSet):
    queryset = JournalEntry.objects.select_related("created_by", "reverses").prefetch_related("lines__account").all()
    serializer_class = JournalEntrySerializer
    permission_classes = [IsAuthenticated, IsAccountingRole]

    def get_queryset(self):
        qs = super().get_queryset()
        entry_status = self.request.query_params.get("status")
        if entry_status:
            qs = qs.filter(status=entry_status)
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(number__icontains=search) | qs.filter(description__icontains=search)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, number=next_entry_number())

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.status != JournalEntry.Status.DRAFT:
            raise ValidationError({"detail": "Only a draft entry can be edited."})
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.status != JournalEntry.Status.DRAFT:
            raise ValidationError({"detail": "Only a draft entry can be deleted."})
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        entry = self.get_object()
        if entry.status != JournalEntry.Status.DRAFT:
            return Response({"detail": f'Entry status is "{entry.status}" -- must be "draft" to submit.'}, status=status.HTTP_400_BAD_REQUEST)
        entry.status = JournalEntry.Status.SUBMITTED
        entry.save(update_fields=["status"])
        return Response(JournalEntrySerializer(entry).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        entry = self.get_object()
        if entry.status != JournalEntry.Status.SUBMITTED:
            return Response({"detail": f'Entry status is "{entry.status}" -- must be "submitted" to approve.'}, status=status.HTTP_400_BAD_REQUEST)
        entry.status = JournalEntry.Status.APPROVED
        entry.save(update_fields=["status"])
        return Response(JournalEntrySerializer(entry).data)

    @action(detail=True, methods=["post"])
    def post_entry(self, request, pk=None):
        entry = self.get_object()
        if entry.status != JournalEntry.Status.APPROVED:
            return Response({"detail": f'Entry status is "{entry.status}" -- must be "approved" to post.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            entry = JournalEntry.objects.select_for_update().get(pk=entry.pk)
            if entry.status != JournalEntry.Status.APPROVED:
                return Response({"detail": "Entry status changed before posting could complete -- please retry."}, status=status.HTTP_409_CONFLICT)
            apply_posting_effect(entry, sign=1)
            entry.status = JournalEntry.Status.POSTED
            entry.save(update_fields=["status"])
            log_event(AuditLog.EventType.ACCOUNTING_POSTED, actor=request.user, request=request, entity_type="journal_entry", entity_id=entry.id, description=f"Posted journal entry {entry.number}")

        return Response(JournalEntrySerializer(entry).data)

    @action(detail=True, methods=["post"])
    def reverse(self, request, pk=None):
        entry = self.get_object()
        if entry.status != JournalEntry.Status.POSTED:
            return Response({"detail": f'Entry status is "{entry.status}" -- must be "posted" to reverse.'}, status=status.HTTP_400_BAD_REQUEST)
        if hasattr(entry, "reversed_by"):
            return Response({"detail": "This entry has already been reversed."}, status=status.HTTP_400_BAD_REQUEST)

        reason = request.data.get("reason", "")

        with transaction.atomic():
            entry = JournalEntry.objects.select_for_update().get(pk=entry.pk)
            if hasattr(entry, "reversed_by"):
                return Response({"detail": "This entry has already been reversed."}, status=status.HTTP_400_BAD_REQUEST)

            reversing_entry = JournalEntry.objects.create(
                number=next_entry_number(),
                date=request.data.get("date") or entry.date,
                reference=entry.number,
                description=f"Reversal of {entry.number}" + (f" -- {reason}" if reason else ""),
                status=JournalEntry.Status.POSTED,
                reverses=entry,
                created_by=request.user,
            )
            for line in entry.lines.all():
                JournalLine.objects.create(
                    entry=reversing_entry, account=line.account,
                    debit=line.credit, credit=line.debit,
                    memo=line.memo, cost_center=line.cost_center,
                )
            apply_posting_effect(reversing_entry, sign=1)

        return Response(JournalEntrySerializer(reversing_entry).data, status=status.HTTP_201_CREATED)


class CustodyViewSet(viewsets.ModelViewSet):
    queryset = Custody.objects.select_related("employee", "treasury_account", "custody_account", "created_by").all()
    serializer_class = CustodySerializer
    permission_classes = [IsAuthenticated, IsAccountingRole]

    def get_queryset(self):
        qs = super().get_queryset()
        custody_status = self.request.query_params.get("status")
        if custody_status:
            qs = qs.filter(status=custody_status)
        employee_id = self.request.query_params.get("employee")
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, number=f"CUS-{Custody.objects.count() + 1:04d}")

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.status != Custody.Status.DRAFT:
            raise ValidationError({"detail": "Only a draft custody record can be edited."})
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.status != Custody.Status.DRAFT:
            raise ValidationError({"detail": "Only a draft custody record can be deleted."})
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        custody = self.get_object()
        if custody.status != Custody.Status.DRAFT:
            return Response({"detail": f'Status is "{custody.status}" -- must be "draft".'}, status=status.HTTP_400_BAD_REQUEST)
        custody.status = Custody.Status.SUBMITTED
        custody.save(update_fields=["status"])
        return Response(CustodySerializer(custody).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        custody = self.get_object()
        if custody.status != Custody.Status.SUBMITTED:
            return Response({"detail": f'Status is "{custody.status}" -- must be "submitted".'}, status=status.HTTP_400_BAD_REQUEST)
        custody.status = Custody.Status.APPROVED
        custody.save(update_fields=["status"])
        return Response(CustodySerializer(custody).data)

    @action(detail=True, methods=["post"])
    def issue(self, request, pk=None):
        custody = self.get_object()
        if custody.status != Custody.Status.APPROVED:
            return Response({"detail": f'Status is "{custody.status}" -- must be "approved" to issue.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            custody = Custody.objects.select_for_update().get(pk=custody.pk)
            if custody.status != Custody.Status.APPROVED:
                return Response({"detail": "Status changed before issuing could complete -- please retry."}, status=status.HTTP_409_CONFLICT)

            entry = create_and_post_entry(
                date=custody.date, description=f"Custody issued to {custody.employee.username} -- {custody.description}",
                reference=custody.number,
                lines_data=[(custody.custody_account, custody.amount, Decimal("0")), (custody.treasury_account, Decimal("0"), custody.amount)],
                user=request.user,
            )
            custody.status = Custody.Status.POSTED
            custody.journal_entry = entry
            custody.save(update_fields=["status", "journal_entry"])

        return Response(CustodySerializer(custody).data)

    @action(detail=True, methods=["post"])
    def settle(self, request, pk=None):
        custody = self.get_object()
        if custody.status != Custody.Status.POSTED:
            return Response({"detail": f'Status is "{custody.status}" -- must be "posted" (open) to settle.'}, status=status.HTTP_400_BAD_REQUEST)

        unposted = custody.expenses_charged.exclude(status=ExpenseVoucher.Status.POSTED).exists()
        if unposted:
            return Response({"detail": "This custody has unposted expense vouchers charged against it -- post or remove them before settling."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            custody = Custody.objects.select_for_update().get(pk=custody.pk)
            if custody.status != Custody.Status.POSTED:
                return Response({"detail": "Status changed before settlement could complete -- please retry."}, status=status.HTTP_409_CONFLICT)

            remaining = custody.remaining
            if remaining > 0:
                entry = create_and_post_entry(
                    date=request.data.get("date") or custody.date,
                    description=f"Custody settlement -- return of {remaining} from {custody.employee.username}",
                    reference=custody.number,
                    lines_data=[(custody.treasury_account, remaining, Decimal("0")), (custody.custody_account, Decimal("0"), remaining)],
                    user=request.user,
                )
                custody.settlement_entry = entry

            custody.status = Custody.Status.SETTLED
            custody.save(update_fields=["status", "settlement_entry"])

        return Response(CustodySerializer(custody).data)


class ExpenseVoucherViewSet(viewsets.ModelViewSet):
    queryset = ExpenseVoucher.objects.select_related("treasury_account", "custody", "expense_account", "created_by").all()
    serializer_class = ExpenseVoucherSerializer
    permission_classes = [IsAuthenticated, IsAccountingRole]

    def get_queryset(self):
        qs = super().get_queryset()
        expense_status = self.request.query_params.get("status")
        if expense_status:
            qs = qs.filter(status=expense_status)
        category = self.request.query_params.get("category")
        if category:
            qs = qs.filter(category=category)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, number=f"EXP-{ExpenseVoucher.objects.count() + 1:04d}")

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.status != ExpenseVoucher.Status.DRAFT:
            raise ValidationError({"detail": "Only a draft expense can be edited."})
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.status != ExpenseVoucher.Status.DRAFT:
            raise ValidationError({"detail": "Only a draft expense can be deleted."})
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        expense = self.get_object()
        if expense.status != ExpenseVoucher.Status.DRAFT:
            return Response({"detail": f'Status is "{expense.status}" -- must be "draft".'}, status=status.HTTP_400_BAD_REQUEST)
        expense.status = ExpenseVoucher.Status.SUBMITTED
        expense.save(update_fields=["status"])
        return Response(ExpenseVoucherSerializer(expense).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        expense = self.get_object()
        if expense.status != ExpenseVoucher.Status.SUBMITTED:
            return Response({"detail": f'Status is "{expense.status}" -- must be "submitted".'}, status=status.HTTP_400_BAD_REQUEST)
        expense.status = ExpenseVoucher.Status.APPROVED
        expense.save(update_fields=["status"])
        return Response(ExpenseVoucherSerializer(expense).data)

    @action(detail=True, methods=["post"])
    def post_expense(self, request, pk=None):
        expense = self.get_object()
        if expense.status != ExpenseVoucher.Status.APPROVED:
            return Response({"detail": f'Status is "{expense.status}" -- must be "approved" to post.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            expense = ExpenseVoucher.objects.select_for_update().get(pk=expense.pk)
            if expense.status != ExpenseVoucher.Status.APPROVED:
                return Response({"detail": "Status changed before posting could complete -- please retry."}, status=status.HTTP_409_CONFLICT)

            if expense.payment_method == ExpenseVoucher.PaymentMethod.CUSTODY:
                custody = Custody.objects.select_for_update().get(pk=expense.custody_id)
                if expense.amount > custody.remaining:
                    return Response({"detail": f"Amount exceeds remaining custody balance ({custody.remaining}) -- someone else may have charged this custody first."}, status=status.HTTP_409_CONFLICT)
                credit_account = custody.custody_account
                custody.spent = custody.spent + expense.amount
                custody.save(update_fields=["spent"])
            else:
                credit_account = expense.treasury_account

            lines_data = [(expense.expense_account, expense.amount, Decimal("0"))]
            total_credit = expense.amount
            if expense.vat_amount and expense.vat_amount > 0:
                if not expense.vat_account:
                    return Response({"detail": "vat_account is required when vat_amount is set."}, status=status.HTTP_400_BAD_REQUEST)
                lines_data.append((expense.vat_account, expense.vat_amount, Decimal("0")))
                total_credit = expense.amount + expense.vat_amount
            lines_data.append((credit_account, Decimal("0"), total_credit))

            entry = create_and_post_entry(
                date=expense.date, description=f"{expense.category} -- {expense.description}",
                reference=expense.number,
                lines_data=lines_data,
                user=request.user,
            )
            expense.status = ExpenseVoucher.Status.POSTED
            expense.journal_entry = entry
            expense.save(update_fields=["status", "journal_entry"])

        return Response(ExpenseVoucherSerializer(expense).data)

    @action(detail=True, methods=["post"])
    def confirm_and_post(self, request, pk=None):
        expense = self.get_object()
        if expense.status != ExpenseVoucher.Status.DRAFT:
            return Response({"detail": "Status must be draft to confirm and post immediately."}, status=status.HTTP_400_BAD_REQUEST)

        expense.status = ExpenseVoucher.Status.APPROVED
        expense.save(update_fields=["status"])
        return self.post_expense(request, pk=pk)

    @action(detail=True, methods=["post"])
    def reverse(self, request, pk=None):
        expense = self.get_object()
        if expense.status != ExpenseVoucher.Status.POSTED:
            return Response({"detail": f'Status is "{expense.status}" -- must be "posted" to reverse.'}, status=status.HTTP_400_BAD_REQUEST)
        if hasattr(expense, "reversed_by"):
            return Response({"detail": "This expense has already been reversed."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            expense = ExpenseVoucher.objects.select_for_update().get(pk=expense.pk)
            if hasattr(expense, "reversed_by"):
                return Response({"detail": "This expense has already been reversed."}, status=status.HTTP_400_BAD_REQUEST)

            if expense.payment_method == ExpenseVoucher.PaymentMethod.CUSTODY:
                custody = Custody.objects.select_for_update().get(pk=expense.custody_id)
                credit_account = custody.custody_account
                custody.spent = custody.spent - expense.amount
                custody.save(update_fields=["spent"])
            else:
                credit_account = expense.treasury_account

            reversing = ExpenseVoucher.objects.create(
                number=f"EXP-{ExpenseVoucher.objects.count() + 1:04d}", date=request.data.get("date") or expense.date,
                category=expense.category, amount=expense.amount, payment_method=expense.payment_method,
                treasury_account=expense.treasury_account, custody=expense.custody, expense_account=expense.expense_account,
                description=f"Reversal of {expense.number}", status=ExpenseVoucher.Status.POSTED,
                reverses=expense, created_by=request.user,
            )
            entry = create_and_post_entry(
                date=reversing.date, description=f"Reversal -- {expense.category} -- {expense.description}",
                reference=reversing.number,
                lines_data=[(credit_account, expense.amount, Decimal("0")), (expense.expense_account, Decimal("0"), expense.amount)],
                user=request.user,
            )
            reversing.journal_entry = entry
            reversing.save(update_fields=["journal_entry"])

        return Response(ExpenseVoucherSerializer(reversing).data, status=status.HTTP_201_CREATED)


class VoucherViewSet(viewsets.ModelViewSet):
    queryset = Voucher.objects.select_related("party", "treasury_account", "party_control_account", "created_by").all()
    serializer_class = VoucherSerializer
    permission_classes = [IsAuthenticated, IsAccountingRole]

    def get_queryset(self):
        qs = super().get_queryset()
        voucher_type = self.request.query_params.get("type")
        if voucher_type:
            qs = qs.filter(type=voucher_type)
        voucher_status = self.request.query_params.get("status")
        if voucher_status:
            qs = qs.filter(status=voucher_status)
        party_id = self.request.query_params.get("party")
        if party_id:
            qs = qs.filter(party_id=party_id)
        return qs

    def perform_create(self, serializer):
        voucher_type = serializer.validated_data["type"]
        prefix = "REC" if voucher_type == Voucher.VoucherType.RECEIPT else "PAY"
        count = Voucher.objects.filter(type=voucher_type).count()
        serializer.save(created_by=self.request.user, number=f"{prefix}-{count + 1:04d}")

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.status != Voucher.Status.DRAFT:
            raise ValidationError({"detail": "Only a draft voucher can be edited."})
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.status != Voucher.Status.DRAFT:
            raise ValidationError({"detail": "Only a draft voucher can be deleted."})
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        voucher = self.get_object()
        if voucher.status != Voucher.Status.DRAFT:
            return Response({"detail": f'Status is "{voucher.status}" -- must be "draft".'}, status=status.HTTP_400_BAD_REQUEST)
        voucher.status = Voucher.Status.SUBMITTED
        voucher.save(update_fields=["status"])
        return Response(VoucherSerializer(voucher).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        voucher = self.get_object()
        if voucher.status != Voucher.Status.SUBMITTED:
            return Response({"detail": f'Status is "{voucher.status}" -- must be "submitted".'}, status=status.HTTP_400_BAD_REQUEST)
        voucher.status = Voucher.Status.APPROVED
        voucher.save(update_fields=["status"])
        return Response(VoucherSerializer(voucher).data)

    @action(detail=True, methods=["post"])
    def post_voucher(self, request, pk=None):
        voucher = self.get_object()
        if voucher.status != Voucher.Status.APPROVED:
            return Response({"detail": f'Status is "{voucher.status}" -- must be "approved" to post.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            voucher = Voucher.objects.select_for_update().get(pk=voucher.pk)
            if voucher.status != Voucher.Status.APPROVED:
                return Response({"detail": "Status changed before posting could complete -- please retry."}, status=status.HTTP_409_CONFLICT)

            party = Party.objects.select_for_update().get(pk=voucher.party_id)

            if voucher.type == Voucher.VoucherType.RECEIPT:
                lines_data = [(voucher.treasury_account, voucher.amount, Decimal("0")), (voucher.party_control_account, Decimal("0"), voucher.amount)]
                party.balance = party.balance - voucher.amount
            else:
                lines_data = [(voucher.party_control_account, voucher.amount, Decimal("0")), (voucher.treasury_account, Decimal("0"), voucher.amount)]
                party.balance = party.balance + voucher.amount

            party.save(update_fields=["balance"])

            entry = create_and_post_entry(
                date=voucher.date, description=f"{voucher.get_type_display()} -- {voucher.party.full_name} -- {voucher.description}",
                reference=voucher.number, lines_data=lines_data, user=request.user,
            )
            voucher.status = Voucher.Status.POSTED
            voucher.journal_entry = entry
            voucher.save(update_fields=["status", "journal_entry"])

        return Response(VoucherSerializer(voucher).data)

    @action(detail=True, methods=["post"])
    def reverse(self, request, pk=None):
        voucher = self.get_object()
        if voucher.status != Voucher.Status.POSTED:
            return Response({"detail": f'Status is "{voucher.status}" -- must be "posted" to reverse.'}, status=status.HTTP_400_BAD_REQUEST)
        if hasattr(voucher, "reversed_by"):
            return Response({"detail": "This voucher has already been reversed."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            voucher = Voucher.objects.select_for_update().get(pk=voucher.pk)
            if hasattr(voucher, "reversed_by"):
                return Response({"detail": "This voucher has already been reversed."}, status=status.HTTP_400_BAD_REQUEST)

            party = Party.objects.select_for_update().get(pk=voucher.party_id)

            prefix = "REC" if voucher.type == Voucher.VoucherType.RECEIPT else "PAY"
            count = Voucher.objects.filter(type=voucher.type).count()
            reversing = Voucher.objects.create(
                number=f"{prefix}-{count + 1:04d}", type=voucher.type, date=request.data.get("date") or voucher.date,
                party=voucher.party, amount=voucher.amount, treasury_account=voucher.treasury_account,
                party_control_account=voucher.party_control_account, description=f"Reversal of {voucher.number}",
                status=Voucher.Status.POSTED, reverses=voucher, created_by=request.user,
            )

            if voucher.type == Voucher.VoucherType.RECEIPT:
                lines_data = [(voucher.party_control_account, voucher.amount, Decimal("0")), (voucher.treasury_account, Decimal("0"), voucher.amount)]
                party.balance = party.balance + voucher.amount
            else:
                lines_data = [(voucher.treasury_account, voucher.amount, Decimal("0")), (voucher.party_control_account, Decimal("0"), voucher.amount)]
                party.balance = party.balance - voucher.amount

            party.save(update_fields=["balance"])

            entry = create_and_post_entry(
                date=reversing.date, description=f"Reversal -- {voucher.party.full_name} -- {voucher.description}",
                reference=reversing.number, lines_data=lines_data, user=request.user,
            )
            reversing.journal_entry = entry
            reversing.save(update_fields=["journal_entry"])

        return Response(VoucherSerializer(reversing).data, status=status.HTTP_201_CREATED)

from django.utils import timezone

from .models import Invoice
from .serializers import InvoiceSerializer


def next_invoice_number():
    last = Invoice.objects.order_by("-id").first()
    next_n = (last.id + 1) if last else 1
    return f"INV-{next_n:04d}"


class InvoiceViewSet(viewsets.ModelViewSet):
    queryset = Invoice.objects.select_related("party", "created_by", "credits", "replaces").all()
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated, IsAccountingRole]

    def get_queryset(self):
        qs = super().get_queryset()
        invoice_status = self.request.query_params.get("status")
        if invoice_status:
            qs = qs.filter(status=invoice_status)
        party_id = self.request.query_params.get("party")
        if party_id:
            qs = qs.filter(party_id=party_id)
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(number__icontains=search)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, number=next_invoice_number())

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.is_issued:
            raise ValidationError({"detail": "An issued invoice can never be deleted -- use Credit Note & Re-issue instead."})
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def issue(self, request, pk=None):
        """
        Locks the invoice forever: sets is_issued=True, captures the
        signature/QR snapshot, and stamps issued_at. Nothing about
        total_amount, party, or the fields above can ever change again
        after this -- confirmed by the serializer's own validate().
        """
        invoice = self.get_object()
        if invoice.is_issued:
            return Response({"detail": "This invoice is already issued."}, status=status.HTTP_400_BAD_REQUEST)

        ar_account_id = request.data.get("ar_account")
        revenue_account_id = request.data.get("revenue_account")
        if not ar_account_id or not revenue_account_id:
            return Response({"detail": "ar_account and revenue_account are required to issue an invoice."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            ar_account = Account.objects.get(pk=ar_account_id)
            revenue_account = Account.objects.get(pk=revenue_account_id)
        except Account.DoesNotExist:
            return Response({"detail": "One of the selected accounts no longer exists."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
            if invoice.is_issued:
                return Response({"detail": "This invoice is already issued."}, status=status.HTTP_400_BAD_REQUEST)

            entry = create_and_post_entry(
                date=invoice.date, description=f"Invoice {invoice.number} -- {invoice.party.full_name}",
                reference=invoice.number,
                lines_data=[(ar_account, invoice.total_amount, Decimal("0")), (revenue_account, Decimal("0"), invoice.total_amount)],
                user=request.user,
            )

            invoice.is_issued = True
            invoice.status = Invoice.Status.ISSUED
            invoice.issued_at = timezone.now()
            invoice.signature_data = request.data.get("signature_data", "")
            invoice.qr_code_data = request.data.get("qr_code_data", "")
            invoice.ar_account = ar_account
            invoice.revenue_account = revenue_account
            invoice.journal_entry = entry
            invoice.save(update_fields=["is_issued", "status", "issued_at", "signature_data", "qr_code_data", "ar_account", "revenue_account", "journal_entry"])
            log_event(AuditLog.EventType.INVOICE_ISSUED, actor=request.user, request=request, entity_type="invoice", entity_id=invoice.id, description=f"Issued invoice {invoice.number} -- {invoice.total_amount}")

        return Response(InvoiceSerializer(invoice).data)

    @action(detail=True, methods=["post"])
    def credit_and_reissue(self, request, pk=None):
        """
        Never touches the original issued invoice's own fields -- creates
        a Credit Note (a locked, negative-amount Invoice referencing the
        original via credits) to neutralize it, then a brand-new
        replacement Invoice (linked via eplaces) with the corrected
        amount, ready to be issued separately. The original's number and
        total_amount stay exactly as printed, permanently, for audit
        trail integrity.
        """
        original = self.get_object()
        if not original.is_issued:
            return Response({"detail": "Only an issued invoice can be credited and re-issued."}, status=status.HTTP_400_BAD_REQUEST)
        if hasattr(original, "credited_by"):
            return Response({"detail": "This invoice has already been credited."}, status=status.HTTP_400_BAD_REQUEST)

        new_amount = request.data.get("new_amount")
        if new_amount is None:
            return Response({"detail": "new_amount is required."}, status=status.HTTP_400_BAD_REQUEST)
        new_amount = Decimal(str(new_amount))
        if new_amount <= 0:
            return Response({"detail": "new_amount must be greater than zero."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            original = Invoice.objects.select_for_update().get(pk=original.pk)
            if hasattr(original, "credited_by"):
                return Response({"detail": "This invoice has already been credited."}, status=status.HTTP_400_BAD_REQUEST)

            credit_note_entry = None
            if original.ar_account_id and original.revenue_account_id and original.journal_entry_id:
                credit_note_entry = create_and_post_entry(
                    date=timezone.now().date(), description=f"Credit Note cancelling {original.number}",
                    reference=original.number,
                    lines_data=[(original.revenue_account, original.total_amount, Decimal("0")), (original.ar_account, Decimal("0"), original.total_amount)],
                    user=request.user,
                )

            credit_note = Invoice.objects.create(
                number=next_invoice_number(), date=timezone.now().date(), party=original.party,
                booking_reference=original.booking_reference, total_amount=-original.total_amount,
                description=f"Credit Note cancelling {original.number}", status=Invoice.Status.ISSUED,
                is_issued=True, issued_at=timezone.now(), credits=original, created_by=request.user,
                ar_account=original.ar_account, revenue_account=original.revenue_account, journal_entry=credit_note_entry,
            )
            original.status = Invoice.Status.CREDITED
            original.save(update_fields=["status"])

            replacement = Invoice.objects.create(
                number=next_invoice_number(), date=timezone.now().date(), party=original.party,
                booking_reference=original.booking_reference, total_amount=new_amount,
                description=request.data.get("description", f"Replacement for {original.number}"),
                status=Invoice.Status.DRAFT, replaces=original, created_by=request.user,
            )

        return Response({
            "credit_note": InvoiceSerializer(credit_note).data,
            "replacement": InvoiceSerializer(replacement).data,
        }, status=status.HTTP_201_CREATED)


from .models import FinancialPeriod
from .serializers import FinancialPeriodSerializer


def is_date_locked(date):
    """
    Shared guard called from every posting action across Accounting --
    Journal Entries, Vouchers, Expenses, Custody. A locked period blocks
    any new financial mutation dated inside it, permanently.
    """
    return FinancialPeriod.objects.filter(year=date.year, month=date.month, is_locked=True).exists()


class FinancialPeriodViewSet(viewsets.ModelViewSet):
    queryset = FinancialPeriod.objects.select_related("closed_by").all()
    serializer_class = FinancialPeriodSerializer
    permission_classes = [IsAuthenticated, IsAccountingRole]
    http_method_names = ["get", "post", "head", "options"]  # never edited/deleted directly -- only created via open_period/closed via close

    @action(detail=False, methods=["post"])
    def open_period(self, request):
        year = request.data.get("year")
        month = request.data.get("month")
        if not year or not month:
            return Response({"detail": "year and month are required."}, status=status.HTTP_400_BAD_REQUEST)
        period, created = FinancialPeriod.objects.get_or_create(year=year, month=month)
        return Response(FinancialPeriodSerializer(period).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @action(detail=True, methods=["get"])
    def readiness_check(self, request, pk=None):
        """
        Pre-closing audit view: rolls up the month's live numbers without
        touching anything, and flags anything that would block closing.
        """
        period = self.get_object()
        if period.is_locked:
            return Response({"detail": "This period is already locked -- readiness check only applies to open periods."}, status=status.HTTP_400_BAD_REQUEST)

        from bookings.models import Booking

        month_start = f"{period.year:04d}-{period.month:02d}-01"
        next_month = period.month + 1 if period.month < 12 else 1
        next_year = period.year if period.month < 12 else period.year + 1
        month_end = f"{next_year:04d}-{next_month:02d}-01"

        pending_bookings_count = Booking.objects.filter(
            date__gte=month_start, date__lt=month_end, status=Booking.BookingStatus.PENDING, record_status=Booking.RecordStatus.ACTIVE,
        ).count()
        open_custody_count = Custody.objects.filter(date__gte=month_start, date__lt=month_end, status=Custody.Status.POSTED).count()

        # Issued invoices this month that still have an open balance --
        # every posted receipt voucher linked to that invoice's booking
        # counts against it, same logic as Booking.payment_summary.
        unpaid_invoices_count = 0
        for invoice in Invoice.objects.filter(date__gte=month_start, date__lt=month_end, status=Invoice.Status.ISSUED):
            if invoice.booking_id:
                collected = sum((v.amount for v in invoice.booking.vouchers.filter(status="posted", type="receipt")), Decimal("0"))
            else:
                collected = Decimal("0")
            if collected < invoice.total_amount:
                unpaid_invoices_count += 1

        draft_vouchers_count = Voucher.objects.filter(date__gte=month_start, date__lt=month_end, status=Voucher.Status.DRAFT).count()
        draft_expenses_count = ExpenseVoucher.objects.filter(date__gte=month_start, date__lt=month_end, status=ExpenseVoucher.Status.DRAFT).count()

        gross_profit = sum(
            (b.selling_rate - b.net_rate for b in Booking.objects.filter(
                date__gte=month_start, date__lt=month_end, status=Booking.BookingStatus.CONFIRMED, record_status=Booking.RecordStatus.ACTIVE,
            )), start=Decimal("0"),
        )
        total_expenses = ExpenseVoucher.objects.filter(
            date__gte=month_start, date__lt=month_end, status=ExpenseVoucher.Status.POSTED,
        ).aggregate(total=models_sum("amount"))["total"] or Decimal("0")

        ready_to_close = (
            pending_bookings_count == 0 and open_custody_count == 0
            and unpaid_invoices_count == 0 and draft_vouchers_count == 0 and draft_expenses_count == 0
        )

        return Response({
            "pending_bookings_count": pending_bookings_count,
            "open_custody_count": open_custody_count,
            "unpaid_invoices_count": unpaid_invoices_count,
            "draft_vouchers_count": draft_vouchers_count,
            "draft_expenses_count": draft_expenses_count,
            "ready_to_close": ready_to_close,
            "preview_gross_profit": str(gross_profit),
            "preview_total_expenses": str(total_expenses),
            "preview_net_profit": str(gross_profit - total_expenses),
        })

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        """
        Locks the period permanently. Refuses if pending bookings or open
        custody exist -- same rule as readiness_check, re-verified fresh
        here rather than trusting a stale check result from earlier.
        Freezes the final numbers onto this row so they never need
        recalculating again, and are still exactly readable months later
        even after new data changes what a live query would return.
        """
        period = self.get_object()
        if period.is_locked:
            return Response({"detail": "This period is already locked."}, status=status.HTTP_400_BAD_REQUEST)

        from bookings.models import Booking

        month_start = f"{period.year:04d}-{period.month:02d}-01"
        next_month = period.month + 1 if period.month < 12 else 1
        next_year = period.year if period.month < 12 else period.year + 1
        month_end = f"{next_year:04d}-{next_month:02d}-01"

        with transaction.atomic():
            period = FinancialPeriod.objects.select_for_update().get(pk=period.pk)
            if period.is_locked:
                return Response({"detail": "This period is already locked."}, status=status.HTTP_400_BAD_REQUEST)

            pending_bookings_count = Booking.objects.filter(
                date__gte=month_start, date__lt=month_end, status=Booking.BookingStatus.PENDING, record_status=Booking.RecordStatus.ACTIVE,
            ).count()
            open_custody_count = Custody.objects.filter(date__gte=month_start, date__lt=month_end, status=Custody.Status.POSTED).count()

            unpaid_invoices_count = 0
            for invoice in Invoice.objects.filter(date__gte=month_start, date__lt=month_end, status=Invoice.Status.ISSUED):
                if invoice.booking_id:
                    collected = sum((v.amount for v in invoice.booking.vouchers.filter(status="posted", type="receipt")), Decimal("0"))
                else:
                    collected = Decimal("0")
                if collected < invoice.total_amount:
                    unpaid_invoices_count += 1

            draft_vouchers_count = Voucher.objects.filter(date__gte=month_start, date__lt=month_end, status=Voucher.Status.DRAFT).count()
            draft_expenses_count = ExpenseVoucher.objects.filter(date__gte=month_start, date__lt=month_end, status=ExpenseVoucher.Status.DRAFT).count()

            if pending_bookings_count > 0 or open_custody_count > 0 or unpaid_invoices_count > 0 or draft_vouchers_count > 0 or draft_expenses_count > 0:
                return Response({
                    "detail": "Cannot close -- pending bookings, open custody, unpaid invoices, or draft vouchers/expenses exist for this period.",
                    "pending_bookings_count": pending_bookings_count, "open_custody_count": open_custody_count,
                    "unpaid_invoices_count": unpaid_invoices_count, "draft_vouchers_count": draft_vouchers_count,
                    "draft_expenses_count": draft_expenses_count,
                }, status=status.HTTP_400_BAD_REQUEST)

            gross_profit = sum(
                (b.selling_rate - b.net_rate for b in Booking.objects.filter(
                    date__gte=month_start, date__lt=month_end, status=Booking.BookingStatus.CONFIRMED, record_status=Booking.RecordStatus.ACTIVE,
                )), start=Decimal("0"),
            )
            total_expenses = ExpenseVoucher.objects.filter(
                date__gte=month_start, date__lt=month_end, status=ExpenseVoucher.Status.POSTED,
            ).aggregate(total=models_sum("amount"))["total"] or Decimal("0")
            pending_receivables = sum(
                (b.selling_rate - b.net_rate for b in Booking.objects.filter(
                    date__gte=month_start, date__lt=month_end, collection_status__in=["partial", "unpaid"], record_status=Booking.RecordStatus.ACTIVE,
                )), start=Decimal("0"),
            )

            period.total_gross_profit = gross_profit
            period.total_expenses = total_expenses
            period.net_profit = gross_profit - total_expenses
            period.pending_receivables = pending_receivables
            period.is_locked = True
            period.closed_by = request.user
            period.closed_at = timezone.now()
            period.save()
            log_event(AuditLog.EventType.PERIOD_CLOSED, actor=request.user, request=request, entity_type="financial_period", entity_id=period.id, description=f"Closed period {period.year}-{period.month:02d} -- net profit {period.net_profit}")

        return Response(FinancialPeriodSerializer(period).data)


from rest_framework.views import APIView

from bookings.models import Booking


class BookingAccountingApprovalView(APIView):
    permission_classes = [IsAuthenticated, IsAccountingRole]

    def get(self, request):
        # Pending Accounting Approval queue -- every confirmed booking
        # not yet locked, from all three departments together.
        bookings = Booking.objects.filter(
            status=Booking.BookingStatus.CONFIRMED, record_status=Booking.RecordStatus.ACTIVE,
            accounting_status=Booking.AccountingStatus.PENDING,
        ).select_related("created_by").order_by("-date")

        rows = [{
            "id": b.id, "department": b.department, "date": b.date, "passenger_name": b.passenger_name,
            "customer_name": b.customer_name, "supplier": b.supplier, "net_rate": str(b.net_rate),
            "selling_rate": str(b.selling_rate), "profit": str(b.selling_rate - b.net_rate), "currency": b.currency,
        } for b in bookings]

        return Response({"results": rows})

    def post(self, request, pk=None):
        """
        Approve & Lock: generates one balanced 4-line journal entry --
        AR/Revenue for the sell side, COGS/AP for the buy side -- and
        marks the booking as accounting_status=locked so it can never be
        approved (and double-posted) again. Fully atomic: either the
        entry posts and the booking locks, or neither happens.
        """
        booking = Booking.objects.filter(pk=pk).first()
        if not booking:
            return Response({"detail": "Booking not found."}, status=status.HTTP_404_NOT_FOUND)
        if booking.accounting_status == Booking.AccountingStatus.LOCKED:
            return Response({"detail": "This booking is already approved and locked."}, status=status.HTTP_400_BAD_REQUEST)
        if booking.status != Booking.BookingStatus.CONFIRMED:
            return Response({"detail": "Only confirmed bookings can be approved for accounting."}, status=status.HTTP_400_BAD_REQUEST)

        ar_account_id = request.data.get("ar_account")
        revenue_account_id = request.data.get("revenue_account")
        cogs_account_id = request.data.get("cogs_account")
        ap_account_id = request.data.get("ap_account")
        if not all([ar_account_id, revenue_account_id, cogs_account_id, ap_account_id]):
            return Response({"detail": "ar_account, revenue_account, cogs_account, and ap_account are all required."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            booking = Booking.objects.select_for_update().get(pk=pk)
            if booking.accounting_status == Booking.AccountingStatus.LOCKED:
                return Response({"detail": "This booking was locked by someone else just now -- please refresh."}, status=status.HTTP_409_CONFLICT)

            try:
                ar_account = Account.objects.get(pk=ar_account_id)
                revenue_account = Account.objects.get(pk=revenue_account_id)
                cogs_account = Account.objects.get(pk=cogs_account_id)
                ap_account = Account.objects.get(pk=ap_account_id)
            except Account.DoesNotExist:
                return Response({"detail": "One or more of the selected accounts no longer exists."}, status=status.HTTP_400_BAD_REQUEST)

            entry = create_and_post_entry(
                date=booking.date,
                description=f"Accounting approval -- {booking.get_department_display()} -- {booking.passenger_name}",
                reference=f"BK-{booking.id}",
                lines_data=[
                    (ar_account, booking.selling_rate, Decimal("0")),
                    (revenue_account, Decimal("0"), booking.selling_rate),
                    (cogs_account, booking.net_rate, Decimal("0")),
                    (ap_account, Decimal("0"), booking.net_rate),
                ],
                user=request.user,
            )

            booking.accounting_status = Booking.AccountingStatus.LOCKED
            booking.accounting_journal_entry_id = entry.id
            booking.save(update_fields=["accounting_status", "accounting_journal_entry_id"])

            log_event(AuditLog.EventType.ACCOUNTING_POSTED, actor=request.user, request=request, entity_type="booking_accounting_approval", entity_id=booking.id, description=f"Approved & locked booking #{booking.id} for accounting -- {booking.passenger_name}")

        return Response({
            "booking_id": booking.id, "accounting_status": booking.accounting_status,
            "journal_entry_id": entry.id, "journal_entry_number": entry.number,
        })


from .models import RecurringExpenseTemplate
from .serializers import RecurringExpenseTemplateSerializer


class RecurringExpenseTemplateViewSet(viewsets.ModelViewSet):
    queryset = RecurringExpenseTemplate.objects.select_related("treasury_account", "expense_account", "created_by").all()
    serializer_class = RecurringExpenseTemplateSerializer
    permission_classes = [IsAuthenticated, IsAccountingRole]

    def get_queryset(self):
        qs = super().get_queryset()
        active_only = self.request.query_params.get("active_only")
        if active_only == "true":
            qs = qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=["post"])
    def post_month(self, request):
        """
        One-click monthly run: takes {"lines": [{"template_id": N, "amount": X, "date": "Y"}, ...]}
        (the accountant's reviewed/adjusted amounts for this month) and
        generates one real, immediately-posted ExpenseVoucher per line
        -- fully atomic, so either every line posts or none do.
        """
        lines = request.data.get("lines", [])
        if not lines:
            return Response({"detail": "No lines provided."}, status=status.HTTP_400_BAD_REQUEST)

        created_vouchers = []
        with transaction.atomic():
            for line in lines:
                template = RecurringExpenseTemplate.objects.filter(pk=line.get("template_id"), is_active=True).first()
                if not template:
                    return Response({"detail": f"Template {line.get('template_id')} not found or inactive."}, status=status.HTTP_400_BAD_REQUEST)

                amount = Decimal(str(line.get("amount", template.default_amount)))
                if amount <= 0:
                    return Response({"detail": f"Amount for '{template.name}' must be greater than zero."}, status=status.HTTP_400_BAD_REQUEST)

                voucher = ExpenseVoucher.objects.create(
                    number=f"EXP-{ExpenseVoucher.objects.count() + 1:04d}",
                    date=line.get("date") or timezone.now().date(),
                    category=template.category, amount=amount, payment_method=ExpenseVoucher.PaymentMethod.BANK,
                    treasury_account=template.treasury_account, expense_account=template.expense_account,
                    description=f"Recurring: {template.name}", status=ExpenseVoucher.Status.APPROVED,
                    created_by=request.user,
                )

                entry = create_and_post_entry(
                    date=voucher.date, description=f"{voucher.category} -- {voucher.description}",
                    reference=voucher.number,
                    lines_data=[(voucher.expense_account, voucher.amount, Decimal("0")), (voucher.treasury_account, Decimal("0"), voucher.amount)],
                    user=request.user,
                )
                voucher.status = ExpenseVoucher.Status.POSTED
                voucher.journal_entry = entry
                voucher.save(update_fields=["status", "journal_entry"])
                created_vouchers.append(voucher)

            log_event(AuditLog.EventType.ACCOUNTING_POSTED, actor=request.user, request=request, entity_type="recurring_expenses_batch", entity_id=None, description=f"Posted {len(created_vouchers)} recurring expense(s) for the month.")

        return Response({"posted_count": len(created_vouchers), "voucher_ids": [v.id for v in created_vouchers]}, status=status.HTTP_201_CREATED)


    @action(detail=False, methods=["post"])
    def post_payroll_batch(self, request):
        """
        Salaries are different from other recurring lines: instead of one
        ExpenseVoucher per employee, every employee's (salary - deduction)
        is summed into ONE net total, posted as a single ExpenseVoucher
        and a single Journal Entry -- one line hitting the treasury for
        the combined net payout.
        """
        lines = request.data.get("lines", [])
        treasury_account_id = request.data.get("treasury_account")
        expense_account_id = request.data.get("expense_account")
        if not lines or not treasury_account_id or not expense_account_id:
            return Response({"detail": "lines, treasury_account, and expense_account are all required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            treasury_account = Account.objects.get(pk=treasury_account_id)
            expense_account = Account.objects.get(pk=expense_account_id)
        except Account.DoesNotExist:
            return Response({"detail": "One of the selected accounts no longer exists."}, status=status.HTTP_400_BAD_REQUEST)

        total_net = Decimal("0")
        breakdown = []
        for line in lines:
            salary = Decimal(str(line.get("salary", "0")))
            deduction = Decimal(str(line.get("deduction", "0")))
            net = salary - deduction
            if net < 0:
                return Response({"detail": f"Deduction exceeds salary for employee {line.get('employee_name', line.get('employee_id'))}."}, status=status.HTTP_400_BAD_REQUEST)
            total_net += net
            breakdown.append(f"{line.get('employee_name', '')}: {net}")

        if total_net <= 0:
            return Response({"detail": "Total payroll amount must be greater than zero."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            voucher = ExpenseVoucher.objects.create(
                number=f"EXP-{ExpenseVoucher.objects.count() + 1:04d}",
                date=request.data.get("date") or timezone.now().date(),
                category="Payroll", amount=total_net, payment_method=ExpenseVoucher.PaymentMethod.BANK,
                treasury_account=treasury_account, expense_account=expense_account,
                description=f"Monthly payroll -- {len(lines)} employee(s) -- " + "; ".join(breakdown[:5]),
                status=ExpenseVoucher.Status.APPROVED, created_by=request.user,
            )
            entry = create_and_post_entry(
                date=voucher.date, description=voucher.description, reference=voucher.number,
                lines_data=[(expense_account, total_net, Decimal("0")), (treasury_account, Decimal("0"), total_net)],
                user=request.user,
            )
            voucher.status = ExpenseVoucher.Status.POSTED
            voucher.journal_entry = entry
            voucher.save(update_fields=["status", "journal_entry"])

            log_event(AuditLog.EventType.ACCOUNTING_POSTED, actor=request.user, request=request, entity_type="payroll_batch", entity_id=voucher.id, description=f"Posted payroll batch -- {len(lines)} employees -- total {total_net}")

        return Response({"voucher_id": voucher.id, "voucher_number": voucher.number, "total_net": str(total_net)}, status=status.HTTP_201_CREATED)


class BookingCancellationView(APIView):
    """
    Reverses a booking's accounting approval when it gets cancelled --
    the exact mirror of BookingAccountingApprovalView.post(): posts a
    single balanced reversing Journal Entry (AR/Revenue/COGS/AP all
    flipped) and unlocks the booking's accounting_status. This is
    intentionally the clean, no-penalty base case; supplier/client
    cancellation fees are handled as separate follow-up Adjustment
    Entries in a later step, never mixed into this reversal itself.
    """

    permission_classes = [IsAuthenticated, IsAccountingRole]

    def post(self, request, pk=None):
        booking = Booking.objects.filter(pk=pk).first()
        if not booking:
            return Response({"detail": "Booking not found."}, status=status.HTTP_404_NOT_FOUND)
        if booking.accounting_status != Booking.AccountingStatus.LOCKED:
            return Response({"detail": "This booking was never approved for accounting -- nothing to reverse."}, status=status.HTTP_400_BAD_REQUEST)
        if not booking.accounting_journal_entry_id:
            return Response({"detail": "No journal entry is linked to this booking -- cannot reverse."}, status=status.HTTP_400_BAD_REQUEST)

        original_entry = JournalEntry.objects.filter(pk=booking.accounting_journal_entry_id).first()
        if not original_entry:
            return Response({"detail": "The original journal entry no longer exists."}, status=status.HTTP_400_BAD_REQUEST)
        if hasattr(original_entry, "reversed_by"):
            return Response({"detail": "This booking's accounting entry has already been reversed."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            booking = Booking.objects.select_for_update().get(pk=pk)
            original_entry = JournalEntry.objects.select_for_update().get(pk=original_entry.pk)
            if hasattr(original_entry, "reversed_by"):
                return Response({"detail": "This booking's accounting entry has already been reversed."}, status=status.HTTP_400_BAD_REQUEST)

            reason = request.data.get("reason", "Booking cancelled")
            reversing_entry = JournalEntry.objects.create(
                number=next_entry_number(), date=request.data.get("date") or timezone.now().date(),
                reference=original_entry.number,
                description=f"Cancellation reversal of {original_entry.number} -- {reason}",
                status=JournalEntry.Status.POSTED, reverses=original_entry, created_by=request.user,
            )
            for line in original_entry.lines.all():
                JournalLine.objects.create(
                    entry=reversing_entry, account=line.account,
                    debit=line.credit, credit=line.debit, memo=line.memo,
                )
            apply_posting_effect(reversing_entry, sign=1)

            # Penalties are separate Adjustment Entries layered on top of
            # the clean reversal above -- they never touch or replace it.
            # Supplier penalty: extra cost to the company, so it re-adds
            # part of the AP liability the reversal just cleared.
            # Client penalty: revenue kept from the customer, so it
            # re-adds part of the AR receivable the reversal just cleared.
            original_lines = list(original_entry.lines.select_related("account").all())
            ar_line = next((l for l in original_lines if l.debit > 0 and l.account.type == Account.AccountType.ASSET), None)
            ap_line = next((l for l in original_lines if l.credit > 0 and l.account.type == Account.AccountType.LIABILITY), None)

            supplier_penalty = Decimal(str(request.data.get("supplier_penalty") or "0"))
            client_penalty = Decimal(str(request.data.get("client_penalty") or "0"))
            penalty_entry = None

            if supplier_penalty > 0 or client_penalty > 0:
                penalty_lines_data = []

                if supplier_penalty > 0:
                    if not ap_line:
                        return Response({"detail": "Cannot apply a supplier penalty -- no AP line found on the original entry."}, status=status.HTTP_400_BAD_REQUEST)
                    supplier_penalty_account = Account.objects.filter(pk=request.data.get("supplier_penalty_account")).first()
                    if not supplier_penalty_account:
                        return Response({"detail": "supplier_penalty_account is required when supplier_penalty > 0."}, status=status.HTTP_400_BAD_REQUEST)
                    penalty_lines_data.append((supplier_penalty_account, supplier_penalty, Decimal("0")))
                    penalty_lines_data.append((ap_line.account, Decimal("0"), supplier_penalty))

                if client_penalty > 0:
                    if not ar_line:
                        return Response({"detail": "Cannot apply a client penalty -- no AR line found on the original entry."}, status=status.HTTP_400_BAD_REQUEST)
                    client_penalty_account = Account.objects.filter(pk=request.data.get("client_penalty_account")).first()
                    if not client_penalty_account:
                        return Response({"detail": "client_penalty_account is required when client_penalty > 0."}, status=status.HTTP_400_BAD_REQUEST)
                    penalty_lines_data.append((ar_line.account, client_penalty, Decimal("0")))
                    penalty_lines_data.append((client_penalty_account, Decimal("0"), client_penalty))

                penalty_entry = create_and_post_entry(
                    date=request.data.get("date") or timezone.now().date(),
                    description=f"Cancellation penalties -- {reason}", reference=original_entry.number,
                    lines_data=penalty_lines_data, user=request.user,
                )

            booking.accounting_status = Booking.AccountingStatus.PENDING
            booking.accounting_journal_entry_id = None
            booking.record_status = Booking.RecordStatus.CANCELLED
            booking.save(update_fields=["accounting_status", "accounting_journal_entry_id", "record_status"])

            log_event(AuditLog.EventType.ACCOUNTING_REVERSED, actor=request.user, request=request, entity_type="booking_cancellation", entity_id=booking.id, description=f"Cancelled and reversed booking #{booking.id} -- {reason} -- supplier penalty {supplier_penalty}, client penalty {client_penalty}")

            # Net refundable = whatever the customer already paid, minus
            # whatever penalty the company is keeping from them.
            posted_receipts = list(booking.vouchers.filter(status="posted", type="receipt").select_related("party", "treasury_account", "party_control_account"))
            total_collected = sum((v.amount for v in posted_receipts), Decimal("0"))
            net_refundable = total_collected - client_penalty

            # Draft Refund Voucher: created as a payment voucher, left in
            # Draft so an accountant still reviews and posts it manually
            # through the normal Treasury workflow -- this endpoint never
            # pushes money out the door on its own.
            refund_voucher = None
            if net_refundable > 0 and posted_receipts:
                reference_receipt = posted_receipts[0]
                prefix = "PAY"
                count = Voucher.objects.filter(type=Voucher.VoucherType.PAYMENT).count()
                refund_voucher = Voucher.objects.create(
                    number=f"{prefix}-{count + 1:04d}", type=Voucher.VoucherType.PAYMENT,
                    date=timezone.now().date(), party=reference_receipt.party, amount=net_refundable,
                    treasury_account=reference_receipt.treasury_account,
                    party_control_account=reference_receipt.party_control_account,
                    description=f"Refund for cancelled booking #{booking.id} -- {reason}",
                    status=Voucher.Status.DRAFT, booking=booking, created_by=request.user,
                )

        return Response({
            "booking_id": booking.id, "accounting_status": booking.accounting_status,
            "reversing_entry_id": reversing_entry.id, "reversing_entry_number": reversing_entry.number,
            "penalty_entry_id": penalty_entry.id if penalty_entry else None,
            "supplier_penalty": str(supplier_penalty), "client_penalty": str(client_penalty),
            "net_company_gain_loss": str(client_penalty - supplier_penalty),
            "total_collected": str(total_collected), "net_refundable": str(net_refundable),
            "refund_voucher_id": refund_voucher.id if refund_voucher else None,
            "refund_voucher_number": refund_voucher.number if refund_voucher else None,
        })
