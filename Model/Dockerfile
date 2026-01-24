FROM python:3.13-slim

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

COPY --chown=appuser . .

USER appuser
RUN python -m pip install -r ./docker/requirements.txt

CMD ["python3", "model.py"]
