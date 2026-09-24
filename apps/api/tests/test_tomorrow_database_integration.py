"""Exercise the Tomorrow SQL against canonical tables, without persisting fixtures."""

import asyncio
import os
import sys
from datetime import date, timedelta
from uuid import uuid4

import psycopg
import pytest
from psycopg.rows import dict_row

from app.api.v1.tomorrow import TomorrowReadModel, _projection, _tomorrow_rows

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


@pytest.mark.asyncio
async def test_tomorrow_query_reconciles_requirement_and_assignment() -> None:
    database_url = os.getenv(
        "SUPABASE_DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    )
    try:
        connection = await psycopg.AsyncConnection.connect(
            database_url, row_factory=dict_row
        )
    except psycopg.OperationalError:
        pytest.skip("Local Supabase is unavailable.")

    request_id, requirement_id, assignment_id = uuid4(), uuid4(), uuid4()
    organisation_id, worker_id = uuid4(), uuid4()
    work_date = date.today() + timedelta(days=30)
    async with connection:
        try:
            await connection.execute(
                """insert into public.organisations(id, legal_name, display_name)
                   values (%s, 'Tomorrow SQL Synthetic', 'Tomorrow SQL Synthetic')""",
                (organisation_id,),
            )
            await connection.execute(
                """insert into public.people(id, display_name)
                   values (%s, 'Tomorrow SQL Worker')""",
                (worker_id,),
            )
            await connection.execute(
                "insert into public.worker_profiles(person_id) values (%s)",
                (worker_id,),
            )
            await connection.execute(
                """insert into public.labour_requests(
                     id, organisation_id, needed_from, needed_to, needed_at,
                     headcount, lifecycle, source, timezone
                   ) values (%s, %s, %s, %s, '07:30', 3, 'active',
                             'pytest synthetic fixture', 'Africa/Johannesburg')""",
                (request_id, organisation_id, work_date, work_date),
            )
            await connection.execute(
                """insert into public.labour_requirements(
                     id, labour_request_id, work_type, headcount
                   ) values (%s, %s, 'Plastering', 3)""",
                (requirement_id, request_id),
            )
            await connection.execute(
                """insert into public.assignments(
                     id, labour_request_id, labour_requirement_id, worker_id,
                     organisation_id, starts_on, ends_on, lifecycle,
                     worker_response, contractor_confirmation, offered_at, source
                   ) values (%s, %s, %s, %s, %s, %s, %s, 'active', 'pending',
                             'pending', now(), 'pytest synthetic fixture')""",
                (
                    assignment_id,
                    request_id,
                    requirement_id,
                    worker_id,
                    organisation_id,
                    work_date,
                    work_date,
                ),
            )
            rows = await _tomorrow_rows(connection, work_date)
            request = next(
                row for row in rows if row["labour_request_id"] == request_id
            )
            model = TomorrowReadModel.model_validate(
                {"date": work_date, **_projection([request])}
            )
            assert model.summary.positions_required == 3
            assert model.summary.covered_positions == 1
            assert model.summary.open_positions == 2
            assert model.summary.waiting_worker_response == 1
            assert model.summary.travel_ready == 0
            assert model.requests[0].assignments[0].bucket == "awaiting_worker_response"
        finally:
            await connection.rollback()
