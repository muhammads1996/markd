FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

COPY pyproject.toml ./
RUN pip install --no-cache-dir \
    "fastapi>=0.116,<1.0" \
    "httpx>=0.28,<1.0" \
    "psycopg[binary,pool]>=3.2,<4.0" \
    "pyjwt[crypto]>=2.10,<3.0" \
    "python-multipart>=0.0.20,<1.0" \
    "pydantic-settings>=2.10,<3.0" \
    "uvicorn[standard]>=0.35,<1.0" \
    && useradd --create-home --uid 10001 markd

COPY app ./app
COPY run.py ./run.py

USER markd
EXPOSE 8000
CMD ["sh", "-c", "if [ \"$MARKD_PROCESS_ROLE\" = worker ]; then python run.py worker --continuous; else python run.py; fi"]