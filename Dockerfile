# Production Dockerfile for Yimly Home Core (Python FastAPI)
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

EXPOSE 3000

# Start production Yimly Home Core Python FastAPI backend
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3000"]
