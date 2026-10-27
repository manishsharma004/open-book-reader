FROM node:22-bookworm-slim AS web

WORKDIR /src/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web ./
ENV BASE_PATH=
RUN npm run build

FROM python:3.12-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY apps/server/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt
COPY apps/server /app/apps/server
COPY --from=web /src/apps/web/build /app/apps/web/build

WORKDIR /app/apps/server
EXPOSE 7507
CMD ["python", "-m", "uvicorn", "open_book.main:app", "--host", "0.0.0.0", "--port", "7507"]
