#FROM python:3.13-slim
FROM python:3.9.6

WORKDIR /app

RUN apt-get -y update \
    && apt-get install -y --no-install-recommends build-essential cython3 gfortran cmake pkg-config libopenblas-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && adduser --disabled-password --gecos "" appuser \
    && chown -R appuser /app

ENV \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PATH="${PATH}:/home/appuser/.local/bin" \
  TZ="Europe/Paris"

USER appuser
COPY --chown=appuser ./docker/requirements.txt .

RUN python -m pip install -r ./requirements.txt

COPY --chown=appuser . .

CMD ["python3", "model.py"]
