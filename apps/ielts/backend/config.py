from os import getenv
from dotenv import load_dotenv

load_dotenv()

HOST: str = getenv("HOST", "0.0.0.0")
PORT: int = int(getenv("PORT", "8000"))
SYSTEM_PROMPT: str | None = getenv("SYSTEM_PROMPT", None)
SYSTEM_PROMPT_FILE: str | None = getenv("SYSTEM_PROMPT_FILE", None)
