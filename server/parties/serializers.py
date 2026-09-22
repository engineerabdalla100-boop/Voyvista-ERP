from rest_framework import serializers

from .models import Party, PartyAlias, PartyContactNumber, PartySocialLink


def _generate_root_code(party_type: str) -> str:
    prefix = "CUST" if party_type == Party.Type.CUSTOMER else "SUP"
    existing_count = Party.objects.filter(type=party_type, parent_party__isnull=True).count()
    return f"{prefix}-{existing_count + 1:04d}"


class PartyContactNumberSerializer(serializers.ModelSerializer):
    class Meta:
        model = PartyContactNumber
        fields = ["id", "number", "label"]


class PartySocialLinkSerializer(serializers.ModelSerializer):
    class Meta:
        model = PartySocialLink
        fields = ["id", "platform", "handle_or_url"]


class PartySerializer(serializers.ModelSerializer):
    contact_numbers = PartyContactNumberSerializer(many=True, required=False)
    social_links = PartySocialLinkSerializer(many=True, required=False)

    class Meta:
        model = Party
        fields = [
            "id", "code", "type", "client_category", "parent_party",
            "relationship", "job_title", "full_name", "industry", "phone", "email", "address",
            "contact_numbers", "social_links",
            "currency", "credit_limit", "opening_balance", "balance",
            "passport_number", "passport_expiry", "date_of_birth", "national_id",
            "is_vip", "preferences", "record_status",
            "created_by", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "record_status", "created_by", "created_at", "updated_at"]

    def validate(self, attrs):
        client_category = attrs.get("client_category", getattr(self.instance, "client_category", None))
        relationship = attrs.get("relationship", "")
        job_title = attrs.get("job_title", "")
        parent_party = attrs.get("parent_party", getattr(self.instance, "parent_party", None))

        if parent_party is not None:
            if client_category == Party.ClientCategory.B2C and not relationship:
                raise serializers.ValidationError({"relationship": "Required for a B2C sub-member."})
            if client_category == Party.ClientCategory.B2B and not job_title:
                raise serializers.ValidationError({"job_title": "Required for a B2B sub-member."})

        return attrs

    def create(self, validated_data):
        contact_numbers_data = validated_data.pop("contact_numbers", [])
        social_links_data = validated_data.pop("social_links", [])

        parent_party = validated_data.get("parent_party")
        if parent_party is not None:
            validated_data["code"] = parent_party.code
        # Otherwise: leave "code" untouched. If the caller supplied one
        # manually it's respected as-is; if not, Party.save() generates
        # the unified VV-CUS-000001 code itself.

        party = Party.objects.create(**validated_data)
        self._replace_related(party, contact_numbers_data, social_links_data)
        return party

    def update(self, instance, validated_data):
        contact_numbers_data = validated_data.pop("contact_numbers", None)
        social_links_data = validated_data.pop("social_links", None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if contact_numbers_data is not None or social_links_data is not None:
            self._replace_related(
                instance,
                contact_numbers_data if contact_numbers_data is not None else [],
                social_links_data if social_links_data is not None else [],
                clear_all=True,
            )
        return instance

    @staticmethod
    def _replace_related(party, contact_numbers_data, social_links_data, clear_all=False):
        if clear_all:
            party.contact_numbers.all().delete()
            party.social_links.all().delete()
        for item in contact_numbers_data:
            PartyContactNumber.objects.create(party=party, **item)
        for item in social_links_data:
            PartySocialLink.objects.create(party=party, **item)

class PartyAliasSerializer(serializers.ModelSerializer):
    party_code = serializers.CharField(source="party.code", read_only=True)
    linked_by_name = serializers.CharField(source="linked_by.username", read_only=True)

    class Meta:
        model = PartyAlias
        fields = ["id", "party", "party_code", "alias_code", "note", "linked_by", "linked_by_name", "linked_at"]
        read_only_fields = ["id", "linked_by", "linked_at"]