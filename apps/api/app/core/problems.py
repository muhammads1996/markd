from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ProblemDetail(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        title: str,
        detail: str,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.title = title
        self.detail = detail


def problem_body(request: Request, problem: ProblemDetail) -> dict[str, Any]:
    request_id = getattr(request.state, "correlation_id", None)
    return {
        "type": f"https://api.markd/errors/{problem.code.lower()}",
        "title": problem.title,
        "status": problem.status_code,
        "code": problem.code,
        "detail": problem.detail,
        "correlation_id": request_id,
    }


async def problem_exception_handler(
    request: Request, exception: Exception
) -> JSONResponse:
    if not isinstance(exception, ProblemDetail):
        raise exception
    return JSONResponse(
        status_code=exception.status_code,
        content=problem_body(request, exception),
        media_type="application/problem+json",
    )


async def validation_exception_handler(
    request: Request, exception: Exception
) -> JSONResponse:
    if not isinstance(exception, RequestValidationError):
        raise exception
    return JSONResponse(
        status_code=422,
        content=problem_body(
            request,
            ProblemDetail(
                422,
                "VALIDATION_ERROR",
                "Validation error",
                "The request could not be processed.",
            ),
        ),
        media_type="application/problem+json",
    )