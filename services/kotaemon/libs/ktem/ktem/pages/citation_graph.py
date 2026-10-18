import html
from urllib.parse import urlparse

import gradio as gr
from decouple import config


class CitationGraphPage:
    """Embed the standalone citation graph service in Kotaemon."""

    def __init__(self, app):
        self._app = app
        service_url = config(
            "CITATION_GRAPH_URL",
            default="http://localhost:8001",
        ).strip()

        parsed = urlparse(service_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            service_url = "http://localhost:8001"

        safe_url = html.escape(service_url.rstrip("/"), quote=True)
        self.ui = gr.HTML(
            f"""
            <style>
              #citation-graph-shell {{
                height: calc(var(--main-area-height, 88vh) - 10px);
                min-height: 650px;
                overflow: hidden;
                border: 1px solid var(--border-color-primary);
                border-radius: 8px;
                background: #f3f5f6;
              }}
              #citation-graph-shell iframe {{
                display: block;
                width: 100%;
                height: 100%;
                border: 0;
                background: #f3f5f6;
              }}
              @media (max-width: 900px) {{
                #citation-graph-shell {{
                  height: 78vh;
                  min-height: 600px;
                }}
              }}
            </style>
            <div id="citation-graph-shell">
              <iframe
                src="{safe_url}"
                title="Citation Graph"
                loading="eager"
                referrerpolicy="no-referrer"
              ></iframe>
            </div>
            """,
            elem_id="citation-graph-embed",
        )
