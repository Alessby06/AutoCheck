FROM node:20-slim

# Instalar dependencias necesarias del sistema para Chrome, Puppeteer, Xvfb y Python
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    chromium \
    xvfb \
    python3 \
    python3-pip \
    python3-venv \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Alias python -> python3 para compatibilidad con scripts que esperan 'python'
RUN ln -sf /usr/bin/python3 /usr/bin/python

# Configurar variables de entorno
ENV CHROME_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Copiar manifiestos e instalar dependencias
COPY package*.json ./
RUN npm ci --omit=dev

# Instalar dependencias Python (ddddocr + opencv-python-headless) en venv
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --upgrade pip && \
    /opt/venv/bin/pip install ddddocr opencv-python-headless

ENV PATH="/opt/venv/bin:$PATH"

# Copiar el codigo de la aplicacion
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
