"""调试入口：python wsgi.py。生产用 gunicorn 'app:create_app()'。"""
from app import create_app

app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8810, debug=False)
