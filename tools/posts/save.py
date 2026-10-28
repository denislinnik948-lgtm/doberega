"""Tiny local receiver for the post generator: POST /save?name=x.jpg writes posts/x.jpg (posts/en/ with &dir=en, tools/posts/shots/ with &dir=shots)."""

import http.server
import os
import urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(ROOT, "..", "..", "posts"))
SHOTS = os.path.join(ROOT, "shots")


class Handler(http.server.BaseHTTPRequestHandler):
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_POST(self):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        name = os.path.basename(query.get("name", ["card.png"])[0])
        if not name.endswith((".png", ".jpg")):
            name += ".png"
        data = self.rfile.read(int(self.headers["Content-Length"]))
        folder = query.get("dir", [""])[0]
        out = SHOTS if folder == "shots" else os.path.join(OUT, "en") if folder == "en" else OUT
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, name), "wb") as file:
            file.write(data)
        self.send_response(200)
        self.cors()
        self.end_headers()
        self.wfile.write(b"ok")


http.server.HTTPServer(("127.0.0.1", 8002), Handler).serve_forever()
