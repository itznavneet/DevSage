
from fastapi import FastAPI

app = FastAPI(title="DevSage AI Service")

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "devsage-ai",
    }
