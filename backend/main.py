# -*- coding: utf-8 -*-
"""
main.py
=======
Servidor FastAPI + Bot de Telegram corriendo juntos.
Todo en un solo proceso para que Railway lo despliegue fácil.
"""

import os
import json
import logging
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
import requests
from jinja2 import Environment, FileSystemLoader

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

# ============================================================
# CONFIGURACIÓN
# ============================================================
load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
ADMIN_ID = os.getenv("ADMIN_ID")
PORT = int(os.getenv("PORT", "8080"))
RAILWAY_URL = (
    os.getenv("RAILWAY_URL")
    or os.getenv("RAILWAY_PUBLIC_DOMAIN")
    or ""
).rstrip("/")

BASE_DIR = Path(__file__).resolve().parent.parent
REPORTS_DIR = BASE_DIR / "reports"
TEMPLATES_DIR = BASE_DIR / "templates"
MINI_APP_DIR = BASE_DIR / "mini-app"
DATA_DIR = BASE_DIR / "data"

REPORTS_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bot")

app = FastAPI(title="Mi Bot de Datos")

# Servir la Mini App como archivos estáticos
app.mount("/mini-app", StaticFiles(directory=str(MINI_APP_DIR)), name="mini-app")

# Jinja2
env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))

# Referencia global al bot de Telegram
bot_app = None


# ============================================================
# RUTAS DEL SERVIDOR WEB
# ============================================================
@app.get("/")
def inicio():
    return {"status": "ok", "mensaje": "El servidor está corriendo"}


@app.post("/telegram/webhook")
async def telegram_webhook(request: Request):
    """Entrega a Telegram las actualizaciones recibidas por webhook."""
    if bot_app is None:
        raise HTTPException(status_code=503, detail="El bot no está iniciado")

    datos = await request.json()
    update = Update.de_json(datos, bot_app.bot)
    await bot_app.process_update(update)
    return {"status": "ok"}


@app.post("/report")
async def recibir_reporte(request: Request):
    """Recibe los datos del Mini App, genera HTML y avisa al admin."""
    try:
        datos = await request.json()
        logger.info(f"Datos recibidos")

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        user_id = datos.get("telegram", {}).get("user", {}).get("id", "anonimo")

        # Guardar JSON crudo
        archivo_json = DATA_DIR / f"reporte_{user_id}_{timestamp}.json"
        with open(archivo_json, "w", encoding="utf-8") as f:
            json.dump(datos, f, ensure_ascii=False, indent=2)

        # Renderizar HTML
        template = env.get_template("report.html")
        html_content = template.render(**datos)

        archivo_html = REPORTS_DIR / f"reporte_{user_id}_{timestamp}.html"
        with open(archivo_html, "w", encoding="utf-8") as f:
            f.write(html_content)

        # Avisar al admin por Telegram
        await notificar_admin(user_id, datos, timestamp)

        return {
            "status": "ok",
            "report_id": f"{user_id}_{timestamp}"
        }
    except Exception as e:
        logger.exception("Error procesando reporte")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/report/{report_id}", response_class=HTMLResponse)
def ver_reporte(report_id: str):
    archivo = REPORTS_DIR / f"reporte_{report_id}.html"
    if not archivo.exists():
        raise HTTPException(status_code=404, detail="Reporte no encontrado")
    return FileResponse(archivo)


# ============================================================
# FUNCIÓN: AVISAR AL ADMIN
# ============================================================
async def notificar_admin(user_id, datos, timestamp):
    """Envía un mensaje al admin avisando que llegó un reporte."""
    if not bot_app or not ADMIN_ID:
        return
    try:
        nombre = datos.get("telegram", {}).get("user", {}).get("firstName", "Anónimo")
        url = f"{RAILWAY_URL}/report/{user_id}_{timestamp}"
        mensaje = f"📥 Nuevo reporte de {nombre} (ID: {user_id})\n\n🔗 {url}"
        await bot_app.bot.send_message(chat_id=ADMIN_ID, text=mensaje)
    except Exception as e:
        logger.error(f"Error avisando al admin: {e}")


# ============================================================
# BOT DE TELEGRAM (usa webhook para evitar conflictos entre instancias)
# ============================================================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Muestra botón para abrir la Mini App."""
    user = update.effective_user
    logger.info(f"Usuario {user.id} inició el bot")

    webapp_url = f"{RAILWAY_URL}/mini-app/"

    keyboard = [
        [InlineKeyboardButton("🚀 Abrir App", web_app=WebAppInfo(url=webapp_url))]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    await update.message.reply_text(
        f"¡Hola {user.first_name}! 👋\n\n"
        f"Presiona el botón para abrir la aplicación.",
        reply_markup=reply_markup
    )


@app.on_event("startup")
async def iniciar_bot_telegram():
    """Inicializa el bot y registra el webhook público de Railway."""
    global bot_app

    if not RAILWAY_URL:
        raise RuntimeError(
            "Configura RAILWAY_URL con la URL pública de Railway "
            "(por ejemplo, https://mi-servicio.up.railway.app)"
        )

    bot_app = Application.builder().token(BOT_TOKEN).build()
    bot_app.add_handler(CommandHandler("start", start))
    await bot_app.initialize()
    await bot_app.start()
    await bot_app.bot.set_webhook(
        url=f"{RAILWAY_URL}/telegram/webhook",
        drop_pending_updates=True,
    )
    logger.info("Bot de Telegram iniciado mediante webhook")


@app.on_event("shutdown")
async def detener_bot_telegram():
    """Elimina el webhook y detiene limpiamente la aplicación del bot."""
    if bot_app is not None:
        await bot_app.bot.delete_webhook()
        await bot_app.stop()
        await bot_app.shutdown()


# ============================================================
# INICIO: servidor web y bot mediante el ciclo de vida de FastAPI
# ============================================================
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT, reload=False)