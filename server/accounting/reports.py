from decimal import Decimal

from django.db.models import Sum
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from bookings.models import Booking
from core.base_models import AuditLog

from .models import Account, ExpenseVoucher, FinancialPeriod, JournalLine
from .views import IsAccountingRole


def month_bounds(year, month):
    month_start = f"{year:04d}-{month:02d}-01"
    next_month = month + 1 if month < 12 else 1
    next_year = year if month < 12 else year + 1
    month_end = f"{next_year:04d}-{next_month:02d}-01"
    return month_start, month_end


DEPARTMENT_LABELS = {"flight": "Flights", "hotel": "Hotels", "visa": "Visas"}


# Reads a closed month's frozen numbers straight from FinancialPeriod
# (fast, and stays historically accurate forever). For an open month,
# computes live from Booking + ExpenseVoucher -- same formula
# FinancialPeriod.close() uses, so the numbers match once the month
# is actually closed.
def _previous_month_summary(year, month):
    prev_month = month - 1 if month > 1 else 12
    prev_year = year if month > 1 else year - 1
    period = FinancialPeriod.objects.filter(year=prev_year, month=prev_month, is_locked=True).first()
    if not period:
        return None
    return {
        "year": prev_year, "month": prev_month, "source": "archived",
        "gross_profit": str(period.total_gross_profit),
        "total_expenses": str(period.total_expenses),
        "net_profit": str(period.net_profit),
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAccountingRole])
def profit_loss_report(request):
    year = int(request.query_params.get("year"))
    month = int(request.query_params.get("month"))
    compare = request.query_params.get("compare_with_previous") == "true"
    comparison = _previous_month_summary(year, month) if compare else None

    period = FinancialPeriod.objects.filter(year=year, month=month).first()
    if period and period.is_locked:
        return Response({
            "year": year, "month": month, "source": "archived",
            "gross_profit": str(period.total_gross_profit),
            "total_expenses": str(period.total_expenses),
            "net_profit": str(period.net_profit),
            "comparison": comparison,
        })

    month_start, month_end = month_bounds(year, month)
    bookings = Booking.objects.filter(
        date__gte=month_start, date__lt=month_end, status=Booking.BookingStatus.CONFIRMED, record_status=Booking.RecordStatus.ACTIVE,
    )

    by_department = {}
    for dept_key, dept_label in DEPARTMENT_LABELS.items():
        dept_profit = sum((b.selling_rate - b.net_rate for b in bookings.filter(department=dept_key)), start=Decimal("0"))
        by_department[dept_key] = str(dept_profit)

    gross_profit = sum((Decimal(v) for v in by_department.values()), start=Decimal("0"))
    total_expenses = ExpenseVoucher.objects.filter(
        date__gte=month_start, date__lt=month_end, status=ExpenseVoucher.Status.POSTED,
    ).aggregate(total=Sum("amount"))["total"] or Decimal("0")

    return Response({
        "year": year, "month": month, "source": "live",
        "comparison": comparison,
        "profit_by_department": by_department,
        "gross_profit": str(gross_profit),
        "total_expenses": str(total_expenses),
        "net_profit": str(gross_profit - total_expenses),
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAccountingRole])
def department_performance_report(request):
    year = int(request.query_params.get("year"))
    month = int(request.query_params.get("month"))
    month_start, month_end = month_bounds(year, month)

    bookings = Booking.objects.filter(
        date__gte=month_start, date__lt=month_end, status=Booking.BookingStatus.CONFIRMED, record_status=Booking.RecordStatus.ACTIVE,
    )

    rows = []
    total_profit = Decimal("0")
    for dept_key, dept_label in DEPARTMENT_LABELS.items():
        dept_bookings = list(bookings.filter(department=dept_key))
        count = len(dept_bookings)
        total_selling = sum((b.selling_rate for b in dept_bookings), start=Decimal("0"))
        total_net = sum((b.net_rate for b in dept_bookings), start=Decimal("0"))
        profit = total_selling - total_net
        total_profit += profit
        rows.append({
            "department": dept_key, "label": dept_label, "booking_count": count,
            "total_selling_rate": str(total_selling), "total_net_rate": str(total_net), "profit": str(profit),
        })

    for row in rows:
        row["profit_percentage"] = str(round((Decimal(row["profit"]) / total_profit * 100), 2)) if total_profit != 0 else "0.00"

    return Response({"year": year, "month": month, "departments": rows, "total_profit": str(total_profit)})


