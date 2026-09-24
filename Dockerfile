FROM node:22-alpine AS ui
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY --from=ui /app/frontend/dist frontend/dist
EXPOSE 8000
CMD ["uvicorn", "causal_platform.api:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
