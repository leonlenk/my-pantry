from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.utils.logger import setup_logging
from src.config import settings
from src.routers import extract, substitute, auth, sync
from loguru import logger
import uvicorn

setup_logging()

app = FastAPI(title="MyPantry Cloud API")

@app.on_event("startup")
def startup_event():
    logger.info(f"CORS allowed origin: chrome-extension://{settings.extension_id}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"chrome-extension://{settings.extension_id}",
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:8000",
        "http://127.0.0.1:8000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(extract.router)
app.include_router(substitute.router)
app.include_router(sync.router)
app.include_router(auth.router, prefix="/oauth", tags=["oauth"])

from fastapi.responses import HTMLResponse

@app.get("/")
def read_root():
    return {"message": "Welcome to the MyPantry Cloud API."}

@app.get("/auth/callback", response_class=HTMLResponse)
def auth_callback():
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Authorizing...</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background-color: #FDFBF7;
                color: #4A4036;
            }
            .loader {
                border: 3px solid #E8E3D9;
                border-top: 3px solid #E5B299;
                border-radius: 50%;
                width: 24px;
                height: 24px;
                animation: spin 1s linear infinite;
                margin-bottom: 1rem;
            }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            p { margin: 0; font-size: 1.1rem; }
            .sub { color: #8C7F70; font-size: 0.9rem; margin-top: 0.5rem; }
        </style>
    </head>
    <body>
        <div class="loader"></div>
        <p>Completing login...</p>
        <span class="sub">This tab will close automatically.</span>
    </body>
    </html>
    """

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