# Every posted movement on one account, in order, with a running
# balance -- reads straight from JournalLine, the single source of
# truth every posting action already writes to.
@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAccountingRole])
def ledger_report(request):
    account_id = request.query_params.get("account_id")
    if not account_id:
        return Response({"detail": "account_id is required."}, status=400)

    account = Account.objects.filter(pk=account_id).first()
    if not account:
        return Response({"detail": "Account not found."}, status=404)

    lines = JournalLine.objects.filter(account_id=account_id).select_related("entry").order_by("entry__date", "entry__id")

    date_from = request.query_params.get("date_from")
    date_to = request.query_params.get("date_to")
    if date_from:
        lines = lines.filter(entry__date__gte=date_from)
    if date_to:
        lines = lines.filter(entry__date__lte=date_to)

    running_balance = account.opening_balance
    rows = []
    for line in lines:
        net_effect = (line.debit - line.credit) if account.nature == Account.Nature.DEBIT else (line.credit - line.debit)
        running_balance += net_effect
        rows.append({
            "date": line.entry.date, "entry_number": line.entry.number, "description": line.entry.description,
            "memo": line.memo, "debit": str(line.debit), "credit": str(line.credit), "running_balance": str(running_balance),
        })

    return Response({
        "account": {"id": account.id, "code": account.code, "name": account.name, "opening_balance": str(account.opening_balance), "current_balance": str(account.balance)},
        "lines": rows,
    })


# Every account's current balance side by side -- total debit-nature
# balances must equal total credit-nature balances for the books to
# be genuinely in balance.
@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAccountingRole])
def trial_balance_report(request):
    accounts = Account.objects.exclude(status=Account.Status.INACTIVE).order_by("code")

    rows = []
    total_debit_side = Decimal("0")
    total_credit_side = Decimal("0")
    for account in accounts:
        if account.nature == Account.Nature.DEBIT:
            debit_col = account.balance if account.balance >= 0 else Decimal("0")
            credit_col = -account.balance if account.balance < 0 else Decimal("0")
        else:
            credit_col = account.balance if account.balance >= 0 else Decimal("0")
            debit_col = -account.balance if account.balance < 0 else Decimal("0")
        total_debit_side += debit_col
        total_credit_side += credit_col
        rows.append({"code": account.code, "name": account.name, "debit": str(debit_col), "credit": str(credit_col)})

    return Response({
        "accounts": rows, "total_debit": str(total_debit_side), "total_credit": str(total_credit_side),
        "is_balanced": total_debit_side == total_credit_side,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAccountingRole])
def audit_log_report(request):
    qs = AuditLog.objects.select_related("actor").filter(
        event_type__in=[
            AuditLog.EventType.ACCOUNTING_POSTED, AuditLog.EventType.ACCOUNTING_REVERSED,
            AuditLog.EventType.PERIOD_CLOSED, AuditLog.EventType.INVOICE_ISSUED, AuditLog.EventType.INVOICE_CREDITED,
        ]
    )

    event_type = request.query_params.get("event_type")
    if event_type:
        qs = qs.filter(event_type=event_type)
    user_id = request.query_params.get("user")
    if user_id:
        qs = qs.filter(actor_id=user_id)
    date_from = request.query_params.get("date_from")
    if date_from:
        qs = qs.filter(created_at__gte=date_from)
    date_to = request.query_params.get("date_to")
    if date_to:
        qs = qs.filter(created_at__lte=date_to)

    rows = [{
        "id": e.id, "event_type": e.event_type, "actor": e.actor.username if e.actor else None,
        "entity_type": e.entity_type, "entity_id": e.entity_id, "description": e.description, "created_at": e.created_at,
    } for e in qs[:200]]

    return Response({"results": rows})

# Age buckets: how many days since a Party's last posted movement
# (Voucher or Invoice), used as a proxy for how "old" their outstanding
# balance is -- simpler than tracking each individual invoice's own
# aging, and good enough for a monthly closing checklist.
AGING_BUCKETS = [(0, 30), (31, 60), (61, 90), (91, None)]


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAccountingRole])
def ar_ap_aging_report(request):
    from datetime import date as date_cls

    from parties.models import Party

    party_type = request.query_params.get("type", "customer")
    today = date_cls.today()

    parties = Party.objects.filter(type=party_type).exclude(balance=0)

    rows = []
    bucket_totals = {f"{b[0]}-{b[1] or '90+'}": Decimal("0") for b in AGING_BUCKETS}

    for party in parties:
        last_voucher = party.vouchers.filter(status="posted").order_by("-date").first()
        last_date = last_voucher.date if last_voucher else None
        days_old = (today - last_date).days if last_date else None

        bucket_label = "unknown"
        for low, high in AGING_BUCKETS:
            if days_old is None:
                break
            if high is None and days_old >= low:
                bucket_label = f"{low}-90+"
                break
            if high is not None and low <= days_old <= high:
                bucket_label = f"{low}-{high}"
                break

        if bucket_label in bucket_totals:
            bucket_totals[bucket_label] += party.balance

        rows.append({
            "party_id": party.id, "party_name": party.full_name, "balance": str(party.balance),
            "last_activity_date": last_date, "days_old": days_old, "bucket": bucket_label,
        })

    rows.sort(key=lambda r: (r["days_old"] is None, -(r["days_old"] or 0)))

    return Response({
        "type": party_type, "as_of": today,
        "rows": rows,
        "bucket_totals": {k: str(v) for k, v in bucket_totals.items()},
        "total_outstanding": str(sum((p.balance for p in parties), Decimal("0"))),
    })
