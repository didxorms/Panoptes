FROM python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7 AS builder

ARG OPENPROVER_COMMIT=e200251b34349ab6c34548d30319abde86cb6bc6
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && git clone https://github.com/Kripner/openprover.git /opt/openprover \
    && cd /opt/openprover \
    && git checkout "$OPENPROVER_COMMIT" \
    && test "$(git rev-parse HEAD)" = "$OPENPROVER_COMMIT"

FROM python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7
COPY --from=builder /opt/openprover/openprover /opt/openprover/openprover
COPY openprover/runner.py /opt/panoptes/runner.py
RUN chmod 755 /opt/panoptes/runner.py \
    && mkdir -p /run \
    && chown 1000:1000 /run

USER 1000:1000
WORKDIR /run
ENV PYTHONPATH=/opt/openprover
ENTRYPOINT ["python", "/opt/panoptes/runner.py"]
