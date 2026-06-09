# InfraOS Design

InfraOS is the control layer for AIF objects.

In v0.1 it provides:

- FastAPI REST API
- WebSocket event stream
- SQLite object/log metadata
- AIF object registry loaded from `data/objects`
- subprocess bridge to the AInfra compiler
- subprocess bridge to InfraVM
- vanilla TypeScript dashboard for object inspection, graph viewing, and VM runs
- provider key-status reporting for OpenAI, Anthropic, Gemini, Microsoft, DeepSeek, Hugging Face, and Ollama

Peer-to-peer discovery, accounts, deployment, sandboxing, and plugin systems are intentionally stubbed.

Startup behavior:

1. Create/open SQLite database.
2. Load known `*.aif` files from `data/objects`.
3. Find the start object.
4. Do not execute automatically unless `INFRAOS_AUTOSTART=1`.
