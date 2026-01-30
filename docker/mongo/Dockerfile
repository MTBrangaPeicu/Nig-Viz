FROM mongo:8.2

RUN apt-get -y update \
    && apt-get install -y python3-bcrypt \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
