"""Tiny local receiver for the card generator: POST /save?name=x.png writes cards/x.png."""

import http.server
import os
import urllib.parse

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "cards"))


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
        if not name.endswith(".png"):
            name += ".png"
        data = self.rfile.read(int(self.headers["Content-Length"]))
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, name), "wb") as file:
            file.write(data)
        self.send_response(200)
        self.cors()
        self.end_headers()
        self.wfile.write(b"ok")


http.server.HTTPServer(("127.0.0.1", 8001), Handler).serve_forever()
