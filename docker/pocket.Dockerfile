FROM python:3.12-slim-bookworm

ARG TORCH_BACKEND=cpu

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY services/pocket/requirements.txt /tmp/pocket-requirements.txt
COPY docker/install-torch.sh /tmp/install-torch.sh
RUN chmod +x /tmp/install-torch.sh \
    && TORCH_BACKEND="${TORCH_BACKEND}" /tmp/install-torch.sh \
    && rm /tmp/install-torch.sh /tmp/pocket-requirements.txt

WORKDIR /app
COPY services/pocket/app.py /app/app.py

ENV POCKET_HOST=0.0.0.0 \
    POCKET_PORT=7508
EXPOSE 7508
CMD ["python", "/app/app.py"]
