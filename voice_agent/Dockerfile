# Image for the voice worker (voice quiz + voice coach). Self-contained: build it from this
# folder, which is what LiveKit Cloud does (`lk agent create` / `lk agent deploy` in voice_agent/):
#   docker build -t fde-voice-agent voice_agent
# Week content comes from the API (API_URL), so content/ doesn't need to be in the image.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY agent.py ./agent.py

RUN useradd --create-home appuser
USER appuser

# Download the turn-detection and VAD model files at build time, so the first call doesn't wait.
RUN python agent.py download-files

CMD ["python", "agent.py", "start"]
