from rest_framework import serializers

from .models import Event, EventCompany, EventTeamMember, ExpenseItem


class ExpenseItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseItem
        fields = ["id", "description", "category", "amount"]

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        return value


class EventCompanySerializer(serializers.ModelSerializer):
    class Meta:
        model = EventCompany
        fields = ["id", "name"]


class EventTeamMemberSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventTeamMember
        fields = ["id", "name", "role"]


class EventSerializer(serializers.ModelSerializer):
    expense_items = ExpenseItemSerializer(many=True, required=False)
    companies = EventCompanySerializer(many=True, required=False)
    team = EventTeamMemberSerializer(many=True, required=False)
    total_spent = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = Event
        fields = [
            "id", "location", "date", "people_count",
            "expense_items", "companies", "team", "total_spent",
            "created_by", "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

    def create(self, validated_data):
        expense_items_data = validated_data.pop("expense_items", [])
        companies_data = validated_data.pop("companies", [])
        team_data = validated_data.pop("team", [])

        event = Event.objects.create(**validated_data)
        self._replace_related(event, expense_items_data, companies_data, team_data)
        return event

    def update(self, instance, validated_data):
        expense_items_data = validated_data.pop("expense_items", None)
        companies_data = validated_data.pop("companies", None)
        team_data = validated_data.pop("team", None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if expense_items_data is not None or companies_data is not None or team_data is not None:
            self._replace_related(
                instance,
                expense_items_data if expense_items_data is not None else [],
                companies_data if companies_data is not None else [],
                team_data if team_data is not None else [],
                clear_all=True,
            )
        return instance

    @staticmethod
    def _replace_related(event, expense_items_data, companies_data, team_data, clear_all=False):
        if clear_all:
            event.expense_items.all().delete()
            event.companies.all().delete()
            event.team.all().delete()
        for item in expense_items_data:
            ExpenseItem.objects.create(event=event, **item)
        for company in companies_data:
            EventCompany.objects.create(event=event, **company)
        for member in team_data:
            EventTeamMember.objects.create(event=event, **member)