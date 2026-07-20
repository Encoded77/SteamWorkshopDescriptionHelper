# The `playwright` dependency in package.json must match this tag exactly, or it
# looks for a browser revision that is not installed.
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

# Palette quantization for oversized preview PNGs.
RUN apt-get update \
    && apt-get install -y --no-install-recommends pngquant \
    && rm -rf /var/lib/apt/lists/*

# Dependencies first, so edits to src/ don't invalidate the npm layer.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

ENTRYPOINT ["npx", "tsx", "src/cli.ts"]
CMD ["build"]
