# Image for the voice-quiz worker. LiveKit Cloud agents (`lk agent create`) and
# any always-on Docker host (for example a Render background worker) can run it.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app

COPY voice_agent/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY voice_agent/agent.py ./agent.py
COPY content /app/content
ENV CONTENT_DIR=/app/content

RUN useradd --create-home appuser
USER appuser

# Download the turn-detection and VAD model files at build time, so the first call doesn't wait.
RUN python agent.py download-files

CMD ["python", "agent.py", "start"]
