FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl zstd && rm -rf /var/lib/apt/lists/*
ARG LEAN_VERSION=4.28.0
ARG LEAN_SHA256=ceb3a3f844f7aebf63245e2b51c28d5b0ed38942c19f93cf3febd520302160bd
RUN curl --fail --location "https://github.com/leanprover/lean4/releases/download/v${LEAN_VERSION}/lean-${LEAN_VERSION}-linux.tar.zst" -o /tmp/lean.tar.zst \
    && echo "${LEAN_SHA256}  /tmp/lean.tar.zst" | sha256sum -c - \
    && mkdir /opt/lean \
    && tar --zstd -xf /tmp/lean.tar.zst -C /opt/lean --strip-components=1 \
    && rm /tmp/lean.tar.zst
ENV PATH="/opt/lean/bin:${PATH}"
COPY lean/verify.sh /opt/panoptes/verify.sh
RUN chmod 755 /opt/panoptes/verify.sh
WORKDIR /work
ENTRYPOINT ["/opt/panoptes/verify.sh"]
