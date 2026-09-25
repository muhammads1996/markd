"""Resolve the immutable actor snapshot captured with an inbound message."""

from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from app.core.auth import CurrentActor


@dataclass(frozen=True)
class ChannelPrincipal:
    event_id: UUID
    person_id: UUID
    role: Literal["worker", "hirer"]
    organisation_contact_id: UUID | None = None
    organisation_id: UUID | None = None

    def command_actor(self) -> CurrentActor:
        contacts = (
            [
                {
                    "organisation_contact_id": str(self.organisation_contact_id),
                    "organisation_id": str(self.organisation_id),
                }
            ]
            if self.role == "hirer"
            else []
        )
        return CurrentActor(
            user_id=None,
            claims={
                "participant_person_id": str(self.person_id),
                "worker_scope": self.role == "worker",
                "contractor_contacts": contacts,
            },
            channel_event_id=self.event_id,
            person_id=self.person_id,
            organisation_contact_id=self.organisation_contact_id,
        )

    def entity_ids(self) -> dict[str, str]:
        if self.role == "worker":
            return {"workerId": str(self.person_id)}
        return {
            "assertedById": str(self.person_id),
            "assertedRole": "hirer",
            "organisationContactId": str(self.organisation_contact_id),
            "organisationId": str(self.organisation_id),
        }


async def resolve_channel_principal(
    connection: Any, channel_event_id: str
) -> ChannelPrincipal | None:
    result = await connection.execute(
        """
        select event.id as event_id, evidence.person_id,
               worker.person_id as worker_id,
               contact.id as organisation_contact_id,
               organisation.id as organisation_id
        from public.channel_events as event
        join private.channel_actor_evidence as evidence
          on evidence.channel_event_id = event.id
         and evidence.resolution in ('worker', 'hirer')
        join public.people as person
          on person.id = evidence.person_id and person.archived_at is null
        left join public.worker_profiles as worker
          on worker.person_id = person.id
         and evidence.resolution = 'worker'
         and worker.archived_at is null and worker.record_status = 'active'
        left join public.organisation_contacts as contact
          on contact.id = evidence.organisation_contact_id
         and contact.person_id = person.id and contact.archived_at is null
         and evidence.resolution = 'hirer'
        left join public.organisations as organisation
          on organisation.id = evidence.organisation_id
         and organisation.id = contact.organisation_id
         and organisation.archived_at is null
         and organisation.record_status = 'active'
        where event.id = %s::uuid and event.channel = 'whatsapp'
          and event.event_type = 'message'
          and event.provider_message_id is not null
        """,
        (channel_event_id,),
    )
    rows = await result.fetchall()
    if len(rows) != 1:
        return None
    row = rows[0]
    worker = row["worker_id"] is not None
    hirer = (
        row["organisation_contact_id"] is not None
        and row["organisation_id"] is not None
    )
    if worker == hirer:
        return None
    return ChannelPrincipal(
        event_id=UUID(str(row["event_id"])),
        person_id=UUID(str(row["person_id"])),
        role="worker" if worker else "hirer",
        organisation_contact_id=(
            UUID(str(row["organisation_contact_id"])) if hirer else None
        ),
        organisation_id=UUID(str(row["organisation_id"])) if hirer else None,
    )
