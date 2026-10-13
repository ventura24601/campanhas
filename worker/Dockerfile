# Imagem oficial do Playwright (Node + Chromium compatíveis com playwright-core 1.63.0)
FROM mcr.microsoft.com/playwright:v1.63.0-noble

# ffmpeg (vídeo) + Python (recortes, PDF, fontes)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /tmp/requirements.txt \
    && python3 -c "from rembg import new_session; new_session('isnet-general-use')"

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV DATA_DIR=/data PORT=8080 NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
EXPOSE 8080
CMD ["node", "src/server.js"]
